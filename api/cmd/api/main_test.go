package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestValidateRunSubmission(t *testing.T) {
	t.Parallel()

	valid := runSubmissionRequest{
		Date:          "2026-03-21",
		Seed:          "daily3dmaze:2026-03-21",
		MoveCount:     42,
		ElapsedTimeMs: 12345,
		ReplayTrace: []replayTraceEvent{
			{ElapsedTimeMs: 0, Action: "move_forward"},
			{ElapsedTimeMs: 120, Action: "turn_right"},
		},
	}

	if err := validateRunSubmission(valid); err != nil {
		t.Fatalf("expected valid submission, got error: %v", err)
	}

	cases := []struct {
		name    string
		request runSubmissionRequest
	}{
		{
			name: "missing seed",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				MoveCount:     42,
				ElapsedTimeMs: 12345,
			},
		},
		{
			name: "invalid date format",
			request: runSubmissionRequest{
				Date:          "03-21-2026",
				Seed:          "daily3dmaze:03-21-2026",
				MoveCount:     42,
				ElapsedTimeMs: 12345,
			},
		},
		{
			name: "seed mismatch",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-20",
				MoveCount:     42,
				ElapsedTimeMs: 12345,
			},
		},
		{
			name: "move count too large",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     maxMoveCount + 1,
				ElapsedTimeMs: 12345,
			},
		},
		{
			name: "elapsed time too large",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     42,
				ElapsedTimeMs: maxElapsedTimeMs + 1,
				ReplayTrace: []replayTraceEvent{
					{ElapsedTimeMs: 0, Action: "move_forward"},
				},
			},
		},
		{
			name: "missing replay trace",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     42,
				ElapsedTimeMs: 12345,
			},
		},
		{
			name: "replay trace decreases in time",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     42,
				ElapsedTimeMs: 12345,
				ReplayTrace: []replayTraceEvent{
					{ElapsedTimeMs: 100, Action: "move_forward"},
					{ElapsedTimeMs: 90, Action: "turn_left"},
				},
			},
		},
		{
			name: "replay trace has unknown action",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     42,
				ElapsedTimeMs: 12345,
				ReplayTrace: []replayTraceEvent{
					{ElapsedTimeMs: 100, Action: "teleport"},
				},
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if err := validateRunSubmission(tc.request); err == nil {
				t.Fatalf("expected validation error for case %q", tc.name)
			}
		})
	}
}

func TestValidateLeaderboardDate(t *testing.T) {
	t.Parallel()

	if err := validateLeaderboardDate("2026-03-21"); err != nil {
		t.Fatalf("expected valid leaderboard date, got error: %v", err)
	}

	if err := validateLeaderboardDate("21/03/2026"); err == nil {
		t.Fatal("expected invalid leaderboard date to fail validation")
	}
}

func TestRankLeaderboardEntries(t *testing.T) {
	t.Parallel()

	entries := []leaderboardEntry{
		{Date: "2026-03-21", MoveCount: 10, ElapsedTimeMs: 1000},
		{Date: "2026-03-21", MoveCount: 12, ElapsedTimeMs: 1200},
	}

	ranked := rankLeaderboardEntries(entries)

	if ranked[0].Rank != 1 || ranked[1].Rank != 2 {
		t.Fatalf("expected ranks 1 and 2, got %d and %d", ranked[0].Rank, ranked[1].Rank)
	}

	if entries[0].Rank != 0 || entries[1].Rank != 0 {
		t.Fatal("expected original slice to remain unmodified")
	}
}

func TestGenerateDailyMazeIsDeterministic(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)
	first := generateDailyMaze(now)
	second := generateDailyMaze(now)

	if first.Seed != second.Seed {
		t.Fatalf("expected matching seeds, got %q and %q", first.Seed, second.Seed)
	}

	if len(first.Grid) != len(second.Grid) {
		t.Fatalf("expected matching grid heights, got %d and %d", len(first.Grid), len(second.Grid))
	}

	for index := range first.Grid {
		if first.Grid[index] != second.Grid[index] {
			t.Fatalf("expected deterministic grid row %d to match", index)
		}
	}
}

func TestDailyMazeHandlerSupportsExplicitDate(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet, "/api/daily-maze?date=2026-03-19", nil)
	recorder := httptest.NewRecorder()

	dailyMazeHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload dailyMazeResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode daily maze response: %v", err)
	}

	if payload.Date != "2026-03-19" {
		t.Fatalf("expected challenge date 2026-03-19, got %q", payload.Date)
	}

	if payload.Seed != "daily3dmaze:2026-03-19" {
		t.Fatalf("expected seed for archived date, got %q", payload.Seed)
	}
}

