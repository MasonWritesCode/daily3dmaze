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
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

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
	expiresAt := a.currentTime().Add(sessionLifetime)

	const query = `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`

	if _, err := a.db.Exec(query, user.ID, tokenHash, expiresAt); err != nil {
		return err
	}

	setSessionCookie(w, token, expiresAt, a.secureCookies)
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

func setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
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

func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func validateUsername(username string) error {
	trimmed := strings.TrimSpace(username)
	if len(trimmed) < minUsernameLength || len(trimmed) > maxUsernameLength {
		return errors.New("username must be between 3 and 32 characters")
	}

	for _, char := range trimmed {
		if !strings.ContainsRune(usernameAllowedChars, char) {
			return errors.New("username contains invalid characters")
		}
	}

	return nil
}

func roleAllows(userRole string, allowedRoles ...string) bool {
	for _, allowedRole := range allowedRoles {
		if userRole == allowedRole {
			return true
		}
	}

	return false
}
