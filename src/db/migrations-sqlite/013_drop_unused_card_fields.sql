-- The inline status CHECK prevents dropping its column directly.
-- Rebuild cards while preserving rowids so the external-content FTS index stays
-- associated with the same rows. Foreign keys are disabled only for the table
-- swap by the migration runner, outside its transaction; tree_nodes keeps its
-- rows and cards target after the rename.

DROP TRIGGER IF EXISTS cards_fts_insert;
DROP TRIGGER IF EXISTS cards_fts_update;
DROP TRIGGER IF EXISTS cards_fts_delete;
DROP TRIGGER IF EXISTS cards_updated_at;
DROP TABLE IF EXISTS cards_new;

CREATE TABLE cards_new (
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
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  updated_by TEXT
);

INSERT INTO cards_new (rowid, id, card_type, title, content, "references", tags, card_timestamp,
                       content_timestamp, source_type, source_ref, source_snapshot, version,
                       updated_at, created_by, updated_by)
SELECT rowid, id, card_type, title, content, "references", tags, card_timestamp,
       content_timestamp, source_type, source_ref, source_snapshot, version,
       updated_at, created_by, updated_by
FROM cards;

DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;

CREATE TRIGGER cards_fts_insert AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, COALESCE(new.content, ''), COALESCE(new.tags, ''));
END;

CREATE TRIGGER cards_fts_update AFTER UPDATE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.content, ''), COALESCE(old.tags, ''));
  INSERT INTO cards_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, COALESCE(new.content, ''), COALESCE(new.tags, ''));
END;

CREATE TRIGGER cards_fts_delete AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.content, ''), COALESCE(old.tags, ''));
END;

CREATE TRIGGER cards_updated_at AFTER UPDATE ON cards
  FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE cards SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
END;

INSERT INTO cards_fts(cards_fts) VALUES ('rebuild');
