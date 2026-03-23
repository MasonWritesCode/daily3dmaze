package main

type ReplaySuspicionReason string

const (
	ReasonReplayLengthMismatch  ReplaySuspicionReason = "replay_length_mismatch"
	ReasonTimestampDrift        ReplaySuspicionReason = "timestamp_drift"
	ReasonVeryHighActionDensity ReplaySuspicionReason = "very_high_action_density"
	ReasonHighActionDensity     ReplaySuspicionReason = "high_action_density"
	ReasonRapidRepeatedTurns    ReplaySuspicionReason = "rapid_repeated_turns"
)

type ReplayValidationResult struct {
	Score   int
	Reasons []ReplaySuspicionReason
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

	if result.Score > 100 {
		result.Score = 100
	}

	return result
}

func minInt(left, right int) int {
	if left < right {
		return left
	}

	return right
}
