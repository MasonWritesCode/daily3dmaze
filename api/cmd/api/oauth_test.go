package main

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNormalizeOAuthUsername(t *testing.T) {
	t.Parallel()

	if got := normalizeOAuthUsername("Mason Writes Code", "github"); got != "mason_writes_code" {
		t.Fatalf("expected normalized username, got %q", got)
	}

	if got := normalizeOAuthUsername("!!!", "github"); got != "github_user" {
		t.Fatalf("expected provider fallback username, got %q", got)
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
		SELECT users.id, users.username, users.role
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`)).
		WithArgs("github", "42").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role"}).AddRow(7, "mason_dev", roleUser))

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
