package main

import (
	"bytes"
	"encoding/json"
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
}
