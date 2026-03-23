ALTER TABLE runs
	ADD COLUMN IF NOT EXISTS public_id TEXT;

UPDATE runs
SET public_id = 'run_' || md5(id::text || clock_timestamp()::text || random()::text)
WHERE public_id IS NULL OR public_id = '';

ALTER TABLE runs
	ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS runs_public_id_idx
	ON runs (public_id);
