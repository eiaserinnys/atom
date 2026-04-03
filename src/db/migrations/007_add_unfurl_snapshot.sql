ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS source_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staleness_status') THEN
    CREATE TYPE staleness_status AS ENUM ('fresh', 'stale', 'unverified');
  END IF;
END $$;

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS staleness staleness_status NOT NULL DEFAULT 'unverified';
