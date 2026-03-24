package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestNormalizeOAuthUsername(t *testing.T) {
	t.Parallel()

	if got := normalizeOAuthUsername("Mason Writes Code", "github"); got != "mason_writes_code" {
		t.Fatalf("expected normalized username, got %q", got)
	}

	if got := normalizeOAuthUsername("!!!", "github"); got != "github_user" {
		t.Fatalf("expected provider fallback username, got %q", got)
	}

	if got := normalizeOAuthUsername("Mason.Writes+Code", "google"); got != "mason_writes_code" {
		t.Fatalf("expected normalized google username, got %q", got)
	}
}

func TestParseOAuthPath(t *testing.T) {
	t.Parallel()

	provider, action, err := parseOAuthPath("google/start")
	if err != nil {
		t.Fatalf("expected valid oauth path, got %v", err)
	}
	if provider != "google" || action != "start" {
		t.Fatalf("unexpected oauth path parse result provider=%q action=%q", provider, action)
	}

	if _, _, err := parseOAuthPath("google"); err == nil {
		t.Fatal("expected incomplete oauth path to fail")
	}
}

func TestOAuthHandlerRejectsInvalidState(t *testing.T) {
	t.Parallel()

	application := app{
		oauthProviders: map[string]oauthProvider{
			"github": {
				Name:         "github",
				ClientID:     "client-id",
				ClientSecret: "client-secret",
				AuthorizeURL: "https://github.com/login/oauth/authorize",
				TokenURL:     "https://github.com/login/oauth/access_token",
				UserURL:      "https://api.github.com/user",
			},
		},
	}

	request := httptest.NewRequest(http.MethodGet, "/api/auth/oauth/github/callback?state=wrong&code=abc123", nil)
	recorder := httptest.NewRecorder()

	application.oauthHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, response.StatusCode)
	}
}

func TestResolveOAuthUserUsesExistingLinkedAccount(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("github", "42").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, false))

	user, err := application.resolveOAuthUser(httptest.NewRequest(http.MethodGet, "/", nil), oauthIdentity{
		Provider:       "github",
		ProviderUserID: "42",
		Username:       "mason_dev",
	})
	if err != nil {
		t.Fatalf("resolve oauth user: %v", err)
	}

	if user.Username != "mason_dev" || user.Role != roleUser {
		t.Fatalf("unexpected oauth-linked user: %+v", user)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestConfiguredOAuthProvidersIncludesGoogleWhenConfigured(t *testing.T) {
	t.Setenv("GOOGLE_OAUTH_CLIENT_ID", "google-client-id")
	t.Setenv("GOOGLE_OAUTH_CLIENT_SECRET", "google-client-secret")

	providers := configuredOAuthProviders()
	provider, ok := providers["google"]
	if !ok {
		t.Fatal("expected google oauth provider to be configured")
	}

	if provider.AuthorizeURL != "https://accounts.google.com/o/oauth2/v2/auth" {
		t.Fatalf("unexpected google authorize url %q", provider.AuthorizeURL)
	}

	if len(provider.Scopes) != 3 || provider.Scopes[0] != "openid" {
		t.Fatalf("unexpected google scopes %#v", provider.Scopes)
	}
}

func TestFetchOAuthIdentityGoogle(t *testing.T) {
	t.Parallel()

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if got := r.Header.Get("Authorization"); got != "Bearer google-access-token" {
			t.Fatalf("expected bearer token, got %q", got)
		}

		payload, err := json.Marshal(map[string]any{
			"sub":            "google-user-123",
			"email":          "mason@example.com",
			"email_verified": true,
			"name":           "Mason Writes Code",
			"given_name":     "Mason",
		})
		if err != nil {
			t.Fatalf("encode google identity response: %v", err)
		}

		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(bytes.NewReader(payload)),
		}, nil
	})}

	identity, err := fetchOAuthIdentity(client, oauthProvider{
		Name:    "google",
		UserURL: "https://example.test/userinfo",
	}, "google-access-token")
	if err != nil {
		t.Fatalf("fetch google oauth identity: %v", err)
	}

	if identity.Provider != "google" {
		t.Fatalf("expected provider google, got %q", identity.Provider)
	}
	if identity.ProviderUserID != "google-user-123" {
		t.Fatalf("expected provider user id google-user-123, got %q", identity.ProviderUserID)
	}
	if identity.Username != "mason" {
		t.Fatalf("expected email-local username mason, got %q", identity.Username)
	}
	if identity.Email != "mason@example.com" {
		t.Fatalf("expected email mason@example.com, got %q", identity.Email)
	}
	if !identity.EmailVerified {
		t.Fatal("expected google email to be marked verified")
	}
}

