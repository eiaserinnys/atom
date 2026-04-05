# atom
**A knowledge base of the agents, by the agents, for the agents.** 

Atomic knowledge cards in a tree with symlinks — think Zettelkasten, but for agents.<br/>
Exposed over MCP so AI agents can read, write, and reorganize knowledge directly.

## Why atom

Most knowledge tools are built for humans first, then bolted on with an API.
atom is the opposite — **MCP is the primary interface**. The dashboard exists for oversight, but agents are the first-class citizens.

An agent can:
- **Create** a knowledge card and place it in a tree hierarchy — in one call
- **Compile** any subtree into depth-controlled markdown — feed a 200-node knowledge tree into a single prompt
- **Symlink** a card into multiple locations without duplication
- **Batch** dozens of creates, updates, moves, deletes, and symlinks in a single atomic transaction
- **Search** by BM25 full-text across titles, content, and tags — scoped to any subtree
- **Unfurl** external references inline during compilation — Trello cards, and more
- **Track provenance** — every card records its source, snapshot, checksum, and staleness

Humans get a React dashboard with a 3-panel layout (tree / compiled view / card detail) and real-time SSE updates. But the system is designed so an agent can operate it end-to-end without human intervention.

<p align="center">
  <img src="atom.jpg" alt="atom" width="100%" />
</p>

## Architecture

```
PostgreSQL 16
    ├── cards           — atomic knowledge units
    ├── tree_nodes      — hierarchical placement (symlinks, BFS-safe)
    ├── unfurl_snapshots — cached external resource snapshots
    └── agents          — API key credentials for agent access

Fastify server
    ├── REST API        — 17 endpoints, used by the dashboard
    ├── MCP HTTP        — POST /mcp, Streamable HTTP, stateless
    ├── MCP stdio       — local agent transport
    ├── Batch API       — POST /batch, atomic multi-op transactions
    ├── Unfurl service  — external URL/card expansion pipeline
    └── SSE             — GET /events, real-time change stream

React dashboard
    — tree / compile / card detail panels
    — live updates via SSE (useAtomEvents hook)
    — Google + Slack OAuth authentication
    — unfurl toggle with credentials management
```

## Data model

Two tables. Content and placement are separated by design.

**Card** — the atomic unit of knowledge:

```sql
cards (
  id, card_type ('structure' | 'knowledge'),
  title (≤50 chars), content,
  tags[], references[],
  card_timestamp, content_timestamp,
  source_type, source_ref, source_snapshot, source_checksum, source_checked_at,
  staleness ('unverified' | 'fresh' | 'stale' | 'outdated'),
  version, fts_vector (auto-generated tsvector for BM25)
)
```

**TreeNode** — where a card lives in the hierarchy:

```sql
tree_nodes (
  id, card_id → cards,
  parent_node_id → tree_nodes (self-ref, CASCADE),
  position, is_symlink,
  created_at
)
```

One card can appear in multiple tree locations via symlinks.
Deleting a card cascades all its nodes. Deleting a node preserves the card.

## MCP tools (14)

| Tool | Description |
|------|-------------|
| `create_card` | Create card + tree node in one call |
| `get_card` | Retrieve card by UUID |
| `update_card` | Partial update (content changes bump `content_timestamp`) |
| `delete_card` | Delete card and all its tree nodes |
| `get_backlinks` | Find cards that reference this card |
| `get_tree` | List root-level nodes |
| `get_node` | Single node with embedded card data |
| `list_children` | Direct children of a node |
| `compile_subtree` | BFS markdown compilation with depth/filter options |
| `create_symlink` | Place a card at another tree location |
| `move_node` | Relocate a node to a new parent/position |
| `delete_node` | Remove node only (card preserved, children cascade) |
| `search_cards` | BM25 full-text search with snippets; scope by `rootNodeId` |
| `batch_op` | Atomic multi-operation transaction (creates/updates/moves/deletes/symlinks) |

### batch_op

The most powerful tool. Executes creates, updates, moves, deletes, and symlink operations in a single PostgreSQL transaction.

- **temp_id references** — new cards can reference each other within the same batch via `temp_id` / `parent_temp_id`
- **Topological sort** — parent nodes are created before children, with cycle detection
- **Symlinks operation** — create multiple symlinks in one atomic batch
- **Atomic** — everything succeeds or everything rolls back

