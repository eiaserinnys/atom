CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  openai_api_key TEXT,
  openai_key_saved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS card_embeddings (
  card_id UUID PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions = 3072),
  content_hash TEXT NOT NULL,
  card_version INTEGER NOT NULL,
  token_count INTEGER NOT NULL CHECK (token_count BETWEEN 1 AND 8191),
  truncated BOOLEAN NOT NULL,
  embedding BYTEA NOT NULL,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(embedding) = dimensions * 4)
);
