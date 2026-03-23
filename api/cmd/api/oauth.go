package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
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
	Scopes       []string
}

type oauthIdentity struct {
	Provider       string
	ProviderUserID string
	Username       string
	Email          string
}

type oauthTokenResponse struct {
	AccessToken string `json:"access_token"`
}

type githubUserResponse struct {
	ID    int64   `json:"id"`
	Login string  `json:"login"`
	Email *string `json:"email"`
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
			Scopes:       []string{"read:user", "user:email"},
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

func parseOAuthPath(pathSuffix string) (string, string, error) {
	parts := strings.Split(strings.Trim(pathSuffix, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", errors.New("oauth path must include provider and action")
	}

	return parts[0], parts[1], nil
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
		http.Error(w, "failed to resolve oauth user", http.StatusInternalServerError)
		return
	}

	if err := a.startSession(w, user); err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, a.webBaseURL+"/play", http.StatusFound)
}

func buildOAuthAuthorizeURL(provider oauthProvider, redirectURL, state string) string {
	values := url.Values{}
	values.Set("client_id", provider.ClientID)
	values.Set("redirect_uri", redirectURL)
	values.Set("response_type", "code")
	values.Set("scope", strings.Join(provider.Scopes, " "))
	values.Set("state", state)
	return provider.AuthorizeURL + "?" + values.Encode()
}

func (a app) oauthRedirectURL(providerName string) string {
	return fmt.Sprintf("%s/api/auth/oauth/%s/callback", strings.TrimRight(a.apiBaseURL, "/"), providerName)
}

func (a app) oauthHTTPClient() *http.Client {
	if a.oauthClient != nil {
		return a.oauthClient
	}

	return http.DefaultClient
}

func setOAuthStateCookie(w http.ResponseWriter, providerName, state string) error {
	payload, err := json.Marshal(oauthStateCookieValue{
		Provider: providerName,
		State:    state,
	})
	if err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    base64.RawURLEncoding.EncodeToString(payload),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("APP_ENV") == "production",
		Expires:  time.Now().UTC().Add(oauthStateLifetime),
		MaxAge:   int(oauthStateLifetime.Seconds()),
	})

	return nil
}

func validateOAuthStateCookie(r *http.Request, providerName, state string) bool {
	if strings.TrimSpace(state) == "" {
		return false
	}

	cookie, err := r.Cookie(oauthStateCookieName)
	if err != nil {
		return false
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil {
		return false
	}

	var payload oauthStateCookieValue
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return false
	}

	return payload.Provider == providerName && payload.State == state
}

func clearOAuthStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("APP_ENV") == "production",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func exchangeOAuthCode(client *http.Client, provider oauthProvider, code, redirectURL string) (string, error) {
	form := url.Values{}
	form.Set("client_id", provider.ClientID)
	form.Set("client_secret", provider.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURL)

	request, err := http.NewRequest(http.MethodPost, provider.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oauth token exchange failed with status %d", response.StatusCode)
	}

	var payload oauthTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.AccessToken) == "" {
		return "", errors.New("oauth access token is empty")
	}

	return payload.AccessToken, nil
}

