package replay

import (
	"hash/fnv"
	"math/rand"
	"time"
)

type SuspicionReason string
type VerificationStatus string

const (
	ReasonReplayLengthMismatch   SuspicionReason = "replay_length_mismatch"
	ReasonTimestampDrift         SuspicionReason = "timestamp_drift"
	ReasonVeryHighActionDensity  SuspicionReason = "very_high_action_density"
	ReasonHighActionDensity      SuspicionReason = "high_action_density"
	ReasonRapidRepeatedTurns     SuspicionReason = "rapid_repeated_turns"
	ReasonBlockedMoveAttempts    SuspicionReason = "blocked_move_attempts"
	ReasonReplayDoesNotReachExit SuspicionReason = "replay_does_not_reach_exit"
	ReasonActionsAfterExit       SuspicionReason = "actions_after_exit"

	VerificationStatusPending    VerificationStatus = "pending"
	VerificationStatusVerified   VerificationStatus = "verified"
	VerificationStatusSuspicious VerificationStatus = "suspicious"
	VerificationStatusInvalid    VerificationStatus = "invalid"
)

type Point struct {
	X int
	Y int
}

type Size struct {
	Width  int
	Height int
}

type DailyMaze struct {
	Date  string
	Title string
	Seed  string
	Size  Size
	Start Point
	Exit  Point
	Grid  []string
}

type ReplayTraceEvent struct {
	ElapsedTimeMs int
	Action        string
}

type RunSubmission struct {
	Date          string
	Seed          string
	MoveCount     int
	ElapsedTimeMs int
	ReplayTrace   []ReplayTraceEvent
}

type SimulationResult struct {
	FinalPosition       Point
	FinalDirectionIndex int
	ReachedExit         bool
	FirstExitStep       int
	BlockedMoveCount    int
	ActionsAfterExit    int
}

type ValidationResult struct {
	Score              int
	Reasons            []SuspicionReason
	Simulation         SimulationResult
	VerificationStatus VerificationStatus
	VerificationNotes  []string
}

func (result ValidationResult) ReasonStrings() []string {
	reasons := make([]string, len(result.Reasons))
	for index, reason := range result.Reasons {
		reasons[index] = string(reason)
	}

	return reasons
}

func GenerateDailyMaze(now time.Time) DailyMaze {
	challengeDate := now.Format("2006-01-02")
	seed := "daily3dmaze:" + challengeDate
	size := generateMazeSize(seed)
	grid, start, exit := generateMazeLayout(seed, size)

	return DailyMaze{
		Date:  challengeDate,
		Title: "Daily Maze",
		Seed:  seed,
		Size:  size,
		Start: start,
		Exit:  exit,
		Grid:  grid,
	}
}

