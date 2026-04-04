---
name: atom-zettelkasten
description: |
  A Zettelkasten methodology guide for writing knowledge cards in the atom MCP system.
  Reference this whenever creating, updating, or structuring cards in atom.
  Use for requests like: "add this to atom", "create a card", "save to atom", "organize my knowledge".
  All skills that write atom cards follow the principles defined here.
---

# atom Zettelkasten Card Writing Guide

## Three Core Principles

### 1. Atomicity — Most Important

One card, one idea. **One sentence is ideal; three sentences maximum.**

The test: *"If I move this card to a completely different tree, does it still make sense on its own?"*

Atomic cards can be relocated and relinked. Overloaded cards get stuck in one context and can't connect to anything else. Atomicity is portability.

### 2. Source Attribution

Every knowledge card **must** have a `source_ref`.

Without a source, the information can never be verified again. A card without a source is an incomplete card.

| Situation | source_ref format |
|-----------|-------------------|
| Web URL | `https://example.com/path` |
| Local document | `file://{absolute-path}` or filename |
| No URL (internal source) | `{source-name}:{identifier}` (e.g. `internal:meeting-2024-03`) |

### 3. In Your Own Words

Never copy-paste from the source. Rewrite it the way you understood it.
It should be readable without any surrounding context — so you never have to dig up the original again.

## Good Cards vs. Bad Cards

### Atomicity

```
❌ Bad: "Project Status"
  content: "Team A is behind schedule. Team B is on track.
            Team C ships this week. Overall progress 42%.
            Main blockers are QA staffing and contractor delays.
            3 more items are incomplete."
→ 5+ ideas mixed together. Can't be linked to anything specifically.

✅ Good: "QA understaffing is the primary blocker for the current release."
  content: "QA understaffing is the primary blocker for the current release."
  source_ref: "https://..."
→ One fact. Linkable to other "blocker" cards.
```

### Source Attribution

```
❌ Bad: (no source_ref)
  content: "Feature A implementation is 40% complete"
→ When was this measured? Where can it be verified?

✅ Good: source_ref: "https://github.com/myorg/myrepo/issues/42"
  content: "Feature A implementation is 40% complete (as of 2024-03-01)"
→ Verifiable at any time.
```

### In Your Own Words

```
❌ Bad: content: "PRD v2 deadline: frontend+backend assembly complete + first QA outsourcing applied"
→ Copy-pasted. Meaningless without context.

✅ Good: content: "The v2 deadline at end of April targets a 'fully playable flow'.
              It's also the first milestone where external QA is involved."
→ Your understanding is captured. Creates context to link with other "milestone" cards.
```

## Card Types

### structure card (`card_type: "structure"`)

Acts as a table of contents, section, or folder. A container for other cards.
Has no content or just a short label. `source_ref` is not required.

```
Examples: "Release Roadmap", "Team Members", "Open Questions"
```

### knowledge card (`card_type: "knowledge"`)

Holds actual knowledge. The atomicity principle applies. `source_ref` is required.

```
Example: "Feature v2 overall progress: 16% (19/117 items) as of D-28"
         source_ref: "https://github.com/myorg/roadmap/issues/10"
```

## atom MCP Tool Reference

### Create a card

```python
mcp__atom__create_card(
    title="Title (≤50 chars, required)",
    content="Content (1–3 sentences)",
    card_type="knowledge",          # or "structure"
    source_ref="https://...",       # required for knowledge cards
    parent_node_id="<node-uuid>",   # where to place it in the tree
    references=["<card-uuid>", ...] # cards to link to
)
```

### Update a card

```python
mcp__atom__update_card(
    card_id="<card-uuid>",
    content="Updated content",
    source_ref="https://...",
    content_timestamp="2024-03-01T10:00:00+00:00"  # ISO format
)
```

### Navigate the tree

```python
# Read an entire subtree as markdown (useful for orientation)
mcp__atom__compile_subtree(node_id="<node-uuid>", depth=3)

# List direct children of a node
mcp__atom__list_children(parent_node_id="<node-uuid>")
```

### Search cards (before creating, to avoid duplicates)

```python
mcp__atom__search_cards(query="search term", limit=10)
```

## Linking Cards

### references — semantic links

"To understand this card, you also need to know that card."
Add UUIDs to the `references` field in `create_card` — bidirectional backlinks are created automatically.

```python
# Link "QA understaffing" card to "v2 release risk" card
mcp__atom__create_card(
    title="QA understaffing is a release blocker",
    content="...",
    references=["<v2 release risk card UUID>"]
)
```

### symlink — same card, multiple contexts

Place a card in multiple tree locations without duplicating it.
One source of truth, many placements — update in one place, reflected everywhere.

```python
mcp__atom__create_symlink(
    card_id="<card UUID>",
    parent_node_id="<target location node UUID>"
)
```

### structure cards — building a table of contents

Group related cards under a structure card and the tree itself becomes a navigable outline.

## Tree Layout Pattern

```
[root structure]
├── [section A structure]    ← label only, no content
│   ├── [knowledge card]     ← one atomic idea + source_ref
│   └── [knowledge card]
└── [section B structure]
    ├── [knowledge card]
    └── [subsection structure]
        └── [knowledge card]
```

Use `mcp__atom__compile_subtree(node_id, depth=3)` to read the full outline at once.
Use `mcp__atom__get_tree()` to find root nodes.

## Update Principles

- When content changes, **update** the card and verify `source_ref` is still current
- Set `content_timestamp` to the current ISO datetime
- Prefer updating over deleting — add `[invalidated YYYY-MM-DD]` to the first line if needed
  - Deleting a card with backlinks breaks the connections

## Workflow Summary

1. `mcp__atom__search_cards` — check for existing cards (avoid duplicates)
2. If none → `mcp__atom__create_card`
3. If found → `mcp__atom__update_card`
4. Link if relevant → add to `references` or call `create_symlink`
5. `mcp__atom__compile_subtree` — verify the result
