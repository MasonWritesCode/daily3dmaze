package main

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	passwordResetLifetime     = 60 * time.Minute
	emailVerificationLifetime = 24 * time.Hour
)

type passwordResetRequest struct {
	UsernameOrEmail string `json:"usernameOrEmail"`
}

type passwordResetCompleteRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

type emailVerificationRequest struct {
	Token string `json:"token"`
}

type passwordResetResponse struct {
	Message string `json:"message"`
}

func (a app) forgotPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "forgot-password") {
		return
	}

	var request passwordResetRequest
	if err := decodeJSONBody(w, r, &request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	identifier := strings.TrimSpace(request.UsernameOrEmail)
	if identifier == "" {
		http.Error(w, "username or email is required", http.StatusBadRequest)
		return
	}

	user, err := a.findUserForPasswordReset(identifier)
	if err == nil && !user.IsBanned && user.Email != "" {
		if sendErr := a.issuePasswordReset(user); sendErr != nil {
			log.Printf("failed to issue password reset for %q: %v", identifier, sendErr)
		}
	}

	writeJSON(w, http.StatusOK, passwordResetResponse{
		Message: "If an eligible account exists, a password reset link has been sent.",
	})
}

func (a app) resetPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "reset-password") {
		return
	}

	var request passwordResetCompleteRequest
	if err := decodeJSONBody(w, r, &request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	token := strings.TrimSpace(request.Token)
	if token == "" {
		http.Error(w, "reset token is required", http.StatusBadRequest)
		return
	}

	if len(request.NewPassword) < minPasswordLength {
		http.Error(w, "password must be at least 10 characters", http.StatusBadRequest)
		return
	}

	if err := a.completePasswordReset(token, request.NewPassword); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "reset token is invalid or expired", http.StatusBadRequest)
			return
		}
		if errors.Is(err, errAccountBanned) {
			http.Error(w, "account is disabled", http.StatusForbidden)
			return
		}
		http.Error(w, "failed to reset password", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, passwordResetResponse{
		Message: "Your password has been reset.",
	})
}

func (a app) requestEmailVerificationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "verify-email-request") {
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

	if strings.TrimSpace(user.Email) == "" {
		http.Error(w, "email address is required", http.StatusBadRequest)
		return
	}

	if user.EmailVerified {
		writeJSON(w, http.StatusOK, passwordResetResponse{
			Message: "Your email is already verified.",
		})
		return
	}

	if err := a.issueEmailVerification(user); err != nil {
		http.Error(w, "failed to send verification email", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, passwordResetResponse{
		Message: "A verification link has been sent if your account is eligible.",
	})
}

func (a app) verifyEmailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !a.allowAuthAttempt(w, r, "verify-email") {
		return
	}

	var request emailVerificationRequest
	if err := decodeJSONBody(w, r, &request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	token := strings.TrimSpace(request.Token)
	if token == "" {
		http.Error(w, "verification token is required", http.StatusBadRequest)
		return
	}

	if err := a.completeEmailVerification(token); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "verification token is invalid or expired", http.StatusBadRequest)
			return
		}
		if errors.Is(err, errAccountBanned) {
			http.Error(w, "account is disabled", http.StatusForbidden)
			return
		}
		http.Error(w, "failed to verify email", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, passwordResetResponse{
		Message: "Your email has been verified.",
	})
}
