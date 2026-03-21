ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS runs_run_date_elapsed_idx
	ON runs (run_date, elapsed_time_ms, move_count, accepted_at);
