# atom

[![ci](https://github.com/eiaserinnys/atom/actions/workflows/ci.yml/badge.svg)](https://github.com/eiaserinnys/atom/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-skills_+_MCP-D97757)](#agent-skills)
[![Claude Desktop](https://img.shields.io/badge/Claude_Desktop-MCP_stdio-D97757)](#local-stdio-mcp)
[![Codex](https://img.shields.io/badge/Codex-skills_+_MCP-111111)](#installing-for-codex)
[![Self-host](https://img.shields.io/badge/self--host-SQLite_%7C_PostgreSQL-3ECF8E)](#quick-start)

**A knowledge base of the agents, by the agents, for the agents.**

`atom` organizes knowledge as a tree for AI agents to read and write. Agents read and update the tree through 17 Model Context Protocol (MCP) tools or a Fastify REST API. Humans inspect and edit the same tree in a three-panel React dashboard that updates in real time over Server-Sent Events (`GET /events`). The [`skills/`](skills/) directory ships [Agent Skills](#agent-skills) that teach agents how to write cards and keep the tree organized.

![atom three-panel dashboard](docs/screenshots/overview.png)

## Core Design

### Card and TreeNode Separation

`atom` keeps content and hierarchy in two separate database tables:

- **`cards`** store the content. Each card has a `title` (up to 50 characters), a `card_type` (`structure` for section headings, `knowledge` for notes), Markdown `content`, `tags`, and `references` (an array of referenced card UUIDs). Cards also track timestamps (`card_timestamp`, `content_timestamp`, `updated_at`), source provenance (`source_type`, `source_ref`, `source_snapshot`), and a `version` number for optimistic concurrency control.
- **`tree_nodes`** organize cards into a parent-child hierarchy. Each node stores a `parent_node_id`, a 10-digit LexoRank `position`, an `is_symlink` flag, and an optional `journal_limit`. `position` is stored as text in the database and returned as a number in API and MCP responses.

### Symlinks Without Duplicating Content

A card can appear under more than one parent. One placement is the canonical node (`is_symlink = false`); every other placement is a symlink node (`is_symlink = true`) that references the same `card_id`.

When `compile_subtree` encounters a symlink node, it expands the children of that card's canonical node. The traversal is depth-first: it finishes each child's subtree before moving on to the next sibling. It tracks the `card_id` values on the current path. If a node's card is already on that path, the traversal marks the node with `*(cycle)*` instead of expanding it again.

### Subtree Compilation for Agent Context Windows

`compile_subtree` turns a branch into one Markdown document, starting from any `node_id`. Heading levels (`#` through `######`) follow tree depth. Setting `titles_only: true` returns an indented title outline with character counts so agents can inspect a branch before compiling full card content.

### Orphan-Free Deletion Rules

- **Deleting a card** (`delete_card`, `DELETE /cards/:id`, or `batch_op.deletes`) cascades to every `tree_nodes` row referencing that card, including symlinks.
- **Deleting a tree node** (`delete_node` or `DELETE /tree/:nodeId`) removes the node and its descendants in a single transaction. Cards from that subtree are deleted too, unless a canonical or symlink node in another branch still references them.

## Quick Start

`atom` defaults to a SQLite file. You can run the server and dashboard locally without PostgreSQL or OAuth credentials.

### Prerequisites

- Node.js 20.19+ or 22.12+, and npm
- pnpm 10.33+ or 11.15+ (pnpm 11 requires Node.js 22+); the dashboard workspace explicitly permits esbuild's install script.

### 1. Install Dependencies

```bash
npm install
pnpm --dir dashboard install
```

### 2. Create Your Local `.env`

```bash
cp .env.example .env
```

In `.env.example`, `DATABASE_URL` is commented out, so the server uses SQLite at `./atom.db`. Set `SQLITE_PATH` to use a different file path. The example file also sets `API_PORT=4200`.

To use the dashboard without setting up Google or Slack OAuth, turn on the local auth bypass in `.env`:

```dotenv
AUTH_BYPASS=1
```

> [!WARNING]
> `AUTH_BYPASS=1` turns off browser sign-in: every request that would otherwise need a session cookie runs with `admin` access. In this mode the server binds only to `127.0.0.1` for local use. The server refuses to start if `AUTH_BYPASS=1` is set together with `GOOGLE_CLIENT_ID` or `SLACK_CLIENT_ID`.

### 3. Seed Synthetic Demo Data

```bash
npx tsx scripts/seed-demo.ts
```

The script runs database migrations, then loads `examples/demo/seed.json` into a sample tree of structure cards, knowledge cards, and a symlink. Pass `--file <path>` to load your own seed file instead. If `tree_nodes` already has rows, the script exits and leaves existing data untouched.

> [!NOTE]
> `scripts/seed-demo.ts` reads `DATABASE_URL` and `SQLITE_PATH` directly from the process environment without loading `.env`. If you changed `SQLITE_PATH` in `.env`, pass it inline: `SQLITE_PATH=./custom.db npx tsx scripts/seed-demo.ts`.

### 4. Start the API Server and Dashboard

Start the Fastify API and MCP server in one terminal:

```bash
npm run dev
```

Start the React dashboard in a second terminal, pointing `VITE_API_BASE_URL` to port `4200`:

```bash
VITE_API_BASE_URL=http://localhost:4200 pnpm --dir dashboard dev
```

Open `http://localhost:5173` in your browser.

## Connecting Agents via MCP

Agents can connect to 17 MCP tools via stateless Streamable HTTP (`POST /mcp`) or local `stdio`.

### Streamable HTTP MCP (Recommended)

1. Open the dashboard and click the **Settings** gear icon in the header.
2. Select the **API Keys** tab, enter an `agent_id` (and an optional display name), choose a scope, and click **Generate**. The scope menu starts at `read`; switch it to `write` for an agent that edits the tree.
3. Copy the API key now; it is shown once on creation, and `atom` stores only its bcrypt hash (`secret_hash`) in the `agents` table.
4. Register the endpoint in an MCP client that supports Streamable HTTP (for example, `.mcp.json` in Claude Code):

```json
{
  "mcpServers": {
    "atom": {
      "type": "http",
      "url": "http://localhost:4200/mcp",
      "headers": {
        "x-api-key": "YOUR_AGENT_API_KEY"
      }
    }
  }
}
```

After a key's first successful request, the server caches it in memory under its SHA-256 digest. Every call is still checked against active `agents` rows.

### Local stdio MCP

The `stdio` transport connects directly to the database configured in `.env` (`SQLITE_PATH` or `DATABASE_URL`) without API key authentication. Use `stdio` when the client and database run on the same machine (for example, in `claude_desktop_config.json`).

Build the TypeScript sources first, then launch `dist/mcp/server.js`:

```bash
npm run build
npm run mcp
```

`npm run mcp:dev` runs the TypeScript entry point directly during development. Writes over `stdio` are attributed to `MCP_AGENT_ID` (default `"stdio-agent"`) in `created_by` and `updated_by`.

> [!NOTE]
> `get_card_neighbors` requires the HTTP server's OpenAI embedding service and returns `NEIGHBORS_HTTP_ONLY` when invoked over `stdio`.

### MCP Tool Reference (17 Tools)

Keys with the `write` scope can call all 17 tools. For `read` keys, the server registers only the query tools marked `read` below.

| Category | Tool | Scope | Purpose |
| :--- | :--- | :--- | :--- |
| **Card** | `create_card` | `write` | Create a `structure` or `knowledge` card (`title`, `content`, `tags`, `references`, source fields) and place it in the tree (`parent_node_id`, `position`). |
| | `get_card` | `read` | Fetch a card's fields by `card_id`. |
| | `update_card` | `write` | Update `title`, `content`, `tags`, `references`, `content_timestamp`, or source fields, with optional `expected_version` for optimistic locking. |
| | `delete_card` | `write` | Delete a card and cascade-delete all `tree_nodes` pointing to it. |
| | `get_backlinks` | `read` | Find all cards whose `references` array contains `card_id`. |
| **Tree** | `get_tree` | `read` | Return a flat list of root-level tree nodes. |
| | `get_node` | `read` | Fetch a single `tree_nodes` row and its associated card data. |
| | `list_children` | `read` | List direct child nodes of `parent_node_id` (or the root nodes if omitted) ordered by `position`. |
| | `compile_subtree` | `read` | Compile a node and its descendants into a single Markdown document. |
| | `create_symlink` | `write` | Create a symlink node (`is_symlink = true`) that places an existing card (`card_id`) under `parent_node_id`. |
| | `move_node` | `write` | Move `node_id` to `parent_node_id` (or keep its current parent) and position it via `before`, `after`, `to`, or the deprecated `position`. |
| | `update_node` | `write` | Set or clear a node's `journal_limit` (`null` or `0` for unlimited, or a positive integer `N` for the latest `N` children by descending `position`). |
| | `delete_node` | `write` | Delete `node_id`, its descendant nodes, and any cards in that subtree that have no remaining tree nodes elsewhere. |
| **Search & Eval** | `search_cards` | `read` | Search card titles and content via full-text search (SQLite `fts5` or PostgreSQL `tsvector`/`ts_rank`, default `limit` `20`) or Jev (`engine: "jev"`, default `limit` `6`). |
| | `get_card_neighbors` | `read` | Return nearest-neighbor cards by OpenAI embedding cosine similarity (default `limit` `20`, max `50`; HTTP MCP only). |
| | `evaluate_cards` | `read` | Evaluate 1 to 48 candidate `card_ids` against a Jev query and context, returning a relevance `score` (`0` to `1`) for each card. |
| **Batch** | `batch_op` | `write` | Run multiple card and tree mutations in one database transaction. |

`update_card`, browser `PUT /cards/:id`, and agent `PATCH /api/cards/:cardId` accept optional `expected_version`. A mismatch leaves the card unchanged. HTTP returns `409` with `{ "error": "VERSION_CONFLICT", "current_version": N }`; MCP reports `VersionConflict`, as `batch_op` does. Omitting the version keeps last-write-wins behavior.

The card detail editor sends the version from the start of editing. On a conflict it keeps the draft and shows the existing change warning; pressing Save again overwrites against the version returned by the server. Unsaved title, content, and journal-limit drafts stay with their card while switching cards and are cleared by a page reload.

### Progressive Disclosure with `compile_subtree`

Read a branch outline first, then compile full card content only for the nodes you need.

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `node_id` | (required) | Root tree node UUID of the subtree to compile. |
| `depth` | `3` | Maximum traversal depth (`null` compiles the full tree without a depth limit). In the REST API, `GET /tree/:nodeId/compile` also defaults to `3`, while `GET /api/tree/:nodeId/compile` defaults to `2`. |
| `include_ids` | (omitted) | Controls ID annotations. Leave it unset for the defaults (`[node:X card:Y]` in `titles_only` mode, HTML metadata comments in heading mode), set `true` to force full HTML metadata in `titles_only` mode, or set `false` to drop IDs entirely. |
| `titles_only` | `false` | When `true`, outputs an indented outline of card titles and character counts without card `content`. |
| `numbering` | `false` | When `true`, prepends hierarchical numbers (`1`, `1.1`, `1.1.1`) to compiled headings below the root node. |
| `max_chars` | (omitted) | Truncates output to at most `N` characters on a line boundary (`0` or negative means unlimited). |
| `exclude_nodes` | (omitted) | Array of `node_id` UUIDs whose subtrees are skipped. |
| `limit` | (omitted) | Restricts direct children (`depth = 1`) to the latest `N` items by `card_timestamp`. |
| `resolve_refs` | (omitted) | External reference unfurl mode: `"cached"` (use `cards.source_snapshot` if present, otherwise fetch) or `"fresh"` (always fetch). Omit to skip unfurling. |
| `credentials` | (omitted) | Per-source credentials map for external reference unfurling (for example, `{ trello: { apiKey: "...", token: "..." } }`). |

### Atomic Multi-Step Updates with `batch_op`

`batch_op` runs up to seven operation arrays inside one transaction in a fixed execution order:

1. `creates` (new cards placed in the tree, each labeled with a caller-assigned `temp_id`)
2. `symlinks` (new symlink nodes for existing `card_id` values)
3. `updates` (card field updates by `card_id`)
4. `node_updates` (`journal_limit` updates on existing nodes by `node_id`)
5. `moves` (node reparenting and reordering)
6. `child_orders` (bulk reordering of direct children under `parent_node_id`)
7. `deletes` (card deletions by `card_id`, removing each card and all of its tree nodes)

Each item in `creates` requires a caller-assigned `temp_id` string. Other items in `creates`, `symlinks`, and `moves` within the same request can pass that string in `parent_temp_id` to place nodes under the newly created card. `symlinks.card_id` and `child_orders.parent_node_id` do not accept `temp_id` values and require real UUIDs. The call returns `{ created, symlinked, updated, node_updated, moved, child_ordered, deleted }`, where `created` is an array of `{ temp_id, card_id, node_id }` objects. If any step fails, the whole transaction rolls back.

## Agent Skills

The MCP tools let an agent change the tree; they do not tell it what a good card or a well-organized branch looks like. The [`skills/`](skills/) directory fills that gap with four skills in the open [Agent Skills](https://agentskills.io) format: each is a folder with a `SKILL.md` (YAML frontmatter with `name` and `description`, followed by Markdown instructions) that agents load when a request matches the description.

| Skill | Use it when the agent needs to |
| :--- | :--- |
| [`atom-zettelkasten`](skills/atom-zettelkasten/SKILL.md) | Write, update, link, or retire cards: one idea per card with a `source_ref`, structure cards that describe their section, `references` vs. symlinks, and updates guarded by `expected_version`. |
| [`atom-search`](skills/atom-search/SKILL.md) | Find what the tree already knows: rewrite `search_cards` queries until they hit, then drill down with `compile_subtree` outlines. Works with a `read` key. |
| [`atom-tree-cleanup`](skills/atom-tree-cleanup/SKILL.md) | Design or groom a branch: section order and naming, integrity checks, relative moves with `before`/`after`, `batch_op` restructuring, and deleting sections without losing cards. Includes `scripts/scan_heavy_cards.py` for finding oversized cards. |
| [`atom-reference-digest`](skills/atom-reference-digest/SKILL.md) | Turn an external source (web page, Git repository, paper) into atomic reference cards and symlink them into the knowledge tree. |

Register the atom MCP server before installing the skills (see [Connecting Agents via MCP](#connecting-agents-via-mcp)). The skills refer to tools by name; with the server registered as `atom`, Claude Code exposes them as `mcp__atom__<tool>`.

### Installing for Claude Code

Copy the skill folders into a skills directory. Claude Code reads personal skills from `~/.claude/skills/` (every project on the machine) and project skills from `.claude/skills/` in a repository:

```bash
mkdir -p ~/.claude/skills
cp -R skills/atom-* ~/.claude/skills/
```

Claude uses a skill when a request matches its description, and you can invoke one directly with `/atom-search`, `/atom-tree-cleanup`, and so on.

### Installing for Codex

Codex reads user skills from `~/.agents/skills/` and repository skills from `.agents/skills/` between the working directory and the repository root:

```bash
mkdir -p ~/.agents/skills
cp -R skills/atom-* ~/.agents/skills/
```

Codex picks a skill when a task matches its description; mention one explicitly with `$atom-search` or choose it from `/skills`.

### Other Agents

To keep installed skills in step with this repository, symlink the folders instead of copying them (for example, `ln -s "$PWD/skills/atom-search" ~/.claude/skills/atom-search`). For an agent without skill support, add the relevant `SKILL.md` body to its system prompt or project instructions (such as `AGENTS.md`); the files are plain Markdown.

`atom-tree-cleanup/scripts/scan_heavy_cards.py` calls the REST API (`GET /api/tree/:nodeId/children`) with an agent key. It reads `ATOM_BASE_URL` and `ATOM_API_KEY` from the environment, or the `atom` entry of a `.mcp.json` found above the script or the current directory.

## Web Dashboard

`dashboard/` is a single-page app built with React 19 and Vite. It supports nine UI languages (`en`, `ko`, `zh`, `ja`, `es`, `de`, `fr`, `ru`, `pt`) through `react-i18next`. It also listens to the `GET /events` SSE stream and refreshes open panels whenever an agent or a user changes a card or tree node.

![Card detail editor](docs/screenshots/card-detail.png)

![Compile view and depth menu](docs/screenshots/compile.png)

![Search results dropdown](docs/screenshots/search.png)

![Settings window](docs/screenshots/settings.png)

![Mobile tree view](docs/screenshots/mobile.png)

## Authentication and Permissions

### Browser Authentication

Browser API access is denied by default:

- **Default 401 when unconfigured**: If neither `GOOGLE_CLIENT_ID` nor `SLACK_CLIENT_ID` is configured and `AUTH_BYPASS` is not `1`, browser API routes that need a session cookie return `401`. This rule does not cover public routes such as `/api/health` and `/api/auth/*`. Agent routes (`/mcp`, `/api/cards`, `/api/tree`) authenticate with an API key instead.
- **Startup configuration validation**: At startup, `src/api/startup-config.ts` checks these settings:
  - `AUTH_BYPASS=1` is never set at the same time as `GOOGLE_CLIENT_ID` or `SLACK_CLIENT_ID`.
  - When `GOOGLE_CLIENT_ID` is set, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`, and `FRONTEND_URL` are also present.
  - When `SLACK_CLIENT_ID` is set, `SLACK_CLIENT_SECRET`, `SLACK_CALLBACK_URL`, `JWT_SECRET`, and `FRONTEND_URL` are also present.
- **Google OAuth admission (`ALLOWED_EMAIL`)**: A new Google user can sign in only if their email matches `ALLOWED_EMAIL`. The value can be a single address (`alice@example.com`) or a domain suffix (`@example.com`). If the `users` table is empty at startup and `ALLOWED_EMAIL` is a full address, `seedMigration()` creates that user as the first `admin`. Users who sign in through Google after that are created as `editor`.
  With an empty `users` table, a domain-only value leaves it empty and logs a warning to set a full address for the first admin.
- **Slack OAuth admission (`SLACK_ALLOWED_TEAM_ID`)**: Creating a new user via Slack sign-in requires `SLACK_ALLOWED_TEAM_ID` to be set and to match the user's Slack workspace team ID. If the variable is empty, new Slack users are rejected. Admitted Slack users are created with the `editor` role.

### Permissions Model

- **Instance-wide visibility**: `atom` does not partition visibility by card or subtree. Every authenticated browser user (`admin`, `editor`, `viewer`) and every active agent key (`read`, `write`) can read the entire tree in that instance.
- **Sharing a single subtree publicly**: If an instance holds private branches, do not hand out `viewer` accounts or `read` agent keys for public sharing. Compile the branch with `compile_subtree` and `include_ids: false`, then publish the resulting Markdown as a static page.
- **Browser user roles (`users.role`)**:
  - `admin`: Full read/write access to cards and tree nodes, plus these admin endpoints:
    - User roles and activation (`/api/config/users`)
    - Agent key issuance and deactivation (`/api/config/agents`)
    - `.env` editing (`/api/config/env`)
    - OpenAI key management (`/api/config/openai`)
    - Database connection testing and SQLite-to-PostgreSQL migration (`/api/config/db-test`, `/api/config/migrate-to-pg`)
    - Server restart (`/api/system/restart`)
  - `editor`: Can create, edit, move, or delete cards and tree nodes. Can also run searches, compile subtrees, read database status (`/api/config/db-info`), and list agent keys. Cannot issue, reissue, or modify agent keys. Cannot manage users or change any other admin setting.
  - `viewer`: Read-only. Mutating browser requests (`POST`, `PUT`, `PATCH`, `DELETE`) return `403`, except for two read-only `POST` endpoints: `POST /tree/:nodeId/compile` and `POST /search/evaluate`.
- **Immediate enforcement**: Changing a user's role or deactivating a user (`is_active = false`) in **Settings > Users** takes effect on the very next HTTP request.
- **Agent key scopes (`agents.scope`)**:
  - `write`: Can invoke all 17 MCP tools and call mutating agent REST endpoints (`POST /api/cards`, `PATCH /api/cards/:cardId`). Keys created before scopes existed have `write`, and so does a key issued through the API without a `scope` field.
  - `read`: Can see and call only the read-only query MCP tools, and gets `403` from mutating agent REST endpoints. The dashboard issues `read` keys by default.
  - Only `admin` users can issue or deactivate agent keys.

## Running with PostgreSQL

Use PostgreSQL in production or when many agents search at the same time. Its full-text search uses the built-in `tsvector`, `websearch_to_tsquery`, and `ts_rank`.

1. Set `DATABASE_URL` in `.env`:

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5432/atom_db
```

2. Start the server (`npm run dev` or `npm start`). At startup, the SQLite adapter runs only the files in `src/db/migrations-sqlite/` that are not yet recorded in `schema_migrations`. The PostgreSQL adapter, by contrast, runs every SQL file in `src/db/migrations/` in filename order each time it starts. All of those files are idempotent. To run migrations separately:

```bash
npm run build
npm run migrate
```

### Migrating an Existing SQLite Instance to PostgreSQL

To move an existing SQLite database to PostgreSQL from the dashboard:

1. Sign in to the dashboard as an `admin` and open **Settings > Database**.
2. Enter your `postgresql://` connection string and click **Test Connection** (`POST /api/config/db-test`).
3. Click **Save URL** (`PUT /api/config/env`) to write `DATABASE_URL` to `.env`, then restart the server so it boots on PostgreSQL.
4. Reopen **Settings > Database** and click **Migrate** (`POST /api/config/migrate-to-pg`). The server copies `users`, `agents`, `cards`, and `tree_nodes` from the local SQLite file into PostgreSQL, then renames the SQLite file with a `.deprecated` suffix (`app_settings` and `card_embeddings` are not copied).

## Optional Features

### OpenAI Embeddings and Similar Cards

An `admin` can configure an OpenAI API key in **Settings > OpenAI** (`PUT /api/config/openai/key`):

- The key is stored in the `app_settings` table (`openai_api_key`), not in `.env`. `PUT /api/config/env` rejects `OPENAI_API_KEY`, so the key can only be set in one place.
- `GET /api/config/openai` returns the key status (`configured`, `last_saved_at`) along with the embedding model, dimensions, progress counts, and worker status. It never sends the raw key back to the browser.
- When a key is configured, a background worker embeds non-empty canonical cards with `text-embedding-3-large` (`3072` dimensions) into `card_embeddings`.
- `get_card_neighbors` (HTTP MCP), `GET /cards/:cardId/neighbors`, and `GET /api/cards/:cardId/neighbors` return nearest-neighbor cards.

### Jev Search and Card Evaluation

Set both `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` in `.env` to enable Jev search and card evaluation:

- `search_cards` with `engine: "jev"` and `GET /search?q=...&engine=jev` retrieve candidate cards using Jev. The REST route also accepts `stream=1` for SSE progress events in the dashboard.
- `evaluate_cards` (MCP) and `POST /search/evaluate` evaluate 1 to 48 candidate `card_ids` against the query and context, returning a relevance `score` (`0` to `1`) for each card.

### External Reference Unfurl

To link a card to an external resource, set `source_ref` to the URL and `source_type` to `"link"` (or an adapter name). When `compile_subtree` runs with `resolve_refs: "cached"` or `"fresh"`, `atom` fetches external metadata through registered adapters and caches the result in `cards.source_snapshot`. Over REST, send `resolveRefs` and `credentials` in the body of `POST /tree/:nodeId/compile`.

- **Built-in Trello adapter**: Resolves `https://trello.com/c/...` card links using per-request `credentials` (`{ trello: { apiKey: "...", token: "..." } }`).
- **Custom adapter packages**: Set `ADAPTER_PACKAGES` in `.env` to a comma-separated list of npm packages. At startup, `atom` dynamically imports each package and calls its exported `register(registry)` function.

## Data Model and HTTP Surfaces

### Database Tables

| Table | Purpose |
| :--- | :--- |
| `cards` | Card titles, Markdown `content`, tags, card-to-card `references`, provenance fields, timestamps, and optimistic concurrency versions. |
| `tree_nodes` | Parent-child tree placements, LexoRank positions, symlink flags, and per-node `journal_limit` settings. |
| `users` | Browser user accounts, roles (`admin`, `editor`, `viewer`), and active status. |
| `agents` | Agent records for issued keys: bcrypt key hashes (`secret_hash`), scopes, and active status. |
| `app_settings` | Instance-level settings stored in the database, such as the OpenAI API key. |
| `card_embeddings` | Vector embeddings and indexing metadata generated for canonical cards. |

### HTTP Surfaces

- **Browser API**: Cookie-authenticated routes used by the React dashboard for sign-in, card and tree operations, search, live events (`GET /events`), and instance settings.
- **Agent REST API**: Key-authenticated routes (`x-api-key` header) under `/api/cards` and `/api/tree` for HTTP clients.
- **Streamable HTTP MCP**: Stateless MCP endpoint at `POST /mcp`, authenticated with the `x-api-key` header.

See `src/api/routes/` for route definitions and request schemas.

## Operational Notes

### Process Manager Required for `POST /api/system/restart`

When an `admin` saves `.env` changes in the dashboard and clicks the restart banner, `POST /api/system/restart` responds with `{ ok: true }` and calls `process.exit(0)` two seconds later. It does not start a new process itself. Run the API server under a process manager that automatically restarts the process when it exits.

### `.env` Secret Masking in Settings

`GET /api/config/env` never sends raw secrets to the browser. It masks every non-empty `.env` value as `***` unless its key is on this 15-key allowlist:

`API_PORT`, `NODE_ENV`, `FRONTEND_URL`, `AUTH_BYPASS`, `ALLOWED_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CALLBACK_URL`, `SLACK_CLIENT_ID`, `SLACK_CALLBACK_URL`, `SLACK_ALLOWED_TEAM_ID`, `ADAPTER_PACKAGES`, `TYPESAFE_BASE_URL`, `SQLITE_PATH`, `SEARCH_MOTION_PAGE_URL`, `MCP_AGENT_ID`.

Empty values stay empty, and `OPENAI_API_KEY` is left out of the response entirely. When `PUT /api/config/env` receives `***` for a masked key, it preserves the existing value in `.env` on disk.

### Environment Variables Summary

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | (unset) | PostgreSQL connection URL. When unset, `atom` uses SQLite at `SQLITE_PATH`. |
| `SQLITE_PATH` | `./atom.db` | File path for the SQLite database when `DATABASE_URL` is unset. |
| `API_PORT` | (required; `4200` in `.env.example`) | Port for the Fastify HTTP and MCP server (startup fails if unset). |
| `VITE_API_BASE_URL` | `""` (same origin) | API base URL used by the dashboard when running the Vite dev server on a separate port. |
| `FRONTEND_URL` | (unset) | Allowed CORS origin and post-OAuth redirect URL (required when Google or Slack OAuth is enabled). |
| `AUTH_BYPASS` | (unset) | Set to `1` for local unauthenticated `admin` access when no OAuth provider is configured. |
| `JWT_SECRET` | (required with OAuth) | Secret used to sign and verify browser session JWT cookies. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | (unset) | Google OAuth 2.0 credentials. |
| `ALLOWED_EMAIL` | (unset) | Email (`user@example.com`) or domain (`@example.com`) allowed to sign in via Google OAuth; seeds the first `admin` when set to a full email on an empty `users` table. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_CALLBACK_URL` | (unset) | Slack OAuth credentials. |
| `SLACK_ALLOWED_TEAM_ID` | (unset) | Slack workspace Team ID required to admit new Slack OAuth users. |
| `MCP_AGENT_ID` | `stdio-agent` | Attribution ID recorded in `created_by` and `updated_by` for `stdio` MCP mutations. |
| `ADAPTER_PACKAGES` | (unset) | Comma-separated npm package names providing external reference unfurl adapters. |
| `TYPESAFE_API_KEY` | (unset) | API key for Jev search and card evaluation (required together with `TYPESAFE_BASE_URL`). |
| `TYPESAFE_BASE_URL` | (unset) | Base URL for the Jev API (required together with `TYPESAFE_API_KEY`). |
| `SEARCH_MOTION_PAGE_URL` | (unset) | URL where you host `published/atom-search-motion/`, a static page that shows search results as a node graph. When set, that page can read the API through CORS, and an OAuth sign-in started from that page returns to it afterward. When unset, neither is allowed. |

## Development and Testing

```bash
# Run the API server in watch mode
npm run dev

# Build backend TypeScript to dist/
npm run build

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Build and lint the dashboard
pnpm --dir dashboard build
pnpm --dir dashboard lint
```

`npm run test:unit` and `npm run test:e2e` do not require a database.
Jest tests refuse to start if `DATABASE_URL` is set and route default SQLite access
to a disposable file, protecting the checkout's `atom.db` and production databases.
`npm run test:integration` and `npm test` require an empty PostgreSQL test
database whose name contains `test`; set its URL as `TEST_DATABASE_URL`.
Integration tests delete rows from this database, so use a dedicated database with no data you need to keep.

```bash
docker run --rm -d -p 127.0.0.1:5433:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=atom_test postgres:16
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/atom_test npm run test:integration
```

For browser tests, install Chromium with `npx playwright install chromium`, unset
`DATABASE_URL`, then run `npm run test:e2e`. The E2E config refuses an inherited
`DATABASE_URL` and creates a disposable workspace for the API source, SQLite DB,
and `.env`. Test resets and auth-setting edits affect only that workspace; the
checkout's DB and `.env` remain untouched. The temporary workspace is removed
after the run.

## License

MIT
