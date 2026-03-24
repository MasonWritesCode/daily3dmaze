package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type recentRunReviewEntry struct {
	PublicID              string   `json:"publicId"`
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
	ReviewStatus          string   `json:"reviewStatus"`
	ReviewNotes           string   `json:"reviewNotes"`
	ReviewedAt            *string  `json:"reviewedAt"`
	ReviewedByUsername    *string  `json:"reviewedByUsername"`
	IsStalePending        bool     `json:"isStalePending"`
	AcceptedAt            string   `json:"acceptedAt"`
}

type runReviewSummary struct {
	PendingCount      int `json:"pendingCount"`
	VerifiedCount     int `json:"verifiedCount"`
	SuspiciousCount   int `json:"suspiciousCount"`
	InvalidCount      int `json:"invalidCount"`
	StalePendingCount int `json:"stalePendingCount"`
}

type recentRunReviewsResponse struct {
	Summary runReviewSummary       `json:"summary"`
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

type requeueRunReviewResponse struct {
	RunPublicID          string `json:"runPublicId"`
	VerificationStatus   string `json:"verificationStatus"`
	VerificationAttempts int    `json:"verificationAttempts"`
}

type updateRunReviewRequest struct {
	ReviewStatus string `json:"reviewStatus"`
	ReviewNotes  string `json:"reviewNotes"`
}

type updateRunReviewResponse struct {
	RunPublicID        string  `json:"runPublicId"`
	ReviewStatus       string  `json:"reviewStatus"`
	ReviewNotes        string  `json:"reviewNotes"`
	ReviewedAt         *string `json:"reviewedAt"`
	ReviewedByUsername *string `json:"reviewedByUsername"`
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

	user, err := a.currentUserFromRequest(r)
	if err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	if !roleAllows(user.Role, roleModerator, roleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	entries, err := a.listRecentRunReviews()
	if err != nil {
		http.Error(w, "failed to load run reviews", http.StatusInternalServerError)
		return
	}

	summary, err := a.loadRunReviewSummary()
	if err != nil {
		http.Error(w, "failed to load run review summary", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(recentRunReviewsResponse{
		Summary: summary,
		Entries: entries,
	}); err != nil {
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

	user, err := a.currentUserFromRequest(r)
	if err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	if !roleAllows(user.Role, roleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
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

	reviewer, err := a.currentUserFromRequest(r)
	if err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	if !roleAllows(reviewer.Role, roleModerator, roleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	pathSuffix := strings.TrimPrefix(r.URL.Path, "/api/admin/run-reviews/")
	if strings.HasSuffix(pathSuffix, "/requeue") {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		runPublicID, err := parseRunReviewPublicID(strings.TrimSuffix(pathSuffix, "/requeue"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		attempts, err := a.requeueRunReview(runPublicID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "run review not found", http.StatusNotFound)
				return
			}

			http.Error(w, "failed to requeue run review", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(requeueRunReviewResponse{
			RunPublicID:          runPublicID,
			VerificationStatus:   string(VerificationStatusPending),
			VerificationAttempts: attempts,
		}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
		}
		return
	}

	if strings.HasSuffix(pathSuffix, "/review") {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		runPublicID, err := parseRunReviewPublicID(strings.TrimSuffix(pathSuffix, "/review"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var request updateRunReviewRequest
		if err := decodeJSONBody(w, r, &request); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if err := validateRunReviewUpdate(request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		reviewedAt, err := a.updateRunReview(runPublicID, reviewer, request)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "run review not found", http.StatusNotFound)
				return
			}

			http.Error(w, "failed to update run review", http.StatusInternalServerError)
			return
		}

		var reviewedAtValue *string
		if !reviewedAt.IsZero() {
			value := reviewedAt.UTC().Format(time.RFC3339)
			reviewedAtValue = &value
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(updateRunReviewResponse{
			RunPublicID:  runPublicID,
			ReviewStatus: request.ReviewStatus,
			ReviewNotes:  strings.TrimSpace(request.ReviewNotes),
			ReviewedAt:   reviewedAtValue,
			ReviewedByUsername: func() *string {
				if request.ReviewStatus == "unreviewed" {
					return nil
				}
				value := reviewer.Username
				return &value
			}(),
		}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
		}
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	runPublicID, err := parseRunReviewPublicID(pathSuffix)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	detail, err := a.loadRunReviewDetail(runPublicID)
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
			runs.public_id,
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
			runs.review_status,
			runs.review_notes,
			runs.reviewed_at,
			review_users.username,
			runs.accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		LEFT JOIN users AS review_users ON review_users.id = runs.reviewed_by_user_id
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
		var reviewedAt sql.NullTime
		var reviewedByUsername sql.NullString
		var suspicionReasonsJSON []byte
		var verificationNotesJSON []byte
		if err := rows.Scan(
			&entry.PublicID,
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
			&entry.ReviewStatus,
			&entry.ReviewNotes,
			&reviewedAt,
			&reviewedByUsername,
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
		if reviewedAt.Valid {
			value := reviewedAt.Time.UTC().Format(time.RFC3339)
			entry.ReviewedAt = &value
		}
		if reviewedByUsername.Valid && strings.TrimSpace(reviewedByUsername.String) != "" {
			value := reviewedByUsername.String
			entry.ReviewedByUsername = &value
		}
		entry.IsStalePending = isStalePendingReview(
			entry.VerificationStatus,
			acceptedAt.UTC(),
			verificationStartedAt,
			a.currentTime(),
		)
		entry.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
		entries = append(entries, entry)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}

func (a app) loadRunReviewSummary() (runReviewSummary, error) {
	if a.db == nil {
		return runReviewSummary{}, errors.New("database unavailable")
	}

	const query = `
		SELECT
			COUNT(*) FILTER (WHERE verification_status = 'pending'),
			COUNT(*) FILTER (WHERE verification_status = 'verified'),
			COUNT(*) FILTER (WHERE verification_status = 'suspicious'),
			COUNT(*) FILTER (WHERE verification_status = 'invalid'),
			COUNT(*) FILTER (
				WHERE verification_status = 'pending'
					AND (
						(verification_started_at IS NOT NULL AND verification_started_at < $1)
						OR (verification_started_at IS NULL AND accepted_at < $1)
					)
			)
		FROM runs
	`

	var summary runReviewSummary
	if err := a.db.QueryRow(query, a.currentTime().Add(-stalePendingAfter)).Scan(
		&summary.PendingCount,
		&summary.VerifiedCount,
		&summary.SuspiciousCount,
		&summary.InvalidCount,
		&summary.StalePendingCount,
	); err != nil {
		return runReviewSummary{}, err
	}

	return summary, nil
}

func isStalePendingReview(
	verificationStatus string,
	acceptedAt time.Time,
	verificationStartedAt sql.NullTime,
	now time.Time,
) bool {
	if verificationStatus != string(VerificationStatusPending) {
		return false
	}

	staleThreshold := now.Add(-stalePendingAfter)
	if verificationStartedAt.Valid {
		return verificationStartedAt.Time.UTC().Before(staleThreshold)
	}

	return acceptedAt.Before(staleThreshold)
}

func (a app) requeueRunReview(runPublicID string) (int, error) {
	if a.db == nil {
		return 0, errors.New("database unavailable")
	}

	const query = `
		UPDATE runs
		SET
			verification_status = $2,
			verification_notes_json = $3,
			verification_started_at = NULL,
			verified_at = NULL,
			verification_error = NULL
		WHERE public_id = $1
		RETURNING verification_attempts
	`

	notesJSON, err := json.Marshal([]string{"manually_requeued_for_verification"})
	if err != nil {
		return 0, err
	}

	var attempts int
	if err := a.db.QueryRow(query, runPublicID, string(VerificationStatusPending), notesJSON).Scan(&attempts); err != nil {
		return 0, err
	}

	return attempts, nil
}

func validateRunReviewUpdate(request updateRunReviewRequest) error {
	switch request.ReviewStatus {
	case "unreviewed", "reviewed_clean", "confirmed_suspicious":
	default:
		return errors.New("reviewStatus must be unreviewed, reviewed_clean, or confirmed_suspicious")
	}

	if len(strings.TrimSpace(request.ReviewNotes)) > 2000 {
		return errors.New("reviewNotes must be 2000 characters or fewer")
	}

	return nil
}

func (a app) updateRunReview(runPublicID string, reviewer currentUser, request updateRunReviewRequest) (time.Time, error) {
	if a.db == nil {
		return time.Time{}, errors.New("database unavailable")
	}

	reviewedAt := a.currentTime()
	var reviewedByUserID *int64
	if request.ReviewStatus == "unreviewed" {
		reviewedAt = time.Time{}
	} else {
		reviewedByUserID = &reviewer.ID
	}

	const query = `
		UPDATE runs
		SET
			review_status = $2,
			review_notes = $3,
			reviewed_at = $4,
			reviewed_by_user_id = $5
		WHERE public_id = $1
		RETURNING id
	`

	var returnedID int64
	if err := a.db.QueryRow(
		query,
		runPublicID,
		request.ReviewStatus,
		strings.TrimSpace(request.ReviewNotes),
		sql.NullTime{Time: reviewedAt, Valid: !reviewedAt.IsZero()},
		reviewedByUserID,
	).Scan(&returnedID); err != nil {
		return time.Time{}, err
	}

	return reviewedAt, nil
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

func parseRunReviewPublicID(raw string) (string, error) {
	if raw == "" || strings.Contains(raw, "/") {
		return "", errors.New("run review public id is required")
	}

	if !strings.HasPrefix(raw, "run_") {
		return "", errors.New("run review public id must start with run_")
	}

	if len(raw) != 36 {
		return "", errors.New("run review public id must be 36 characters")
	}

	for _, r := range raw[4:] {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return "", errors.New("run review public id must use lowercase hexadecimal characters")
		}
	}

	return raw, nil
}

func (a app) loadRunReviewDetail(runPublicID string) (runReviewDetailResponse, error) {
	if a.db == nil {
		return runReviewDetailResponse{}, errors.New("database unavailable")
	}

	const query = `
		SELECT
			runs.public_id,
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
			runs.review_status,
			runs.review_notes,
			runs.reviewed_at,
			review_users.username,
			runs.replay_trace_json,
			runs.accepted_at
		FROM runs
		LEFT JOIN users ON users.id = runs.user_id
		LEFT JOIN users AS review_users ON review_users.id = runs.reviewed_by_user_id
		WHERE runs.public_id = $1
	`

	var (
		detail                runReviewDetailResponse
		acceptedAt            time.Time
		verificationStartedAt sql.NullTime
		verifiedAt            sql.NullTime
		verificationError     sql.NullString
		reviewedAt            sql.NullTime
		reviewedByUsername    sql.NullString
		suspicionReasonsJSON  []byte
		verificationNotesJSON []byte
		replayTraceJSON       []byte
	)
	if err := a.db.QueryRow(query, runPublicID).Scan(
		&detail.Entry.PublicID,
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
		&detail.Entry.ReviewStatus,
		&detail.Entry.ReviewNotes,
		&reviewedAt,
		&reviewedByUsername,
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
	if reviewedAt.Valid {
		value := reviewedAt.Time.UTC().Format(time.RFC3339)
		detail.Entry.ReviewedAt = &value
	}
	if reviewedByUsername.Valid && strings.TrimSpace(reviewedByUsername.String) != "" {
		value := reviewedByUsername.String
		detail.Entry.ReviewedByUsername = &value
	}
	detail.Entry.AcceptedAt = acceptedAt.UTC().Format(time.RFC3339)
	challengeDate, err := time.Parse(dateLayoutISO, detail.Entry.Date)
	if err != nil {
		return runReviewDetailResponse{}, err
	}
	detail.Simulation = simulateReplayTrace(generateDailyMaze(challengeDate.UTC()), detail.ReplayTrace)

	return detail, nil
}
