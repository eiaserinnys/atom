-- Search filter indexes: enable efficient filtering by tags, references, card_type,
-- updated_at, and source_type in search_cards and get_backlinks queries.

CREATE INDEX IF NOT EXISTS idx_cards_tags ON cards USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_cards_refs ON cards USING GIN("references");
CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at);
CREATE INDEX IF NOT EXISTS idx_cards_source_type ON cards(source_type);
