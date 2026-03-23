package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
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
	Status             string   `json:"status"`
	Date               string   `json:"date"`
	Seed               string   `json:"seed"`
	MoveCount          int      `json:"moveCount"`
	ElapsedTimeMs      int      `json:"elapsedTimeMs"`
	AcceptedAt         string   `json:"acceptedAt"`
	SuspicionScore     int      `json:"suspicionScore"`
	SuspicionReasons   []string `json:"suspicionReasons"`
	VerificationStatus string   `json:"verificationStatus"`
	VerificationNotes  []string `json:"verificationNotes"`
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
	ID                    int64    `json:"id"`
	Date                  string   `json:"date"`
	Seed                  string   `json:"seed"`
	Username              string   `json:"username"`
	MoveCount             int      `json:"moveCount"`
	ElapsedTimeMs         int      `json:"elapsedTimeMs"`
	SuspicionScore        int      `json:"suspicionScore"`
	SuspicionReasons      []string `json:"suspicionReasons"`
	VerificationStatus    string   `json:"verificationStatus"`
	VerificationNotes     []string `json:"verificationNotes"`
	VerificationStartedAt *string  `json:"verificationStartedAt"`
	VerifiedAt            *string  `json:"verifiedAt"`
	VerificationAttempts  int      `json:"verificationAttempts"`
	VerificationError     *string  `json:"verificationError"`
	AcceptedAt            string   `json:"acceptedAt"`
}

type recentRunReviewsResponse struct {
	Entries []recentRunReviewEntry `json:"entries"`
}

type runReviewDetailResponse struct {
	Entry       recentRunReviewEntry   `json:"entry"`
	ReplayTrace []replayTraceEvent     `json:"replayTrace"`
	Simulation  ReplaySimulationResult `json:"simulation"`
}

