package main

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	oauthStateCookieName = "daily3dmaze_oauth_state"
	oauthStateLifetime   = 10 * time.Minute
)

type oauthProvider struct {
	Name         string
	ClientID     string
	ClientSecret string
	AuthorizeURL string
	TokenURL     string
	UserURL      string
	EmailURL     string
	Scopes       []string
}

type oauthIdentity struct {
	Provider       string
	ProviderUserID string
	Username       string
	Email          string
	EmailVerified  bool
}

type oauthTokenResponse struct {
	AccessToken string `json:"access_token"`
}

type githubUserResponse struct {
	ID    int64   `json:"id"`
	Login string  `json:"login"`
	Email *string `json:"email"`
}

type githubEmailResponse struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

type googleUserResponse struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
}

type oauthStateCookieValue struct {
	Provider string `json:"provider"`
	State    string `json:"state"`
}

func configuredOAuthProviders() map[string]oauthProvider {
	providers := make(map[string]oauthProvider)

	githubClientID := strings.TrimSpace(os.Getenv("GITHUB_OAUTH_CLIENT_ID"))
	githubClientSecret := strings.TrimSpace(os.Getenv("GITHUB_OAUTH_CLIENT_SECRET"))
	if githubClientID != "" && githubClientSecret != "" {
		providers["github"] = oauthProvider{
			Name:         "github",
			ClientID:     githubClientID,
			ClientSecret: githubClientSecret,
			AuthorizeURL: "https://github.com/login/oauth/authorize",
			TokenURL:     "https://github.com/login/oauth/access_token",
			UserURL:      "https://api.github.com/user",
			EmailURL:     "https://api.github.com/user/emails",
			Scopes:       []string{"read:user", "user:email"},
		}
	}

	googleClientID := strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID"))
	googleClientSecret := strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET"))
	if googleClientID != "" && googleClientSecret != "" {
		providers["google"] = oauthProvider{
			Name:         "google",
			ClientID:     googleClientID,
			ClientSecret: googleClientSecret,
			AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL:     "https://oauth2.googleapis.com/token",
			UserURL:      "https://openidconnect.googleapis.com/v1/userinfo",
			Scopes:       []string{"openid", "profile", "email"},
		}
	}

	return providers
}

func envOrDefault(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	return value
}

func (a app) oauthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	providerName, action, err := parseOAuthPath(strings.TrimPrefix(r.URL.Path, "/api/auth/oauth/"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	provider, ok := a.oauthProviders[providerName]
	if !ok {
		http.Error(w, "oauth provider is not configured", http.StatusNotFound)
		return
	}

	switch action {
	case "start":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		a.oauthStartHandler(w, r, provider)
	case "callback":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		a.oauthCallbackHandler(w, r, provider)
	default:
		http.Error(w, "oauth action is not supported", http.StatusBadRequest)
	}
}

func (a app) oauthStartHandler(w http.ResponseWriter, r *http.Request, provider oauthProvider) {
	state, err := randomToken()
	if err != nil {
		http.Error(w, "failed to initialize oauth state", http.StatusInternalServerError)
		return
	}

	if err := setOAuthStateCookie(w, provider.Name, state); err != nil {
		http.Error(w, "failed to store oauth state", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, buildOAuthAuthorizeURL(provider, a.oauthRedirectURL(provider.Name), state), http.StatusFound)
}

func (a app) oauthCallbackHandler(w http.ResponseWriter, r *http.Request, provider oauthProvider) {
	defer clearOAuthStateCookie(w)

	if !validateOAuthStateCookie(r, provider.Name, r.URL.Query().Get("state")) {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}

	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		http.Error(w, "oauth code is required", http.StatusBadRequest)
		return
	}

	accessToken, err := exchangeOAuthCode(a.oauthHTTPClient(), provider, code, a.oauthRedirectURL(provider.Name))
	if err != nil {
		http.Error(w, "failed to exchange oauth code", http.StatusBadGateway)
		return
	}

	identity, err := fetchOAuthIdentity(a.oauthHTTPClient(), provider, accessToken)
	if err != nil {
		http.Error(w, "failed to load oauth identity", http.StatusBadGateway)
		return
	}

	user, err := a.resolveOAuthUser(r, identity)
	if err != nil {
		if errors.Is(err, errAccountBanned) {
			http.Error(w, "account is disabled", http.StatusForbidden)
			return
		}
		http.Error(w, "failed to resolve oauth user", http.StatusInternalServerError)
		return
	}

	if err := a.startSession(w, user); err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, a.webBaseURL+"/play", http.StatusFound)
}
