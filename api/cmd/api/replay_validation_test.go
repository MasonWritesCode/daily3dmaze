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
		wantStatus      VerificationStatus
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
			wantStatus:      VerificationStatusVerified,
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
			wantScore:  100,
			wantStatus: VerificationStatusInvalid,
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
			wantScore:  15,
			wantStatus: VerificationStatusVerified,
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
			if result.VerificationStatus != testCase.wantStatus {
				t.Fatalf("expected verification status %q, got %q", testCase.wantStatus, result.VerificationStatus)
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
	if result.FinalPosition.X != 3 || result.FinalPosition.Y != 1 {
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
	directionIndex := getStartingDirectionIndexLocal(challenge)
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
		for candidateIndex, direction := range replayTestDirectionOrder {
			if direction == targetDirection {
				targetDirectionIndex = candidateIndex
				break
			}
		}

		for directionIndex != targetDirectionIndex {
			rightTurns := (targetDirectionIndex - directionIndex + len(replayTestDirectionOrder)) % len(replayTestDirectionOrder)
			leftTurns := (directionIndex - targetDirectionIndex + len(replayTestDirectionOrder)) % len(replayTestDirectionOrder)

			elapsed += 120
			if rightTurns <= leftTurns {
				trace = append(trace, replayTraceEvent{
					ElapsedTimeMs: elapsed,
					Action:        "turn_right",
				})
				directionIndex = (directionIndex + 1) % len(replayTestDirectionOrder)
			} else {
				trace = append(trace, replayTraceEvent{
					ElapsedTimeMs: elapsed,
					Action:        "turn_left",
				})
				directionIndex = (directionIndex + len(replayTestDirectionOrder) - 1) % len(replayTestDirectionOrder)
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

		for _, direction := range replayTestDirectionOrder {
			next := mazePoint{
				X: current.X + direction.X,
				Y: current.Y + direction.Y,
			}
			if visited[next] || !isWalkableReplayCellLocal(next, challenge.Grid) {
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

var replayTestDirectionOrder = []mazePoint{
	{X: 0, Y: -1},
	{X: 1, Y: 0},
	{X: 0, Y: 1},
	{X: -1, Y: 0},
}

func getStartingDirectionIndexLocal(challenge dailyMazeResponse) int {
	exitDelta := mazePoint{
		X: challenge.Exit.X - challenge.Start.X,
		Y: challenge.Exit.Y - challenge.Start.Y,
	}

	openDirectionIndexes := make([]int, 0, len(replayTestDirectionOrder))
	for index, direction := range replayTestDirectionOrder {
		nextPosition := mazePoint{
			X: challenge.Start.X + direction.X,
			Y: challenge.Start.Y + direction.Y,
		}
		if isWalkableReplayCellLocal(nextPosition, challenge.Grid) {
			openDirectionIndexes = append(openDirectionIndexes, index)
		}
	}

	if len(openDirectionIndexes) == 0 {
		return 0
	}

	bestIndex := openDirectionIndexes[0]
	bestScore := replayTestDirectionOrder[bestIndex].X*exitDelta.X + replayTestDirectionOrder[bestIndex].Y*exitDelta.Y
	for _, index := range openDirectionIndexes[1:] {
		score := replayTestDirectionOrder[index].X*exitDelta.X + replayTestDirectionOrder[index].Y*exitDelta.Y
		if score > bestScore || (score == bestScore && index < bestIndex) {
			bestIndex = index
			bestScore = score
		}
	}

	return bestIndex
}

func isWalkableReplayCellLocal(position mazePoint, grid []string) bool {
	if position.Y < 0 || position.Y >= len(grid) {
		return false
	}
	row := grid[position.Y]
	if position.X < 0 || position.X >= len(row) {
		return false
	}
	return row[position.X] != '#'
}
