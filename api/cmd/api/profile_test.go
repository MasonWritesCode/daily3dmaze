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

func TestValidateProfileUsername(t *testing.T) {
	t.Parallel()

	if err := validateProfileUsername("mason_dev"); err != nil {
		t.Fatalf("expected valid username, got %v", err)
	}

	if err := validateProfileUsername("mason writes code"); err == nil {
		t.Fatal("expected invalid username to fail validation")
	}
}

func TestProfileHandlerReturnsProfileAndRecentRuns(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	createdAt := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	acceptedAt := time.Date(2026, 3, 21, 13, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT
			users.id,
			users.username,
			users.created_at,
			COUNT(runs.id),
			COUNT(DISTINCT runs.run_date),
			MIN(runs.elapsed_time_ms),
			AVG(runs.elapsed_time_ms),
			MAX(runs.accepted_at)
		FROM users
		LEFT JOIN runs ON runs.user_id = users.id
		WHERE users.username = $1
		GROUP BY users.id, users.username, users.created_at
	`)).
		WithArgs("mason_dev").
		WillReturnRows(
			sqlmock.NewRows([]string{"id", "username", "created_at", "count", "days", "min", "avg", "max"}).
				AddRow(7, "mason_dev", createdAt, 2, 2, 12345, 13000.0, acceptedAt),
		)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT run_date::text, seed, move_count, elapsed_time_ms, accepted_at
		FROM runs
		WHERE user_id = $1
		ORDER BY accepted_at DESC
		LIMIT 10
	`)).
		WithArgs(int64(7)).
		WillReturnRows(
			sqlmock.NewRows([]string{"run_date", "seed", "move_count", "elapsed_time_ms", "accepted_at"}).
				AddRow("2026-03-21", "daily3dmaze:2026-03-21", 42, 12345, acceptedAt),
		)

	request := httptest.NewRequest(http.MethodGet, "/api/profile?username=mason_dev", nil)
	recorder := httptest.NewRecorder()

	application.profileHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload profileResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.User.Username != "mason_dev" {
		t.Fatalf("expected username %q, got %q", "mason_dev", payload.User.Username)
	}

	if payload.Stats.TotalRuns != 2 {
		t.Fatalf("expected total runs 2, got %d", payload.Stats.TotalRuns)
	}

	if payload.Stats.DaysPlayed != 2 {
		t.Fatalf("expected days played 2, got %d", payload.Stats.DaysPlayed)
	}

	if payload.Stats.BestElapsedTimeMs == nil || *payload.Stats.BestElapsedTimeMs != 12345 {
		t.Fatalf("expected best time 12345, got %#v", payload.Stats.BestElapsedTimeMs)
	}

	if payload.Stats.AverageElapsedTimeMs == nil || *payload.Stats.AverageElapsedTimeMs != 13000 {
		t.Fatalf("expected average time 13000, got %#v", payload.Stats.AverageElapsedTimeMs)
	}

	if payload.Stats.LastPlayedAt == nil || *payload.Stats.LastPlayedAt != acceptedAt.Format(time.RFC3339) {
		t.Fatalf("expected last played %q, got %#v", acceptedAt.Format(time.RFC3339), payload.Stats.LastPlayedAt)
	}

	if len(payload.RecentRuns) != 1 {
		t.Fatalf("expected 1 recent run, got %d", len(payload.RecentRuns))
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
