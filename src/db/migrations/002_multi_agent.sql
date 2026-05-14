-- 1) users 테이블
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(100),
  role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) agents 테이블
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(100) NOT NULL UNIQUE,
  secret_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) cards 감사 컬럼 추가 (NULL 허용)
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
-- 참고: agent_id 문자열 저장, 에이전트 삭제 후에도 audit trail 보존을 위해 FK 미적용

-- 4) position 중복 데이터 정리 (유니크 인덱스 생성 전)
-- 같은 parent_node_id 내에서 position이 중복된 행의 position을 +1씩 밀어냄.
--
-- Cycle A1 (migration 010) note: 010 converted position to TEXT and dropped
-- the legacy UNIQUE indexes. PostgreSQL re-executes every .sql in order on
-- each server start (no schema_migrations tracking), so 002 must guard
-- against running after 010. The `data_type = 'integer'` check skips both
-- the integer-arithmetic UPDATE below and the UNIQUE index recreation when
-- 010 has already migrated the column.
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Skip entirely if migration 010 already converted position to TEXT.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tree_nodes'
      AND column_name = 'position'
      AND data_type = 'integer'
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    WITH dups AS (
      SELECT id, parent_node_id, position,
             ROW_NUMBER() OVER (PARTITION BY parent_node_id, position ORDER BY created_at) AS rn
      FROM tree_nodes
    )
    SELECT id, position FROM dups WHERE rn > 1
  LOOP
    UPDATE tree_nodes SET position = r.position + 1 WHERE id = r.id;
  END LOOP;
END $$;

-- 5) position UNIQUE 부분 인덱스 (NULL 처리)
-- PostgreSQL에서 UNIQUE 제약은 NULL을 distinct로 처리하므로 부분 인덱스 2개 사용.
-- Cycle A1: migration 010 drops these and replaces them with a non-unique
-- BTREE on (parent_node_id, position, id) for tie-break. Guard with the
-- same integer-column check so 010-then-002 re-execution doesn't try to
-- recreate the UNIQUE constraints that 010 just removed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tree_nodes'
      AND column_name = 'position'
      AND data_type = 'integer'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_tree_nodes_root_pos
      ON tree_nodes(position)
      WHERE parent_node_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uidx_tree_nodes_child_pos
      ON tree_nodes(parent_node_id, position)
      WHERE parent_node_id IS NOT NULL;
  END IF;
END $$;
