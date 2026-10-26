CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  openai_api_key TEXT,
  openai_key_saved_at TEXT
);

CREATE TABLE IF NOT EXISTS card_embeddings (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions = 3072),
  content_hash TEXT NOT NULL,
  card_version INTEGER NOT NULL,
  token_count INTEGER NOT NULL CHECK (token_count BETWEEN 1 AND 8191),
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  embedding BLOB NOT NULL,
  embedded_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(embedding) = dimensions * 4)
);
