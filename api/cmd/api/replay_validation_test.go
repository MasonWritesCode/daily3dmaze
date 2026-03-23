package main

import (
	"testing"
	"time"
)

func TestEvaluateReplayTrace(t *testing.T) {
	t.Parallel()

	challenge := generateDailyMaze(time.Date(2026, 3, 21, 0, 0, 0, 0, time.UTC))
	validTrace := buildReplayTraceToExit(challenge)

	testCases := []struct {
		name            string
		request         runSubmissionRequest
		wantScore       int
		expectedReasons []ReplaySuspicionReason
	}{
		{
			name: "valid replay to exit stays clean",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     countReplayMovementActions(validTrace),
				ElapsedTimeMs: validTrace[len(validTrace)-1].ElapsedTimeMs,
				ReplayTrace:   validTrace,
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
			wantScore: 100,
			expectedReasons: []ReplaySuspicionReason{
				ReasonReplayLengthMismatch,
				ReasonVeryHighActionDensity,
				ReasonRapidRepeatedTurns,
				ReasonReplayDoesNotReachExit,
			},
		},
		{
			name: "timestamp drift is flagged independently",
			request: runSubmissionRequest{
				Date:          "2026-03-21",
				Seed:          "daily3dmaze:2026-03-21",
				MoveCount:     countReplayMovementActions(validTrace),
				ElapsedTimeMs: validTrace[len(validTrace)-1].ElapsedTimeMs + 600,
				ReplayTrace:   validTrace,
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

func TestDeriveVerificationOutcome(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name         string
		result       ReplayValidationResult
		wantStatus   VerificationStatus
		expectedNote string
	}{
		{
			name: "verified run gets a clean note",
			result: ReplayValidationResult{
				Score: 0,
				Simulation: ReplaySimulationResult{
					ReachedExit: true,
				},
			},
			wantStatus:   VerificationStatusVerified,
			expectedNote: "simulation_matches_expected_outcome",
		},
		{
			name: "blocked moves become suspicious",
			result: ReplayValidationResult{
				Score: 10,
				Simulation: ReplaySimulationResult{
					ReachedExit:      true,
					BlockedMoveCount: 2,
				},
			},
			wantStatus:   VerificationStatusSuspicious,
			expectedNote: "simulation_detected_blocked_moves",
		},
		{
			name: "missing exit is invalid",
			result: ReplayValidationResult{
				Score: 60,
				Simulation: ReplaySimulationResult{
					ReachedExit: false,
				},
			},
			wantStatus:   VerificationStatusInvalid,
			expectedNote: "simulation_never_reached_exit",
		},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			gotStatus, gotNotes := deriveVerificationOutcome(testCase.result)
			if gotStatus != testCase.wantStatus {
				t.Fatalf("expected status %q, got %q", testCase.wantStatus, gotStatus)
			}
			if !containsString(gotNotes, testCase.expectedNote) {
				t.Fatalf("expected notes %v to contain %q", gotNotes, testCase.expectedNote)
			}
		})
	}
}

func TestSimulateReplayTrace(t *testing.T) {
	t.Parallel()

	challenge := dailyMazeResponse{
		Date:  "2026-03-21",
		Title: "Daily Maze",
		Seed:  "daily3dmaze:2026-03-21",
		Size:  mazeSize{Width: 5, Height: 5},
		Start: mazePoint{X: 1, Y: 1},
		Exit:  mazePoint{X: 3, Y: 1},
		Grid: []string{
			"#####",
			"#   #",
			"#####",
			"#####",
			"#####",
		},
	}

	result := simulateReplayTrace(challenge, []replayTraceEvent{
		{ElapsedTimeMs: 100, Action: "move_forward"},
		{ElapsedTimeMs: 200, Action: "move_forward"},
		{ElapsedTimeMs: 300, Action: "turn_right"},
	})

	if !result.ReachedExit {
		t.Fatal("expected replay to reach exit")
	}
	if result.FirstExitStep != 2 {
		t.Fatalf("expected first exit step 2, got %d", result.FirstExitStep)
	}
	if result.ActionsAfterExit != 1 {
		t.Fatalf("expected 1 action after exit, got %d", result.ActionsAfterExit)
	}
	if result.BlockedMoveCount != 0 {
		t.Fatalf("expected no blocked moves, got %d", result.BlockedMoveCount)
	}
	if result.FinalPosition != (mazePoint{X: 3, Y: 1}) {
		t.Fatalf("expected final position (3,1), got %+v", result.FinalPosition)
	}
}

func TestSimulateReplayTraceCountsBlockedMoves(t *testing.T) {
	t.Parallel()

	challenge := dailyMazeResponse{
		Date:  "2026-03-21",
		Title: "Daily Maze",
		Seed:  "daily3dmaze:2026-03-21",
		Size:  mazeSize{Width: 5, Height: 5},
		Start: mazePoint{X: 1, Y: 1},
		Exit:  mazePoint{X: 3, Y: 1},
		Grid: []string{
			"#####",
			"# # #",
			"#####",
			"#####",
			"#####",
		},
	}

	result := simulateReplayTrace(challenge, []replayTraceEvent{
		{ElapsedTimeMs: 100, Action: "move_forward"},
	})

	if result.BlockedMoveCount != 1 {
		t.Fatalf("expected blocked move count 1, got %d", result.BlockedMoveCount)
	}
	if result.ReachedExit {
		t.Fatal("expected blocked replay not to reach exit")
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}

	return false
}

func buildReplayTraceToExit(challenge dailyMazeResponse) []replayTraceEvent {
	path := shortestPathToExit(challenge)
	directionIndex := getStartingDirectionIndexForMaze(challenge)
	elapsed := 0
	trace := make([]replayTraceEvent, 0, len(path)*2)

	for index := 1; index < len(path); index++ {
		current := path[index-1]
		next := path[index]
		targetDirection := mazePoint{
			X: next.X - current.X,
			Y: next.Y - current.Y,
		}
		targetDirectionIndex := 0
		for candidateIndex, direction := range directionOrder {
			if direction == targetDirection {
				targetDirectionIndex = candidateIndex
				break
			}
		}

		for directionIndex != targetDirectionIndex {
			rightTurns := (targetDirectionIndex - directionIndex + len(directionOrder)) % len(directionOrder)
			leftTurns := (directionIndex - targetDirectionIndex + len(directionOrder)) % len(directionOrder)

			elapsed += 120
			if rightTurns <= leftTurns {
				trace = append(trace, replayTraceEvent{
					ElapsedTimeMs: elapsed,
					Action:        "turn_right",
				})
				directionIndex = (directionIndex + 1) % len(directionOrder)
			} else {
				trace = append(trace, replayTraceEvent{
					ElapsedTimeMs: elapsed,
					Action:        "turn_left",
				})
				directionIndex = (directionIndex + len(directionOrder) - 1) % len(directionOrder)
			}
		}

		elapsed += 220
		trace = append(trace, replayTraceEvent{
			ElapsedTimeMs: elapsed,
			Action:        "move_forward",
		})
	}

	return trace
}

func shortestPathToExit(challenge dailyMazeResponse) []mazePoint {
	queue := []mazePoint{challenge.Start}
	visited := map[mazePoint]bool{
		challenge.Start: true,
	}
	previous := map[mazePoint]mazePoint{}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current == challenge.Exit {
			break
		}

		for _, direction := range directionOrder {
			next := mazePoint{
				X: current.X + direction.X,
				Y: current.Y + direction.Y,
			}
			if visited[next] || !isWalkableReplayCell(next, challenge.Grid) {
				continue
			}

			visited[next] = true
			previous[next] = current
			queue = append(queue, next)
		}
	}

	path := []mazePoint{challenge.Exit}
	for path[len(path)-1] != challenge.Start {
		path = append(path, previous[path[len(path)-1]])
	}

	for left, right := 0, len(path)-1; left < right; left, right = left+1, right-1 {
		path[left], path[right] = path[right], path[left]
	}

	return path
}
