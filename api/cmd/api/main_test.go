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

func TestParseLeaderboardScope(t *testing.T) {
	t.Parallel()

	scope, err := parseLeaderboardScope("")
	if err != nil {
		t.Fatalf("expected default scope, got error: %v", err)
	}
	if scope != "all" {
		t.Fatalf("expected default scope all, got %q", scope)
	}

	if _, err := parseLeaderboardScope("first"); err != nil {
		t.Fatalf("expected first scope to be valid, got %v", err)
	}

	if _, err := parseLeaderboardScope("weird"); err == nil {
		t.Fatal("expected invalid leaderboard scope to fail")
	}
}

func TestListLeaderboardUsesFirstRunScopeQuery(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	acceptedAt := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
			WITH first_runs AS (
				SELECT DISTINCT ON (COALESCE(users.username, ''), runs.user_id)
					runs.run_date::text,
					COALESCE(users.username, ''),
					COALESCE(users.role, ''),
					runs.seed,
					runs.move_count,
					runs.elapsed_time_ms,
					runs.accepted_at
				FROM runs
				LEFT JOIN users ON users.id = runs.user_id
				WHERE runs.run_date = $1::date AND runs.verification_status = 'verified'
				ORDER BY COALESCE(users.username, ''), runs.user_id, runs.accepted_at ASC
			)
			SELECT *
			FROM first_runs
			ORDER BY elapsed_time_ms ASC, move_count ASC, accepted_at ASC
			LIMIT 10
	`)).
		WithArgs("2026-03-21").
		WillReturnRows(
			sqlmock.NewRows([]string{"run_date", "username", "role", "seed", "move_count", "elapsed_time_ms", "accepted_at"}).
				AddRow("2026-03-21", "mason_dev", "moderator", "daily3dmaze:2026-03-21", 42, 12345, acceptedAt),
		)

	entries, err := application.listLeaderboard("2026-03-21", "first")
	if err != nil {
		t.Fatalf("list leaderboard first scope: %v", err)
	}

	if len(entries) != 1 || entries[0].Username != "mason_dev" || entries[0].Rank != 1 {
		t.Fatalf("unexpected first-scope leaderboard entries %#v", entries)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
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

func TestRunSubmissionHandlerReturnsPublicID(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO runs (public_id, user_id, run_date, seed, move_count, elapsed_time_ms, replay_trace_json, suspicion_score, suspicion_reasons_json, verification_status, verification_notes_json, accepted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`)).
		WithArgs(
			sqlmock.AnyArg(),
			nil,
			"2026-03-21",
			"daily3dmaze:2026-03-21",
			42,
			12345,
			[]byte(`[{"elapsedTimeMs":0,"action":"move_forward"}]`),
			0,
			[]byte(`[]`),
			string(VerificationStatusPending),
			[]byte(`["queued_for_async_verification"]`),
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/runs", strings.NewReader(`{
		"date":"2026-03-21",
		"seed":"daily3dmaze:2026-03-21",
		"moveCount":42,
		"elapsedTimeMs":12345,
		"replayTrace":[{"elapsedTimeMs":0,"action":"move_forward"}]
	}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	application.runSubmissionHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, response.StatusCode)
	}

	var payload runSubmissionResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode submission response: %v", err)
	}

	if payload.PublicID == "" || !strings.HasPrefix(payload.PublicID, "run_") {
		t.Fatalf("expected run public id in response, got %q", payload.PublicID)
	}
	if payload.VerificationStatus != string(VerificationStatusPending) {
		t.Fatalf("expected pending verification status, got %q", payload.VerificationStatus)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRunStatusHandlerReturnsStoredVerificationState(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	acceptedAt := time.Date(2026, 3, 23, 19, 37, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT public_id, accepted_at, suspicion_score, suspicion_reasons_json, verification_status, verification_notes_json
		FROM runs
		WHERE public_id = $1
	`)).
		WithArgs("run_0123456789abcdef0123456789abcdef").
		WillReturnRows(
			sqlmock.NewRows([]string{"public_id", "accepted_at", "suspicion_score", "suspicion_reasons_json", "verification_status", "verification_notes_json"}).
				AddRow("run_0123456789abcdef0123456789abcdef", acceptedAt, 0, []byte(`[]`), string(VerificationStatusVerified), []byte(`["simulation_matches_expected_outcome"]`)),
		)

	request := httptest.NewRequest(http.MethodGet, "/api/runs/run_0123456789abcdef0123456789abcdef", nil)
	recorder := httptest.NewRecorder()

	application.runStatusHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload runStatusResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode run status response: %v", err)
	}

	if payload.PublicID != "run_0123456789abcdef0123456789abcdef" {
		t.Fatalf("unexpected public id %q", payload.PublicID)
	}
	if payload.VerificationStatus != string(VerificationStatusVerified) {
		t.Fatalf("expected verified status, got %q", payload.VerificationStatus)
	}
	if len(payload.VerificationNotes) != 1 || payload.VerificationNotes[0] != "simulation_matches_expected_outcome" {
		t.Fatalf("unexpected verification notes %#v", payload.VerificationNotes)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRunStatusHandlerRejectsInvalidPublicIDPath(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodGet, "/api/runs/", nil)
	recorder := httptest.NewRecorder()

	application.runStatusHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, response.StatusCode)
	}
}

func TestRunStatusHandlerReturnsNotFoundForUnknownRun(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT public_id, accepted_at, suspicion_score, suspicion_reasons_json, verification_status, verification_notes_json
		FROM runs
		WHERE public_id = $1
	`)).
		WithArgs("run_0123456789abcdef0123456789abcdef").
		WillReturnError(sql.ErrNoRows)

	request := httptest.NewRequest(http.MethodGet, "/api/runs/run_0123456789abcdef0123456789abcdef", nil)
	recorder := httptest.NewRecorder()

	application.runStatusHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, response.StatusCode)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
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