func TestRecentRunReviewsHandlerRequiresAuthentication(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodGet, "/api/admin/run-reviews", nil)
	recorder := httptest.NewRecorder()

	application.recentRunReviewsHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.StatusCode)
	}
}

func TestRunReviewDetailHandlerRequiresAuthentication(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodGet, "/api/admin/run-reviews/7", nil)
	recorder := httptest.NewRecorder()

	application.runReviewDetailHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.StatusCode)
	}
}

func TestRequeueRunReviewHandlerRequiresAuthentication(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodPost, "/api/admin/run-reviews/7/requeue", nil)
	recorder := httptest.NewRecorder()

	application.runReviewDetailHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.StatusCode)
	}
}

func TestUpdateRunReviewHandlerRequiresAuthentication(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodPost, "/api/admin/run-reviews/7/review", strings.NewReader(`{"reviewStatus":"reviewed_clean","reviewNotes":"looks good"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	application.runReviewDetailHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.StatusCode)
	}
}

func TestRecomputeRunReviewsHandlerRequiresAuthentication(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodPost, "/api/admin/run-reviews/recompute", nil)
	recorder := httptest.NewRecorder()

	application.recomputeRunReviewsHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.StatusCode)
	}
}

func TestParseRunReviewID(t *testing.T) {
	t.Parallel()

	runID, err := parseRunReviewID("42")
	if err != nil {
		t.Fatalf("expected valid run id, got error: %v", err)
	}
	if runID != 42 {
		t.Fatalf("expected run id 42, got %d", runID)
	}

	invalidValues := []string{"", "abc", "0", "-1", "42/extra"}
	for _, invalidValue := range invalidValues {
		if _, err := parseRunReviewID(invalidValue); err == nil {
			t.Fatalf("expected invalid run id %q to fail", invalidValue)
		}
	}
}

func TestRecomputeStoredRunVerifications(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	challenge := generateDailyMaze(time.Date(2026, 3, 21, 0, 0, 0, 0, time.UTC))
	validTrace := buildReplayTraceToExit(challenge)
	validTraceJSON, err := json.Marshal(validTrace)
	if err != nil {
		t.Fatalf("marshal valid trace: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, run_date::text, seed, move_count, elapsed_time_ms, replay_trace_json
		FROM runs
		ORDER BY id ASC
	`)).
		WillReturnRows(
			sqlmock.NewRows([]string{"id", "run_date", "seed", "move_count", "elapsed_time_ms", "replay_trace_json"}).
				AddRow(7, "2026-03-21", "daily3dmaze:2026-03-21", countReplayMovementActions(validTrace), validTrace[len(validTrace)-1].ElapsedTimeMs, validTraceJSON).
				AddRow(8, "2026-03-21", "daily3dmaze:2026-03-21", 1, 1000, nil),
		)

	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE runs
		SET
			suspicion_score = $2,
			suspicion_reasons_json = $3,
			verification_status = $4,
			verification_notes_json = $5,
			verification_started_at = COALESCE(verification_started_at, $6),
			verified_at = $6,
			verification_error = NULL
		WHERE id = $1
	`)).
		WithArgs(int64(7), 0, []byte("[]"), string(VerificationStatusVerified), []byte(`["simulation_matches_expected_outcome"]`), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	updatedCount, skippedCount, err := application.recomputeStoredRunVerifications()
	if err != nil {
		t.Fatalf("recompute stored run verifications: %v", err)
	}

	if updatedCount != 1 || skippedCount != 1 {
		t.Fatalf("expected updated=1 skipped=1, got updated=%d skipped=%d", updatedCount, skippedCount)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRequeueRunReview(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		UPDATE runs
		SET
			verification_status = $2,
			verification_notes_json = $3,
			verification_started_at = NULL,
			verified_at = NULL,
			verification_error = NULL
		WHERE id = $1
		RETURNING verification_attempts
	`)).
		WithArgs(int64(7), string(VerificationStatusPending), []byte(`["manually_requeued_for_verification"]`)).
		WillReturnRows(sqlmock.NewRows([]string{"verification_attempts"}).AddRow(3))

	attempts, err := application.requeueRunReview(7)
	if err != nil {
		t.Fatalf("requeue run review: %v", err)
	}

	if attempts != 3 {
		t.Fatalf("expected verification attempts 3, got %d", attempts)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLoadRunReviewSummary(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 3, 23, 12, 0, 0, 0, time.UTC)
	application := app{
		db:  db,
		now: func() time.Time { return now },
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT
			COUNT(*) FILTER (WHERE verification_status = 'pending'),
			COUNT(*) FILTER (WHERE verification_status = 'verified'),
			COUNT(*) FILTER (WHERE verification_status = 'suspicious'),
			COUNT(*) FILTER (WHERE verification_status = 'invalid'),
			COUNT(*) FILTER (
				WHERE verification_status = 'pending'
					AND (
						(verification_started_at IS NOT NULL AND verification_started_at < $1)
						OR (verification_started_at IS NULL AND accepted_at < $1)
					)
			)
		FROM runs
	`)).
		WithArgs(now.Add(-stalePendingAfter)).
		WillReturnRows(sqlmock.NewRows([]string{
			"pending_count",
			"verified_count",
			"suspicious_count",
			"invalid_count",
			"stale_pending_count",
		}).AddRow(4, 9, 2, 1, 1))

	summary, err := application.loadRunReviewSummary()
	if err != nil {
		t.Fatalf("load run review summary: %v", err)
	}

	if summary.PendingCount != 4 || summary.VerifiedCount != 9 || summary.StalePendingCount != 1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestValidateRunReviewUpdate(t *testing.T) {
	t.Parallel()

	if err := validateRunReviewUpdate(updateRunReviewRequest{
		ReviewStatus: "reviewed_clean",
		ReviewNotes:  "confirmed legitimate",
	}); err != nil {
		t.Fatalf("expected valid review update, got %v", err)
	}

	if err := validateRunReviewUpdate(updateRunReviewRequest{
		ReviewStatus: "bad_status",
	}); err == nil {
		t.Fatal("expected invalid review status to fail")
	}
}

func TestUpdateRunReview(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 3, 23, 16, 30, 0, 0, time.UTC)
	application := app{
		db:  db,
		now: func() time.Time { return now },
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		UPDATE runs
		SET
			review_status = $2,
			review_notes = $3,
			reviewed_at = $4,
			reviewed_by_user_id = $5
		WHERE id = $1
		RETURNING id
	`)).
		WithArgs(int64(7), "confirmed_suspicious", "tool-assisted run; needs follow-up", sql.NullTime{
			Time:  now,
			Valid: true,
		}, int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))

	reviewedAt, err := application.updateRunReview(7, currentUser{ID: 12, Username: "mod_mason"}, updateRunReviewRequest{
		ReviewStatus: "confirmed_suspicious",
		ReviewNotes:  " tool-assisted run; needs follow-up ",
	})
	if err != nil {
		t.Fatalf("update run review: %v", err)
	}

	if !reviewedAt.Equal(now) {
		t.Fatalf("expected reviewedAt %s, got %s", now, reviewedAt)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestIsStalePendingReview(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 23, 12, 0, 0, 0, time.UTC)
	startedAt := sql.NullTime{
		Time:  now.Add(-2 * time.Minute),
		Valid: true,
	}

	if !isStalePendingReview(string(VerificationStatusPending), now.Add(-time.Minute), startedAt, now) {
		t.Fatal("expected old pending run with old start time to be stale")
	}

	if isStalePendingReview(string(VerificationStatusVerified), now.Add(-10*time.Minute), sql.NullTime{}, now) {
		t.Fatal("expected verified run to not be stale")
	}
}

func TestRateLimitKeyFromRequestPrefersForwardedHeaders(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("GET", "/health", nil)
	request.RemoteAddr = "127.0.0.1:4000"
	request.Header.Set("X-Forwarded-For", "203.0.113.10, 10.0.0.1")

	if key := rateLimitKeyFromRequest(request); key != "203.0.113.10" {
		t.Fatalf("expected forwarded IP, got %q", key)
	}
}

func TestAuthRateLimiterExpiresOldAttempts(t *testing.T) {
	t.Parallel()

	limiter := newAuthRateLimiter(2, time.Minute)
	now := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }

	if !limiter.allow("login", "127.0.0.1") {
		t.Fatal("expected first request to be allowed")
	}

	if !limiter.allow("login", "127.0.0.1") {
		t.Fatal("expected second request to be allowed")
	}

	if limiter.allow("login", "127.0.0.1") {
		t.Fatal("expected third request in the window to be denied")
	}

	now = now.Add(2 * time.Minute)

	if !limiter.allow("login", "127.0.0.1") {
		t.Fatal("expected request after the window to be allowed")
	}
}
