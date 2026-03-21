CREATE TABLE IF NOT EXISTS users (
	id BIGSERIAL PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
	id BIGSERIAL PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx
	ON sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
	ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS runs (
	id BIGSERIAL PRIMARY KEY,
	user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
	run_date DATE NOT NULL,
	seed TEXT NOT NULL,
	move_count INTEGER NOT NULL,
	elapsed_time_ms INTEGER NOT NULL,
	accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runs_run_date_elapsed_idx
	ON runs (run_date, elapsed_time_ms, move_count, accepted_at);
