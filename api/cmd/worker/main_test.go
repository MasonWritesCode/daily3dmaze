package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"testing"
	"time"

	"daily3dmaze/api/internal/replay"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestCalculateRetryDelay(t *testing.T) {
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

func TestProcessNextPendingRunPersistsVerificationResult(t *testing.T) {
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

	challenge := replay.GenerateDailyMaze(time.Date(2026, 3, 21, 0, 0, 0, 0, time.UTC))
	trace := buildReplayTraceToExit(challenge)
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
			replay.CountMovementActions(trace),
			trace[len(trace)-1].ElapsedTimeMs,
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
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE runs
		SET
			suspicion_score = $2,
			suspicion_reasons_json = $3,
			verification_status = $4,
			verification_notes_json = $5,
			verified_at = $6,
			verification_error = NULL
		WHERE id = $1
	`)).
		WithArgs(int64(7), 0, []byte(`[]`), "verified", []byte(`["simulation_matches_expected_outcome"]`), now.UTC()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	processed, err := processNextPendingRun(db)
	if err != nil {
		t.Fatalf("process next pending run: %v", err)
	}
	if !processed {
		t.Fatal("expected worker to process a pending run")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestProcessNextPendingRunMarksVerificationFailureOnInvalidReplayJSON(t *testing.T) {
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
			100,
			[]byte(`{bad json`),
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
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE runs
		SET
			verification_error = $2,
			verification_notes_json = $3
		WHERE id = $1
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), []byte(`["worker_verification_failed"]`)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	processed, err := processNextPendingRun(db)
	if err == nil {
		t.Fatal("expected invalid replay json to bubble an error")
	}
	if processed {
		t.Fatal("expected failed claim to report processed=false")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestMarkRunVerificationFailureStoresWorkerError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE runs
		SET
			verification_error = $2,
			verification_notes_json = $3
		WHERE id = $1
	`)).
		WithArgs(int64(9), "boom", []byte(`["worker_verification_failed"]`)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := markRunVerificationFailure(db, 9, errors.New("boom")); err != nil {
		t.Fatalf("mark verification failure: %v", err)
	}
}

func buildReplayTraceToExit(challenge replay.DailyMaze) []replay.ReplayTraceEvent {
	path := shortestPathToExit(challenge)
	directionIndex := startingDirectionIndex(challenge)
	elapsed := 0
	trace := make([]replay.ReplayTraceEvent, 0, len(path)*2)

	for index := 1; index < len(path); index++ {
		current := path[index-1]
		next := path[index]
		targetDirection := replay.Point{X: next.X - current.X, Y: next.Y - current.Y}
		targetDirectionIndex := 0
		for candidateIndex, direction := range directionOrder {
			if direction == targetDirection {
				targetDirectionIndex = candidateIndex
				break
			}
		}

		for directionIndex != targetDirectionIndex {
			elapsed += 300
			delta := (targetDirectionIndex - directionIndex + len(directionOrder)) % len(directionOrder)
			if delta == 1 {
				trace = append(trace, replay.ReplayTraceEvent{ElapsedTimeMs: elapsed, Action: "turn_right"})
				directionIndex = (directionIndex + 1) % len(directionOrder)
			} else {
				trace = append(trace, replay.ReplayTraceEvent{ElapsedTimeMs: elapsed, Action: "turn_left"})
				directionIndex = (directionIndex + len(directionOrder) - 1) % len(directionOrder)
			}
		}

		elapsed += 300
		trace = append(trace, replay.ReplayTraceEvent{ElapsedTimeMs: elapsed, Action: "move_forward"})
	}

	return trace
}

func shortestPathToExit(challenge replay.DailyMaze) []replay.Point {
	queue := []replay.Point{challenge.Start}
	visited := map[replay.Point]bool{challenge.Start: true}
	previous := map[replay.Point]replay.Point{}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current == challenge.Exit {
			break
		}

		for _, direction := range directionOrder {
			next := replay.Point{X: current.X + direction.X, Y: current.Y + direction.Y}
			if visited[next] || !isWalkableCell(next, challenge.Grid) {
				continue
			}
			visited[next] = true
			previous[next] = current
			queue = append(queue, next)
		}
	}

	path := []replay.Point{challenge.Exit}
	for path[len(path)-1] != challenge.Start {
		path = append(path, previous[path[len(path)-1]])
	}

	for left, right := 0, len(path)-1; left < right; left, right = left+1, right-1 {
		path[left], path[right] = path[right], path[left]
	}

	return path
}

var directionOrder = []replay.Point{
	{X: 0, Y: -1},
	{X: 1, Y: 0},
	{X: 0, Y: 1},
	{X: -1, Y: 0},
}

func startingDirectionIndex(challenge replay.DailyMaze) int {
	exitDelta := replay.Point{X: challenge.Exit.X - challenge.Start.X, Y: challenge.Exit.Y - challenge.Start.Y}
	openDirectionIndexes := make([]int, 0, len(directionOrder))
	for index, direction := range directionOrder {
		nextPosition := replay.Point{X: challenge.Start.X + direction.X, Y: challenge.Start.Y + direction.Y}
		if isWalkableCell(nextPosition, challenge.Grid) {
			openDirectionIndexes = append(openDirectionIndexes, index)
		}
	}
	if len(openDirectionIndexes) == 0 {
		return 0
	}

	bestIndex := openDirectionIndexes[0]
	bestScore := directionOrder[bestIndex].X*exitDelta.X + directionOrder[bestIndex].Y*exitDelta.Y
	for _, index := range openDirectionIndexes[1:] {
		score := directionOrder[index].X*exitDelta.X + directionOrder[index].Y*exitDelta.Y
		if score > bestScore || (score == bestScore && index < bestIndex) {
			bestIndex = index
			bestScore = score
		}
	}

	return bestIndex
}

func isWalkableCell(position replay.Point, grid []string) bool {
	if position.Y < 0 || position.Y >= len(grid) {
		return false
	}
	row := grid[position.Y]
	if position.X < 0 || position.X >= len(row) {
		return false
	}
	return row[position.X] != '#'
}