func fetchOAuthIdentity(client *http.Client, provider oauthProvider, accessToken string) (oauthIdentity, error) {
	request, err := http.NewRequest(http.MethodGet, provider.UserURL, nil)
	if err != nil {
		return oauthIdentity{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return oauthIdentity{}, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return oauthIdentity{}, fmt.Errorf("oauth user request failed with status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	switch provider.Name {
	case "github":
		var payload githubUserResponse
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			return oauthIdentity{}, err
		}
		if payload.ID == 0 || strings.TrimSpace(payload.Login) == "" {
			return oauthIdentity{}, errors.New("github oauth response is missing required identity fields")
		}

		email := ""
		if payload.Email != nil {
			email = strings.TrimSpace(*payload.Email)
		}

		return oauthIdentity{
			Provider:       provider.Name,
			ProviderUserID: strconv.FormatInt(payload.ID, 10),
			Username:       payload.Login,
			Email:          email,
		}, nil
	default:
		return oauthIdentity{}, errors.New("oauth provider is not supported")
	}
}

func (a app) resolveOAuthUser(r *http.Request, identity oauthIdentity) (currentUser, error) {
	if linkedUser, err := a.findUserByOAuthAccount(identity.Provider, identity.ProviderUserID); err == nil {
		return linkedUser, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return currentUser{}, err
	}

	if sessionUser, err := a.currentUserFromRequest(r); err == nil {
		if err := a.linkOAuthAccount(sessionUser, identity); err != nil {
			return currentUser{}, err
		}
		return sessionUser, nil
	}

	username, err := a.allocateOAuthUsername(identity.Username, identity.Provider)
	if err != nil {
		return currentUser{}, err
	}

	passwordHash, err := generateUnusablePasswordHash()
	if err != nil {
		return currentUser{}, err
	}

	user, err := a.createUser(username, passwordHash)
	if err != nil {
		return currentUser{}, err
	}

	if err := a.linkOAuthAccount(user, identity); err != nil {
		return currentUser{}, err
	}

	return user, nil
}

func (a app) findUserByOAuthAccount(providerName, providerUserID string) (currentUser, error) {
	const query = `
		SELECT users.id, users.username, users.role
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`

	var user currentUser
	if err := a.db.QueryRow(query, providerName, providerUserID).Scan(&user.ID, &user.Username, &user.Role); err != nil {
		return currentUser{}, err
	}

	return user, nil
}

func (a app) linkOAuthAccount(user currentUser, identity oauthIdentity) error {
	const query = `
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, provider_user_id)
		DO NOTHING
	`

	result, err := a.db.Exec(
		query,
		user.ID,
		identity.Provider,
		identity.ProviderUserID,
		identity.Username,
		nullString(identity.Email),
	)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected > 0 {
		return nil
	}

	const ownerQuery = `
		SELECT user_id
		FROM oauth_accounts
		WHERE provider = $1 AND provider_user_id = $2
	`

	var ownerUserID int64
	if err := a.db.QueryRow(ownerQuery, identity.Provider, identity.ProviderUserID).Scan(&ownerUserID); err != nil {
		return err
	}
	if ownerUserID != user.ID {
		return errors.New("oauth account is already linked to another user")
	}

	return nil
}

func (a app) allocateOAuthUsername(candidate, providerName string) (string, error) {
	base := normalizeOAuthUsername(candidate, providerName)
	if base == "" {
		base = providerName + "_user"
	}

	for suffix := 0; suffix < 100; suffix++ {
		username := base
		if suffix > 0 {
			suffixText := strconv.Itoa(suffix + 1)
			maxBaseLength := maxUsernameLength - len(suffixText)
			if maxBaseLength < 1 {
				maxBaseLength = 1
			}
			if len(username) > maxBaseLength {
				username = username[:maxBaseLength]
			}
			username += suffixText
		}

		exists, err := a.usernameExists(username)
		if err != nil {
			return "", err
		}
		if !exists {
			return username, nil
		}
	}

	return "", errors.New("failed to allocate oauth username")
}

func (a app) usernameExists(username string) (bool, error) {
	var exists bool
	if err := a.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`, username).Scan(&exists); err != nil {
		return false, err
	}

	return exists, nil
}

func normalizeOAuthUsername(candidate, providerName string) string {
	lower := strings.ToLower(strings.TrimSpace(candidate))
	if lower == "" {
		return providerName + "_user"
	}

	var builder strings.Builder
	lastUnderscore := false
	for _, character := range lower {
		if strings.ContainsRune(usernameAllowedChars, character) {
			builder.WriteRune(character)
			lastUnderscore = false
			continue
		}

		if !lastUnderscore {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}

	normalized := strings.Trim(builder.String(), "_-")
	if normalized == "" {
		normalized = providerName + "_user"
	}
	if len(normalized) > maxUsernameLength {
		normalized = normalized[:maxUsernameLength]
	}

	return normalized
}

func generateUnusablePasswordHash() (string, error) {
	password, err := randomToken()
	if err != nil {
		return "", err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	return string(passwordHash), nil
}

func nullString(value string) sql.NullString {
	trimmedValue := strings.TrimSpace(value)
	return sql.NullString{String: trimmedValue, Valid: trimmedValue != ""}
}
