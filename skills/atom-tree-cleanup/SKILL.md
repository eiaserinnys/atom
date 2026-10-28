---
name: atom-tree-cleanup
description: |
  How to design, inspect, and groom the structure of an atom knowledge tree: section order and naming, grouping,
  integrity checks, and safe moves, reorders, and deletions with move_node and batch_op.
  Use for "clean up the tree", "reorganize this branch", "where should this section go", "check tree health",
  "remove stale entries", "reorder sections", or when a branch has become hard to navigate.
  Card-level writing rules live in atom-zettelkasten; lookups in atom-search.
---

# atom Tree Design and Grooming

A good atom tree lets an agent that has never seen it find the right branch from the outline alone. This skill covers how to shape a tree, how to find what is wrong with an existing one, and how to change it without losing cards.

Tool names below are the bare MCP tool names; your client may prefix them (Claude Code: `mcp__atom__move_node` when the server is registered as `atom`). Changing the tree needs an agent key with the `write` scope.

## Principles

### A branch should read like a book

Compile a branch as an outline and read it top to bottom. Understanding should build up:

1. Why this topic matters (problem, motivation)
2. Concepts and rules you need first
3. The main patterns and how to use them
4. Advanced patterns and edge cases
5. References, comparisons, and catalogs (appendix, always last)

Later sections should depend on earlier ones. Reference lists placed before the main material make readers skim an appendix first.

For a software project tree, a common order is: architecture overview → source layout → invariants → core domain → interfaces (API, events) → clients → development conventions → testing → environment → open issues → resolved issues → logs. Use it as a default, not a rule.

### Name sections after the problem they answer

Ask "why are these cards together?"; the answer is the section name.

| Weak (tool or technique) | Better (problem or role) |
| :--- | :--- |
| "Zustand" | "Limiting re-render scope" |
| "useMemo" | "Measuring render cost" |
| "Playwright" | "End-to-end tests" |
| "TanStack Query" | "Server state caching" |

Explicit comparison cards ("SWR vs TanStack Query") may keep tool names.

### Group by meaning, not by count

If you can see a unit of meaning among sibling cards, group it under a structure card. If you cannot, leave the cards alone. Easier navigation follows from meaningful grouping; it is not a reason on its own. As a review heuristic, three to seven siblings per level is comfortable, and a chain where every parent has exactly one child is a sign of an unnecessary level.

### Structure cards describe themselves

Every structure card's content says what the section collects and when to open it, in the first sentence (see `atom-zettelkasten`). Agents, and atom's optional Jev search, decide whether to descend from that description. Do not list the children in it; it goes stale.

### Leave log sections alone

Append-only sections such as work logs, changelogs, incident logs, or "mistakes we made" are records, not topics. Keep them at the end of their branch, keep their names, and do not regroup or merge their entries into topical sections. If such a section uses `journal_limit` (only the latest N children are compiled), new entries must be appended at the end, because "latest" means last in position order.

## Workflow

### Step 1: Get the outline

```text
compile_subtree(node_id, titles_only=true, numbering=true, depth=3)
```

This returns titles, `[node:… card:…]` IDs, and each card's content length. Use `depth=4` for deep branches and `max_chars` to cap very large ones. Open individual cards with `get_card` when a title is not enough to judge.

### Step 2 (optional): Find oversized cards

`scripts/scan_heavy_cards.py` in this skill's directory walks a branch through atom's REST API and lists cards whose content exceeds a threshold:

```bash
python <skill-dir>/scripts/scan_heavy_cards.py <node_id> --threshold 300 --depth 10
```

It reads `ATOM_BASE_URL` and `ATOM_API_KEY` from the environment, or the `atom` entry of a `.mcp.json` found above the script or the current directory (a `read` key is enough). In Claude Code, `<skill-dir>` is `${CLAUDE_SKILL_DIR}`. Long knowledge cards are candidates for splitting into a structure card with atomic children.

### Step 3: Diagnose

Check the outline for these problems:

**Integrity**
- A knowledge card with children. Knowledge cards hold one idea and never contain other cards; the parent should be a structure card.
- An empty structure card (no children): remove it, or fill it if the section is genuinely needed.
- A structure card with no description, or a description that is just a list of its children.
- A knowledge card without `source_ref`.
- Two cards stating the same idea. Keep one canonical card, and symlink it where the other placement was useful.
- `references` that point to cards that no longer exist (`get_card` returns "not found").

