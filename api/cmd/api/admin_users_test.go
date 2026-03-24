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

func TestAdminUsersHandlerRequiresAdminRole(t *testing.T) {
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
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(7, "mod_mason", roleModerator, false))

	request := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.adminUsersHandler(recorder, request)

	if recorder.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, recorder.Result().StatusCode)
	}
}

func TestAdminUsersHandlerReturnsEntriesForAdmin(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	token := "session-token"
	createdAt := time.Date(2026, 3, 23, 14, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(1, "admin_mason", roleAdmin, false))

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT username, role, COALESCE(is_banned, FALSE), banned_at, created_at
		FROM users
		ORDER BY created_at DESC
		LIMIT 100
	`)).
		WillReturnRows(sqlmock.NewRows([]string{"username", "role", "is_banned", "banned_at", "created_at"}).
			AddRow("admin_mason", roleAdmin, false, nil, createdAt))

	request := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.adminUsersHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload adminUsersResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode admin users response: %v", err)
	}
	if len(payload.Entries) != 1 || payload.Entries[0].Username != "admin_mason" {
		t.Fatalf("unexpected admin users payload %+v", payload.Entries)
	}
}

func TestListAdminUsers(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	application := app{db: db}
	createdAt := time.Date(2026, 3, 23, 14, 0, 0, 0, time.UTC)
	bannedAt := time.Date(2026, 3, 23, 15, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT username, role, COALESCE(is_banned, FALSE), banned_at, created_at
		FROM users
		ORDER BY created_at DESC
		LIMIT 100
	`)).
		WillReturnRows(sqlmock.NewRows([]string{"username", "role", "is_banned", "banned_at", "created_at"}).
			AddRow("admin_mason", roleAdmin, false, nil, createdAt).
			AddRow("user_one", roleUser, true, bannedAt, createdAt.Add(-time.Hour)))

	entries, err := application.listAdminUsers()
	if err != nil {
		t.Fatalf("list admin users: %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	if entries[1].BannedAt == nil {
		t.Fatal("expected bannedAt to be populated for banned user")
	}
}

func TestUpdateManagedUserRoleRejectsOwnAccount(t *testing.T) {
	t.Parallel()

	application := app{}
	_, err := application.updateManagedUserRole(currentUser{Username: "mason_admin"}, "mason_admin", roleModerator)
	if err == nil || !strings.Contains(err.Error(), "cannot modify your own account") {
		t.Fatalf("expected self role update to fail, got %v", err)
	}
}

func TestUpdateManagedUserBanStateDeletesSessions(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 3, 23, 16, 0, 0, 0, time.UTC)
	application := app{
		db:  db,
		now: func() time.Time { return now },
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`
		UPDATE users
		SET
			is_banned = $2,
			banned_at = $3
		WHERE username = $1
		RETURNING id, is_banned, banned_at
	`)).
		WithArgs("user_one", true, sql.NullTime{Time: now, Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_banned", "banned_at"}).AddRow(int64(12), true, now))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM sessions WHERE user_id = $1`)).
		WithArgs(int64(12)).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	isBanned, bannedAt, err := application.updateManagedUserBanState(currentUser{Username: "admin_mason"}, "user_one", true)
	if err != nil {
		t.Fatalf("update managed user ban state: %v", err)
	}

	if !isBanned || !bannedAt.Equal(now) {
		t.Fatalf("unexpected ban result: isBanned=%t bannedAt=%s", isBanned, bannedAt)
	}
}

func TestAdminUserDetailHandlerUpdatesRole(t *testing.T) {
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
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(1, "admin_mason", roleAdmin, false))

	mock.ExpectQuery(regexp.QuoteMeta(`
		UPDATE users
		SET role = $2
		WHERE username = $1
		RETURNING role
	`)).
		WithArgs("user_one", roleModerator).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(roleModerator))

	request := httptest.NewRequest(http.MethodPost, "/api/admin/users/user_one/role", strings.NewReader(`{"role":"moderator"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.adminUserDetailHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload updateAdminUserRoleResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode role update response: %v", err)
	}
	if payload.Role != roleModerator || payload.Username != "user_one" {
		t.Fatalf("unexpected role update payload %+v", payload)
	}
}

func TestAdminUserDetailHandlerUpdatesBanState(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 3, 23, 16, 0, 0, 0, time.UTC)
	application := app{
		db:  db,
		now: func() time.Time { return now },
	}
	token := "session-token"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT users.id, users.username, users.role, COALESCE(users.is_banned, FALSE)
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
	`)).
		WithArgs(hashToken(token)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "role", "is_banned"}).AddRow(1, "admin_mason", roleAdmin, false))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`
		UPDATE users
		SET
			is_banned = $2,
			banned_at = $3
		WHERE username = $1
		RETURNING id, is_banned, banned_at
	`)).
		WithArgs("user_one", true, sql.NullTime{Time: now, Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_banned", "banned_at"}).AddRow(int64(12), true, now))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM sessions WHERE user_id = $1`)).
		WithArgs(int64(12)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	request := httptest.NewRequest(http.MethodPost, "/api/admin/users/user_one/ban", strings.NewReader(`{"banned":true}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	recorder := httptest.NewRecorder()

	application.adminUserDetailHandler(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var payload updateAdminUserBanResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode ban update response: %v", err)
	}
	if !payload.IsBanned || payload.BannedAt == nil {
		t.Fatalf("unexpected ban payload %+v", payload)
	}
}
