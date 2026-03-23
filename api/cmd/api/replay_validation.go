package main

import (
	"time"

	"daily3dmaze/api/internal/replay"
)

type ReplaySuspicionReason = replay.SuspicionReason
type VerificationStatus = replay.VerificationStatus
type ReplayValidationResult = replay.ValidationResult
type ReplaySimulationResult = replay.SimulationResult

const (
	ReasonReplayLengthMismatch   ReplaySuspicionReason = replay.ReasonReplayLengthMismatch
	ReasonTimestampDrift         ReplaySuspicionReason = replay.ReasonTimestampDrift
	ReasonVeryHighActionDensity  ReplaySuspicionReason = replay.ReasonVeryHighActionDensity
	ReasonHighActionDensity      ReplaySuspicionReason = replay.ReasonHighActionDensity
	ReasonRapidRepeatedTurns     ReplaySuspicionReason = replay.ReasonRapidRepeatedTurns
	ReasonBlockedMoveAttempts    ReplaySuspicionReason = replay.ReasonBlockedMoveAttempts
	ReasonReplayDoesNotReachExit ReplaySuspicionReason = replay.ReasonReplayDoesNotReachExit
	ReasonActionsAfterExit       ReplaySuspicionReason = replay.ReasonActionsAfterExit

	VerificationStatusPending    VerificationStatus = replay.VerificationStatusPending
	VerificationStatusVerified   VerificationStatus = replay.VerificationStatusVerified
	VerificationStatusSuspicious VerificationStatus = replay.VerificationStatusSuspicious
	VerificationStatusInvalid    VerificationStatus = replay.VerificationStatusInvalid
)

func evaluateReplayTrace(request runSubmissionRequest) ReplayValidationResult {
	return replay.EvaluateRun(toReplayRunSubmission(request))
}

func countReplayMovementActions(replayTrace []replayTraceEvent) int {
	return replay.CountMovementActions(toReplayTrace(replayTrace))
}

func simulateReplayTrace(challenge dailyMazeResponse, replayTrace []replayTraceEvent) ReplaySimulationResult {
	return replay.SimulateReplayTrace(toReplayMaze(challenge), toReplayTrace(replayTrace))
}

func generateDailyMaze(now time.Time) dailyMazeResponse {
	challenge := replay.GenerateDailyMaze(now)
	return fromReplayMaze(challenge)
}

func toReplayRunSubmission(request runSubmissionRequest) replay.RunSubmission {
	return replay.RunSubmission{
		Date:          request.Date,
		Seed:          request.Seed,
		MoveCount:     request.MoveCount,
		ElapsedTimeMs: request.ElapsedTimeMs,
		ReplayTrace:   toReplayTrace(request.ReplayTrace),
	}
}

func toReplayTrace(replayTrace []replayTraceEvent) []replay.ReplayTraceEvent {
	events := make([]replay.ReplayTraceEvent, len(replayTrace))
	for index, event := range replayTrace {
		events[index] = replay.ReplayTraceEvent{
			ElapsedTimeMs: event.ElapsedTimeMs,
			Action:        event.Action,
		}
	}
	return events
}

func toReplayMaze(challenge dailyMazeResponse) replay.DailyMaze {
	return replay.DailyMaze{
		Date:  challenge.Date,
		Title: challenge.Title,
		Seed:  challenge.Seed,
		Size: replay.Size{
			Width:  challenge.Size.Width,
			Height: challenge.Size.Height,
		},
		Start: replay.Point{
			X: challenge.Start.X,
			Y: challenge.Start.Y,
		},
		Exit: replay.Point{
			X: challenge.Exit.X,
			Y: challenge.Exit.Y,
		},
		Grid: append([]string(nil), challenge.Grid...),
	}
}

func fromReplayMaze(challenge replay.DailyMaze) dailyMazeResponse {
	return dailyMazeResponse{
		Date:  challenge.Date,
		Title: challenge.Title,
		Seed:  challenge.Seed,
		Size: mazeSize{
			Width:  challenge.Size.Width,
			Height: challenge.Size.Height,
		},
		Start: mazePoint{
			X: challenge.Start.X,
			Y: challenge.Start.Y,
		},
		Exit: mazePoint{
			X: challenge.Exit.X,
			Y: challenge.Exit.Y,
		},
		Grid: append([]string(nil), challenge.Grid...),
	}
}
