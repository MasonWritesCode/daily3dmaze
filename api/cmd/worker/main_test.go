package main

import (
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCalculateRetryDelay(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		attempts int
		want     time.Duration
	}{
		{name: "no attempts", attempts: 0, want: 0},
		{name: "first retry", attempts: 1, want: 30 * time.Second},
		{name: "second retry", attempts: 2, want: time.Minute},
		{name: "third retry", attempts: 3, want: 2 * time.Minute},
		{name: "cap reached", attempts: 10, want: 10 * time.Minute},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			if got := calculateRetryDelay(testCase.attempts); got != testCase.want {
				t.Fatalf("expected retry delay %s, got %s", testCase.want, got)
			}
		})
	}
}

func TestIsRunReadyForRetry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 23, 12, 0, 0, 0, time.UTC)

	if !isRunReadyForRetry(now, sql.NullTime{}, 0, sql.NullString{}) {
		t.Fatal("expected never-started pending run to be ready")
	}

	if isRunReadyForRetry(now, sql.NullTime{
		Time:  now.Add(-10 * time.Second),
		Valid: true,
	}, 1, sql.NullString{}) {
		t.Fatal("expected in-flight run inside timeout window to be blocked")
	}

	if !isRunReadyForRetry(now, sql.NullTime{
		Time:  now.Add(-31 * time.Second),
		Valid: true,
	}, 1, sql.NullString{}) {
		t.Fatal("expected stale in-flight run to be reclaimable")
	}

	if isRunReadyForRetry(now, sql.NullTime{
		Time:  now.Add(-20 * time.Second),
		Valid: true,
	}, 1, sql.NullString{
		String: "boom",
		Valid:  true,
	}) {
		t.Fatal("expected failed run inside retry backoff window to be blocked")
	}

	if !isRunReadyForRetry(now, sql.NullTime{
		Time:  now.Add(-31 * time.Second),
		Valid: true,
	}, 1, sql.NullString{
		String: "boom",
		Valid:  true,
	}) {
		t.Fatal("expected failed run after retry backoff window to be claimable")
	}
}

func TestClaimNextPendingRun(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 3, 23, 12, 0, 0, 0, time.UTC)
	workerNow = func() time.Time { return now }
	t.Cleanup(func() {
		workerNow = time.Now
	})

	trace := []map[string]any{
		{
			"elapsedTimeMs": 120,
			"action":        "move_forward",
		},
	}
	traceJSON, err := json.Marshal(trace)
	if err != nil {
		t.Fatalf("marshal trace: %v", err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, run_date::text, seed, move_count, elapsed_time_ms, replay_trace_json, verification_started_at, verification_attempts, verification_error
		FROM runs
		WHERE verification_status = 'pending'
		ORDER BY accepted_at ASC
		LIMIT 25
		FOR UPDATE SKIP LOCKED
	`)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"run_date",
			"seed",
			"move_count",
			"elapsed_time_ms",
			"replay_trace_json",
			"verification_started_at",
			"verification_attempts",
			"verification_error",
		}).AddRow(
			int64(7),
			"2026-03-21",
			"daily3dmaze:2026-03-21",
			1,
			120,
			traceJSON,
			nil,
			0,
			nil,
		))
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE runs
		SET
			verification_started_at = $2,
			verification_attempts = verification_attempts + 1,
			verification_error = NULL
		WHERE id = $1
	`)).
		WithArgs(int64(7), now.UTC()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	run, err := claimNextPendingRun(db)
	if err != nil {
		t.Fatalf("claim next pending run: %v", err)
	}

	if run.ID != 7 {
		t.Fatalf("expected run id 7, got %d", run.ID)
	}

	if len(run.Request.ReplayTrace) != 1 {
		t.Fatalf("expected replay trace length 1, got %d", len(run.Request.ReplayTrace))
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
