package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"golang.org/x/crypto/bcrypt"
)

func TestValidateAuthRequest(t *testing.T) {
	t.Parallel()

	valid := authRequest{
		Username: "mason_dev",
		Password: "supersecure123",
	}

	if err := validateAuthRequest(valid); err != nil {
		t.Fatalf("expected valid auth request, got error: %v", err)
	}

	cases := []struct {
		name    string
		request authRequest
	}{
		{
			name: "short username",
			request: authRequest{
				Username: "ab",
				Password: "supersecure123",
			},
		},
		{
			name: "invalid username characters",
			request: authRequest{
				Username: "mason writes code",
				Password: "supersecure123",
			},
		},
		{
			name: "short password",
			request: authRequest{
				Username: "mason_dev",
				Password: "short",
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if err := validateAuthRequest(tc.request); err == nil {
				t.Fatalf("expected validation error for case %q", tc.name)
			}
		})
	}
}

func TestHashTokenIsDeterministic(t *testing.T) {
	t.Parallel()

	first := hashToken("session-token")
	second := hashToken("session-token")

	if first != second {
		t.Fatalf("expected deterministic token hash, got %q and %q", first, second)
	}

	if first == hashToken("different-token") {
		t.Fatal("expected different tokens to produce different hashes")
	}
}

