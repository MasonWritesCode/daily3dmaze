package main

import (
	"database/sql"
	"testing"
	"time"
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
