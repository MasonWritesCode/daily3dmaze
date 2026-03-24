CREATE TABLE IF NOT EXISTS email_verification_tokens (
	id BIGSERIAL PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL,
	used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx
	ON email_verification_tokens (user_id);

CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_at_idx
	ON email_verification_tokens (expires_at);
