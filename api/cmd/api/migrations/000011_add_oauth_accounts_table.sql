CREATE TABLE IF NOT EXISTS oauth_accounts (
	id BIGSERIAL PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider TEXT NOT NULL,
	provider_user_id TEXT NOT NULL,
	provider_username TEXT NOT NULL DEFAULT '',
	provider_email TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE(provider, provider_user_id),
	UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user_id_idx
	ON oauth_accounts (user_id);
