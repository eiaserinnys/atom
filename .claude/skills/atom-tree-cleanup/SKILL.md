---
name: atom-tree-cleanup
description: |
  Inspect and groom the structure of an atom knowledge tree.
  Identifies stale entries, moves misplaced cards, groups related items, and reorders sections logically.
  Use for requests like: "clean up the tree", "reorganize atom", "improve tree structure",
  "remove stale entries", "check tree health", "reorder sections",
  or when the user mentions a specific tree and asks "does this need cleanup?".
---

# atom Tree Cleanup

A grooming workflow for maintaining structural quality in atom knowledge trees.

## Workflow

### Step 1: Get a tree overview

Fetch the target subtree with `compile_subtree`.

```python
mcp__atom__compile_subtree(node_id, titles_only=True, depth=3)  # or depth=4 for deeper trees
```

`titles_only=True` returns only titles and content sizes, making even large trees quick to scan.
Adjust depth based on tree size — 3 is usually enough; use 4 for deeper structures.

To inspect a specific card's content, use `mcp__atom__get_card` for individual lookup.

### Step 1.5 (optional): Scan for oversized cards

Use this when you need to find cards with excessive content.
Helpful for identifying decomposition candidates before a full grooming pass.

```bash
# Run from the project root (the directory containing .mcp.json)
python .claude/skills/atom-tree-cleanup/scripts/scan_heavy_cards.py <node_id> [--threshold 300] [--depth 10]
```

The script loads its configuration from environment variables or `.mcp.json`:
- `ATOM_BASE_URL` + `ATOM_API_KEY` environment variables, or
- `.mcp.json` with an `atom` server entry (searched upward from script location and from cwd)

`.mcp.json` example:
```json
{
  "mcpServers": {
    "atom": {
      "url": "http://localhost:4200/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

Sample output:
```
[Result]  2 of 6 cards exceed the threshold (300 chars).

    1. compile_subtree option schema  (knowledge)  — 1,285 chars
       node: e2d66d4a-1cff-4272-8fc0-2d0cfee00610
    2. batch_op — atomic multi-operation  (knowledge)  — 413 chars
       node: 160055b6-bb5b-4cfa-bb8c-581504106e12
```

Cards above the threshold are **decomposition candidates**.
If a knowledge card contains multiple concepts, break it into a structure card + child knowledge cards.
The decomposition test is the same as the atomicity principle in `atom-zettelkasten`:
"If I move this card to a different context, does it still make sense on its own?"

### Step 2: Identify problems and propose changes

Analyze the tree for the following issue types.

**Stale entries**
- Completed fixes still sitting in an "Issues" section
- Time-stamped operational snapshots mixed with architectural knowledge
- Information that's no longer valid (code has already changed)

**Misplaced entries**
- Cards that belong in a different project's tree
- Architectural knowledge and operational facts mixed in the same section

**Structural improvements**

The criterion for grouping is meaning, not count.
"Do I see a meaningful unit among these cards?" — YES means group aggressively. NO means leave it alone.
Navigation efficiency is a byproduct of good structure, not a criterion.

Specific structural signals:
- `knowledge → knowledge` parent-child: atomicity violation. Knowledge cards cannot have children.
- Empty structure cards (folders with no children): removal candidates
- Overcrowded structure children: look for meaningful groupings (no numeric threshold — judge by meaning)
- Illogical section ordering (prefer general→specific, architecture→development→operations)

Present the findings to the user with numbered items and wait for confirmation before proceeding.

### Step 3: Execute changes

Cleanup operations fall into two categories, each with the right tool.

#### Structural changes: use `batch_op`

Create structure cards, move items to a different parent, and delete — all atomically in one `batch_op`.

```python
mcp__atom__batch_op(
  creates=[
    {"temp_id": "new-group", "card_type": "structure", "title": "...",
     "parent_node_id": "...", "position": 9000}
  ],
  moves=[
    {"node_id": "...", "parent_temp_id": "new-group", "new_position": 100},
    {"node_id": "...", "new_parent_node_id": "other-tree-id", "new_position": 900}
  ]
)
```

**Avoid position conflicts**: use a high position value (e.g. 9000) for newly created cards.
Reorder to the correct position in the next step.

#### Reordering within the same parent: use `move_node` individually

When reordering children under the same parent, using `batch_op` moves causes
position conflicts (fails after 3 retries). Use individual `move_node` calls instead.

**⚠️ `position` is a raw sort key — not an ordinal index.**

The `position` parameter in `move_node` is the raw value stored in the DB, not "insert at position N".
Existing nodes may have values like 0/1/2 or 100/200/300 or 1000/2000 depending on how they were created.
**Always check actual position values with `list_children` before moving.**

```python
# 1. Check actual position values
children = mcp__atom__list_children(parent_node_id="parent-id")
# → [{"id": "a", "position": 0}, {"id": "b", "position": 300}, {"id": "c", "position": 700}, ...]

# 2. Calculate insertion point: to place between b(300) and c(700), use 500
mcp__atom__move_node(node_id="target", parent_node_id="parent", position=500)
```

To reset the full order, assign positions with even spacing:

```python
# Reset with spacing of 100 — calls can be made in parallel
mcp__atom__move_node(node_id="first",  parent_node_id="parent", position=100)
mcp__atom__move_node(node_id="second", parent_node_id="parent", position=200)
mcp__atom__move_node(node_id="third",  parent_node_id="parent", position=300)
```

### Step 4: Verify results

After cleanup, run `compile_subtree(titles_only=True)` to confirm the final state and show it to the user.
