ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'suspicious',
	ADD COLUMN IF NOT EXISTS verification_notes_json JSONB NOT NULL DEFAULT '[]'::jsonb;
