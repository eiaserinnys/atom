-- Atom DB schema: cards + tree_nodes + FTS

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_type VARCHAR(20) NOT NULL CHECK (card_type IN ('structure', 'knowledge')),
  title VARCHAR(50) NOT NULL,
  content TEXT,
  "references" UUID[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  card_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_timestamp TIMESTAMPTZ,
  source_type TEXT,
  source_ref TEXT,
  source_snapshot TEXT,
  source_checksum TEXT,
  source_checked_at TIMESTAMPTZ,
  staleness VARCHAR(20) DEFAULT 'unverified',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fts_vector TSVECTOR
);

-- updated_at auto-update trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cards_updated_at'
  ) THEN
    CREATE TRIGGER cards_updated_at
    BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- FTS trigger: keep fts_vector in sync on INSERT/UPDATE
CREATE OR REPLACE FUNCTION update_fts_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fts_vector := to_tsvector(
    'simple',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.content, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cards_fts_update'
  ) THEN
    CREATE TRIGGER cards_fts_update
    BEFORE INSERT OR UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION update_fts_vector();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tree_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  parent_node_id UUID REFERENCES tree_nodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  is_symlink BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tree_nodes_card_id ON tree_nodes(card_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent ON tree_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_cards_fts ON cards USING GIN(fts_vector);
