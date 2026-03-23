package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
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
	Date          string             `json:"date"`
	Seed          string             `json:"seed"`
	MoveCount     int                `json:"moveCount"`
	ElapsedTimeMs int                `json:"elapsedTimeMs"`
	ReplayTrace   []replayTraceEvent `json:"replayTrace"`
}

type replayTraceEvent struct {
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
	Action        string `json:"action"`
}

type runSubmissionResponse struct {
	Status           string   `json:"status"`
	Date             string   `json:"date"`
	Seed             string   `json:"seed"`
	MoveCount        int      `json:"moveCount"`
	ElapsedTimeMs    int      `json:"elapsedTimeMs"`
	AcceptedAt       string   `json:"acceptedAt"`
	SuspicionScore   int      `json:"suspicionScore"`
	SuspicionReasons []string `json:"suspicionReasons"`
}

type leaderboardEntry struct {
	Rank          int    `json:"rank"`
	Username      string `json:"username"`
	Date          string `json:"date"`
	Seed          string `json:"seed"`
	MoveCount     int    `json:"moveCount"`
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
	AcceptedAt    string `json:"acceptedAt"`
}

type leaderboardResponse struct {
	Date    string             `json:"date"`
	Entries []leaderboardEntry `json:"entries"`
}

type recentRunReviewEntry struct {
	Date             string   `json:"date"`
	Seed             string   `json:"seed"`
	Username         string   `json:"username"`
	MoveCount        int      `json:"moveCount"`
	ElapsedTimeMs    int      `json:"elapsedTimeMs"`
	SuspicionScore   int      `json:"suspicionScore"`
	SuspicionReasons []string `json:"suspicionReasons"`
	AcceptedAt       string   `json:"acceptedAt"`
}

type recentRunReviewsResponse struct {
	Entries []recentRunReviewEntry `json:"entries"`
}

type app struct {
	db          *sql.DB
	authLimiter *authRateLimiter
	now         func() time.Time
}

