-- 017_fts_update_trigger_columns.sql
-- cards_updated_at runs before cards_fts_update and its nested UPDATE fired
-- cards_fts_update again with the already-new content as old.content, so
-- adding content to a card that had none failed with SQLITE_CORRUPT_VTAB.
-- Index updates only react to the columns the index covers.

DROP TRIGGER IF EXISTS cards_fts_update;

CREATE TRIGGER cards_fts_update AFTER UPDATE OF title, content, tags ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.content, ''), COALESCE(old.tags, ''));
  INSERT INTO cards_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, COALESCE(new.content, ''), COALESCE(new.tags, ''));
END;

INSERT INTO cards_fts(cards_fts) VALUES ('rebuild');
