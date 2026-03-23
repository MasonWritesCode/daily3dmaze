package main

import (
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRunMigrationsAppliesRunsUserIDUpgrade(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectExec(regexp.QuoteMeta(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000001_initial_schema.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000002_add_user_id_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS runs_run_date_elapsed_idx
	ON runs (run_date, elapsed_time_ms, move_count, accepted_at);`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000002_add_user_id_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000003_add_replay_trace_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS replay_trace_json JSONB;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000003_add_replay_trace_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000004_add_suspicion_score_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS suspicion_score INTEGER NOT NULL DEFAULT 0;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000004_add_suspicion_score_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000005_add_suspicion_reasons_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS suspicion_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000005_add_suspicion_reasons_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000006_add_verification_fields_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'suspicious',
	ADD COLUMN IF NOT EXISTS verification_notes_json JSONB NOT NULL DEFAULT '[]'::jsonb;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000006_add_verification_fields_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000007_add_verification_observability_fields.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS verification_started_at TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS verification_error TEXT;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000007_add_verification_observability_fields.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000008_add_review_fields_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed',
	ADD COLUMN IF NOT EXISTS review_notes TEXT NOT NULL DEFAULT '',
	ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000008_add_review_fields_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000009_add_reviewer_identity_to_runs.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000009_add_reviewer_identity_to_runs.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`)).
		WithArgs("000010_add_role_to_users.sql").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`ALTER TABLE users
	ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO schema_migrations (version) VALUES ($1)`)).
		WithArgs("000010_add_role_to_users.sql").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if err := runMigrations(db); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
