package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

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