type recomputeRunReviewsResponse struct {
	UpdatedCount int `json:"updatedCount"`
	SkippedCount int `json:"skippedCount"`
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
	mux.HandleFunc("/api/admin/run-reviews/recompute", application.recomputeRunReviewsHandler)
	mux.HandleFunc("/api/admin/run-reviews/", application.runReviewDetailHandler)
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

	suspicionScore := 0
	suspicionReasons := []string{}
	verificationStatus := VerificationStatusPending
	verificationNotes := []string{"queued_for_async_verification"}

	acceptedAt := time.Now().UTC()
	var userID *int64
	if user, err := a.currentUserFromRequest(r); err == nil {
		userID = &user.ID
	}

	if err := a.insertRun(request, userID, suspicionScore, suspicionReasons, verificationStatus, verificationNotes, acceptedAt); err != nil {
		http.Error(w, "failed to persist run", http.StatusInternalServerError)
		return
	}

	response := runSubmissionResponse{
		Status:             "accepted",
		Date:               request.Date,
		Seed:               request.Seed,
		MoveCount:          request.MoveCount,
		ElapsedTimeMs:      request.ElapsedTimeMs,
		AcceptedAt:         acceptedAt.Format(time.RFC3339),
		SuspicionScore:     suspicionScore,
		SuspicionReasons:   suspicionReasons,
		VerificationStatus: string(verificationStatus),
		VerificationNotes:  verificationNotes,
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

func (a app) insertRun(request runSubmissionRequest, userID *int64, suspicionScore int, suspicionReasons []string, verificationStatus VerificationStatus, verificationNotes []string, acceptedAt time.Time) error {
	if a.db == nil {
		return errors.New("database unavailable")
	}

	const query = `
		INSERT INTO runs (user_id, run_date, seed, move_count, elapsed_time_ms, replay_trace_json, suspicion_score, suspicion_reasons_json, verification_status, verification_notes_json, accepted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`

	replayTraceJSON, err := json.Marshal(request.ReplayTrace)
	if err != nil {
		return err
	}
	suspicionReasonsJSON, err := json.Marshal(suspicionReasons)
	if err != nil {
		return err
	}
	verificationNotesJSON, err := json.Marshal(verificationNotes)
	if err != nil {
		return err
	}

	_, err = a.db.Exec(query, userID, request.Date, request.Seed, request.MoveCount, request.ElapsedTimeMs, replayTraceJSON, suspicionScore, suspicionReasonsJSON, string(verificationStatus), verificationNotesJSON, acceptedAt)
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

func (a app) recomputeRunReviewsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if _, err := a.currentUserFromRequest(r); err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	updatedCount, skippedCount, err := a.recomputeStoredRunVerifications()
	if err != nil {
		http.Error(w, "failed to recompute run verifications", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(recomputeRunReviewsResponse{
		UpdatedCount: updatedCount,
		SkippedCount: skippedCount,
	}); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (a app) runReviewDetailHandler(w http.ResponseWriter, r *http.Request) {
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

	runID, err := parseRunReviewID(strings.TrimPrefix(r.URL.Path, "/api/admin/run-reviews/"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	detail, err := a.loadRunReviewDetail(runID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "run review not found", http.StatusNotFound)
			return
		}

		http.Error(w, "failed to load run review", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(detail); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (a app) listRecentRunReviews() ([]recentRunReviewEntry, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}

	const query = `
		SELECT
			runs.id,
			runs.run_date::text,
			runs.seed,
			COALESCE(users.username, ''),
			runs.move_count,
			runs.elapsed_time_ms,
			runs.suspicion_score,
			runs.suspicion_reasons_json,
			runs.verification_status,
			runs.verification_notes_json,
			runs.verification_started_at,
			runs.verified_at,
			runs.verification_attempts,
			runs.verification_error,
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
		var verificationStartedAt sql.NullTime
		var verifiedAt sql.NullTime
		var verificationError sql.NullString
		var suspicionReasonsJSON []byte
		var verificationNotesJSON []byte
		if err := rows.Scan(
			&entry.ID,
			&entry.Date,
			&entry.Seed,
			&entry.Username,
			&entry.MoveCount,
			&entry.ElapsedTimeMs,
			&entry.SuspicionScore,
			&suspicionReasonsJSON,
			&entry.VerificationStatus,
			&verificationNotesJSON,
			&verificationStartedAt,
			&verifiedAt,
			&entry.VerificationAttempts,
			&verificationError,
			&acceptedAt,
		); err != nil {
			return nil, err
		}

		if err := json.Unmarshal(suspicionReasonsJSON, &entry.SuspicionReasons); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(verificationNotesJSON, &entry.VerificationNotes); err != nil {
			return nil, err
		}
		if verificationStartedAt.Valid {
			value := verificationStartedAt.Time.UTC().Format(time.RFC3339)
			entry.VerificationStartedAt = &value
		}
		if verifiedAt.Valid {
			value := verifiedAt.Time.UTC().Format(time.RFC3339)
			entry.VerifiedAt = &value
		}
		if verificationError.Valid && strings.TrimSpace(verificationError.String) != "" {
			value := verificationError.String
			entry.VerificationError = &value
		}
		entry.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
		entries = append(entries, entry)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}

func (a app) recomputeStoredRunVerifications() (int, int, error) {
	if a.db == nil {
		return 0, 0, errors.New("database unavailable")
	}

	const selectQuery = `
		SELECT id, run_date::text, seed, move_count, elapsed_time_ms, replay_trace_json
		FROM runs
		ORDER BY id ASC
	`

	rows, err := a.db.Query(selectQuery)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	type storedRun struct {
		id              int64
		request         runSubmissionRequest
		replayTraceJSON []byte
	}

	runs := make([]storedRun, 0, 32)
	for rows.Next() {
		var run storedRun
		if err := rows.Scan(
			&run.id,
			&run.request.Date,
			&run.request.Seed,
			&run.request.MoveCount,
			&run.request.ElapsedTimeMs,
			&run.replayTraceJSON,
		); err != nil {
			return 0, 0, err
		}
		runs = append(runs, run)
	}

	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	const updateQuery = `
		UPDATE runs
		SET
			suspicion_score = $2,
			suspicion_reasons_json = $3,
			verification_status = $4,
			verification_notes_json = $5,
			verification_started_at = COALESCE(verification_started_at, $6),
			verified_at = $6,
			verification_error = NULL
		WHERE id = $1
	`

	updatedCount := 0
	skippedCount := 0
	for _, run := range runs {
		if len(run.replayTraceJSON) == 0 {
			skippedCount++
			continue
		}

		if err := json.Unmarshal(run.replayTraceJSON, &run.request.ReplayTrace); err != nil {
			return updatedCount, skippedCount, err
		}
		if len(run.request.ReplayTrace) == 0 {
			skippedCount++
			continue
		}

		replayValidation := evaluateReplayTrace(run.request)
		suspicionReasonsJSON, err := json.Marshal(replayValidation.ReasonStrings())
		if err != nil {
			return updatedCount, skippedCount, err
		}
		verificationNotesJSON, err := json.Marshal(replayValidation.VerificationNotes)
		if err != nil {
			return updatedCount, skippedCount, err
		}

		if _, err := a.db.Exec(
			updateQuery,
			run.id,
			replayValidation.Score,
			suspicionReasonsJSON,
			string(replayValidation.VerificationStatus),
			verificationNotesJSON,
			a.currentTime(),
		); err != nil {
			return updatedCount, skippedCount, err
		}

		updatedCount++
	}

	return updatedCount, skippedCount, nil
}

func parseRunReviewID(raw string) (int64, error) {
	if raw == "" || strings.Contains(raw, "/") {
		return 0, errors.New("run review id is required")
	}

	runID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || runID <= 0 {
		return 0, errors.New("run review id must be a positive integer")
	}

	return runID, nil
}

func (a app) loadRunReviewDetail(runID int64) (runReviewDetailResponse, error) {
	if a.db == nil {
		return runReviewDetailResponse{}, errors.New("database unavailable")
	}

	const query = `
		SELECT
			runs.id,
			runs.run_date::text,
			runs.seed,
			COALESCE(users.username, ''),
			runs.move_count,
			runs.elapsed_time_ms,
			runs.suspicion_score,
			runs.suspicion_reasons_json,
			runs.verification_status,
			runs.verification_notes_json,
			runs.verification_started_at,
			runs.verified_at,
			runs.verification_attempts,
			runs.verification_error,
			runs.replay_trace_json,
			runs.accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		WHERE runs.id = $1
	`

	var (
		detail                runReviewDetailResponse
		acceptedAt            time.Time
		verificationStartedAt sql.NullTime
		verifiedAt            sql.NullTime
		verificationError     sql.NullString
		suspicionReasonsJSON  []byte
		verificationNotesJSON []byte
		replayTraceJSON       []byte
	)
	if err := a.db.QueryRow(query, runID).Scan(
		&detail.Entry.ID,
		&detail.Entry.Date,
		&detail.Entry.Seed,
		&detail.Entry.Username,
		&detail.Entry.MoveCount,
		&detail.Entry.ElapsedTimeMs,
		&detail.Entry.SuspicionScore,
		&suspicionReasonsJSON,
		&detail.Entry.VerificationStatus,
		&verificationNotesJSON,
		&verificationStartedAt,
		&verifiedAt,
		&detail.Entry.VerificationAttempts,
		&verificationError,
		&replayTraceJSON,
		&acceptedAt,
	); err != nil {
		return runReviewDetailResponse{}, err
	}

	if err := json.Unmarshal(suspicionReasonsJSON, &detail.Entry.SuspicionReasons); err != nil {
		return runReviewDetailResponse{}, err
	}
	if err := json.Unmarshal(verificationNotesJSON, &detail.Entry.VerificationNotes); err != nil {
		return runReviewDetailResponse{}, err
	}
	if len(replayTraceJSON) > 0 {
		if err := json.Unmarshal(replayTraceJSON, &detail.ReplayTrace); err != nil {
			return runReviewDetailResponse{}, err
		}
	}
	if verificationStartedAt.Valid {
		value := verificationStartedAt.Time.UTC().Format(time.RFC3339)
		detail.Entry.VerificationStartedAt = &value
	}
	if verifiedAt.Valid {
		value := verifiedAt.Time.UTC().Format(time.RFC3339)
		detail.Entry.VerifiedAt = &value
	}
	if verificationError.Valid && strings.TrimSpace(verificationError.String) != "" {
		value := verificationError.String
		detail.Entry.VerificationError = &value
	}
	detail.Entry.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
	challengeDate, err := time.Parse(dateLayoutISO, detail.Entry.Date)
	if err != nil {
		return runReviewDetailResponse{}, err
	}
	detail.Simulation = simulateReplayTrace(generateDailyMaze(challengeDate.UTC()), detail.ReplayTrace)

	return detail, nil
}

func (a app) listLeaderboard(date string) ([]leaderboardEntry, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}

	const query = `
		SELECT run_date::text, COALESCE(users.username, ''), seed, move_count, elapsed_time_ms, accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		WHERE run_date = $1::date AND verification_status = 'verified'
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
