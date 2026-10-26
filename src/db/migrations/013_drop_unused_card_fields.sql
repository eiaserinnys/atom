ALTER TABLE cards
  DROP COLUMN IF EXISTS staleness,
  DROP COLUMN IF EXISTS source_checksum,
  DROP COLUMN IF EXISTS source_checked_at;

DROP TYPE IF EXISTS staleness_status;
