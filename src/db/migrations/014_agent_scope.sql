ALTER TABLE agents ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'write';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_scope_check'
      AND conrelid = 'agents'::regclass
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_scope_check CHECK (scope IN ('read', 'write'));
  END IF;
END $$;