**Staleness**
- Resolved problems still filed under an open-issues section.
- Dated status snapshots ("42% as of March") mixed into sections of durable knowledge.
- Cards describing behavior the system no longer has.

**Placement and order**
- Cards that belong to another project's or topic's branch.
- Durable design knowledge and day-to-day operational facts mixed in one section.
- Sections in an order that does not build understanding, or references placed before the main material.
- Overcrowded sections whose children fall into visible sub-topics.

Present the findings as a numbered list with the change you propose for each, and get the user's confirmation before changing anything.

For a large reorganization, write the proposed outline first (current position → new position for each moved card, with the reason for each new section name). If you can run a second agent, have it review the outline against the principles above before you execute; revise at most twice, then ask the user.

### Step 4: Execute

#### Positions: say where, not which number

Sibling order is stored as LexoRank keys. Do not compute or guess numeric positions.

- `move_node(node_id, after=<sibling node_id>)`, `before=<sibling node_id>`, or `to="start" | "end"` places a node relative to its siblings.
- `parent_node_id` decides the destination: a UUID moves under that node, `null` moves to the root, and **omitting it keeps the current parent** (use this for reordering in place).
- Moving a node under its own descendant is rejected.
- `position` on `move_node` is deprecated, and on `create_card`, `create_symlink`, and `batch_op` items it is a raw sort key rather than "the Nth child". Omit it so new nodes are appended, then move them with `before`/`after`.

#### One reorder: `move_node`

```text
move_node(node_id="<card to move>", after="<sibling that should precede it>")
```

#### Restructuring a branch atomically: `batch_op`

`batch_op` runs every change in one transaction; if any item fails, nothing is written. Steps run in a fixed order: `creates` → `symlinks` → `updates` → `node_updates` → `moves` → `child_orders` → `deletes`.

```text
batch_op(
  creates=[
    {"temp_id": "g1", "card_type": "structure", "title": "Server state caching",
     "content": "How the dashboard caches and refreshes server data.", "parent_node_id": "<branch node_id>"}
  ],
  moves=[
    {"node_id": "<card A node_id>", "parent_temp_id": "g1"},
    {"node_id": "<card B node_id>", "parent_temp_id": "g1"},
    {"node_id": "<card C node_id>", "new_parent_node_id": "<other section node_id>", "to": "end"}
  ],
  child_orders=[
    {"parent_node_id": "<branch node_id>", "order": ["<intro node_id>", "<concepts node_id>", "<log node_id>"]}
  ]
)
```

- `parent_temp_id` places a node under a card created in the same call. `child_orders` and `symlinks.card_id` need real UUIDs, so order newly created nodes in a follow-up call or with `move_node`.
- In `moves`, omitting `new_parent_node_id` keeps the node's current parent; `null` moves it to the root.
- `child_orders` rewrites the order of the listed children with evenly spaced keys. Children you leave out keep their old keys and can end up interleaved, so list every child of that parent. Listing a node from another parent moves it under this parent.
- The result maps each `temp_id` to its new `card_id` and `node_id`.

#### Deleting: move the children out first

Deletion removes whole subtrees:

- `delete_node(node_id)` deletes the node and everything under it. Cards in that subtree that are not placed anywhere else are deleted permanently.
- `delete_card(card_id)` and `batch_op` `deletes` remove the card from every placement and delete the subtrees under those placements the same way.

So to remove a section, first move its children to their new homes, confirm the section is empty with `list_children`, and only then delete it. To remove a symlink placement, call `delete_node` on the symlink node; the card and its canonical placement stay. Check `get_backlinks(card_id)` before deleting any card that others may reference.

#### Log sections: `journal_limit`

`update_node(node_id, journal_limit=N)` makes `compile_subtree` include only the last N children of that node; `null` or `0` removes the limit. Use it on append-only log sections so compiling a parent branch does not pull in the whole history.

### Step 5: Verify

```text
compile_subtree(node_id, titles_only=true, numbering=true, depth=4)
```

Compare the result with the outline you proposed. Count the cards before and after: a lower count after moves means a card was deleted or moved outside the branch. Report the final outline to the user.
