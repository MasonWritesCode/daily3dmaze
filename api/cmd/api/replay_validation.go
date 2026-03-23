package main

import "time"

type ReplaySuspicionReason string
type VerificationStatus string

const (
	ReasonReplayLengthMismatch   ReplaySuspicionReason = "replay_length_mismatch"
	ReasonTimestampDrift         ReplaySuspicionReason = "timestamp_drift"
	ReasonVeryHighActionDensity  ReplaySuspicionReason = "very_high_action_density"
	ReasonHighActionDensity      ReplaySuspicionReason = "high_action_density"
	ReasonRapidRepeatedTurns     ReplaySuspicionReason = "rapid_repeated_turns"
	ReasonBlockedMoveAttempts    ReplaySuspicionReason = "blocked_move_attempts"
	ReasonReplayDoesNotReachExit ReplaySuspicionReason = "replay_does_not_reach_exit"
	ReasonActionsAfterExit       ReplaySuspicionReason = "actions_after_exit"

	VerificationStatusVerified   VerificationStatus = "verified"
	VerificationStatusSuspicious VerificationStatus = "suspicious"
	VerificationStatusInvalid    VerificationStatus = "invalid"
)

type ReplayValidationResult struct {
	Score              int
	Reasons            []ReplaySuspicionReason
	Simulation         ReplaySimulationResult
	VerificationStatus VerificationStatus
	VerificationNotes  []string
}

type ReplaySimulationResult struct {
	FinalPosition       mazePoint `json:"finalPosition"`
	FinalDirectionIndex int       `json:"finalDirectionIndex"`
	ReachedExit         bool      `json:"reachedExit"`
	FirstExitStep       int       `json:"firstExitStep"`
	BlockedMoveCount    int       `json:"blockedMoveCount"`
	ActionsAfterExit    int       `json:"actionsAfterExit"`
}

func (result ReplayValidationResult) ReasonStrings() []string {
	reasons := make([]string, len(result.Reasons))
	for index, reason := range result.Reasons {
		reasons[index] = string(reason)
	}

	return reasons
}

func evaluateReplayTrace(request runSubmissionRequest) ReplayValidationResult {
	result := ReplayValidationResult{
		Reasons: make([]ReplaySuspicionReason, 0, 4),
	}

	if len(request.ReplayTrace) != request.MoveCount {
		result.Score += 20
		result.Reasons = append(result.Reasons, ReasonReplayLengthMismatch)
	}

	lastEvent := request.ReplayTrace[len(request.ReplayTrace)-1]
	drift := request.ElapsedTimeMs - lastEvent.ElapsedTimeMs
	if drift < 0 {
		drift = -drift
	}
	if drift > 250 {
		result.Score += 15
		result.Reasons = append(result.Reasons, ReasonTimestampDrift)
	}

	if request.ElapsedTimeMs > 0 {
		actionsPerSecond := float64(len(request.ReplayTrace)) / (float64(request.ElapsedTimeMs) / 1000)
		if actionsPerSecond > 12 {
			result.Score += 35
			result.Reasons = append(result.Reasons, ReasonVeryHighActionDensity)
		} else if actionsPerSecond > 8 {
			result.Score += 15
			result.Reasons = append(result.Reasons, ReasonHighActionDensity)
		}
	}

	repeatedTurns := 0
	for index := 1; index < len(request.ReplayTrace); index++ {
		current := request.ReplayTrace[index]
		previous := request.ReplayTrace[index-1]
		if (current.Action == "turn_left" || current.Action == "turn_right") &&
			current.Action == previous.Action &&
			current.ElapsedTimeMs-previous.ElapsedTimeMs < 50 {
			repeatedTurns++
		}
	}
	if repeatedTurns > 0 {
		result.Score += minInt(20, repeatedTurns*5)
		result.Reasons = append(result.Reasons, ReasonRapidRepeatedTurns)
	}

	if challengeDate, err := time.Parse(dateLayoutISO, request.Date); err == nil {
		challenge := generateDailyMaze(challengeDate.UTC())
		result.Simulation = simulateReplayTrace(challenge, request.ReplayTrace)

		if result.Simulation.BlockedMoveCount > 0 {
			result.Score += minInt(20, result.Simulation.BlockedMoveCount*5)
			result.Reasons = append(result.Reasons, ReasonBlockedMoveAttempts)
		}

		if !result.Simulation.ReachedExit {
			result.Score += 40
			result.Reasons = append(result.Reasons, ReasonReplayDoesNotReachExit)
		}

		if result.Simulation.ActionsAfterExit > 0 {
			result.Score += minInt(20, result.Simulation.ActionsAfterExit*5)
			result.Reasons = append(result.Reasons, ReasonActionsAfterExit)
		}
	}

	if result.Score > 100 {
		result.Score = 100
	}

	result.VerificationStatus, result.VerificationNotes = deriveVerificationOutcome(result)

	return result
}

