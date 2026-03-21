package main

import (
	"encoding/json"
	"hash/fnv"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"
)

type dailyMazeResponse struct {
	Date  string    `json:"date"`
	Title string    `json:"title"`
	Seed  string    `json:"seed"`
	Size  mazeSize  `json:"size"`
	Start mazePoint `json:"start"`
	Exit  mazePoint `json:"exit"`
	Grid  []string  `json:"grid"`
}

type mazeSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type mazePoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type runSubmissionRequest struct {
	Date          string `json:"date"`
	Seed          string `json:"seed"`
	MoveCount     int    `json:"moveCount"`
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
}

type runSubmissionResponse struct {
	Status        string `json:"status"`
	Date          string `json:"date"`
	Seed          string `json:"seed"`
	MoveCount     int    `json:"moveCount"`
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
	AcceptedAt    string `json:"acceptedAt"`
}

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/daily-maze", dailyMazeHandler)
	mux.HandleFunc("/api/runs", runSubmissionHandler)

	addr := ":" + port
	log.Printf("api listening on %s", addr)

	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	response := map[string]string{
		"service": "api",
		"status":  "ok",
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func dailyMazeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	response := generateDailyMaze(time.Now().UTC())

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func runSubmissionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request runSubmissionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if request.Date == "" || request.Seed == "" {
		http.Error(w, "date and seed are required", http.StatusBadRequest)
		return
	}

	if request.MoveCount <= 0 {
		http.Error(w, "moveCount must be greater than zero", http.StatusBadRequest)
		return
	}

	if request.ElapsedTimeMs <= 0 {
		http.Error(w, "elapsedTimeMs must be greater than zero", http.StatusBadRequest)
		return
	}

	response := runSubmissionResponse{
		Status:        "accepted",
		Date:          request.Date,
		Seed:          request.Seed,
		MoveCount:     request.MoveCount,
		ElapsedTimeMs: request.ElapsedTimeMs,
		AcceptedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func generateDailyMaze(now time.Time) dailyMazeResponse {
	challengeDate := now.Format("2006-01-02")
	seed := "daily3dmaze:" + challengeDate
	size := generateMazeSize(seed)
	grid, start, exit := generateMazeLayout(seed, size)

	return dailyMazeResponse{
		Date:  challengeDate,
		Title: "Daily Maze",
		Seed:  seed,
		Size:  size,
		Start: start,
		Exit:  exit,
		Grid:  grid,
	}
}

func generateMazeSize(seed string) mazeSize {
	value := hashSeed(seed)

	// Keep early daily challenges compact while still varying by date.
	baseWidth := 13
	baseHeight := 13

	return mazeSize{
		Width:  baseWidth + int(value%5)*2,
		Height: baseHeight + int((value/5)%5)*2,
	}
}

func generateMazeLayout(seed string, size mazeSize) ([]string, mazePoint, mazePoint) {
	grid := make([][]byte, size.Height)
	for y := range grid {
		grid[y] = make([]byte, size.Width)
		for x := range grid[y] {
			grid[y][x] = '#'
		}
	}

	start := mazePoint{X: 1, Y: 1}
	grid[start.Y][start.X] = ' '

	rng := rand.New(rand.NewSource(int64(hashSeed(seed))))
	stack := []mazePoint{start}
	directions := []mazePoint{
		{X: 0, Y: -2},
		{X: 2, Y: 0},
		{X: 0, Y: 2},
		{X: -2, Y: 0},
	}

	for len(stack) > 0 {
		current := stack[len(stack)-1]
		perm := rng.Perm(len(directions))
		carved := false

		for _, index := range perm {
			direction := directions[index]
			next := mazePoint{
				X: current.X + direction.X,
				Y: current.Y + direction.Y,
			}

			if next.X <= 0 || next.X >= size.Width-1 || next.Y <= 0 || next.Y >= size.Height-1 {
				continue
			}

			if grid[next.Y][next.X] != '#' {
				continue
			}

			wall := mazePoint{
				X: current.X + direction.X/2,
				Y: current.Y + direction.Y/2,
			}

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

func findFarthestOpenCell(grid [][]byte, start mazePoint) mazePoint {
	height := len(grid)
	width := len(grid[0])
	directions := []mazePoint{
		{X: 1, Y: 0},
		{X: 0, Y: 1},
		{X: -1, Y: 0},
		{X: 0, Y: -1},
	}

	visited := make([][]bool, height)
	for y := range visited {
		visited[y] = make([]bool, width)
	}

	queue := []mazePoint{start}
	visited[start.Y][start.X] = true
	farthest := start

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		farthest = current

		for _, direction := range directions {
			next := mazePoint{
				X: current.X + direction.X,
				Y: current.Y + direction.Y,
			}

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

func hashSeed(seed string) uint32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(seed))
	return hash.Sum32()
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		next.ServeHTTP(w, r)
	})
}
