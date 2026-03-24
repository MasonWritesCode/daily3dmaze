package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
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

type passwordResetUser struct {
	ID       int64
	Username string
	Email    string
	IsBanned bool
}

type passwordResetSender interface {
	SendPasswordReset(toEmail, username, resetURL string, expiresAt time.Time) error
	SendEmailVerification(toEmail, username, verificationURL string, expiresAt time.Time) error
}

type loggingPasswordResetSender struct{}

func (loggingPasswordResetSender) SendPasswordReset(toEmail, username, resetURL string, expiresAt time.Time) error {
	log.Printf("password reset requested for %s <%s>: %s (expires %s)", username, toEmail, resetURL, expiresAt.Format(time.RFC3339))
	return nil
}

func (loggingPasswordResetSender) SendEmailVerification(toEmail, username, verificationURL string, expiresAt time.Time) error {
	log.Printf("email verification requested for %s <%s>: %s (expires %s)", username, toEmail, verificationURL, expiresAt.Format(time.RFC3339))
	return nil
}

type smtpPasswordResetSender struct {
	host     string
	addr     string
	username string
	password string
	from     string
}

type unavailablePasswordResetSender struct{}

func (unavailablePasswordResetSender) SendPasswordReset(toEmail, username, resetURL string, expiresAt time.Time) error {
	return errors.New("password reset email delivery is not configured")
}

func (unavailablePasswordResetSender) SendEmailVerification(toEmail, username, verificationURL string, expiresAt time.Time) error {
	return errors.New("email verification delivery is not configured")
}

func (s smtpPasswordResetSender) SendPasswordReset(toEmail, username, resetURL string, expiresAt time.Time) error {
	body := strings.Join([]string{
		fmt.Sprintf("To: %s", toEmail),
		fmt.Sprintf("From: %s", s.from),
		"Subject: Reset your daily3dmaze password",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		fmt.Sprintf("Hi %s,", username),
		"",
		"Use the link below to reset your daily3dmaze password:",
		resetURL,
		"",
		fmt.Sprintf("This link expires at %s.", expiresAt.Format(time.RFC1123)),
		"If you did not request this, you can ignore this email.",
		"",
	}, "\r\n")

	var auth smtp.Auth
	if s.username != "" {
		auth = smtp.PlainAuth("", s.username, s.password, s.host)
	}

	return smtp.SendMail(s.addr, auth, s.from, []string{toEmail}, []byte(body))
}

func (s smtpPasswordResetSender) SendEmailVerification(toEmail, username, verificationURL string, expiresAt time.Time) error {
	body := strings.Join([]string{
		fmt.Sprintf("To: %s", toEmail),
		fmt.Sprintf("From: %s", s.from),
		"Subject: Verify your daily3dmaze email",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		fmt.Sprintf("Hi %s,", username),
		"",
		"Use the link below to verify your daily3dmaze email address:",
		verificationURL,
		"",
		fmt.Sprintf("This link expires at %s.", expiresAt.Format(time.RFC1123)),
		"If you did not request this, you can ignore this email.",
		"",
	}, "\r\n")

	var auth smtp.Auth
	if s.username != "" {
		auth = smtp.PlainAuth("", s.username, s.password, s.host)
	}

	return smtp.SendMail(s.addr, auth, s.from, []string{toEmail}, []byte(body))
}

func configuredPasswordResetSender() passwordResetSender {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	from := strings.TrimSpace(os.Getenv("SMTP_FROM_EMAIL"))

	if host == "" || port == "" || from == "" {
		if strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production") {
			return unavailablePasswordResetSender{}
		}
		return loggingPasswordResetSender{}
	}

	return smtpPasswordResetSender{
		host:     host,
		addr:     host + ":" + port,
		username: strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
		password: os.Getenv("SMTP_PASSWORD"),
		from:     from,
	}
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

func (a app) findUserForPasswordReset(identifier string) (passwordResetUser, error) {
	const query = `
		SELECT id, username, COALESCE(email, ''), COALESCE(is_banned, FALSE)
		FROM users
		WHERE
			(
				username = $1
				AND email_verified_at IS NOT NULL
			)
			OR LOWER(COALESCE(email, '')) = $2
		LIMIT 1
	`

	normalizedUsername := strings.ToLower(identifier)
	normalizedEmail := strings.ToLower(identifier)

	var user passwordResetUser
	err := a.db.QueryRow(query, normalizedUsername, normalizedEmail).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.IsBanned,
	)
	if err != nil {
		return passwordResetUser{}, err
	}

	return user, nil
}

