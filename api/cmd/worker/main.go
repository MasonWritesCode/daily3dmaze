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
	ID                   int64
	Request              replay.RunSubmission
	VerificationStarted  sql.NullTime
	VerificationAttempts int
	VerificationError    sql.NullString
}

var workerNow = time.Now

const (
	verificationRetryDelayBase  = 30 * time.Second
	verificationRetryDelayMax   = 10 * time.Minute
	verificationInFlightTimeout = 30 * time.Second
	verificationClaimBatchSize  = 25
)

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
		workerNow().UTC(),
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
		SELECT id, run_date::text, seed, move_count, elapsed_time_ms, replay_trace_json, verification_started_at, verification_attempts, verification_error
		FROM runs
		WHERE verification_status = 'pending'
		ORDER BY accepted_at ASC
		LIMIT 25
		FOR UPDATE SKIP LOCKED
	`

	rows, err := tx.Query(query)
	if err != nil {
		return storedRun{}, err
	}

	now := workerNow().UTC()
	var (
		run             storedRun
		replayTraceJSON []byte
		found           bool
	)
	for rows.Next() {
		var candidate storedRun
		var candidateReplayTraceJSON []byte
		if err := rows.Scan(
			&candidate.ID,
			&candidate.Request.Date,
			&candidate.Request.Seed,
			&candidate.Request.MoveCount,
			&candidate.Request.ElapsedTimeMs,
			&candidateReplayTraceJSON,
			&candidate.VerificationStarted,
			&candidate.VerificationAttempts,
			&candidate.VerificationError,
		); err != nil {
			return storedRun{}, err
		}

		if !isRunReadyForRetry(now, candidate.VerificationStarted, candidate.VerificationAttempts, candidate.VerificationError) {
			continue
		}

		run = candidate
		replayTraceJSON = candidateReplayTraceJSON
		found = true
		break
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		return storedRun{}, err
	}

	if err := rows.Close(); err != nil {
		return storedRun{}, err
	}

	if !found {
		if err := tx.Commit(); err != nil {
			return storedRun{}, err
		}
		return storedRun{}, sql.ErrNoRows
	}

	const claimUpdateQuery = `
		UPDATE runs
		SET
			verification_started_at = $2,
			verification_attempts = verification_attempts + 1,
			verification_error = NULL
		WHERE id = $1
	`
	if _, err := tx.Exec(claimUpdateQuery, run.ID, now); err != nil {
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

func isRunReadyForRetry(
	now time.Time,
	verificationStarted sql.NullTime,
	verificationAttempts int,
	verificationError sql.NullString,
) bool {
	if verificationError.Valid && verificationError.String != "" {
		if !verificationStarted.Valid {
			return true
		}

		return !verificationStarted.Time.UTC().Add(calculateRetryDelay(verificationAttempts)).After(now)
	}

	if !verificationStarted.Valid {
		return true
	}

	return !verificationStarted.Time.UTC().Add(verificationInFlightTimeout).After(now)
}

func calculateRetryDelay(verificationAttempts int) time.Duration {
	if verificationAttempts <= 0 {
		return 0
	}

	delay := verificationRetryDelayBase
	for range verificationAttempts - 1 {
		if delay >= verificationRetryDelayMax {
			return verificationRetryDelayMax
		}

		delay *= 2
	}

	if delay > verificationRetryDelayMax {
		return verificationRetryDelayMax
	}

	return delay
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
