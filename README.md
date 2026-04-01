# atom

A Zettelkasten-inspired atomic knowledge card system. Cards live in a flexible tree (with symlinks and cycle-safe BFS compilation), exposed over both a REST API and an MCP stdio server so AI agents can read and write directly.

Live: **https://your-domain.example.com**

## Architecture

```
PostgreSQL (port 5434, Docker: atom-postgres)
    └── cards table      — content units
    └── tree_nodes table — hierarchical placement (supports symlinks)

Node.js server (pm2: atom-api, default port 3000)
    ├── REST API  (Fastify, 13 endpoints)   — used by the dashboard
    └── MCP server (stdio transport)         — used by AI agents

React dashboard (built to dashboard/dist/, served by nginx)
    — 3-panel layout: TreeView | CompileView | CardDetail
    — served at https://your-domain.example.com/
    — API calls go to https://your-domain.example.com/ (nginx proxies non-static paths to the API)
```

## Project structure

```
atom/
├── src/
│   ├── api/
│   │   ├── server.ts           — Fastify app + route registration
│   │   └── routes/
│   │       ├── cards.ts        — CRUD + backlinks (5 endpoints)
│   │       ├── tree.ts         — tree navigation + compile (7 endpoints)
│   │       └── search.ts       — BM25 full-text search (1 endpoint)
│   ├── mcp/
│   │   ├── server.ts           — MCP stdio entry point
│   │   └── tools/
│   │       ├── card_tools.ts   — 5 card tools
│   │       ├── tree_tools.ts   — 7 tree tools
│   │       └── search_tools.ts — 1 search tool
│   ├── services/
│   │   ├── card.service.ts     — shared card business logic
│   │   └── tree.service.ts     — shared tree + compile logic
│   ├── db/
│   │   ├── client.ts           — pg Pool singleton
│   │   ├── schema.sql          — canonical schema
│   │   └── queries/
│   │       ├── cards.ts
│   │       └── tree.ts
│   └── shared/
│       ├── bfs.ts              — compileNode() — pure BFS markdown compiler
│       └── types.ts            — Card, TreeNode, TreeNodeWithCard
├── tests/
│   ├── unit/                   — bfs.test.ts (6 tests)
│   └── integration/            — api.test.ts (19 tests, spins up real DB)
└── dashboard/                  — React + Vite frontend
    └── src/
        ├── api/client.ts       — typed fetch wrapper
        ├── styles/variables.css — soul-ui dark palette + semantic tokens
        └── components/
            ├── Layout/ThreePanelLayout.tsx   — react-resizable-panels v4
            ├── TreeView/{TreeView,TreeNode}.tsx
            ├── CompileView/CompileView.tsx
            ├── CardDetail/CardDetail.tsx
            └── SearchBar/SearchBar.tsx
```

## Database schema (summary)

```sql
-- cards: content unit
CREATE TABLE cards (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_type         text NOT NULL CHECK (card_type IN ('structure','knowledge')),
  title             text NOT NULL CHECK (char_length(title) <= 50),
  content           text,
  tags              text[]   NOT NULL DEFAULT '{}',
  references        text[]   NOT NULL DEFAULT '{}',
  card_timestamp    timestamptz NOT NULL DEFAULT now(),
  content_timestamp timestamptz,
  source_type       text,
  source_ref        text,
  staleness         text NOT NULL DEFAULT 'fresh',
  version           integer NOT NULL DEFAULT 1,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  fts_vector        tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))
  ) STORED
);

-- tree_nodes: placement in the hierarchy
CREATE TABLE tree_nodes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  parent_node_id uuid REFERENCES tree_nodes(id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  is_symlink     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

`updated_at` is auto-bumped by a trigger. FTS index on `fts_vector` for BM25 search.

## REST API (13 endpoints, no `/api` prefix)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cards/:id` | Get card |
| POST | `/cards` | Create card (+ root tree node) |
| PUT | `/cards/:id` | Update card |
| DELETE | `/cards/:id` | Delete card (cascades nodes) |
| GET | `/backlinks/:cardId` | Cards that reference this card |
| GET | `/tree` | Root-level nodes (flat, no children embedded) |
| GET | `/tree/:nodeId` | Single node with embedded card |
| GET | `/tree/:nodeId/children` | Direct children of a node |
| GET | `/tree/:nodeId/compile` | BFS markdown, `?depth=N` (default 2) → `{ markdown }` |
| POST | `/tree/symlink` | Create symlink node (`{ card_id, parent_node_id?, position? }`) |
| PUT | `/tree/:nodeId/move` | Move node (`{ parent_node_id?, position? }`) |
| DELETE | `/tree/:nodeId` | Delete node only (card preserved, cascades children) |
| GET | `/search?q=` | BM25 full-text search → `SearchResult[]` |

`SearchResult` shape: `{ card_id, node_id, title, card_type, is_symlink, snippet }`

## MCP tools (13, stdio transport)

Card tools: `create_card`, `get_card`, `update_card`, `delete_card`, `get_backlinks`

Tree tools: `get_tree`, `get_node`, `list_children`, `compile_subtree` (depth param), `create_symlink`, `move_node`, `delete_node`

Search tools: `search_cards`

## Key design decisions

**compileNode()** (`src/shared/bfs.ts`) is a pure function — no DB access. It takes three callbacks (`getNodeCard`, `getChildren`, `getCard`) so the caller pre-loads data. Cycle detection tracks visited `card_id`s (not node IDs) to handle symlink loops; cycles insert a `*(cycle)*` marker.

**Symlinks** share the same `card_id` as their canonical node. When compiling, `compileSubtree` follows the canonical node's children instead of the symlink's own children.

**`GET /tree` returns flat root nodes** (no children embedded). The dashboard TreeView must lazy-load children via `GET /tree/:nodeId/children` when expanding a node. ← **known gap, not yet implemented**

## Development

```bash
# Start DB
docker start atom-postgres   # or: docker run -d --name atom-postgres -p 5434:5432 -e POSTGRES_PASSWORD=... postgres:16

# Install & run API
npm install
npm run dev          # ts-node src/api/server.ts

# Run MCP (stdio)
npm run mcp          # ts-node src/mcp/server.ts

# Tests
npm test             # jest (unit + integration)

# Dashboard
cd dashboard
pnpm install
pnpm dev             # http://localhost:5173 (set VITE_API_BASE_URL=http://localhost:3000 in .env.local)
pnpm build           # output → dashboard/dist/
```

Environment variables (`.env` in repo root):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (default: `postgres://...@localhost:5434/atom`) |
| `PORT` | API server port (default: `3000`) |

## Deployment

- **Process manager**: pm2 (`atom-api`). Managed by haniel.
- **Nginx**: serves `dashboard/dist/` at `/`. Non-static paths (`/tree`, `/cards`, `/search`, `/backlinks`) are proxied to the API server.
- **Dashboard env**: `dashboard/.env.production` sets `VITE_API_BASE_URL=https://your-domain.example.com`. Build outputs to `dashboard/dist/` which nginx serves.
- **DB**: Docker container `atom-postgres` on port 5434. Data persisted in a named volume.

## Known issues / next work

- **TreeView lazy loading**: `GET /tree` returns flat root nodes. `TreeNode.tsx` checks `node.children` for expand/collapse — currently children are never loaded, so the tree only shows root nodes. Fix: on expand, call `GET /tree/:nodeId/children` and hydrate `node.children`.
- **Initial 2-level load**: On mount, `GET /tree` should ideally pre-load 2 levels deep so the tree isn't empty on first render.
