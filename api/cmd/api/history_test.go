package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestParseHistoryLimit(t *testing.T) {
	t.Parallel()

	limit, err := parseHistoryLimit("")
	if err != nil {
		t.Fatalf("default history limit: %v", err)
	}
	if limit != defaultHistoryLimit {
		t.Fatalf("expected default limit %d, got %d", defaultHistoryLimit, limit)
	}

	if _, err := parseHistoryLimit("0"); err == nil {
		t.Fatal("expected zero limit to fail")
	}

	if _, err := parseHistoryLimit("not-a-number"); err == nil {
		t.Fatal("expected non-numeric limit to fail")
	}
}

func TestHistoryHandlerReturnsRecentEntries(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	now := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)
	oldestDate := now.AddDate(0, 0, -2).Format(dateLayoutISO)
	newestDate := now.Format(dateLayoutISO)

	mock.ExpectQuery(regexp.QuoteMeta(`
		WITH ranked_runs AS (
			SELECT
				runs.run_date::text AS run_date,
				COUNT(*) OVER (PARTITION BY runs.run_date) AS submission_count,
				COALESCE(users.username, '') AS username,
				COALESCE(users.role, '') AS role,
				runs.move_count,
				runs.elapsed_time_ms,
				runs.accepted_at,
				ROW_NUMBER() OVER (
					PARTITION BY runs.run_date
					ORDER BY runs.elapsed_time_ms ASC, runs.move_count ASC, runs.accepted_at ASC
				) AS rank
			FROM runs
			LEFT JOIN users ON users.id = runs.user_id
			WHERE runs.run_date >= $1::date AND runs.run_date <= $2::date
				AND runs.verification_status = 'verified'
		)
		SELECT run_date, submission_count, username, role, move_count, elapsed_time_ms, accepted_at
		FROM ranked_runs
		WHERE rank = 1
		ORDER BY run_date DESC
	`)).
		WithArgs(oldestDate, newestDate).
		WillReturnRows(
			sqlmock.NewRows([]string{"run_date", "submission_count", "username", "role", "move_count", "elapsed_time_ms", "accepted_at"}).
				AddRow("2026-03-21", 3, "mason_dev", "admin", 42, 12345, now).
				AddRow("2026-03-20", 1, "", "", 55, 16000, now.Add(-24*time.Hour)),
		)

	entries, err := application.loadHistory(3, now)
	if err != nil {
		t.Fatalf("load history: %v", err)
	}

	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	if entries[0].Date != "2026-03-21" || entries[0].SubmissionCount != 3 {
		t.Fatalf("unexpected first entry: %#v", entries[0])
	}

	if entries[0].BestRun == nil || entries[0].BestRun.Username != "mason_dev" {
		t.Fatalf("expected best run for first entry, got %#v", entries[0].BestRun)
	}
	if entries[0].BestRun == nil || entries[0].BestRun.Role != "admin" {
		t.Fatalf("expected best run role admin, got %#v", entries[0].BestRun)
	}

	if entries[2].Date != "2026-03-19" || entries[2].SubmissionCount != 0 || entries[2].BestRun != nil {
		t.Fatalf("expected empty archive entry for 2026-03-19, got %#v", entries[2])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestHistoryHandlerEncodesResponse(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		WITH ranked_runs AS (
			SELECT
				runs.run_date::text AS run_date,
				COUNT(*) OVER (PARTITION BY runs.run_date) AS submission_count,
				COALESCE(users.username, '') AS username,
				COALESCE(users.role, '') AS role,
				runs.move_count,
				runs.elapsed_time_ms,
				runs.accepted_at,
				ROW_NUMBER() OVER (
					PARTITION BY runs.run_date
					ORDER BY runs.elapsed_time_ms ASC, runs.move_count ASC, runs.accepted_at ASC
				) AS rank
			FROM runs
			LEFT JOIN users ON users.id = runs.user_id
			WHERE runs.run_date >= $1::date AND runs.run_date <= $2::date
				AND runs.verification_status = 'verified'
		)
		SELECT run_date, submission_count, username, role, move_count, elapsed_time_ms, accepted_at
		FROM ranked_runs
		WHERE rank = 1
		ORDER BY run_date DESC
	`)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"run_date", "submission_count", "username", "role", "move_count", "elapsed_time_ms", "accepted_at"}))

	request := httptest.NewRequest(http.MethodGet, "/api/history?limit=2", nil)
	recorder := httptest.NewRecorder()

	application.historyHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload historyResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(payload.Entries) != 2 {
		t.Fatalf("expected 2 history entries, got %d", len(payload.Entries))
	}
}

func TestHistoryDayHandlerReturnsChallengeAndLeaderboard(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	acceptedAt := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT run_date::text, COALESCE(users.username, ''), COALESCE(users.role, ''), seed, move_count, elapsed_time_ms, accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		WHERE run_date = $1::date AND verification_status = 'verified'
		ORDER BY elapsed_time_ms ASC, move_count ASC, accepted_at ASC
		LIMIT 10
	`)).
		WithArgs("2026-03-21").
		WillReturnRows(
			sqlmock.NewRows([]string{"run_date", "username", "role", "seed", "move_count", "elapsed_time_ms", "accepted_at"}).
				AddRow("2026-03-21", "mason_dev", "moderator", "daily3dmaze:2026-03-21", 42, 12345, acceptedAt),
		)

	request := httptest.NewRequest(http.MethodGet, "/api/history/day?date=2026-03-21", nil)
	recorder := httptest.NewRecorder()

	application.historyDayHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload historyDayResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.Challenge.Date != "2026-03-21" {
		t.Fatalf("expected challenge date 2026-03-21, got %q", payload.Challenge.Date)
	}

	if len(payload.Leaderboard.Entries) != 1 {
		t.Fatalf("expected 1 leaderboard entry, got %d", len(payload.Leaderboard.Entries))
	}

	if payload.Leaderboard.Entries[0].Rank != 1 {
		t.Fatalf("expected ranked leaderboard entry, got %#v", payload.Leaderboard.Entries[0])
	}
	if payload.Leaderboard.Entries[0].Role != "moderator" {
		t.Fatalf("expected leaderboard role moderator, got %#v", payload.Leaderboard.Entries[0])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
