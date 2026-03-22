ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS suspicion_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb;