const (
	maxJSONBodyBytes = 64 * 1024
	maxReplayEvents  = 512
	maxMoveCount     = 100000
	maxElapsedTimeMs = 24 * 60 * 60 * 1000
	dateLayoutISO    = "2006-01-02"
	authRateLimit    = 10
	authWindow       = 5 * time.Minute
)

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	db, err := openDatabase()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	application := app{
		db:          db,
		authLimiter: newAuthRateLimiter(authRateLimit, authWindow),
		now:         time.Now,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/daily-maze", dailyMazeHandler)
	mux.HandleFunc("/api/auth/register", application.registerHandler)
	mux.HandleFunc("/api/auth/login", application.loginHandler)
	mux.HandleFunc("/api/auth/logout", application.logoutHandler)
	mux.HandleFunc("/api/me", application.meHandler)
	mux.HandleFunc("/api/profile", application.profileHandler)
	mux.HandleFunc("/api/history", application.historyHandler)
	mux.HandleFunc("/api/history/day", application.historyDayHandler)
	mux.HandleFunc("/api/runs", application.runSubmissionHandler)
	mux.HandleFunc("/api/admin/run-reviews", application.recentRunReviewsHandler)
	mux.HandleFunc("/api/leaderboard", application.leaderboardHandler)

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

	challengeTime := time.Now().UTC()
	if date := r.URL.Query().Get("date"); date != "" {
		if err := validateLeaderboardDate(date); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		parsedDate, err := time.Parse(dateLayoutISO, date)
		if err != nil {
			http.Error(w, "date must use YYYY-MM-DD format", http.StatusBadRequest)
			return
		}

		challengeTime = parsedDate.UTC()
	}

	response := generateDailyMaze(challengeTime)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (a app) runSubmissionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request runSubmissionRequest
	if err := decodeJSONBody(w, r, &request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := validateRunSubmission(request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	replayValidation := evaluateReplayTrace(request)
	suspicionScore := replayValidation.Score
	suspicionReasons := replayValidation.ReasonStrings()

	acceptedAt := time.Now().UTC()
	var userID *int64
	if user, err := a.currentUserFromRequest(r); err == nil {
		userID = &user.ID
	}

	if err := a.insertRun(request, userID, suspicionScore, suspicionReasons, acceptedAt); err != nil {
		http.Error(w, "failed to persist run", http.StatusInternalServerError)
		return
	}

	response := runSubmissionResponse{
		Status:           "accepted",
		Date:             request.Date,
		Seed:             request.Seed,
		MoveCount:        request.MoveCount,
		ElapsedTimeMs:    request.ElapsedTimeMs,
		AcceptedAt:       acceptedAt.Format(time.RFC3339),
		SuspicionScore:   suspicionScore,
		SuspicionReasons: suspicionReasons,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (a app) leaderboardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().UTC().Format(dateLayoutISO)
	}

	if err := validateLeaderboardDate(date); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	entries, err := a.listLeaderboard(date)
	if err != nil {
		http.Error(w, "failed to load leaderboard", http.StatusInternalServerError)
		return
	}

	response := leaderboardResponse{
		Date:    date,
		Entries: entries,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func generateDailyMaze(now time.Time) dailyMazeResponse {
	challengeDate := now.Format(dateLayoutISO)
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

func openDatabase() (*sql.DB, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://postgres:postgres@localhost:5432/daily3dmaze?sslmode=disable"
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, err
	}

	if err := runMigrations(db); err != nil {
		return nil, err
	}

	return db, nil
}

func (a app) insertRun(request runSubmissionRequest, userID *int64, suspicionScore int, suspicionReasons []string, acceptedAt time.Time) error {
	if a.db == nil {
		return errors.New("database unavailable")
	}

	const query = `
		INSERT INTO runs (user_id, run_date, seed, move_count, elapsed_time_ms, replay_trace_json, suspicion_score, suspicion_reasons_json, accepted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`

	replayTraceJSON, err := json.Marshal(request.ReplayTrace)
	if err != nil {
		return err
	}
	suspicionReasonsJSON, err := json.Marshal(suspicionReasons)
	if err != nil {
		return err
	}

	_, err = a.db.Exec(query, userID, request.Date, request.Seed, request.MoveCount, request.ElapsedTimeMs, replayTraceJSON, suspicionScore, suspicionReasonsJSON, acceptedAt)
	return err
}

func (a app) recentRunReviewsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if _, err := a.currentUserFromRequest(r); err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	entries, err := a.listRecentRunReviews()
	if err != nil {
		http.Error(w, "failed to load run reviews", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(recentRunReviewsResponse{Entries: entries}); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (a app) listRecentRunReviews() ([]recentRunReviewEntry, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}

	const query = `
		SELECT
			runs.run_date::text,
			runs.seed,
			COALESCE(users.username, ''),
			runs.move_count,
			runs.elapsed_time_ms,
			runs.suspicion_score,
			runs.suspicion_reasons_json,
			runs.accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		ORDER BY runs.accepted_at DESC
		LIMIT 20
	`

	rows, err := a.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]recentRunReviewEntry, 0, 20)
	for rows.Next() {
		var entry recentRunReviewEntry
		var acceptedAt time.Time
		var suspicionReasonsJSON []byte
		if err := rows.Scan(
			&entry.Date,
			&entry.Seed,
			&entry.Username,
			&entry.MoveCount,
			&entry.ElapsedTimeMs,
			&entry.SuspicionScore,
			&suspicionReasonsJSON,
			&acceptedAt,
		); err != nil {
			return nil, err
		}

		if err := json.Unmarshal(suspicionReasonsJSON, &entry.SuspicionReasons); err != nil {
			return nil, err
		}
		entry.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
		entries = append(entries, entry)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}

func (a app) listLeaderboard(date string) ([]leaderboardEntry, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}

	const query = `
		SELECT run_date::text, COALESCE(users.username, ''), seed, move_count, elapsed_time_ms, accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		WHERE run_date = $1::date
		ORDER BY elapsed_time_ms ASC, move_count ASC, accepted_at ASC
		LIMIT 10
	`

	rows, err := a.db.Query(query, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]leaderboardEntry, 0, 10)
	for rows.Next() {
		var entry leaderboardEntry
		var acceptedAt time.Time

		if err := rows.Scan(&entry.Date, &entry.Username, &entry.Seed, &entry.MoveCount, &entry.ElapsedTimeMs, &acceptedAt); err != nil {
			return nil, err
		}

		entry.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
		entries = append(entries, entry)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return rankLeaderboardEntries(entries), nil
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(destination); err != nil {
		return err
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}

	return nil
}

func validateRunSubmission(request runSubmissionRequest) error {
	if request.Date == "" || request.Seed == "" {
		return errors.New("date and seed are required")
	}

	if _, err := time.Parse(dateLayoutISO, request.Date); err != nil {
		return errors.New("date must use YYYY-MM-DD format")
	}

	expectedSeed := "daily3dmaze:" + request.Date
	if request.Seed != expectedSeed {
		return errors.New("seed does not match the submitted date")
	}

	if request.MoveCount <= 0 {
		return errors.New("moveCount must be greater than zero")
	}

	if request.MoveCount > maxMoveCount {
		return errors.New("moveCount is unreasonably large")
	}

	if request.ElapsedTimeMs <= 0 {
		return errors.New("elapsedTimeMs must be greater than zero")
	}

	if request.ElapsedTimeMs > maxElapsedTimeMs {
		return errors.New("elapsedTimeMs is unreasonably large")
	}

	if len(request.ReplayTrace) == 0 {
		return errors.New("replayTrace is required")
	}

	if len(request.ReplayTrace) > maxReplayEvents {
		return errors.New("replayTrace contains too many events")
	}

	lastElapsedTime := -1
	for _, event := range request.ReplayTrace {
		if event.ElapsedTimeMs < 0 {
			return errors.New("replayTrace event times must be non-negative")
		}

		if event.ElapsedTimeMs < lastElapsedTime {
			return errors.New("replayTrace event times must be non-decreasing")
		}

		if event.ElapsedTimeMs > request.ElapsedTimeMs {
			return errors.New("replayTrace event times must not exceed elapsedTimeMs")
		}

		switch event.Action {
		case "move_forward", "move_backward", "turn_left", "turn_right":
		default:
			return errors.New("replayTrace contains an unknown action")
		}

		lastElapsedTime = event.ElapsedTimeMs
	}

	return nil
}

func validateLeaderboardDate(date string) error {
	if _, err := time.Parse(dateLayoutISO, date); err != nil {
		return errors.New("date must use YYYY-MM-DD format")
	}

	return nil
}

func rankLeaderboardEntries(entries []leaderboardEntry) []leaderboardEntry {
	ranked := make([]leaderboardEntry, len(entries))
	copy(ranked, entries)

	for index := range ranked {
		ranked[index].Rank = index + 1
	}

	return ranked
}

func (a app) currentTime() time.Time {
	if a.now != nil {
		return a.now().UTC()
	}

	return time.Now().UTC()
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		next.ServeHTTP(w, r)
	})
}

type authRateLimiter struct {
	limit         int
	window        time.Duration
	now           func() time.Time
	mu            sync.Mutex
	requestsByKey map[string][]time.Time
}

func newAuthRateLimiter(limit int, window time.Duration) *authRateLimiter {
	return &authRateLimiter{
		limit:         limit,
		window:        window,
		now:           time.Now,
		requestsByKey: make(map[string][]time.Time),
	}
}

func (l *authRateLimiter) allow(action, key string) bool {
	if l == nil || key == "" {
		return true
	}

	now := l.now().UTC()
	cutoff := now.Add(-l.window)
	bucketKey := action + ":" + key

	l.mu.Lock()
	defer l.mu.Unlock()

	existing := l.requestsByKey[bucketKey]
	kept := existing[:0]
	for _, timestamp := range existing {
		if !timestamp.Before(cutoff) {
			kept = append(kept, timestamp)
		}
	}

	if len(kept) >= l.limit {
		l.requestsByKey[bucketKey] = kept
		return false
	}

	l.requestsByKey[bucketKey] = append(kept, now)
	return true
}

func rateLimitKeyFromRequest(r *http.Request) string {
	if forwardedFor := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwardedFor != "" {
		first := strings.TrimSpace(strings.Split(forwardedFor, ",")[0])
		if first != "" {
			return first
		}
	}

	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		return realIP
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}

	return strings.TrimSpace(r.RemoteAddr)
}
