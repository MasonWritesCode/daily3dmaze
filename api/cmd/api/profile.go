package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type profileRun struct {
	Date          string `json:"date"`
	Seed          string `json:"seed"`
	MoveCount     int    `json:"moveCount"`
	ElapsedTimeMs int    `json:"elapsedTimeMs"`
	AcceptedAt    string `json:"acceptedAt"`
}

type profileResponse struct {
	User struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		CreatedAt string `json:"createdAt"`
	} `json:"user"`
	Stats struct {
		TotalRuns            int     `json:"totalRuns"`
		DaysPlayed           int     `json:"daysPlayed"`
		BestElapsedTimeMs    *int    `json:"bestElapsedTimeMs"`
		AverageElapsedTimeMs *int    `json:"averageElapsedTimeMs"`
		LastPlayedAt         *string `json:"lastPlayedAt"`
	} `json:"stats"`
	RecentRuns []profileRun `json:"recentRuns"`
}

func (a app) profileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("username")))
	if username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}

	if err := validateProfileUsername(username); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	profile, err := a.loadProfile(username)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "profile not found", http.StatusNotFound)
			return
		}

		http.Error(w, "failed to load profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(profile); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func validateProfileUsername(username string) error {
	return validateAuthRequest(authRequest{
		Username: username,
		Password: strings.Repeat("x", minPasswordLength),
	})
}

func (a app) loadProfile(username string) (profileResponse, error) {
	if a.db == nil {
		return profileResponse{}, errors.New("database unavailable")
	}

	const userQuery = `
		SELECT
			users.id,
			users.username,
			users.created_at,
			COUNT(runs.id),
			COUNT(DISTINCT runs.run_date),
			MIN(runs.elapsed_time_ms),
			AVG(runs.elapsed_time_ms),
			MAX(runs.accepted_at)
		FROM users
		LEFT JOIN runs ON runs.user_id = users.id
		WHERE users.username = $1
		GROUP BY users.id, users.username, users.created_at
	`

	var (
		profile           profileResponse
		createdAt         time.Time
		totalRuns         int
		daysPlayed        int
		bestElapsedRaw    sql.NullInt64
		averageElapsedRaw sql.NullFloat64
		lastPlayedRaw     sql.NullTime
	)

	if err := a.db.QueryRow(userQuery, username).Scan(
		&profile.User.ID,
		&profile.User.Username,
		&createdAt,
		&totalRuns,
		&daysPlayed,
		&bestElapsedRaw,
		&averageElapsedRaw,
		&lastPlayedRaw,
	); err != nil {
		return profileResponse{}, err
	}

	profile.User.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	profile.Stats.TotalRuns = totalRuns
	profile.Stats.DaysPlayed = daysPlayed
	if bestElapsedRaw.Valid {
		bestElapsedTimeMs := int(bestElapsedRaw.Int64)
		profile.Stats.BestElapsedTimeMs = &bestElapsedTimeMs
	}
	if averageElapsedRaw.Valid {
		averageElapsedTimeMs := int(averageElapsedRaw.Float64 + 0.5)
		profile.Stats.AverageElapsedTimeMs = &averageElapsedTimeMs
	}
	if lastPlayedRaw.Valid {
		lastPlayedAt := lastPlayedRaw.Time.UTC().Format(time.RFC3339)
		profile.Stats.LastPlayedAt = &lastPlayedAt
	}

	const recentRunsQuery = `
		SELECT run_date::text, seed, move_count, elapsed_time_ms, accepted_at
		FROM runs
		WHERE user_id = $1
		ORDER BY accepted_at DESC
		LIMIT 10
	`

	rows, err := a.db.Query(recentRunsQuery, profile.User.ID)
	if err != nil {
		return profileResponse{}, err
	}
	defer rows.Close()

	profile.RecentRuns = make([]profileRun, 0, 10)
	for rows.Next() {
		var run profileRun
		var acceptedAt time.Time
		if err := rows.Scan(&run.Date, &run.Seed, &run.MoveCount, &run.ElapsedTimeMs, &acceptedAt); err != nil {
			return profileResponse{}, err
		}

		run.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
		profile.RecentRuns = append(profile.RecentRuns, run)
	}

	if err := rows.Err(); err != nil {
		return profileResponse{}, err
	}

	return profile, nil
}
