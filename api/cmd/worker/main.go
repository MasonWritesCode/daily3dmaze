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
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	run, err := claimNextPendingRun(tx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if err := tx.Commit(); err != nil {
				return false, err
			}
			return false, nil
		}

		return false, err
	}

	validation := replay.EvaluateRun(run.Request)
	suspicionReasonsJSON, err := json.Marshal(validation.ReasonStrings())
	if err != nil {
		return false, err
	}
	verificationNotesJSON, err := json.Marshal(validation.VerificationNotes)
	if err != nil {
		return false, err
	}

	const updateQuery = `
		UPDATE runs
		SET
			suspicion_score = $2,
			suspicion_reasons_json = $3,
			verification_status = $4,
			verification_notes_json = $5
		WHERE id = $1
	`
	if _, err := tx.Exec(
		updateQuery,
		run.ID,
		validation.Score,
		suspicionReasonsJSON,
		string(validation.VerificationStatus),
		verificationNotesJSON,
	); err != nil {
		return false, err
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}

	log.Printf("worker verified run %d as %s", run.ID, validation.VerificationStatus)
	return true, nil
}

func claimNextPendingRun(tx *sql.Tx) (storedRun, error) {
	const query = `
		SELECT id, run_date::text, seed, move_count, elapsed_time_ms, replay_trace_json
		FROM runs
		WHERE verification_status = 'pending'
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

	if err := json.Unmarshal(replayTraceJSON, &run.Request.ReplayTrace); err != nil {
		return storedRun{}, err
	}

	return run, nil
}
