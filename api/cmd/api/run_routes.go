package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
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
	PublicID           string   `json:"publicId"`
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

type runStatusResponse struct {
	PublicID           string   `json:"publicId"`
	Status             string   `json:"status"`
	AcceptedAt         string   `json:"acceptedAt"`
	SuspicionScore     int      `json:"suspicionScore"`
	SuspicionReasons   []string `json:"suspicionReasons"`
	VerificationStatus string   `json:"verificationStatus"`
	VerificationNotes  []string `json:"verificationNotes"`
}

type leaderboardEntry struct {
	Rank          int    `json:"rank"`
	Username      string `json:"username"`
	Role          string `json:"role"`
	Date          string `json:"date"`
	Seed          string `json:"seed"`
	MoveCount     int    `json:"moveCount"`
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
	AcceptedAt    string `json:"acceptedAt"`
}

type leaderboardResponse struct {
	Date    string             `json:"date"`
	Scope   string             `json:"scope"`
	Entries []leaderboardEntry `json:"entries"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"service": "api", "status": "ok"})
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

	challengeTime := time.Now().UTC()
	if date := r.URL.Query().Get("date"); date != "" {
		parsed, err := validateLeaderboardDate(date)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		challengeTime = parsed
	}

	writeJSON(w, http.StatusOK, generateDailyMaze(challengeTime))
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

	publicID, err := a.insertRun(request, userID, suspicionScore, suspicionReasons, verificationStatus, verificationNotes, acceptedAt)
	if err != nil {
		http.Error(w, "failed to persist run", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusAccepted, runSubmissionResponse{
		Status:             "accepted",
		PublicID:           publicID,
		Date:               request.Date,
		Seed:               request.Seed,
		MoveCount:          request.MoveCount,
		ElapsedTimeMs:      request.ElapsedTimeMs,
		AcceptedAt:         acceptedAt.Format(time.RFC3339),
		SuspicionScore:     suspicionScore,
		SuspicionReasons:   suspicionReasons,
		VerificationStatus: string(verificationStatus),
		VerificationNotes:  verificationNotes,
	})
}

func (a app) runStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	runPublicID := strings.TrimPrefix(r.URL.Path, "/api/runs/")
	if strings.TrimSpace(runPublicID) == "" || strings.Contains(runPublicID, "/") {
		http.Error(w, "run public id is required", http.StatusBadRequest)
		return
	}

	status, err := a.loadRunStatus(runPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "run not found", http.StatusNotFound)
			return
		}

		http.Error(w, "failed to load run status", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, status)
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

	if _, err := validateLeaderboardDate(date); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	scope, err := parseLeaderboardScope(r.URL.Query().Get("scope"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	entries, err := a.listLeaderboard(date, scope)
	if err != nil {
		http.Error(w, "failed to load leaderboard", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, leaderboardResponse{
		Date:    date,
		Scope:   scope,
		Entries: entries,
	})
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

func (a app) insertRun(request runSubmissionRequest, userID *int64, suspicionScore int, suspicionReasons []string, verificationStatus VerificationStatus, verificationNotes []string, acceptedAt time.Time) (string, error) {
	if a.db == nil {
		return "", errors.New("database unavailable")
	}

	const query = `
		INSERT INTO runs (public_id, user_id, run_date, seed, move_count, elapsed_time_ms, replay_trace_json, suspicion_score, suspicion_reasons_json, verification_status, verification_notes_json, accepted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`

	replayTraceJSON, err := json.Marshal(request.ReplayTrace)
	if err != nil {
		return "", err
	}
	suspicionReasonsJSON, err := json.Marshal(suspicionReasons)
	if err != nil {
		return "", err
	}
	verificationNotesJSON, err := json.Marshal(verificationNotes)
	if err != nil {
		return "", err
	}

	publicID, err := newRunPublicID()
	if err != nil {
		return "", err
	}

	_, err = a.db.Exec(query, publicID, userID, request.Date, request.Seed, request.MoveCount, request.ElapsedTimeMs, replayTraceJSON, suspicionScore, suspicionReasonsJSON, string(verificationStatus), verificationNotesJSON, acceptedAt)
	if err != nil {
		return "", err
	}

	return publicID, nil
}

func (a app) loadRunStatus(runPublicID string) (runStatusResponse, error) {
	if a.db == nil {
		return runStatusResponse{}, errors.New("database unavailable")
	}

	const query = `
		SELECT public_id, accepted_at, suspicion_score, suspicion_reasons_json, verification_status, verification_notes_json
		FROM runs
		WHERE public_id = $1
	`

	var (
		response              runStatusResponse
		acceptedAt            time.Time
		suspicionReasonsJSON  []byte
		verificationNotesJSON []byte
	)

	if err := a.db.QueryRow(query, runPublicID).Scan(
		&response.PublicID,
		&acceptedAt,
		&response.SuspicionScore,
		&suspicionReasonsJSON,
		&response.VerificationStatus,
		&verificationNotesJSON,
	); err != nil {
		return runStatusResponse{}, err
	}

	if len(suspicionReasonsJSON) > 0 {
		if err := json.Unmarshal(suspicionReasonsJSON, &response.SuspicionReasons); err != nil {
			return runStatusResponse{}, err
		}
	}
	if len(verificationNotesJSON) > 0 {
		if err := json.Unmarshal(verificationNotesJSON, &response.VerificationNotes); err != nil {
			return runStatusResponse{}, err
		}
	}

	response.Status = "accepted"
	response.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
	return response, nil
}

func newRunPublicID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return "run_" + fmt.Sprintf("%x", bytes), nil
}

func parseLeaderboardScope(raw string) (string, error) {
	if raw == "" {
		return "all", nil
	}

	if raw == "all" || raw == "first" {
		return raw, nil
	}

	return "", errors.New("scope must be either all or first")
}

func (a app) listLeaderboard(date string, scope string) ([]leaderboardEntry, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}

	query := `
		SELECT run_date::text, COALESCE(users.username, ''), COALESCE(users.role, ''), seed, move_count, elapsed_time_ms, accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		WHERE run_date = $1::date AND verification_status = 'verified'
	`
	if scope == "first" {
		query = `
			WITH first_runs AS (
				SELECT DISTINCT ON (COALESCE(users.username, ''), runs.user_id)
					runs.run_date::text,
					COALESCE(users.username, ''),
					COALESCE(users.role, ''),
					runs.seed,
					runs.move_count,
					runs.elapsed_time_ms,
					runs.accepted_at
				FROM runs
				LEFT JOIN users ON users.id = runs.user_id
				WHERE runs.run_date = $1::date AND runs.verification_status = 'verified'
				ORDER BY COALESCE(users.username, ''), runs.user_id, runs.accepted_at ASC
			)
			SELECT *
			FROM first_runs
		`
	}
	query += `
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

		if err := rows.Scan(&entry.Date, &entry.Username, &entry.Role, &entry.Seed, &entry.MoveCount, &entry.ElapsedTimeMs, &acceptedAt); err != nil {
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

func validateLeaderboardDate(date string) (time.Time, error) {
	t, err := time.Parse(dateLayoutISO, date)
	if err != nil {
		return time.Time{}, errors.New("date must use YYYY-MM-DD format")
	}

	return t, nil
}

func rankLeaderboardEntries(entries []leaderboardEntry) []leaderboardEntry {
	ranked := make([]leaderboardEntry, len(entries))
	copy(ranked, entries)

	for index := range ranked {
		ranked[index].Rank = index + 1
	}

	return ranked
}