### compile_subtree

Renders a subtree as markdown via BFS traversal. Options:

| Option | Description |
|--------|-------------|
| `depth` | Max traversal depth (default: 2) |
| `titles_only` | Extract headings only, skip card bodies |
| `max_chars` | Truncate output at N characters |
| `exclude_nodes` | Skip specific node IDs |
| `numbering` | Auto-assign hierarchical numbers (1.2.3) |

Symlink nodes are marked with `~`. Cycles are detected by `card_id` and marked with `*(cycle)*`.

Ideal for feeding structured knowledge into an agent's context window.

### Connecting

**Claude Desktop / Claude Code** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "atom": {
      "url": "https://your-domain.example.com/mcp",
      "headers": { "x-api-key": "<MCP_SECRET>" }
    }
  }
}
```

**stdio** (local):

```bash
npm run mcp        # built
npm run mcp:dev    # tsx watch
```

## REST API (17 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cards/:id` | Get card |
| POST | `/cards` | Create card (+ tree node) |
| PUT | `/cards/:id` | Update card |
| DELETE | `/cards/:id` | Delete card (cascades nodes) |
| GET | `/backlinks/:cardId` | Reverse references |
| GET | `/tree` | Root-level nodes |
| GET | `/tree/:nodeId` | Single node with card |
| GET | `/tree/:nodeId/children` | Direct children (agent key auth supported) |
| GET | `/tree/:nodeId/compile` | BFS markdown (`?depth=N`, default 2) |
| POST | `/tree/symlink` | Create symlink |
| PUT | `/tree/:nodeId/move` | Move node |
| DELETE | `/tree/:nodeId` | Delete node (card preserved) |
| GET | `/search?q=` | BM25 full-text search (`?rootNodeId=` for scoped search) |
| POST | `/api/cards` | Create card via agent key auth |
| POST | `/mcp` | Streamable HTTP MCP endpoint |
| POST | `/batch` | Batch operation (atomic transaction) |
| GET | `/events` | SSE real-time event stream |

Auth endpoints: `GET /api/auth/google`, `GET /api/auth/google/callback`, `GET /api/auth/slack`, `GET /api/auth/slack/callback`, `GET /api/auth/status`, `POST /api/auth/logout`

## Getting started

```bash
docker run -d --name atom-postgres -p 5434:5432 -e POSTGRES_PASSWORD=atom postgres:16
cp .env.example .env   # DATABASE_URL=postgresql://atom:atom@localhost:5434/atom_db, MCP_SECRET, etc.
npm install
npm run dev            # API on localhost:3000
```

Dashboard (optional):

```bash
cd dashboard && pnpm install && pnpm dev   # localhost:5173
```

Run tests with `npm test` (requires Docker for integration tests).

## Design decisions

**Content ≠ Placement.** A card is *what you know*. A tree node is *where you put it*. This separation enables symlinks — one card, many locations, zero duplication.

**compileNode() is pure.** No DB access. Takes three callbacks (`getNodeCard`, `getChildren`, `getCard`) so the caller pre-loads data. Testable, composable, predictable.

**HTTP MCP is stateless.** Each `POST /mcp` creates a fresh `McpServer` + transport pair. The DB pool is shared with REST. No session state to manage.

**Event bus + SSE.** Every mutation emits typed events (`card:created`, `card:updated`, `card:deleted`, `node:created`, `node:deleted`, `node:moved`). The dashboard subscribes via `/events` for live updates.

**Provenance tracking.** Every card can record `source_type`, `source_ref`, `source_snapshot`, `source_checksum`, and `source_checked_at`. Combined with 4-level `staleness`, agents can audit where knowledge came from and whether it's still current.

**Unfurl pipeline.** When `source_ref` contains an external URL (e.g. a Trello card), `compile_subtree` can expand it inline. Adapters fetch and cache snapshots in `unfurl_snapshots`; cached mode reuses DB data, fresh mode always hits the source. The dashboard exposes a toggle with per-provider credentials input.

**Multi-agent auth.** Named agents register with bcrypt-hashed API keys in the `agents` table. Each request carries `x-api-key`; the audit log records `agent_id` alongside every mutation. The dashboard shows `agent_id` in card detail and compile metadata.
