package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type stubPasswordResetSender struct {
	toEmail   string
	username  string
	resetURL  string
	expiresAt time.Time
	calls     int
}

func (s *stubPasswordResetSender) SendPasswordReset(toEmail, username, resetURL string, expiresAt time.Time) error {
	s.toEmail = toEmail
	s.username = username
	s.resetURL = resetURL
	s.expiresAt = expiresAt
	s.calls++
	return nil
}

func (s *stubPasswordResetSender) SendEmailVerification(toEmail, username, verificationURL string, expiresAt time.Time) error {
	s.toEmail = toEmail
	s.username = username
	s.resetURL = verificationURL
	s.expiresAt = expiresAt
	s.calls++
	return nil
}

func TestForgotPasswordHandlerIssuesResetToken(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	sender := &stubPasswordResetSender{}
	now := time.Date(2026, 3, 24, 12, 0, 0, 0, time.UTC)
	application := app{
		db:                  db,
		now:                 func() time.Time { return now },
		webBaseURL:          "http://localhost:3000",
		passwordResetSender: sender,
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, username, COALESCE(email, ''), COALESCE(is_banned, FALSE)
		FROM users
		WHERE
			(
				username = $1
				AND email_verified_at IS NOT NULL
			)
			OR LOWER(COALESCE(email, '')) = $2
		LIMIT 1
	`)).
		WithArgs("mason_dev", "mason_dev").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "is_banned"}).
			AddRow(7, "mason_dev", "mason@example.com", false))

	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at <= NOW()`)).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), now.Add(passwordResetLifetime)).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", strings.NewReader(
		`{"usernameOrEmail":"mason_dev"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.forgotPasswordHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload passwordResetResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode forgot-password response: %v", err)
	}

	if sender.calls != 1 {
		t.Fatalf("expected sender to be called once, got %d", sender.calls)
	}
	if !strings.Contains(sender.resetURL, "http://localhost:3000/reset-password?token=") {
		t.Fatalf("unexpected reset URL %q", sender.resetURL)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestForgotPasswordHandlerReturnsNeutralResponseForUnknownAccount(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	sender := &stubPasswordResetSender{}
	application := app{
		db:                  db,
		now:                 time.Now,
		webBaseURL:          "http://localhost:3000",
		passwordResetSender: sender,
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, username, COALESCE(email, ''), COALESCE(is_banned, FALSE)
		FROM users
		WHERE
			(
				username = $1
				AND email_verified_at IS NOT NULL
			)
			OR LOWER(COALESCE(email, '')) = $2
		LIMIT 1
	`)).
		WithArgs("missing_user", "missing_user").
		WillReturnError(sql.ErrNoRows)

	request := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", strings.NewReader(
		`{"usernameOrEmail":"missing_user"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.forgotPasswordHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Result().StatusCode)
	}
	if sender.calls != 0 {
		t.Fatalf("expected sender not to be called, got %d", sender.calls)
	}
}

func TestForgotPasswordHandlerSkipsUnverifiedUsernameMatches(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	sender := &stubPasswordResetSender{}
	application := app{
		db:                  db,
		now:                 time.Now,
		webBaseURL:          "http://localhost:3000",
		passwordResetSender: sender,
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, username, COALESCE(email, ''), COALESCE(is_banned, FALSE)
		FROM users
		WHERE
			(
				username = $1
				AND email_verified_at IS NOT NULL
			)
			OR LOWER(COALESCE(email, '')) = $2
		LIMIT 1
	`)).
		WithArgs("mason_dev", "mason_dev").
		WillReturnError(sql.ErrNoRows)

	request := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", strings.NewReader(
		`{"usernameOrEmail":"mason_dev"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.forgotPasswordHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Result().StatusCode)
	}
	if sender.calls != 0 {
		t.Fatalf("expected sender not to be called, got %d", sender.calls)
	}
}

func TestConfiguredPasswordResetSenderDisablesLoggingFallbackInProduction(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("SMTP_HOST", "")
	t.Setenv("SMTP_PORT", "")
	t.Setenv("SMTP_FROM_EMAIL", "")

	sender := configuredPasswordResetSender()
	if _, ok := sender.(unavailablePasswordResetSender); !ok {
		t.Fatalf("expected unavailable password reset sender in production, got %T", sender)
	}
}

func TestRequestEmailVerificationHandlerIssuesTokenForAuthenticatedUnverifiedUser(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	sender := &stubPasswordResetSender{}
	now := time.Date(2026, 3, 24, 12, 0, 0, 0, time.UTC)
	application := app{
		db:                  db,
		now:                 func() time.Time { return now },
		webBaseURL:          "http://localhost:3000",
		passwordResetSender: sender,
	}

	token := "session-token"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).
			AddRow(7, "mason_dev", roleUser, false))

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COALESCE(email, ''), email_verified_at IS NOT NULL
		FROM users
		WHERE id = $1
	`)).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"email", "email_verified"}).
			AddRow("mason@example.com", false))

	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM email_verification_tokens WHERE user_id = $1 OR expires_at <= NOW()`)).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), now.Add(emailVerificationLifetime)).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/verify-email/request", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})

	recorder := httptest.NewRecorder()
	application.requestEmailVerificationHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Result().StatusCode)
	}
	if sender.calls != 1 {
		t.Fatalf("expected verification sender to be called once, got %d", sender.calls)
	}
	if !strings.Contains(sender.resetURL, "http://localhost:3000/verify-email?token=") {
		t.Fatalf("unexpected verification URL %q", sender.resetURL)
	}
}

func TestVerifyEmailHandlerMarksEmailVerified(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, COALESCE(users.is_banned, FALSE)
		FROM email_verification_tokens
		JOIN users ON users.id = email_verification_tokens.user_id
		WHERE email_verification_tokens.token_hash = $1
			AND email_verification_tokens.used_at IS NULL
			AND email_verification_tokens.expires_at > NOW()
	`)).
		WithArgs(hashToken("verify-token")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_banned"}).AddRow(7, false))
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE users
		SET email_verified_at = COALESCE(email_verified_at, NOW())
		WHERE id = $1
	`)).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE email_verification_tokens SET used_at = NOW() WHERE token_hash = $1`)).
		WithArgs(hashToken("verify-token")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM email_verification_tokens WHERE user_id = $1 AND token_hash <> $2`)).
		WithArgs(int64(7), hashToken("verify-token")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	request := httptest.NewRequest(http.MethodPost, "/api/auth/verify-email", strings.NewReader(
		`{"token":"verify-token"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.verifyEmailHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Result().StatusCode)
	}
}

