package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"os"
	"time"

	"daily3dmaze/api/internal/replay"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type storedRun struct {
	ID      int64
	Request replay.RunSubmission
}

const verificationRetryDelay = 30 * time.Second

func main() {
	db, err := openWorkerDatabase()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	pollInterval := 2 * time.Second
	log.Printf("worker polling for pending run verification every %s", pollInterval)

	for {
		processed, err := processNextPendingRun(db)
		if err != nil {
			log.Printf("worker verification error: %v", err)
			time.Sleep(pollInterval)
			continue
		}

		if processed {
			continue
		}

		time.Sleep(pollInterval)
	}
}

func openWorkerDatabase() (*sql.DB, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://postgres:postgres@localhost:5432/daily3dmaze?sslmode=disable"
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, err
	}

	return db, nil
}

func processNextPendingRun(db *sql.DB) (bool, error) {
	run, err := claimNextPendingRun(db)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}

		return false, err
	}

	validation := replay.EvaluateRun(run.Request)
	suspicionReasonsJSON, err := json.Marshal(validation.ReasonStrings())
	if err != nil {
		if updateErr := markRunVerificationFailure(db, run.ID, err); updateErr != nil {
			return false, errors.Join(err, updateErr)
		}
		return true, nil
	}
	verificationNotesJSON, err := json.Marshal(validation.VerificationNotes)
	if err != nil {
		if updateErr := markRunVerificationFailure(db, run.ID, err); updateErr != nil {
			return false, errors.Join(err, updateErr)
		}
		return true, nil
	}

	const updateQuery = `
		UPDATE runs
		SET
			suspicion_score = $2,
			suspicion_reasons_json = $3,
			verification_status = $4,
			verification_notes_json = $5,
			verified_at = $6,
			verification_error = NULL
		WHERE id = $1
	`
	if _, err := db.Exec(
		updateQuery,
		run.ID,
		validation.Score,
		suspicionReasonsJSON,
		string(validation.VerificationStatus),
		verificationNotesJSON,
		time.Now().UTC(),
	); err != nil {
		return false, err
	}

	log.Printf("worker verified run %d as %s", run.ID, validation.VerificationStatus)
	return true, nil
}

func claimNextPendingRun(db *sql.DB) (storedRun, error) {
	tx, err := db.Begin()
	if err != nil {
		return storedRun{}, err
	}
	defer tx.Rollback()

	const query = `
		SELECT id, run_date::text, seed, move_count, elapsed_time_ms, replay_trace_json
		FROM runs
		WHERE verification_status = 'pending'
			AND (
				verification_started_at IS NULL
				OR verification_started_at < NOW() - INTERVAL '30 seconds'
			)
		ORDER BY accepted_at ASC
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`

	var (
		run             storedRun
		replayTraceJSON []byte
	)
	if err := tx.QueryRow(query).Scan(
		&run.ID,
		&run.Request.Date,
		&run.Request.Seed,
		&run.Request.MoveCount,
		&run.Request.ElapsedTimeMs,
		&replayTraceJSON,
	); err != nil {
		return storedRun{}, err
	}

	const claimUpdateQuery = `
		UPDATE runs
		SET
			verification_started_at = $2,
			verification_attempts = verification_attempts + 1,
			verification_error = NULL
		WHERE id = $1
	`
	if _, err := tx.Exec(claimUpdateQuery, run.ID, time.Now().UTC()); err != nil {
		return storedRun{}, err
	}

	if err := tx.Commit(); err != nil {
		return storedRun{}, err
	}

	if err := json.Unmarshal(replayTraceJSON, &run.Request.ReplayTrace); err != nil {
		if updateErr := markRunVerificationFailure(db, run.ID, err); updateErr != nil {
			return storedRun{}, errors.Join(err, updateErr)
		}
		return storedRun{}, err
	}

	return run, nil
}

type verificationFailureWriter interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func markRunVerificationFailure(executor verificationFailureWriter, runID int64, cause error) error {
	const failureQuery = `
		UPDATE runs
		SET
			verification_error = $2,
			verification_notes_json = $3
		WHERE id = $1
	`

	notesJSON, err := json.Marshal([]string{"worker_verification_failed"})
	if err != nil {
		return err
	}

	_, err = executor.Exec(failureQuery, runID, cause.Error(), notesJSON)
	return err
}
