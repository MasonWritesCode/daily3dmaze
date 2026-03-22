package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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

func TestScoreReplayTrace(t *testing.T) {
	t.Parallel()

	lowRisk := runSubmissionRequest{
		Date:          "2026-03-21",
		Seed:          "daily3dmaze:2026-03-21",
		MoveCount:     2,
		ElapsedTimeMs: 1500,
		ReplayTrace: []replayTraceEvent{
			{ElapsedTimeMs: 400, Action: "move_forward"},
			{ElapsedTimeMs: 1400, Action: "turn_right"},
		},
	}

	if score := scoreReplayTrace(lowRisk); score != 0 {
		t.Fatalf("expected low-risk score 0, got %d", score)
	}

	highRisk := runSubmissionRequest{
		Date:          "2026-03-21",
		Seed:          "daily3dmaze:2026-03-21",
		MoveCount:     1,
		ElapsedTimeMs: 200,
		ReplayTrace: []replayTraceEvent{
			{ElapsedTimeMs: 0, Action: "turn_left"},
			{ElapsedTimeMs: 10, Action: "turn_left"},
			{ElapsedTimeMs: 20, Action: "turn_left"},
			{ElapsedTimeMs: 30, Action: "turn_left"},
		},
	}

	if score := scoreReplayTrace(highRisk); score <= 50 {
		t.Fatalf("expected suspicious score above 50, got %d", score)
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