func TestFetchOAuthIdentityGitHubUsesVerifiedEmailEndpoint(t *testing.T) {
	t.Parallel()

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if got := r.Header.Get("Authorization"); got != "Bearer github-access-token" {
			t.Fatalf("expected bearer token, got %q", got)
		}

		switch r.URL.String() {
		case "https://api.github.test/user":
			payload, err := json.Marshal(map[string]any{
				"id":    42,
				"login": "mason_dev",
				"email": nil,
			})
			if err != nil {
				t.Fatalf("encode github user response: %v", err)
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewReader(payload)),
			}, nil
		case "https://api.github.test/user/emails":
			payload, err := json.Marshal([]map[string]any{
				{"email": "secondary@example.com", "primary": false, "verified": true},
				{"email": "mason@example.com", "primary": true, "verified": true},
			})
			if err != nil {
				t.Fatalf("encode github email response: %v", err)
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewReader(payload)),
			}, nil
		default:
			t.Fatalf("unexpected github request url %q", r.URL.String())
			return nil, nil
		}
	})}

	identity, err := fetchOAuthIdentity(client, oauthProvider{
		Name:     "github",
		UserURL:  "https://api.github.test/user",
		EmailURL: "https://api.github.test/user/emails",
	}, "github-access-token")
	if err != nil {
		t.Fatalf("fetch github oauth identity: %v", err)
	}

	if identity.ProviderUserID != "42" {
		t.Fatalf("expected provider user id 42, got %q", identity.ProviderUserID)
	}
	if identity.Email != "mason@example.com" {
		t.Fatalf("expected verified primary email, got %q", identity.Email)
	}
	if !identity.EmailVerified {
		t.Fatal("expected github email to be marked verified")
	}
}

