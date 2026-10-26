ALTER TABLE agents
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'write'
  CHECK (scope IN ('read', 'write'));
