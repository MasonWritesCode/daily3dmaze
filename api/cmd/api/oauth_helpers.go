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

func parseOAuthPath(pathSuffix string) (string, string, error) {
	parts := strings.Split(strings.Trim(pathSuffix, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", errors.New("oauth path must include provider and action")
	}

	return parts[0], parts[1], nil
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
	form.Set("grant_type", "authorization_code")

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
		emailVerified := false
		if payload.Email != nil {
			email = strings.TrimSpace(*payload.Email)
		}
		if provider.EmailURL != "" {
			if verifiedEmail, ok := fetchVerifiedGitHubEmail(client, provider, accessToken); ok {
				email = verifiedEmail
				emailVerified = true
			}
		}

		return oauthIdentity{
			Provider:       provider.Name,
			ProviderUserID: strconv.FormatInt(payload.ID, 10),
			Username:       payload.Login,
			Email:          email,
			EmailVerified:  emailVerified,
		}, nil
	case "google":
		var payload googleUserResponse
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			return oauthIdentity{}, err
		}
		if strings.TrimSpace(payload.Sub) == "" {
			return oauthIdentity{}, errors.New("google oauth response is missing required identity fields")
		}

		email := strings.TrimSpace(payload.Email)
		username := strings.TrimSpace(payload.Name)
		if email != "" {
			if localPart, _, ok := strings.Cut(email, "@"); ok && strings.TrimSpace(localPart) != "" {
				username = strings.TrimSpace(localPart)
			}
		}
		if username == "" {
			username = strings.TrimSpace(payload.GivenName)
		}
		if username == "" {
			username = "google_user"
		}

		return oauthIdentity{
			Provider:       provider.Name,
			ProviderUserID: payload.Sub,
			Username:       username,
			Email:          email,
			EmailVerified:  payload.EmailVerified,
		}, nil
	default:
		return oauthIdentity{}, errors.New("oauth provider is not supported")
	}
}

func fetchVerifiedGitHubEmail(client *http.Client, provider oauthProvider, accessToken string) (string, bool) {
	request, err := http.NewRequest(http.MethodGet, provider.EmailURL, nil)
	if err != nil {
		return "", false
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return "", false
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", false
	}

	var payload []githubEmailResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", false
	}

	for _, candidate := range payload {
		email := strings.TrimSpace(candidate.Email)
		if candidate.Primary && candidate.Verified && email != "" {
			return email, true
		}
	}

	for _, candidate := range payload {
		email := strings.TrimSpace(candidate.Email)
		if candidate.Verified && email != "" {
			return email, true
		}
	}

	return "", false
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

	user, err := a.createUser(username, identity.Email, passwordHash, identity.EmailVerified)
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
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM oauth_accounts
		JOIN users ON users.id = oauth_accounts.user_id
		WHERE oauth_accounts.provider = $1 AND oauth_accounts.provider_user_id = $2
	`

	var user currentUser
	if err := a.db.QueryRow(query, providerName, providerUserID).Scan(&user.ID, &user.Username, &user.Role, &user.IsBanned); err != nil {
		return currentUser{}, err
	}
	if user.IsBanned {
		return currentUser{}, errAccountBanned
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
		if identity.EmailVerified {
			if err := a.syncVerifiedOAuthEmail(user.ID, identity.Email); err != nil {
				return err
			}
		}
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

	if identity.EmailVerified {
		if err := a.syncVerifiedOAuthEmail(user.ID, identity.Email); err != nil {
			return err
		}
	}

	return nil
}

func (a app) syncVerifiedOAuthEmail(userID int64, email string) error {
	normalizedEmail := strings.TrimSpace(strings.ToLower(email))
	if normalizedEmail == "" {
		return nil
	}

	const query = `
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
	`

	_, err := a.db.Exec(query, userID, normalizedEmail)
	return err
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