func TestResolveOAuthUserCreatesAndLinksNewUser(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("google", "google-user-123").
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`)).
		WithArgs("mason").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectQuery(regexp.QuoteMeta(`
		INSERT INTO users (username, email, email_verified_at, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, role
	`)).
		WithArgs("mason", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), roleUser).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role"}).AddRow(7, "mason", roleUser))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, provider_user_id)
		DO NOTHING
	`)).
		WithArgs(int64(7), "google", "google-user-123", "mason", sql.NullString{String: "mason@example.com", Valid: true}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE users
		SET
			email = CASE
				WHEN email IS NULL OR email = '' OR LOWER(email) = LOWER($2) THEN $2
				ELSE email
			END,
			email_verified_at = CASE
				WHEN email IS NULL OR email = '' OR LOWER(email) = LOWER($2)
				THEN COALESCE(email_verified_at, NOW())
				ELSE email_verified_at
			END
		WHERE id = $1
	`)).
		WithArgs(int64(7), "mason@example.com").
		WillReturnResult(sqlmock.NewResult(0, 1))

	user, err := application.resolveOAuthUser(httptest.NewRequest(http.MethodGet, "/", nil), oauthIdentity{
		Provider:       "google",
		ProviderUserID: "google-user-123",
		Username:       "mason",
		Email:          "mason@example.com",
		EmailVerified:  true,
	})
	if err != nil {
		t.Fatalf("resolve oauth user: %v", err)
	}

	if user.Username != "mason" || user.Role != roleUser {
		t.Fatalf("unexpected created oauth user: %+v", user)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestResolveOAuthUserRejectsBannedLinkedAccount(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("github", "42").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, true))

	_, err = application.resolveOAuthUser(httptest.NewRequest(http.MethodGet, "/", nil), oauthIdentity{
		Provider:       "github",
		ProviderUserID: "42",
		Username:       "mason_dev",
	})
	if !errors.Is(err, errAccountBanned) {
		t.Fatalf("expected banned-account error, got %v", err)
	}
}

func TestResolveOAuthUserLinksAccountToExistingSessionUser(t *testing.T) {
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
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("github", "42").
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(9, "signed_in_user", roleModerator, false))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, provider_user_id)
		DO NOTHING
	`)).
		WithArgs(int64(9), "github", "42", "mason_dev", sql.NullString{String: "", Valid: false}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})

	user, err := application.resolveOAuthUser(request, oauthIdentity{
		Provider:       "github",
		ProviderUserID: "42",
		Username:       "mason_dev",
	})
	if err != nil {
		t.Fatalf("resolve oauth user: %v", err)
	}

	if user.ID != 9 || user.Username != "signed_in_user" {
		t.Fatalf("unexpected linked session user %+v", user)
	}
}

func TestLinkOAuthAccountRejectsDifferentOwnerCollision(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, provider_user_id)
		DO NOTHING
	`)).
		WithArgs(int64(7), "google", "google-user-123", "mason", sql.NullString{String: "mason@example.com", Valid: true}).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT user_id
		FROM oauth_accounts
		WHERE provider = $1 AND provider_user_id = $2
	`)).
		WithArgs("google", "google-user-123").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(int64(11)))

	err = application.linkOAuthAccount(currentUser{ID: 7, Username: "mason"}, oauthIdentity{
		Provider:       "google",
		ProviderUserID: "google-user-123",
		Username:       "mason",
		Email:          "mason@example.com",
	})
	if err == nil || err.Error() != "oauth account is already linked to another user" {
		t.Fatalf("expected ownership collision error, got %v", err)
	}
}

func TestLinkOAuthAccountAllowsExistingLinkForSameUser(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, provider_user_id)
		DO NOTHING
	`)).
		WithArgs(int64(7), "github", "42", "mason_dev", sql.NullString{String: "", Valid: false}).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT user_id
		FROM oauth_accounts
		WHERE provider = $1 AND provider_user_id = $2
	`)).
		WithArgs("github", "42").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(int64(7)))

	if err := application.linkOAuthAccount(currentUser{ID: 7, Username: "mason"}, oauthIdentity{
		Provider:       "github",
		ProviderUserID: "42",
		Username:       "mason_dev",
	}); err != nil {
		t.Fatalf("expected idempotent link to succeed, got %v", err)
	}
}

func TestAllocateOAuthUsernameFallsBackToNumberedSuffix(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`)).
		WithArgs("mason").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`)).
		WithArgs("mason2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	username, err := application.allocateOAuthUsername("mason", "google")
	if err != nil {
		t.Fatalf("allocate oauth username: %v", err)
	}
	if username != "mason2" {
		t.Fatalf("expected username mason2, got %q", username)
	}
}