func minInt(left, right int) int {
	if left < right {
		return left
	}

	return right
}

func simulateReplayTrace(challenge dailyMazeResponse, replayTrace []replayTraceEvent) ReplaySimulationResult {
	directionIndex := getStartingDirectionIndexForMaze(challenge)
	position := challenge.Start
	result := ReplaySimulationResult{
		FinalPosition:       position,
		FinalDirectionIndex: directionIndex,
		FirstExitStep:       -1,
	}

	for index, event := range replayTrace {
		if result.ReachedExit {
			result.ActionsAfterExit++
		}

		switch event.Action {
		case "turn_left":
			directionIndex = (directionIndex + len(directionOrder) - 1) % len(directionOrder)
		case "turn_right":
			directionIndex = (directionIndex + 1) % len(directionOrder)
		case "move_forward":
			nextPosition := attemptReplayMove(position, directionOrder[directionIndex], challenge.Grid)
			if nextPosition == position {
				result.BlockedMoveCount++
			}
			position = nextPosition
		case "move_backward":
			backwardDirection := mazePoint{
				X: -directionOrder[directionIndex].X,
				Y: -directionOrder[directionIndex].Y,
			}
			nextPosition := attemptReplayMove(position, backwardDirection, challenge.Grid)
			if nextPosition == position {
				result.BlockedMoveCount++
			}
			position = nextPosition
		}

		if !result.ReachedExit && position == challenge.Exit {
			result.ReachedExit = true
			result.FirstExitStep = index + 1
		}
	}

	result.FinalPosition = position
	result.FinalDirectionIndex = directionIndex

	return result
}

var directionOrder = []mazePoint{
	{X: 0, Y: -1},
	{X: 1, Y: 0},
	{X: 0, Y: 1},
	{X: -1, Y: 0},
}

func getStartingDirectionIndexForMaze(challenge dailyMazeResponse) int {
	exitDelta := mazePoint{
		X: challenge.Exit.X - challenge.Start.X,
		Y: challenge.Exit.Y - challenge.Start.Y,
	}

	openDirectionIndexes := make([]int, 0, len(directionOrder))
	for index, direction := range directionOrder {
		nextPosition := mazePoint{
			X: challenge.Start.X + direction.X,
			Y: challenge.Start.Y + direction.Y,
		}
		if isWalkableReplayCell(nextPosition, challenge.Grid) {
			openDirectionIndexes = append(openDirectionIndexes, index)
		}
	}

	if len(openDirectionIndexes) == 0 {
		return 0
	}

	bestIndex := openDirectionIndexes[0]
	bestScore := directionOrder[bestIndex].X*exitDelta.X + directionOrder[bestIndex].Y*exitDelta.Y
	for _, index := range openDirectionIndexes[1:] {
		score := directionOrder[index].X*exitDelta.X + directionOrder[index].Y*exitDelta.Y
		if score > bestScore || (score == bestScore && index < bestIndex) {
			bestIndex = index
			bestScore = score
		}
	}

	return bestIndex
}

func attemptReplayMove(position, direction mazePoint, grid []string) mazePoint {
	nextPosition := mazePoint{
		X: position.X + direction.X,
		Y: position.Y + direction.Y,
	}
	if !isWalkableReplayCell(nextPosition, grid) {
		return position
	}

	return nextPosition
}

func isWalkableReplayCell(position mazePoint, grid []string) bool {
	if position.Y < 0 || position.Y >= len(grid) {
		return false
	}

	row := grid[position.Y]
	if position.X < 0 || position.X >= len(row) {
		return false
	}

	return row[position.X] != '#'
}

func deriveVerificationOutcome(result ReplayValidationResult) (VerificationStatus, []string) {
	notes := make([]string, 0, 4)

	if !result.Simulation.ReachedExit {
		notes = append(notes, "simulation_never_reached_exit")
	}
	if result.Simulation.BlockedMoveCount > 0 {
		notes = append(notes, "simulation_detected_blocked_moves")
	}
	if result.Simulation.ActionsAfterExit > 0 {
		notes = append(notes, "simulation_detected_actions_after_exit")
	}
	if result.Score >= 50 {
		notes = append(notes, "high_suspicion_score")
	} else if result.Score >= 20 {
		notes = append(notes, "moderate_suspicion_score")
	}

	if !result.Simulation.ReachedExit {
		return VerificationStatusInvalid, notes
	}

	if result.Simulation.BlockedMoveCount > 0 || result.Simulation.ActionsAfterExit > 0 || result.Score >= 20 {
		return VerificationStatusSuspicious, notes
	}

	if len(notes) == 0 {
		notes = append(notes, "simulation_matches_expected_outcome")
	}

	return VerificationStatusVerified, notes
}
