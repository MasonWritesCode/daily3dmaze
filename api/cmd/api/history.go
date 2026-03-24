package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

const (
	defaultHistoryLimit = 14
	maxHistoryLimit     = 60
)

type historyBestRun struct {
	Username      string `json:"username"`
	Role          string `json:"role"`
	MoveCount     int    `json:"moveCount"`
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
	AcceptedAt    string `json:"acceptedAt"`
}

type historyEntry struct {
	Date            string          `json:"date"`
	Title           string          `json:"title"`
	Seed            string          `json:"seed"`
	Size            mazeSize        `json:"size"`
	SubmissionCount int             `json:"submissionCount"`
	BestRun         *historyBestRun `json:"bestRun"`
}

type historyResponse struct {
	Entries []historyEntry `json:"entries"`
}

type historyDayResponse struct {
	Challenge   dailyMazeResponse   `json:"challenge"`
	Leaderboard leaderboardResponse `json:"leaderboard"`
}

func (a app) historyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	limit, err := parseHistoryLimit(r.URL.Query().Get("limit"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	entries, err := a.loadHistory(limit, time.Now().UTC())
	if err != nil {
		http.Error(w, "failed to load history", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(historyResponse{Entries: entries}); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (a app) historyDayHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	date := r.URL.Query().Get("date")
	if err := validateLeaderboardDate(date); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	challengeDate, err := time.Parse(dateLayoutISO, date)
	if err != nil {
		http.Error(w, "date must use YYYY-MM-DD format", http.StatusBadRequest)
		return
	}

	entries, err := a.listLeaderboard(date, "all")
	if err != nil {
		http.Error(w, "failed to load archive leaderboard", http.StatusInternalServerError)
		return
	}

	response := historyDayResponse{
		Challenge: generateDailyMaze(challengeDate.UTC()),
		Leaderboard: leaderboardResponse{
			Date:    date,
			Entries: entries,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func parseHistoryLimit(raw string) (int, error) {
	if raw == "" {
		return defaultHistoryLimit, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errors.New("limit must be a whole number")
	}

	if value <= 0 || value > maxHistoryLimit {
		return 0, errors.New("limit must be between 1 and 60")
	}

	return value, nil
}

func (a app) loadHistory(limit int, now time.Time) ([]historyEntry, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}

	entries := make([]historyEntry, 0, limit)
	entriesByDate := make(map[string]*historyEntry, limit)
	for offset := 0; offset < limit; offset += 1 {
		challengeTime := now.AddDate(0, 0, -offset)
		maze := generateDailyMaze(challengeTime)
		entry := historyEntry{
			Date:            maze.Date,
			Title:           maze.Title,
			Seed:            maze.Seed,
			Size:            maze.Size,
			SubmissionCount: 0,
		}
		entries = append(entries, entry)
		entriesByDate[entry.Date] = &entries[len(entries)-1]
	}

	oldestDate := entries[len(entries)-1].Date
	newestDate := entries[0].Date

	const query = `
		WITH ranked_runs AS (
			SELECT
				runs.run_date::text AS run_date,
				COUNT(*) OVER (PARTITION BY runs.run_date) AS submission_count,
				COALESCE(users.username, '') AS username,
				COALESCE(users.role, '') AS role,
				runs.move_count,
				runs.elapsed_time_ms,
				runs.accepted_at,
				ROW_NUMBER() OVER (
					PARTITION BY runs.run_date
					ORDER BY runs.elapsed_time_ms ASC, runs.move_count ASC, runs.accepted_at ASC
				) AS rank
			FROM runs
			LEFT JOIN users ON users.id = runs.user_id
			WHERE runs.run_date >= $1::date AND runs.run_date <= $2::date
				AND runs.verification_status = 'verified'
		)
		SELECT run_date, submission_count, username, role, move_count, elapsed_time_ms, accepted_at
		FROM ranked_runs
		WHERE rank = 1
		ORDER BY run_date DESC
	`

	rows, err := a.db.Query(query, oldestDate, newestDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			runDate         string
			submissionCount int
			bestRun         historyBestRun
			acceptedAt      time.Time
		)
		if err := rows.Scan(
			&runDate,
			&submissionCount,
			&bestRun.Username,
			&bestRun.Role,
			&bestRun.MoveCount,
			&bestRun.ElapsedTimeMs,
			&acceptedAt,
		); err != nil {
			return nil, err
		}

		entry := entriesByDate[runDate]
		if entry == nil {
			continue
		}

		bestRun.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
		entry.SubmissionCount = submissionCount
		entry.BestRun = &bestRun
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}