func (a app) issuePasswordReset(user passwordResetUser) error {
	if a.passwordResetSender == nil {
		return errors.New("password reset delivery is not configured")
	}

	token, err := randomToken()
	if err != nil {
		return err
	}

	expiresAt := a.now().UTC().Add(passwordResetLifetime)
	if _, err := a.db.Exec(`DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at <= NOW()`, user.ID); err != nil {
		return err
	}

	if _, err := a.db.Exec(`
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, hashToken(token), expiresAt); err != nil {
		return err
	}

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", strings.TrimRight(a.webBaseURL, "/"), url.QueryEscape(token))
	return a.passwordResetSender.SendPasswordReset(user.Email, user.Username, resetURL, expiresAt)
}

func (a app) issueEmailVerification(user currentUser) error {
	if a.passwordResetSender == nil {
		return errors.New("email verification delivery is not configured")
	}

	if strings.TrimSpace(user.Email) == "" {
		return errors.New("user does not have an email address")
	}

	token, err := randomToken()
	if err != nil {
		return err
	}

	expiresAt := a.currentTime().Add(emailVerificationLifetime)
	if _, err := a.db.Exec(`DELETE FROM email_verification_tokens WHERE user_id = $1 OR expires_at <= NOW()`, user.ID); err != nil {
		return err
	}

	if _, err := a.db.Exec(`
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, hashToken(token), expiresAt); err != nil {
		return err
	}

	verificationURL := fmt.Sprintf("%s/verify-email?token=%s", strings.TrimRight(a.webBaseURL, "/"), url.QueryEscape(token))
	return a.passwordResetSender.SendEmailVerification(user.Email, user.Username, verificationURL, expiresAt)
}

func (a app) completePasswordReset(token, newPassword string) error {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var userID int64
	var isBanned bool
	if err = tx.QueryRow(`
		SELECT users.id, COALESCE(users.is_banned, FALSE)
		FROM password_reset_tokens
		JOIN users ON users.id = password_reset_tokens.user_id
		WHERE password_reset_tokens.token_hash = $1
			AND password_reset_tokens.used_at IS NULL
			AND password_reset_tokens.expires_at > NOW()
	`, hashToken(token)).Scan(&userID, &isBanned); err != nil {
		return err
	}
	if isBanned {
		return errAccountBanned
	}

	if _, err = tx.Exec(`UPDATE users SET password_hash = $1 WHERE id = $2`, string(passwordHash), userID); err != nil {
		return err
	}

	if _, err = tx.Exec(`UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1`, hashToken(token)); err != nil {
		return err
	}

	if _, err = tx.Exec(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND token_hash <> $2`, userID, hashToken(token)); err != nil {
		return err
	}

	if _, err = tx.Exec(`DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return err
	}

	return tx.Commit()
}

func (a app) completeEmailVerification(token string) (err error) {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var userID int64
	var isBanned bool
	if err = tx.QueryRow(`
		SELECT users.id, COALESCE(users.is_banned, FALSE)
		FROM email_verification_tokens
		JOIN users ON users.id = email_verification_tokens.user_id
		WHERE email_verification_tokens.token_hash = $1
			AND email_verification_tokens.used_at IS NULL
			AND email_verification_tokens.expires_at > NOW()
	`, hashToken(token)).Scan(&userID, &isBanned); err != nil {
		return err
	}
	if isBanned {
		return errAccountBanned
	}

	if _, err = tx.Exec(`
		UPDATE users
		SET email_verified_at = COALESCE(email_verified_at, NOW())
		WHERE id = $1
	`, userID); err != nil {
		return err
	}

	if _, err = tx.Exec(`UPDATE email_verification_tokens SET used_at = NOW() WHERE token_hash = $1`, hashToken(token)); err != nil {
		return err
	}

	if _, err = tx.Exec(`DELETE FROM email_verification_tokens WHERE user_id = $1 AND token_hash <> $2`, userID, hashToken(token)); err != nil {
		return err
	}

	return tx.Commit()
}

func (a app) passwordResetSenderConfigured() bool {
	return a.passwordResetSender != nil
}

func (a app) passwordResetSenderName() string {
	switch a.passwordResetSender.(type) {
	case smtpPasswordResetSender:
		return "smtp"
	default:
		return "log"
	}
}

func (a app) passwordResetDebugInfo() string {
	payload, _ := json.Marshal(map[string]string{
		"sender": a.passwordResetSenderName(),
	})
	return string(payload)
}
