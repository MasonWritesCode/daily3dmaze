package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

var errCannotModifyOwnAccount = errors.New("you cannot modify your own account")

type adminUserEntry struct {
	Username  string  `json:"username"`
	Role      string  `json:"role"`
	IsBanned  bool    `json:"isBanned"`
	BannedAt  *string `json:"bannedAt"`
	CreatedAt string  `json:"createdAt"`
}

type adminUsersResponse struct {
	Entries []adminUserEntry `json:"entries"`
}

type updateAdminUserRoleRequest struct {
	Role string `json:"role"`
}

type updateAdminUserRoleResponse struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

type updateAdminUserBanRequest struct {
	Banned bool `json:"banned"`
}

type updateAdminUserBanResponse struct {
	Username string  `json:"username"`
	IsBanned bool    `json:"isBanned"`
	BannedAt *string `json:"bannedAt"`
}

func (a app) adminUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	user, err := a.currentUserFromRequest(r)
	if err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	if !roleAllows(user.Role, roleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	entries, err := a.listAdminUsers()
	if err != nil {
		http.Error(w, "failed to load users", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, adminUsersResponse{Entries: entries})
}

func (a app) adminUserDetailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	adminUser, err := a.currentUserFromRequest(r)
	if err != nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	if !roleAllows(adminUser.Role, roleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	pathSuffix := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	switch {
	case strings.HasSuffix(pathSuffix, "/role"):
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		username, err := parseManagedUsername(strings.TrimSuffix(pathSuffix, "/role"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var request updateAdminUserRoleRequest
		if err := decodeJSONBody(w, r, &request); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := validateManagedRole(request.Role); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		role, err := a.updateManagedUserRole(adminUser, username, request.Role)
		if err != nil {
			switch {
			case errors.Is(err, errCannotModifyOwnAccount):
				http.Error(w, err.Error(), http.StatusForbidden)
			case errors.Is(err, sql.ErrNoRows):
				http.Error(w, "user not found", http.StatusNotFound)
			default:
				http.Error(w, "failed to update user role", http.StatusInternalServerError)
			}
			return
		}

		writeJSON(w, http.StatusOK, updateAdminUserRoleResponse{
			Username: username,
			Role:     role,
		})
		return

	case strings.HasSuffix(pathSuffix, "/ban"):
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		username, err := parseManagedUsername(strings.TrimSuffix(pathSuffix, "/ban"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var request updateAdminUserBanRequest
		if err := decodeJSONBody(w, r, &request); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		isBanned, bannedAt, err := a.updateManagedUserBanState(adminUser, username, request.Banned)
		if err != nil {
			switch {
			case errors.Is(err, errCannotModifyOwnAccount):
				http.Error(w, err.Error(), http.StatusForbidden)
			case errors.Is(err, sql.ErrNoRows):
				http.Error(w, "user not found", http.StatusNotFound)
			default:
				http.Error(w, "failed to update ban state", http.StatusInternalServerError)
			}
			return
		}

		var bannedAtValue *string
		if !bannedAt.IsZero() {
			value := bannedAt.UTC().Format(time.RFC3339)
			bannedAtValue = &value
		}

		writeJSON(w, http.StatusOK, updateAdminUserBanResponse{
			Username: username,
			IsBanned: isBanned,
			BannedAt: bannedAtValue,
		})
		return
	default:
		http.Error(w, "admin user action is not supported", http.StatusBadRequest)
	}
}

func parseManagedUsername(raw string) (string, error) {
	username := strings.ToLower(strings.TrimSpace(raw))
	if username == "" || strings.Contains(username, "/") {
		return "", errors.New("username is required")
	}

	for _, char := range username {
		if !strings.ContainsRune(usernameAllowedChars, char) {
			return "", errors.New("username contains invalid characters")
		}
	}

	if len(username) < minUsernameLength || len(username) > maxUsernameLength {
		return "", errors.New("username must be between 3 and 32 characters")
	}

	return username, nil
}

func validateManagedRole(role string) error {
	switch role {
	case roleUser, roleModerator, roleAdmin:
		return nil
	default:
		return errors.New("role must be user, moderator, or admin")
	}
}

func (a app) listAdminUsers() ([]adminUserEntry, error) {
	const query = `
		SELECT username, role, COALESCE(is_banned, FALSE), banned_at, created_at
		FROM users
		ORDER BY created_at DESC
		LIMIT 100
	`

	rows, err := a.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]adminUserEntry, 0, 100)
	for rows.Next() {
		var entry adminUserEntry
		var bannedAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(&entry.Username, &entry.Role, &entry.IsBanned, &bannedAt, &createdAt); err != nil {
			return nil, err
		}
		if bannedAt.Valid {
			value := bannedAt.Time.UTC().Format(time.RFC3339)
			entry.BannedAt = &value
		}
		entry.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		entries = append(entries, entry)
	}

	return entries, rows.Err()
}

func (a app) updateManagedUserRole(actor currentUser, username, role string) (string, error) {
	if strings.EqualFold(actor.Username, username) {
		return "", errCannotModifyOwnAccount
	}

	const query = `
		UPDATE users
		SET role = $2
		WHERE username = $1
		RETURNING role
	`

	var updatedRole string
	if err := a.db.QueryRow(query, username, role).Scan(&updatedRole); err != nil {
		return "", err
	}

	return updatedRole, nil
}

func (a app) updateManagedUserBanState(actor currentUser, username string, banned bool) (bool, time.Time, error) {
	if strings.EqualFold(actor.Username, username) {
		return false, time.Time{}, errCannotModifyOwnAccount
	}

	tx, err := a.db.Begin()
	if err != nil {
		return false, time.Time{}, err
	}
	defer tx.Rollback()

	var bannedAt sql.NullTime
	if banned {
		bannedAt = sql.NullTime{Time: a.currentTime(), Valid: true}
	}

	const query = `
		UPDATE users
		SET
			is_banned = $2,
			banned_at = $3
		WHERE username = $1
		RETURNING id, is_banned, banned_at
	`

	var userID int64
	var updatedBanned bool
	var updatedBannedAt sql.NullTime
	if err := tx.QueryRow(query, username, banned, bannedAt).Scan(&userID, &updatedBanned, &updatedBannedAt); err != nil {
		return false, time.Time{}, err
	}

	if updatedBanned {
		if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
			return false, time.Time{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, time.Time{}, err
	}

	if updatedBannedAt.Valid {
		return updatedBanned, updatedBannedAt.Time.UTC(), nil
	}

	return updatedBanned, time.Time{}, nil
}
