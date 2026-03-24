package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookieName    = "daily3dmaze_session"
	sessionLifetime      = 7 * 24 * time.Hour
	minPasswordLength    = 10
	maxUsernameLength    = 32
	minUsernameLength    = 3
	usernameAllowedChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
	roleUser             = "user"
	roleModerator        = "moderator"
	roleAdmin            = "admin"
)

var errAccountBanned = errors.New("account is banned")

type authRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	User authUserResponse `json:"user"`
}

type authUserResponse struct {
	ID            int64  `json:"id"`
	Username      string `json:"username"`
	Role          string `json:"role"`
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"emailVerified"`
}

type currentUser struct {
	ID            int64
	Username      string
	Role          string
	Email         string
	EmailVerified bool
	IsBanned      bool
}

func (a app) registerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "register") {
		return
	}

	var request authRequest
	if err := decodeJSONBody(w, r, &request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := validateAuthRequest(request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(request.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "failed to create account", http.StatusInternalServerError)
		return
	}

	user, err := a.createUser(
		strings.ToLower(request.Username),
		strings.ToLower(strings.TrimSpace(request.Email)),
		string(passwordHash),
		false,
	)
	if err != nil {
		http.Error(w, registrationConflictMessage(err), http.StatusConflict)
		return
	}

	if err := a.startSession(w, user); err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	if strings.TrimSpace(user.Email) != "" && !user.EmailVerified {
		if err := a.issueEmailVerification(user); err != nil {
			fmt.Printf("failed to send verification email for %s: %v\n", user.Username, err)
		}
	}

	writeJSON(w, http.StatusCreated, authResponse{
		User: authUserResponse{
			ID:            user.ID,
			Username:      user.Username,
			Role:          user.Role,
			Email:         user.Email,
			EmailVerified: user.EmailVerified,
		},
	})
}

func (a app) loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "login") {
		return
	}

	var request authRequest
	if err := decodeJSONBody(w, r, &request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := validateAuthRequest(request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	user, passwordHash, err := a.findUserByUsername(strings.ToLower(request.Username))
	if err != nil {
		if errors.Is(err, errAccountBanned) {
			http.Error(w, "account is disabled", http.StatusForbidden)
			return
		}
		http.Error(w, "invalid username or password", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(request.Password)); err != nil {
		http.Error(w, "invalid username or password", http.StatusUnauthorized)
		return
	}

	if err := a.startSession(w, user); err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		User: authUserResponse{
			ID:            user.ID,
			Username:      user.Username,
			Role:          user.Role,
			Email:         user.Email,
			EmailVerified: user.EmailVerified,
		},
	})
}

func (a app) logoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "logout") {
		return
	}

	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		_ = a.deleteSessionByToken(cookie.Value)
	}

	clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a app) meHandler(w http.ResponseWriter, r *http.Request) {
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
	if err := a.enrichCurrentUser(&user); err != nil {
		http.Error(w, "failed to load user profile", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		User: authUserResponse{
			ID:            user.ID,
			Username:      user.Username,
			Role:          user.Role,
			Email:         user.Email,
			EmailVerified: user.EmailVerified,
		},
	})
}

func validateAuthRequest(request authRequest) error {
	username := strings.TrimSpace(request.Username)
	if len(username) < minUsernameLength || len(username) > maxUsernameLength {
		return errors.New("username must be between 3 and 32 characters")
	}

	for _, char := range username {
		if !strings.ContainsRune(usernameAllowedChars, char) {
			return errors.New("username contains invalid characters")
		}
	}

	if len(request.Password) < minPasswordLength {
		return errors.New("password must be at least 10 characters")
	}

	email := strings.TrimSpace(request.Email)
	if email != "" && (!strings.Contains(email, "@") || strings.HasPrefix(email, "@") || strings.HasSuffix(email, "@")) {
		return errors.New("email must be valid")
	}

	return nil
}

func (a app) createUser(username, email, passwordHash string, emailVerified bool) (currentUser, error) {
	const query = `
		INSERT INTO users (username, email, email_verified_at, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, role
	`

	var emailVerifiedAt sql.NullTime
	if emailVerified && strings.TrimSpace(email) != "" {
		emailVerifiedAt = sql.NullTime{
			Time:  a.currentTime(),
			Valid: true,
		}
	}

	var user currentUser
	if err := a.db.QueryRow(
		query,
		username,
		nullString(email),
		emailVerifiedAt,
		passwordHash,
		roleUser,
	).Scan(&user.ID, &user.Username, &user.Role); err != nil {
		return currentUser{}, err
	}
	user.Email = strings.TrimSpace(email)
	user.EmailVerified = emailVerifiedAt.Valid

	return user, nil
}

func (a app) findUserByUsername(username string) (currentUser, string, error) {
	const query = `
		SELECT id, username, role, COALESCE(email, ''), email_verified_at IS NOT NULL, COALESCE(is_banned, FALSE), password_hash
		FROM users
		WHERE username = $1
	`

	var user currentUser
	var passwordHash string
	if err := a.db.QueryRow(query, username).Scan(&user.ID, &user.Username, &user.Role, &user.Email, &user.EmailVerified, &user.IsBanned, &passwordHash); err != nil {
		return currentUser{}, "", err
	}
	if user.IsBanned {
		return currentUser{}, "", errAccountBanned
	}

	return user, passwordHash, nil
}

func (a app) startSession(w http.ResponseWriter, user currentUser) error {
	token, err := randomToken()
	if err != nil {
		return err
	}

	tokenHash := hashToken(token)
	expiresAt := time.Now().UTC().Add(sessionLifetime)

	const query = `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`

	if _, err := a.db.Exec(query, user.ID, tokenHash, expiresAt); err != nil {
		return err
	}

	setSessionCookie(w, token, expiresAt)
	return nil
}

func (a app) currentUserFromRequest(r *http.Request) (currentUser, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return currentUser{}, err
	}

	const query = `
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`

	var user currentUser
	if err := a.db.QueryRow(query, hashToken(cookie.Value)).Scan(&user.ID, &user.Username, &user.Role, &user.IsBanned); err != nil {
		return currentUser{}, err
	}
	if user.IsBanned {
		return currentUser{}, errAccountBanned
	}

	return user, nil
}

func (a app) enrichCurrentUser(user *currentUser) error {
	if user == nil || user.ID == 0 {
		return nil
	}

	const query = `
		SELECT COALESCE(email, ''), email_verified_at IS NOT NULL
		FROM users
		WHERE id = $1
	`

	return a.db.QueryRow(query, user.ID).Scan(&user.Email, &user.EmailVerified)
}

func (a app) allowAuthAttempt(w http.ResponseWriter, r *http.Request, action string) bool {
	if a.authLimiter == nil {
		return true
	}

	if a.authLimiter.allow(action, a.rateLimitKeyFromRequest(r)) {
		return true
	}

	w.Header().Set("Retry-After", fmt.Sprintf("%.0f", authWindow.Seconds()))
	http.Error(w, "too many requests", http.StatusTooManyRequests)
	return false
}

func (a app) deleteSessionByToken(token string) error {
	if token == "" {
		return nil
	}

	_, err := a.db.Exec(`DELETE FROM sessions WHERE token_hash = $1`, hashToken(token))
	return err
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return hex.EncodeToString(bytes), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("APP_ENV") == "production",
		Expires:  expiresAt,
		MaxAge:   int(sessionLifetime.Seconds()),
	})
}

func registrationConflictMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "users_username_key":
			return "username is unavailable"
		case "users_email_lower_idx":
			return "email is already in use"
		}
	}

	message := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(message, "users_email_lower_idx"),
		strings.Contains(message, "email") && strings.Contains(message, "duplicate"):
		return "email is already in use"
	case strings.Contains(message, "users_username_key"),
		strings.Contains(message, "username") && strings.Contains(message, "duplicate"):
		return "username is unavailable"
	default:
		return "username is unavailable"
	}
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("APP_ENV") == "production",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func roleAllows(userRole string, allowedRoles ...string) bool {
	for _, allowedRole := range allowedRoles {
		if userRole == allowedRole {
			return true
		}
	}

	return false
}