func TestRegisterHandlerCreatesUserAndSession(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		INSERT INTO users (username, email, email_verified_at, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, role
	`)).
		WithArgs("mason_dev", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), roleUser).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role"}).AddRow(7, "mason_dev", roleUser))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(
		`{"username":"Mason_Dev","password":"supersecure123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.registerHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, response.StatusCode)
	}

	var payload authResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode auth response: %v", err)
	}

	if payload.User.Username != "mason_dev" {
		t.Fatalf("expected lowercased username, got %q", payload.User.Username)
	}
	if payload.User.Role != roleUser {
		t.Fatalf("expected role %q, got %q", roleUser, payload.User.Role)
	}

	cookies := response.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 session cookie, got %d", len(cookies))
	}

	if cookies[0].Name != sessionCookieName {
		t.Fatalf("expected session cookie %q, got %q", sessionCookieName, cookies[0].Name)
	}

	if !cookies[0].HttpOnly {
		t.Fatal("expected session cookie to be HttpOnly")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRegisterHandlerIssuesVerificationEmailWhenEmailProvided(t *testing.T) {
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
		INSERT INTO users (username, email, email_verified_at, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, role
	`)).
		WithArgs("mason_dev", sql.NullString{String: "mason@example.com", Valid: true}, sqlmock.AnyArg(), sqlmock.AnyArg(), roleUser).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role"}).AddRow(7, "mason_dev", roleUser))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM email_verification_tokens WHERE user_id = $1 OR expires_at <= NOW()`)).
		WithArgs(int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), now.Add(emailVerificationLifetime)).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(
		`{"username":"Mason_Dev","email":"mason@example.com","password":"supersecure123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.registerHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Result().StatusCode)
	}
	if sender.calls != 1 {
		t.Fatalf("expected verification sender to be called once, got %d", sender.calls)
	}
}

func TestLoginHandlerRejectsInvalidPassword(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte("supersecure123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate password hash: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, username, role, COALESCE(email, ''), email_verified_at IS NOT NULL, COALESCE(is_banned, FALSE), password_hash
		FROM users
		WHERE username = $1
	`)).
		WithArgs("mason_dev").
		WillReturnRows(
			sqlmock.NewRows([]string{"id", "username", "role", "email", "email_verified", "is_banned", "password_hash"}).
				AddRow(7, "mason_dev", roleUser, "", false, false, string(passwordHash)),
		)

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(
		`{"username":"mason_dev","password":"wrongpassword123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.loginHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.StatusCode)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLoginHandlerCreatesSessionOnSuccess(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte("supersecure123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate password hash: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, username, role, COALESCE(email, ''), email_verified_at IS NOT NULL, COALESCE(is_banned, FALSE), password_hash
		FROM users
		WHERE username = $1
	`)).
		WithArgs("mason_dev").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "email", "email_verified", "is_banned", "password_hash"}).
			AddRow(7, "mason_dev", roleModerator, "", false, false, string(passwordHash)))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(
		`{"username":"mason_dev","password":"supersecure123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.loginHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload authResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode auth response: %v", err)
	}
	if payload.User.Username != "mason_dev" || payload.User.Role != roleModerator {
		t.Fatalf("unexpected login payload %+v", payload.User)
	}
	if len(response.Cookies()) != 1 {
		t.Fatalf("expected session cookie, got %d cookies", len(response.Cookies()))
	}
}

func TestLoginHandlerRejectsBannedUser(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, username, role, COALESCE(email, ''), email_verified_at IS NOT NULL, COALESCE(is_banned, FALSE), password_hash
		FROM users
		WHERE username = $1
	`)).
		WithArgs("mason_dev").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "email", "email_verified", "is_banned", "password_hash"}).
			AddRow(7, "mason_dev", roleUser, "", false, true, "$2a$10$invalidplaceholderhashvalue123456789012345678901234567890123"))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(
		`{"username":"mason_dev","password":"supersecure123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.loginHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, recorder.Result().StatusCode)
	}
}

func TestMeHandlerReturnsAuthenticatedUser(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	token := "session-token"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleModerator, false))

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COALESCE(email, ''), email_verified_at IS NOT NULL
		FROM users
		WHERE id = $1
	`)).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"email", "email_verified"}).AddRow("mason@example.com", true))

	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})

	recorder := httptest.NewRecorder()
	application.meHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload authResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode me response: %v", err)
	}

	if payload.User.Username != "mason_dev" {
		t.Fatalf("expected username %q, got %q", "mason_dev", payload.User.Username)
	}
	if payload.User.Role != roleModerator {
		t.Fatalf("expected role %q, got %q", roleModerator, payload.User.Role)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLogoutHandlerDeletesSessionAndClearsCookie(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	token := "session-token"

	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM sessions WHERE token_hash = $1`)).
		WithArgs(hashToken(token)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})

	recorder := httptest.NewRecorder()
	application.logoutHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, response.StatusCode)
	}

	cookies := response.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}

	if cookies[0].Name != sessionCookieName {
		t.Fatalf("expected cookie name %q, got %q", sessionCookieName, cookies[0].Name)
	}

	if cookies[0].MaxAge != -1 {
		t.Fatalf("expected cleared cookie MaxAge -1, got %d", cookies[0].MaxAge)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestMeHandlerRejectsBannedSessionUser(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	token := "session-token"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, true))

	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.meHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, recorder.Result().StatusCode)
	}
}

func TestRegisterHandlerReturnsConflictWhenUsernameUnavailable(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		INSERT INTO users (username, email, email_verified_at, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, role
	`)).
		WithArgs("mason_dev", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), roleUser).
		WillReturnError(errors.New("duplicate key value violates unique constraint"))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(
		`{"username":"Mason_Dev","password":"supersecure123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.registerHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Result().StatusCode)
	}
}

func TestRegisterHandlerReturnsConflictWhenEmailAlreadyInUse(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		INSERT INTO users (username, email, email_verified_at, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, role
	`)).
		WithArgs("mason_dev", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), roleUser).
		WillReturnError(errors.New(`duplicate key value violates unique constraint "users_email_lower_idx"`))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(
		`{"username":"Mason_Dev","email":"mason@example.com","password":"supersecure123"}`,
	))
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	application.registerHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Result().StatusCode)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "email is already in use") {
		t.Fatalf("expected email collision message, got %q", body)
	}
}

func TestLoginHandlerReturnsTooManyRequestsWhenRateLimited(t *testing.T) {
	t.Parallel()

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	limiter := newAuthRateLimiter(1, time.Minute)
	start := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return start }

	application := app{
		db:          db,
		authLimiter: limiter,
	}

	firstRequest := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(
		`{"username":"mason_dev","password":"supersecure123"}`,
	))
	firstRequest.Header.Set("Content-Type", "application/json")
	firstRequest.RemoteAddr = "127.0.0.1:4000"

	firstRecorder := httptest.NewRecorder()
	application.loginHandler(firstRecorder, firstRequest)

	secondRequest := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(
		`{"username":"mason_dev","password":"supersecure123"}`,
	))
	secondRequest.Header.Set("Content-Type", "application/json")
	secondRequest.RemoteAddr = "127.0.0.1:4000"

	secondRecorder := httptest.NewRecorder()
	application.loginHandler(secondRecorder, secondRequest)

	response := secondRecorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected status %d, got %d", http.StatusTooManyRequests, response.StatusCode)
	}

	if response.Header.Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on rate-limited response")
	}
}
