package replay

import (
	"testing"
	"time"
)

func TestGenerateDailyMazeIsDeterministic(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)
	first := GenerateDailyMaze(now)
	second := GenerateDailyMaze(now)

	if first.Seed != second.Seed || first.Date != second.Date {
		t.Fatalf("expected deterministic challenge identity, got %+v and %+v", first, second)
	}

	if first.Start != second.Start || first.Exit != second.Exit {
		t.Fatalf("expected deterministic start/exit, got %+v and %+v", first, second)
	}

	if len(first.Grid) != len(second.Grid) {
		t.Fatalf("expected same grid size, got %d and %d", len(first.Grid), len(second.Grid))
	}

	for index := range first.Grid {
		if first.Grid[index] != second.Grid[index] {
			t.Fatalf("expected identical row %d, got %q and %q", index, first.Grid[index], second.Grid[index])
		}
	}
}

func TestGenerateDailyMazeProducesWalkableStartAndExit(t *testing.T) {
	t.Parallel()

	challenge := GenerateDailyMaze(time.Date(2026, 3, 21, 0, 0, 0, 0, time.UTC))

	if !isWalkableCell(challenge.Start, challenge.Grid) {
		t.Fatalf("expected start to be walkable, got %+v", challenge.Start)
	}

	if !isWalkableCell(challenge.Exit, challenge.Grid) {
		t.Fatalf("expected exit to be walkable, got %+v", challenge.Exit)
	}

	if challenge.Start == challenge.Exit {
		t.Fatal("expected exit to differ from start")
	}
}

func TestCountMovementActions(t *testing.T) {
	t.Parallel()

	count := CountMovementActions([]ReplayTraceEvent{
		{ElapsedTimeMs: 0, Action: "turn_left"},
		{ElapsedTimeMs: 100, Action: "move_forward"},
		{ElapsedTimeMs: 200, Action: "move_backward"},
		{ElapsedTimeMs: 300, Action: "turn_right"},
	})

	if count != 2 {
		t.Fatalf("expected 2 movement actions, got %d", count)
	}
}

func TestEvaluateRunOutcomes(t *testing.T) {
	t.Parallel()

	challenge := GenerateDailyMaze(time.Date(2026, 3, 21, 0, 0, 0, 0, time.UTC))
	validTrace := buildReplayTraceToExit(challenge)

	valid := EvaluateRun(RunSubmission{
		Date:          "2026-03-21",
		Seed:          "daily3dmaze:2026-03-21",
		MoveCount:     CountMovementActions(validTrace),
		ElapsedTimeMs: validTrace[len(validTrace)-1].ElapsedTimeMs,
		ReplayTrace:   validTrace,
	})
	if valid.VerificationStatus != VerificationStatusVerified {
		t.Fatalf("expected verified run, got %q", valid.VerificationStatus)
	}
	if len(valid.Reasons) != 0 {
		t.Fatalf("expected no suspicion reasons, got %v", valid.Reasons)
	}

	suspiciousTrace := make([]ReplayTraceEvent, 0, len(validTrace)+1)
	suspiciousTrace = append(suspiciousTrace, ReplayTraceEvent{ElapsedTimeMs: 300, Action: "move_backward"})
	for _, event := range validTrace {
		suspiciousTrace = append(suspiciousTrace, ReplayTraceEvent{
			ElapsedTimeMs: event.ElapsedTimeMs + 300,
			Action:        event.Action,
		})
	}
	suspicious := EvaluateRun(RunSubmission{
		Date:          "2026-03-21",
		Seed:          "daily3dmaze:2026-03-21",
		MoveCount:     CountMovementActions(suspiciousTrace),
		ElapsedTimeMs: suspiciousTrace[len(suspiciousTrace)-1].ElapsedTimeMs,
		ReplayTrace:   suspiciousTrace,
	})
	if suspicious.VerificationStatus != VerificationStatusSuspicious {
		t.Fatalf("expected suspicious run, got %q", suspicious.VerificationStatus)
	}
	if !containsReason(suspicious.Reasons, ReasonBlockedMoveAttempts) {
		t.Fatalf("expected blocked-move reason, got %v", suspicious.Reasons)
	}

	invalidTrace := []ReplayTraceEvent{
		{ElapsedTimeMs: 0, Action: "turn_left"},
		{ElapsedTimeMs: 10, Action: "turn_left"},
		{ElapsedTimeMs: 20, Action: "turn_left"},
	}
	invalid := EvaluateRun(RunSubmission{
		Date:          "2026-03-21",
		Seed:          "daily3dmaze:2026-03-21",
		MoveCount:     1,
		ElapsedTimeMs: 200,
		ReplayTrace:   invalidTrace,
	})
	if invalid.VerificationStatus != VerificationStatusInvalid {
		t.Fatalf("expected invalid run, got %q", invalid.VerificationStatus)
	}
	if !containsReason(invalid.Reasons, ReasonReplayDoesNotReachExit) {
		t.Fatalf("expected missing-exit reason, got %v", invalid.Reasons)
	}
}

func TestReasonStrings(t *testing.T) {
	t.Parallel()

	result := ValidationResult{
		Reasons: []SuspicionReason{ReasonTimestampDrift, ReasonHighActionDensity},
	}

	got := result.ReasonStrings()
	if len(got) != 2 || got[0] != "timestamp_drift" || got[1] != "high_action_density" {
		t.Fatalf("unexpected reason strings %v", got)
	}
}

func containsReason(values []SuspicionReason, target SuspicionReason) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}

	return false
}

func buildReplayTraceToExit(challenge DailyMaze) []ReplayTraceEvent {
	path := shortestPathToExit(challenge)
	directionIndex := getStartingDirectionIndex(challenge)
	elapsed := 0
	trace := make([]ReplayTraceEvent, 0, len(path)*2)

	for index := 1; index < len(path); index++ {
		current := path[index-1]
		next := path[index]
		targetDirection := Point{X: next.X - current.X, Y: next.Y - current.Y}
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
				trace = append(trace, ReplayTraceEvent{ElapsedTimeMs: elapsed, Action: "turn_right"})
				directionIndex = (directionIndex + 1) % len(directionOrder)
			} else {
				trace = append(trace, ReplayTraceEvent{ElapsedTimeMs: elapsed, Action: "turn_left"})
				directionIndex = (directionIndex + len(directionOrder) - 1) % len(directionOrder)
			}
		}

		elapsed += 300
		trace = append(trace, ReplayTraceEvent{ElapsedTimeMs: elapsed, Action: "move_forward"})
	}

	return trace
}

func shortestPathToExit(challenge DailyMaze) []Point {
	type queueState struct {
		position Point
	}

	queue := []queueState{{position: challenge.Start}}
	visited := map[Point]bool{challenge.Start: true}
	previous := map[Point]Point{}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current.position == challenge.Exit {
			break
		}

		for _, direction := range directionOrder {
			next := Point{X: current.position.X + direction.X, Y: current.position.Y + direction.Y}
			if visited[next] || !isWalkableCell(next, challenge.Grid) {
				continue
			}
			visited[next] = true
			previous[next] = current.position
			queue = append(queue, queueState{position: next})
		}
	}

	path := []Point{challenge.Exit}
	for path[len(path)-1] != challenge.Start {
		path = append(path, previous[path[len(path)-1]])
	}

	for left, right := 0, len(path)-1; left < right; left, right = left+1, right-1 {
		path[left], path[right] = path[right], path[left]
	}

	return path
}
