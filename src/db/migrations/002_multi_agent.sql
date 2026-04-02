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

-- 4) position UNIQUE 부분 인덱스 (NULL 처리)
-- PostgreSQL에서 UNIQUE 제약은 NULL을 distinct로 처리하므로 부분 인덱스 2개 사용
CREATE UNIQUE INDEX IF NOT EXISTS uidx_tree_nodes_root_pos
  ON tree_nodes(position)
  WHERE parent_node_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tree_nodes_child_pos
  ON tree_nodes(parent_node_id, position)
  WHERE parent_node_id IS NOT NULL;
