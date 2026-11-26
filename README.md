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

- **Deleting a card** (`delete_card`, `DELETE /cards/:id`, or `batch_op.deletes`) removes every node of that card, symlinks included, together with the whole subtree below each of those nodes. Cards in those subtrees that have no node left elsewhere are permanently deleted as well; cards that still have a canonical or symlink node outside the deleted subtrees are kept. This cannot be undone, so move a card you want to keep out of the subtree first, or give it another node elsewhere with a symlink. `delete_card` answers `{ "deleted": true, "deleted_card_ids": [...], "deleted_node_count": N }`, where `deleted_card_ids` lists every card the call deleted permanently. Pass `dry_run: true` to get the same lists with `"deleted": false` and `"dry_run": true` without deleting anything. A subtree card that is kept because a symlink elsewhere still references it stays only through that symlink, without the children it had below the deleted node.
- **Deleting a tree node** (`delete_node` or `DELETE /tree/:nodeId`) removes the node and its descendant nodes in a single transaction. Cards from that subtree (including the node's own card) are permanently deleted too, unless a canonical or symlink node in another branch still references them. Deleting a symlink node removes only that node, unless it is the card's last node (the canonical node was already deleted): then the card is permanently deleted too. Check with `dry_run` first. `delete_node` answers the same JSON as `delete_card` and accepts `dry_run`. The dashboard asks `GET /tree/:nodeId/delete-preview` (`{ "target": "node" | "symlink", "deleted_node_count", "deleted_card_count", "deleted_card_ids" }`) before it shows the delete confirmation; `DELETE /tree/:nodeId` and `DELETE /cards/:id` still answer `204`.

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

Set `ALLOWED_EMAIL` in `.env` to your own email **before the first start**. The server creates that user as the first admin; an empty value or the `your-email@...` example is skipped with a warning. If you start once without it, set it and restart: the user is created then.

To use the dashboard without setting up Google or Slack OAuth, turn on the local auth bypass in `.env`:

```dotenv
AUTH_BYPASS=1
```

> [!WARNING]
> `AUTH_BYPASS=1` turns off browser sign-in: every request that would otherwise need a session cookie runs with `admin` access. In this mode the server binds only to `127.0.0.1` by default; setting `API_HOST` changes the listen address, and a host reachable from the network gives everyone who can reach it `admin` access. The server refuses to start if `AUTH_BYPASS=1` is set together with `GOOGLE_CLIENT_ID`, `SLACK_CLIENT_ID`, or `DASHBOARD_ADMIN_PASSWORD`.

### 3. Seed Synthetic Demo Data

```bash
npx tsx scripts/seed-demo.ts
```

The script runs database migrations, then loads `examples/demo/seed.json` into a sample tree of structure cards, knowledge cards, and a symlink. Pass `--file <path>` to load your own seed file instead. If `tree_nodes` already has rows, the script exits and leaves existing data untouched.

> [!NOTE]
> Every entry point (`npm run dev`, `npm start`, `npm run migrate`, the stdio MCP server, `seed-demo`) loads `.env` and gives it priority over the shell. A variable that is in `.env` is ignored when you put it before the command (`AUTH_BYPASS=1 npm run dev`, `SQLITE_PATH=./custom.db npx tsx scripts/seed-demo.ts`); edit `.env` instead. Variables that are not in `.env` still come from the shell. Each entry point prints which database it uses and where that setting came from. To read a different file instead of the repository-root `.env`, set `ATOM_ENV_FILE` in the shell (see the environment variable table); the settings window still edits the repository-root `.env`.

### 4. Start the API Server and Dashboard

Start the Fastify API and MCP server in one terminal:

```bash
npm run dev
```

> [!NOTE]
> `npm run dev` has no process manager. The dashboard's **Restart Now** button only stops the server there; start `npm run dev` again yourself. The dashboard shows this next to the button.

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
| | `update_card` | `write` | Update `title`, `content`, `tags`, `references`, `content_timestamp`, or source fields; omitted fields stay as they are, but `content`, `tags`, and `references` are replaced in full, not patched. Send the card's `version` from `get_card` as `expected_version` for optimistic locking when another session may edit the same card. |
| | `delete_card` | `write` | Permanently delete a card, every `tree_nodes` row pointing to it (symlinks included), and the subtrees below them. Cards in those subtrees with no node left elsewhere are deleted too. Returns `{ deleted, deleted_card_ids, deleted_node_count }`; `dry_run: true` only reports. |
| | `get_backlinks` | `read` | Find all cards whose `references` array contains `card_id`. |
| **Tree** | `get_tree` | `read` | Return a flat list of root-level tree nodes. |
| | `get_node` | `read` | Fetch a single `tree_nodes` row and its associated card data. |
| | `list_children` | `read` | List direct child nodes of `parent_node_id` (or the root nodes if omitted) ordered by `position`. |
| | `compile_subtree` | `read` | Compile a node and its descendants into a single Markdown document. |
| | `create_symlink` | `write` | Create a symlink node (`is_symlink = true`) that places an existing card (`card_id`) under `parent_node_id`. |
| | `move_node` | `write` | Move `node_id` to `parent_node_id` (or keep its current parent) and position it via `before`, `after`, `to`, or the deprecated `position` (an absolute sort key). |
| | `update_node` | `write` | Set or clear a node's `journal_limit` (`null` or `0` for unlimited, or a positive integer `N` for the latest `N` children by descending `position`). |
| | `delete_node` | `write` | Permanently delete `node_id`, its descendant nodes, and any cards in that subtree (including the node's own card) that have no remaining tree nodes elsewhere. Returns `{ deleted, deleted_card_ids, deleted_node_count }`; `dry_run: true` only reports. |
| **Search & Eval** | `search_cards` | `read` | Search card titles and content via full-text search (SQLite `fts5` or PostgreSQL `tsvector`/`ts_rank`, default `limit` `20`). Plain words match as word prefixes (`소울스트림` finds `소울스트림에서`, but a fragment from the middle of a word does not match), quoted phrases match whole words in order, `-word` excludes, and `OR` joins alternatives. When the query returns 0 cards, the default `strategy: "auto"` retries with a widened query and marks those results with a `fallback` field. Or search with Jev (`engine: "jev"`, default `limit` `6`). |
| | `get_card_neighbors` | `read` | Return nearest-neighbor cards by OpenAI embedding cosine similarity (default `limit` `20`, max `50`; HTTP MCP only). |
| | `evaluate_cards` | `read` | Evaluate 1 to 48 candidate `card_ids` against a Jev query and context, returning a relevance `score` (`0` to `1`) for each card. |
| **Batch** | `batch_op` | `write` | Run multiple card and tree mutations in one database transaction. |

Tools that take a `parent_node_id` (`create_card`, `create_symlink`, `move_node`, `batch_op`) place the node under the canonical node when that parent is a symlink node, so check the `parent_node_id` in the response (`create_card` and the `batch_op` results for `creates`, `symlinks`, and `moves` do not return the parent, so call `get_node` to confirm it; the `child_ordered` result of `batch_op` lists the resolved parent `node_id` of each `child_orders` item). `position` in the creating tools is a sort key (usually in steps of 100), not a 0-based index: omit it to append at the end, and use `move_node` with `before` or `after` to choose a spot. `node_id` is a tree position (`node:` in `compile_subtree` output) and `card_id` is card content (`card:`); each argument description says which of the two it takes. They are easy to swap: `create_symlink` takes a `card_id` (the card to link) together with a `parent_node_id` (the tree position to put it under).

`update_card`, browser `PUT /cards/:id`, and agent `PATCH /api/cards/:cardId` accept optional `expected_version`. A mismatch leaves the card unchanged. HTTP returns `409` with `{ "error": "VERSION_CONFLICT", "code": "VERSION_CONFLICT", "current_version": N, "message": "..." }`; MCP reports `VersionConflict`, as `batch_op` does. Omitting the version keeps last-write-wins behavior.

Agent `PATCH /api/cards/:cardId` takes the same fields as `update_card`: `title`, `content`, `tags`, `references`, `content_timestamp`, `source_type`, `source_ref`, and `expected_version`. It applies the same checks (title rules, `references` as UUIDs, version conflict), and an unknown field is a `400`.

The card detail editor sends the version from the start of editing. On a conflict it keeps the draft and shows the existing change warning; pressing Save again overwrites against the version returned by the server. Unsaved title, content, and journal-limit drafts stay with their card while switching cards and are cleared by a page reload.

### Progressive Disclosure with `compile_subtree`

Read a branch outline first, then compile full card content only for the nodes you need.

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `node_id` | (required) | Root tree node UUID of the subtree to compile. |
| `depth` | `3` | Maximum traversal depth, `0` or more (`null` compiles the full tree without a depth limit; a negative value is rejected). In the REST API, `GET /tree/:nodeId/compile` also defaults to `3`, while `GET /api/tree/:nodeId/compile` defaults to `2`. |
| `include_ids` | (omitted) | Controls ID annotations. Leave it unset for the defaults (`[node:X card:Y]` in `titles_only` mode, HTML metadata comments in heading mode), set `true` to force full HTML metadata in `titles_only` mode, or set `false` to drop IDs entirely. |
| `titles_only` | `false` | When `true`, outputs an indented outline of card titles and character counts without card `content`. |
| `numbering` | `false` | When `true`, prepends hierarchical numbers (`1`, `1.1`, `1.1.1`) to compiled headings below the root node. |
| `max_chars` | (omitted) | Truncates output to at most `N` characters on a line boundary and appends `<!-- truncated: M chars omitted -->` (`0` or negative means unlimited). The first line is always kept whole, so an `N` smaller than the first line still returns that line. |
| `exclude_nodes` | (omitted) | Array of `node_id` UUIDs whose subtrees are skipped. |
| `limit` | (omitted) | Restricts direct children (`depth = 1`) to the latest `N` items by `card_timestamp`. |
| `resolve_refs` | (omitted) | External reference unfurl mode: `"cached"` (use `cards.source_snapshot` if present, otherwise fetch) or `"fresh"` (always fetch). Omit to skip unfurling. |
| `credentials` | (omitted) | Per-source credentials map for external reference unfurling (for example, `{ trello: { apiKey: "...", token: "..." } }`). |

When `journal_limit` shows only the latest children of a node, or `limit` cuts the root's direct children, the compiled text says so with one HTML comment line under that node, for example `<!-- omitted: 12 older children (journal_limit 5) -->` or `<!-- omitted: 30 children (limit 20) -->`. In `titles_only` mode the line sits at the indentation of the children. The count is the number of children actually left out; nothing is added when nothing was left out.

### Atomic Multi-Step Updates with `batch_op`

`batch_op` runs up to seven operation arrays inside one transaction in a fixed execution order:

1. `creates` (new cards placed in the tree, each labeled with a caller-assigned `temp_id`)
2. `symlinks` (new symlink nodes for existing `card_id` values)
3. `updates` (card field updates by `card_id`)
4. `node_updates` (`journal_limit` updates on existing nodes by `node_id`)
5. `moves` (node reparenting and reordering)
6. `child_orders` (bulk reordering of direct children under `parent_node_id`)
7. `deletes` (card deletions by `card_id`, removing each card, all of its tree nodes, and the subtrees below them; cards in those subtrees with no node left elsewhere are deleted too; a `card_id` that did not exist when the batch started fails the batch with `Card not found: <id>`, and a card an earlier item already deleted is skipped)

Each item in `creates` requires a caller-assigned `temp_id` string. Other items in `creates`, `symlinks`, and `moves` within the same request can pass that string in `parent_temp_id` to place nodes under the newly created card. `symlinks.card_id` and `child_orders.parent_node_id` do not accept `temp_id` values and require real UUIDs. In `moves`, omitting `new_parent_node_id` keeps the node under its current parent (`null` means root); position it with `before`, `after`, or `to` (`new_position` is deprecated). A node listed in `child_orders.order` that sits under another parent is moved under that `parent_node_id`. `updates` replaces `content` in full, like `update_card`. The call returns `{ created, symlinked, updated, node_updated, moved, child_ordered, deleted, cascade_deleted_card_ids }`, where `created` is an array of `{ temp_id, card_id, node_id }` objects, `deleted` lists the requested `card_id`s the batch actually deleted, and `cascade_deleted_card_ids` lists the cards it deleted without being asked (subtree cards with no node left elsewhere). If any step fails, the whole transaction rolls back.

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

Authentication modes are resolved in this order:

| Priority | Mode | Configuration |
| --- | --- | --- |
| 1 | OAuth | `GOOGLE_CLIENT_ID` or `SLACK_CLIENT_ID` is set; the installation password is ignored. |
| 2 | Password | `DASHBOARD_ADMIN_PASSWORD` is nonblank after trimming; requires `JWT_SECRET`. |
| 3 | Bypass | `AUTH_BYPASS=1` for local development only. |
| 4 | Unconfigured | No login method; protected browser APIs return 401. |

Password and bypass cannot be enabled together. Password mode creates the first administrator as `owner@local` and preserves an existing account's role and active state. Login is limited to ten failed attempts per IP in a 60-second window. Session cookies are marked `Secure` when the first `X-Forwarded-Proto` value is `https`, or the request itself uses HTTPS when that header is absent. Set `DASHBOARD_DIR` to a built dashboard directory to have the API serve its static files and client routes; `API_HOST` optionally overrides the listen host.

Browser API access is denied by default:

- **Default 401 when unconfigured**: If neither OAuth nor a dashboard password is configured and `AUTH_BYPASS` is not `1`, browser API routes that need a session cookie return `401`. This rule does not cover public routes such as `/api/health` and `/api/auth/*`. Agent routes (`/mcp`, `/api/cards`, `/api/tree`) authenticate with an API key instead.
- **Startup configuration validation**: At startup, `src/api/startup-config.ts` refuses to start (and names what is wrong) in these cases:
  - `AUTH_BYPASS=1` is set together with `GOOGLE_CLIENT_ID` or `SLACK_CLIENT_ID`.
  - `AUTH_BYPASS=1` is set together with `DASHBOARD_ADMIN_PASSWORD`.
  - `GOOGLE_CLIENT_ID` is set but `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`, or `FRONTEND_URL` is missing.
  - `SLACK_CLIENT_ID` is set but `SLACK_CLIENT_SECRET`, `SLACK_CALLBACK_URL`, `JWT_SECRET`, or `FRONTEND_URL` is missing.
  - Password mode (`DASHBOARD_ADMIN_PASSWORD` without an OAuth provider) has no `JWT_SECRET`.
- **Google OAuth admission (`ALLOWED_EMAIL`)**: A new Google user can sign in only if their email matches `ALLOWED_EMAIL`. The value can be a single address (`alice@example.com`) or a domain suffix (`@example.com`). At startup, if `ALLOWED_EMAIL` is a full address and no user has that email, `seedMigration()` creates that user as `admin`, even when other users already exist. An empty value, a domain-only value, or the `your-email@...` example is skipped with a warning; set a full address and restart. A user that already exists keeps its role. Users who sign in through Google after that are created as `editor`.
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
  - `viewer`: Read-only. Mutating browser requests (`POST`, `PUT`, `PATCH`, `DELETE`) return `403`, except for five read-only `POST` endpoints: `POST /tree/:nodeId/compile`, `POST /tree/:nodeId/compile/sections`, `POST /tree/compile/contents`, `POST /search/evaluate`, and `POST /search/expand`. Every other mutating request from a viewer gets `403 { "error": "Forbidden" }`, without a `code`.
- **Immediate enforcement**: Changing a user's role or deactivating a user (`is_active = false`) in **Settings > Users** takes effect on the very next HTTP request.
- **Agent key scopes (`agents.scope`)**:
  - `write`: Can invoke all 17 MCP tools and call mutating agent REST endpoints (`POST /api/cards`, `PATCH /api/cards/:cardId`). Keys created before scopes existed have `write`, and so does a key issued through the API without a `scope` field.
  - `read`: Can see and call only the read-only query MCP tools, and gets `403` from mutating agent REST endpoints. The dashboard issues `read` keys by default. Calling a write tool by name answers with an error that names the cause ("This API key has read scope, so write tools are disabled (create_card)..."), and the `403` body says the key has read scope and that a write-scope key is needed.
  - Only `admin` users can issue or deactivate agent keys.

## Running with PostgreSQL

Use PostgreSQL in production or when many agents search at the same time. Its full-text search uses the built-in `tsvector`, a `to_tsquery` built from websearch-style input (plain words as prefixes, quoted phrases, `-word`, `OR`), and `ts_rank`.

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

Errors from the service layer (a node or card that does not exist, a malformed ID, invalid input, a version conflict) and the `403` for a read-scope key come back as `{ "error": "<what is wrong and what to do>", "code": "<CODE>" }`. There `error` is a string; branch on `code`. Some responses have another shape and carry no `code` from this table:

- Authentication failures (`401`) and query-parameter errors (a bad `limit` on compile, a bad `depth` or `excerpt_chars` on `/tree/outline`, a missing node on outline) answer with `{ "error": "<message>" }` only.
- Jev search errors answer with `{ "error": { "code", "message" } }`; neighbors and search-expand answer with `{ "error": { "code" } }`.
- A move that would make a cycle answers in Fastify's standard shape with a top-level `code` of `TREE_CYCLE`.

MCP errors are plain text.

| `code` | Status | Meaning |
| :--- | :--- | :--- |
| `NODE_NOT_FOUND` | `404` | No node with that `node_id`. The message says when the value is really a `card_id`. |
| `CARD_NOT_FOUND` | `404` | No card with that `card_id`. The message says when the value is really a `node_id`. |
| `PARENT_NOT_FOUND` | `404` | The `parent_node_id` of a write does not exist. |
| `INVALID_ID` | `400` | A path or body ID is not a UUID (8-4-4-4-12 hex). |
| `INVALID_INPUT` | `400` | Another input problem, such as an empty title, an unknown field, or a negative `depth`. |
| `VERSION_CONFLICT` | `409` | `expected_version` differs from the card's version. |
| `ALREADY_EXISTS` | `409` | The `agent_id` is already registered (`POST /api/config/agents`). |
| `INSUFFICIENT_SCOPE` | `403` | A read-scope key, or a `viewer` account, called a write route of the agent REST API (`POST /api/cards`, `PATCH /api/cards/:cardId`). A viewer on a browser route gets `{ "error": "Forbidden" }` without a `code`. |

## Operational Notes

### Process Manager Required for `POST /api/system/restart`

When an `admin` saves `.env` changes in the dashboard and clicks the restart banner, `POST /api/system/restart` responds with `{ ok: true }` and calls `process.exit(0)` two seconds later. It does not start a new process itself. Run the API server under a process manager that automatically restarts the process when it exits.

### `.env` Secret Masking in Settings

`GET /api/config/env` never sends raw secrets to the browser. It masks every non-empty `.env` value as `***` unless its key is on this 17-key allowlist:

`API_PORT`, `API_HOST`, `DASHBOARD_DIR`, `NODE_ENV`, `FRONTEND_URL`, `AUTH_BYPASS`, `ALLOWED_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CALLBACK_URL`, `SLACK_CLIENT_ID`, `SLACK_CALLBACK_URL`, `SLACK_ALLOWED_TEAM_ID`, `ADAPTER_PACKAGES`, `TYPESAFE_BASE_URL`, `SQLITE_PATH`, `SEARCH_MOTION_PAGE_URL`, `MCP_AGENT_ID`.

Empty values stay empty, and `OPENAI_API_KEY` is left out of the response entirely. When `PUT /api/config/env` receives `***` for a masked key, it preserves the existing value in `.env` on disk.

### Environment Variables Summary

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | (unset) | PostgreSQL connection URL. When unset, `atom` uses SQLite at `SQLITE_PATH`. |
| `SQLITE_PATH` | `./atom.db` | File path for the SQLite database when `DATABASE_URL` is unset. |
| `API_PORT` | (required; `4200` in `.env.example`) | Port for the Fastify HTTP and MCP server (startup fails if unset). |
| `API_HOST` | (unset) | Listen host. When unset, the server binds `127.0.0.1` in `AUTH_BYPASS=1` mode and `0.0.0.0` otherwise. Setting it overrides both; in bypass mode a host reachable from the network opens unauthenticated `admin` access to that network. |
| `ATOM_ENV_FILE` | (unset) | Path of the env file to load instead of the repository-root `.env`. Read from the shell only (a value inside `.env` has no effect). `GET` and `PUT /api/config/env` still read and write the repository-root `.env`. |
| `GIT_COMMIT_SHA`, `BUILD_DATE` | `dev`, `unknown` outside Docker; `unknown`, `unknown` in the Docker image | Build identifiers that `GET /api/version` returns as `commit` and `buildDate`. `Dockerfile.backend` bakes them into the image from build arguments whose default is `unknown`; the `dev` fallback applies only when the variable is unset. |
| `DASHBOARD_DIR` | (unset) | Built dashboard directory (must contain `index.html`) that the API serves as static files and client routes. |
| `DASHBOARD_ADMIN_PASSWORD` | (unset) | Installation password for dashboard login. Requires `JWT_SECRET`, cannot be combined with `AUTH_BYPASS=1`, and is ignored when an OAuth provider is configured. |
| `VITE_API_BASE_URL` | `""` (same origin) | API base URL used by the dashboard when running the Vite dev server on a separate port. |
| `FRONTEND_URL` | (unset) | Allowed CORS origin and post-OAuth redirect URL (required when Google or Slack OAuth is enabled). |
| `AUTH_BYPASS` | (unset) | Set to `1` for local unauthenticated `admin` access when neither an OAuth provider nor `DASHBOARD_ADMIN_PASSWORD` is configured (combining them stops startup). |
| `JWT_SECRET` | (required with OAuth or password mode) | Secret used to sign and verify browser session JWT cookies. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | (unset) | Google OAuth 2.0 credentials. |
| `ALLOWED_EMAIL` | (unset) | Email (`user@example.com`) or domain (`@example.com`) allowed to sign in via Google OAuth; at startup it creates that user as `admin` when it is a full email and no user has it yet (an existing user keeps its role). |
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
