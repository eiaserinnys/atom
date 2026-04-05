CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL CHECK (card_type IN ('structure', 'knowledge')),
  title TEXT NOT NULL,
  content TEXT,
  "references" TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  card_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  content_timestamp TEXT,
  source_type TEXT,
  source_ref TEXT,
  source_snapshot TEXT,
  source_checksum TEXT,
  source_checked_at TEXT,
  staleness TEXT DEFAULT 'unverified' CHECK (staleness IN ('unverified', 'fresh', 'stale', 'outdated')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS tree_nodes (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  parent_node_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  is_symlink INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tree_nodes_card_id ON tree_nodes(card_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent ON tree_nodes(parent_node_id);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tree_nodes_root_pos
  ON tree_nodes(position) WHERE parent_node_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_tree_nodes_child_pos
  ON tree_nodes(parent_node_id, position) WHERE parent_node_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  title, content, tags,
  content='cards', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS cards_fts_insert AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, COALESCE(new.content, ''), COALESCE(new.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS cards_fts_update AFTER UPDATE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.content, ''), COALESCE(old.tags, ''));
  INSERT INTO cards_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, COALESCE(new.content, ''), COALESCE(new.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS cards_fts_delete AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.content, ''), COALESCE(old.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS cards_updated_at AFTER UPDATE ON cards
  FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE cards SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
END;
