package main

import "testing"

func TestEvaluateReplayTrace(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name            string
		request         runSubmissionRequest
		wantScore       int
		expectedReasons []ReplaySuspicionReason
	}{
		{
			name: "low risk trace stays clean",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     2,
				ElapsedTimeMs: 1500,
				ReplayTrace: []replayTraceEvent{
					{ElapsedTimeMs: 400, Action: "move_forward"},
					{ElapsedTimeMs: 1400, Action: "turn_right"},
				},
			},
			wantScore:       0,
			expectedReasons: nil,
		},
		{
			name: "stacked heuristics produce explainable reasons",
			request: runSubmissionRequest{
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
			},
			wantScore: 70,
			expectedReasons: []ReplaySuspicionReason{
				ReasonReplayLengthMismatch,
				ReasonVeryHighActionDensity,
				ReasonRapidRepeatedTurns,
			},
		},
		{
			name: "timestamp drift is flagged independently",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     2,
				ElapsedTimeMs: 2000,
				ReplayTrace: []replayTraceEvent{
					{ElapsedTimeMs: 300, Action: "move_forward"},
					{ElapsedTimeMs: 1200, Action: "turn_right"},
				},
			},
			wantScore: 15,
			expectedReasons: []ReplaySuspicionReason{
				ReasonTimestampDrift,
			},
		},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			result := evaluateReplayTrace(testCase.request)

			if result.Score != testCase.wantScore {
				t.Fatalf("expected score %d, got %d", testCase.wantScore, result.Score)
			}

			if len(result.Reasons) != len(testCase.expectedReasons) {
				t.Fatalf("expected reasons %v, got %v", testCase.expectedReasons, result.Reasons)
			}

			for _, expectedReason := range testCase.expectedReasons {
				if !containsReplayReason(result.Reasons, expectedReason) {
					t.Fatalf("expected reasons to contain %q, got %v", expectedReason, result.Reasons)
				}
			}
		})
	}
}

func TestReplayValidationResultReasonStrings(t *testing.T) {
	t.Parallel()

	result := ReplayValidationResult{
		Score: 35,
		Reasons: []ReplaySuspicionReason{
			ReasonHighActionDensity,
			ReasonTimestampDrift,
		},
	}

	got := result.ReasonStrings()
	want := []string{"high_action_density", "timestamp_drift"}

	if len(got) != len(want) {
		t.Fatalf("expected %d reasons, got %d", len(want), len(got))
	}

	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("expected reason %q at index %d, got %q", want[index], index, got[index])
		}
	}
}

func containsReplayReason(values []ReplaySuspicionReason, target ReplaySuspicionReason) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}

	return false
}