func TestResetPasswordHandlerUpdatesPasswordAndClearsSessions(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, COALESCE(users.is_banned, FALSE)
		FROM password_reset_tokens
		JOIN users ON users.id = password_reset_tokens.user_id
		WHERE password_reset_tokens.token_hash = $1
			AND password_reset_tokens.used_at IS NULL
			AND password_reset_tokens.expires_at > NOW()
	`)).
		WithArgs(hashToken("reset-token")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_banned"}).AddRow(7, false))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE users SET password_hash = $1 WHERE id = $2`)).
		WithArgs(sqlmock.AnyArg(), int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1`)).
		WithArgs(hashToken("reset-token")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND token_hash <> $2`)).
		WithArgs(int64(7), hashToken("reset-token")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM sessions WHERE user_id = $1`)).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	request := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", strings.NewReader(
		`{"token":"reset-token","newPassword":"supersecure456"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.resetPasswordHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Result().StatusCode)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestResetPasswordHandlerRejectsExpiredToken(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, COALESCE(users.is_banned, FALSE)
		FROM password_reset_tokens
		JOIN users ON users.id = password_reset_tokens.user_id
		WHERE password_reset_tokens.token_hash = $1
			AND password_reset_tokens.used_at IS NULL
			AND password_reset_tokens.expires_at > NOW()
	`)).
		WithArgs(hashToken("expired-token")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	request := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", strings.NewReader(
		`{"token":"expired-token","newPassword":"supersecure456"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.resetPasswordHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Result().StatusCode)
	}
}