func TestOAuthCallbackHandlerReturnsForbiddenForBannedAccount(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.String() {
		case "https://oauth.example/token":
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(`{"access_token":"oauth-access-token"}`)),
			}, nil
		case "https://oauth.example/user":
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(`{"sub":"google-user-123","email":"mason@example.com","name":"Mason"}`)),
			}, nil
		default:
			t.Fatalf("unexpected oauth request url %q", r.URL.String())
			return nil, nil
		}
	})}

	application := app{
		db:          db,
		oauthClient: client,
		webBaseURL:  "http://localhost:3000",
		apiBaseURL:  "http://localhost:8080",
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("google", "google-user-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, true))

	stateRecorder := httptest.NewRecorder()
	if err := setOAuthStateCookie(stateRecorder, "google", "test-state"); err != nil {
		t.Fatalf("set oauth state cookie: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/auth/oauth/google/callback?state=test-state&code=oauth-code", nil)
	for _, cookie := range stateRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()

	application.oauthCallbackHandler(recorder, request, oauthProvider{
		Name:         "google",
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		TokenURL:     "https://oauth.example/token",
		UserURL:      "https://oauth.example/user",
	})

	if recorder.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, recorder.Result().StatusCode)
	}
}

func TestOAuthCallbackHandlerReturnsServerErrorWhenSessionCreationFails(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.String() {
		case "https://oauth.example/token":
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(`{"access_token":"oauth-access-token"}`)),
			}, nil
		case "https://oauth.example/user":
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(`{"sub":"google-user-123","email":"mason@example.com","name":"Mason"}`)),
			}, nil
		default:
			t.Fatalf("unexpected oauth request url %q", r.URL.String())
			return nil, nil
		}
	})}

	application := app{
		db:          db,
		oauthClient: client,
		webBaseURL:  "http://localhost:3000",
		apiBaseURL:  "http://localhost:8080",
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("google", "google-user-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, false))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnError(errors.New("db unavailable"))

	stateRecorder := httptest.NewRecorder()
	if err := setOAuthStateCookie(stateRecorder, "google", "test-state"); err != nil {
		t.Fatalf("set oauth state cookie: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/auth/oauth/google/callback?state=test-state&code=oauth-code", nil)
	for _, cookie := range stateRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()

	application.oauthCallbackHandler(recorder, request, oauthProvider{
		Name:         "google",
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		TokenURL:     "https://oauth.example/token",
		UserURL:      "https://oauth.example/user",
	})

	if recorder.Result().StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, recorder.Result().StatusCode)
	}
}

func TestOAuthCallbackHandlerCreatesSessionAndRedirects(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.String() {
		case "https://oauth.example/token":
			payload := `{"access_token":"oauth-access-token"}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(payload)),
			}, nil
		case "https://oauth.example/user":
			payload := `{"sub":"google-user-123","email":"mason@example.com","name":"Mason"}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewBufferString(payload)),
			}, nil
		default:
			t.Fatalf("unexpected oauth request url %q", r.URL.String())
			return nil, nil
		}
	})}

	application := app{
		db:          db,
		oauthClient: client,
		webBaseURL:  "http://localhost:3000",
		apiBaseURL:  "http://localhost:8080",
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("google", "google-user-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mason_dev", roleUser, false))

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`)).
		WithArgs(int64(7), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	request := httptest.NewRequest(http.MethodGet, "/api/auth/oauth/google/callback?state=test-state&code=oauth-code", nil)
	if err := setOAuthStateCookie(httptest.NewRecorder(), "google", "test-state"); err != nil {
		t.Fatalf("set oauth state cookie: %v", err)
	}
	stateRecorder := httptest.NewRecorder()
	if err := setOAuthStateCookie(stateRecorder, "google", "test-state"); err != nil {
		t.Fatalf("set oauth state cookie: %v", err)
	}
	for _, cookie := range stateRecorder.Result().Cookies() {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()

	application.oauthCallbackHandler(recorder, request, oauthProvider{
		Name:         "google",
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		TokenURL:     "https://oauth.example/token",
		UserURL:      "https://oauth.example/user",
	})

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusFound {
		t.Fatalf("expected redirect status, got %d", response.StatusCode)
	}
	if got := response.Header.Get("Location"); got != "http://localhost:3000/play" {
		t.Fatalf("expected redirect to play page, got %q", got)
	}
	if len(response.Cookies()) == 0 {
		t.Fatal("expected callback to set session cookie")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