func EvaluateRun(request RunSubmission) ValidationResult {
	result := ValidationResult{
		Reasons: make([]SuspicionReason, 0, 4),
	}

	if CountMovementActions(request.ReplayTrace) != request.MoveCount {
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

	if challengeDate, err := time.Parse("2006-01-02", request.Date); err == nil {
		challenge := GenerateDailyMaze(challengeDate.UTC())
		result.Simulation = SimulateReplayTrace(challenge, request.ReplayTrace)

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

func CountMovementActions(replayTrace []ReplayTraceEvent) int {
	count := 0
	for _, event := range replayTrace {
		if event.Action == "move_forward" || event.Action == "move_backward" {
			count++
		}
	}

	return count
}

func SimulateReplayTrace(challenge DailyMaze, replayTrace []ReplayTraceEvent) SimulationResult {
	directionIndex := getStartingDirectionIndex(challenge)
	position := challenge.Start
	result := SimulationResult{
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
			nextPosition := attemptMove(position, directionOrder[directionIndex], challenge.Grid)
			if nextPosition == position {
				result.BlockedMoveCount++
			}
			position = nextPosition
		case "move_backward":
			backwardDirection := Point{
				X: -directionOrder[directionIndex].X,
				Y: -directionOrder[directionIndex].Y,
			}
			nextPosition := attemptMove(position, backwardDirection, challenge.Grid)
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

var directionOrder = []Point{
	{X: 0, Y: -1},
	{X: 1, Y: 0},
	{X: 0, Y: 1},
	{X: -1, Y: 0},
}

func deriveVerificationOutcome(result ValidationResult) (VerificationStatus, []string) {
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

func generateMazeSize(seed string) Size {
	value := hashSeed(seed)
	return Size{
		Width:  13 + int(value%5)*2,
		Height: 13 + int((value/5)%5)*2,
	}
}

func generateMazeLayout(seed string, size Size) ([]string, Point, Point) {
	grid := make([][]byte, size.Height)
	for y := range grid {
		grid[y] = make([]byte, size.Width)
		for x := range grid[y] {
			grid[y][x] = '#'
		}
	}

	start := Point{X: 1, Y: 1}
	grid[start.Y][start.X] = ' '

	rng := rand.New(rand.NewSource(int64(hashSeed(seed))))
	stack := []Point{start}
	directions := []Point{{X: 0, Y: -2}, {X: 2, Y: 0}, {X: 0, Y: 2}, {X: -2, Y: 0}}

	for len(stack) > 0 {
		current := stack[len(stack)-1]
		perm := rng.Perm(len(directions))
		carved := false

		for _, index := range perm {
			direction := directions[index]
			next := Point{X: current.X + direction.X, Y: current.Y + direction.Y}

			if next.X <= 0 || next.X >= size.Width-1 || next.Y <= 0 || next.Y >= size.Height-1 {
				continue
			}
			if grid[next.Y][next.X] != '#' {
				continue
			}

			wall := Point{X: current.X + direction.X/2, Y: current.Y + direction.Y/2}
			grid[wall.Y][wall.X] = ' '
			grid[next.Y][next.X] = ' '
			stack = append(stack, next)
			carved = true
			break
		}

		if carved {
			continue
		}
		stack = stack[:len(stack)-1]
	}

	exit := findFarthestOpenCell(grid, start)
	rows := make([]string, len(grid))
	for y, row := range grid {
		rows[y] = string(row)
	}

	return rows, start, exit
}

func findFarthestOpenCell(grid [][]byte, start Point) Point {
	height := len(grid)
	width := len(grid[0])
	directions := []Point{{X: 1, Y: 0}, {X: 0, Y: 1}, {X: -1, Y: 0}, {X: 0, Y: -1}}
	visited := make([][]bool, height)
	for y := range visited {
		visited[y] = make([]bool, width)
	}

	queue := []Point{start}
	visited[start.Y][start.X] = true
	farthest := start

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		farthest = current

		for _, direction := range directions {
			next := Point{X: current.X + direction.X, Y: current.Y + direction.Y}
			if next.X < 0 || next.X >= width || next.Y < 0 || next.Y >= height {
				continue
			}
			if visited[next.Y][next.X] || grid[next.Y][next.X] == '#' {
				continue
			}
			visited[next.Y][next.X] = true
			queue = append(queue, next)
		}
	}

	return farthest
}

func getStartingDirectionIndex(challenge DailyMaze) int {
	exitDelta := Point{X: challenge.Exit.X - challenge.Start.X, Y: challenge.Exit.Y - challenge.Start.Y}
	openDirectionIndexes := make([]int, 0, len(directionOrder))
	for index, direction := range directionOrder {
		nextPosition := Point{X: challenge.Start.X + direction.X, Y: challenge.Start.Y + direction.Y}
		if isWalkableCell(nextPosition, challenge.Grid) {
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

func attemptMove(position, direction Point, grid []string) Point {
	nextPosition := Point{X: position.X + direction.X, Y: position.Y + direction.Y}
	if !isWalkableCell(nextPosition, grid) {
		return position
	}
	return nextPosition
}

func isWalkableCell(position Point, grid []string) bool {
	if position.Y < 0 || position.Y >= len(grid) {
		return false
	}
	row := grid[position.Y]
	if position.X < 0 || position.X >= len(row) {
		return false
	}
	return row[position.X] != '#'
}

func hashSeed(seed string) uint32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(seed))
	return hash.Sum32()
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