func TestRecentRunReviewsHandlerRequiresModeratorRole(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	token := "session-token"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, false))

	request := httptest.NewRequest(http.MethodGet, "/api/admin/run-reviews", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.recentRunReviewsHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, response.StatusCode)
	}
}

func TestRunReviewDetailHandlerRequiresAuthentication(t *testing.T) {
	t.Parallel()

	application := app{}
	request := httptest.NewRequest(http.MethodGet, "/api/admin/run-reviews/run_0123456789abcdef0123456789abcdef", nil)
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
	request := httptest.NewRequest(http.MethodPost, "/api/admin/run-reviews/run_0123456789abcdef0123456789abcdef/requeue", nil)
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
	request := httptest.NewRequest(http.MethodPost, "/api/admin/run-reviews/run_0123456789abcdef0123456789abcdef/review", strings.NewReader(`{"reviewStatus":"reviewed_clean","reviewNotes":"looks good"}`))
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

func TestRecomputeRunReviewsHandlerRequiresAdminRole(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	token := "session-token"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mod_mason", roleModerator, false))

	request := httptest.NewRequest(http.MethodPost, "/api/admin/run-reviews/recompute", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.recomputeRunReviewsHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, response.StatusCode)
	}
}

func TestParseRunReviewPublicID(t *testing.T) {
	t.Parallel()

	runID, err := parseRunReviewPublicID("run_0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatalf("expected valid run public id, got error: %v", err)
	}
	if runID != "run_0123456789abcdef0123456789abcdef" {
		t.Fatalf("unexpected run public id %q", runID)
	}

	invalidValues := []string{"", "abc", "run_0", "RUN_0123456789abcdef0123456789abcdef", "run_0123456789abcdef0123456789abcdeg", "run_0123456789abcdef0123456789abcdef/extra"}
	for _, invalidValue := range invalidValues {
		if _, err := parseRunReviewPublicID(invalidValue); err == nil {
			t.Fatalf("expected invalid run public id %q to fail", invalidValue)
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
		WHERE public_id = $1
		RETURNING verification_attempts
	`)).
		WithArgs("run_0123456789abcdef0123456789abcdef", string(VerificationStatusPending), []byte(`["manually_requeued_for_verification"]`)).
		WillReturnRows(sqlmock.NewRows([]string{"verification_attempts"}).AddRow(3))

	attempts, err := application.requeueRunReview("run_0123456789abcdef0123456789abcdef")
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
		WHERE public_id = $1
		RETURNING id
	`)).
		WithArgs("run_0123456789abcdef0123456789abcdef", "confirmed_suspicious", "tool-assisted run; needs follow-up", sql.NullTime{
			Time:  now,
			Valid: true,
		}, int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))

	reviewedAt, err := application.updateRunReview("run_0123456789abcdef0123456789abcdef", currentUser{ID: 12, Username: "mod_mason"}, updateRunReviewRequest{
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
