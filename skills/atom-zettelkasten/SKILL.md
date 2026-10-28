---
name: atom-zettelkasten
description: |
  How to write and update cards in an atom knowledge base so they stay findable, verifiable, and reusable.
  Use whenever you create, update, link, split, or retire atom cards: "add this to atom", "save this as a card",
  "update the card about X", "link these cards", "record what we learned".
  Covers the three Zettelkasten principles (atomicity, source attribution, own words), structure vs. knowledge cards,
  references and symlinks, safe updates with expected_version, and how to retire a card.
  Search for an existing card first (atom-search); restructure whole branches with atom-tree-cleanup.
---

# atom Card Authoring

atom stores knowledge as **cards** (content) placed on **tree nodes** (hierarchy). One card can sit in several places through symlinks, so a card must make sense wherever it lands. This skill is how to write and maintain cards that survive that.

Tool names below are the bare MCP tool names. Your client may prefix them; Claude Code, for example, shows `create_card` as `mcp__atom__create_card` when the server is registered as `atom`. Write tools need an agent key with the `write` scope.

## Before you write: look for the existing card

There should be one card per idea. Search before creating (see the `atom-search` skill for query rewriting):

```text
search_cards(query="release blocker OR QA staffing", limit=10)
```

- An existing card already states the idea → update it instead of creating a near-duplicate.
- An existing card states a related idea → create the new card and add the old one to `references`.
- Nothing found after rewriting the query → create the card.

## Three principles

### 1. Atomicity (most important)

One card holds one idea. One sentence is ideal; three sentences is the limit.

The test: *"If this card were moved to a different branch of the tree, would it still make sense on its own?"* Atomic cards can be relinked and reused; a card that bundles five facts is stuck in the context it was written for.

The title (50 characters max) should state the idea itself, not a topic label. "QA understaffing blocks the v2 release" is a good title; "QA notes" is not.

### 2. Source attribution

Every knowledge card records where its idea came from in `source_ref`, with `source_type` describing the kind of source. A card without a source cannot be re-verified and should be treated as unfinished.

| Situation | `source_ref` | `source_type` |
| :--- | :--- | :--- |
| Web page, issue, PR, paper | `https://...` | `web`, `github`, `paper` |
| Local file | `file:///abs/path` or a repo-relative path | `file` |
| Commit | `https://github.com/org/repo/commit/<sha>` | `git` |
| No URL (meeting, chat, internal tool) | `{system}:{identifier}`, e.g. `slack:C0123/1712345678.000100` | the system name |
| Your own conclusion from other cards | the source cards' references plus a short note | `derived` |

For facts that change over time (status, counts, versions), put the observation date in the content ("as of 2026-03-01") or set `content_timestamp` to when the fact was true.

### 3. In your own words

Do not paste the source. Rewrite the idea as you understood it, with enough context that a reader never has to reopen the original to know what it means.

## Good and bad cards

```text
Bad (not atomic)   title: "Project status"
                   content: "Team A is late. Team B is on track. Progress 42%. QA staffing and
                             contractor delays are the blockers. Three items remain."
Good               title: "QA understaffing blocks the v2 release"
                   content: "QA understaffing is the main blocker for the v2 release; feature work is done."
                   source_ref: "https://github.com/acme/app/issues/42"

Bad (no source)    content: "Feature A is 40% complete"        (measured when? by whom?)
Good               content: "Feature A was 40% complete as of 2026-03-01 (19 of 47 tasks)."
                   source_ref: "https://github.com/acme/app/milestone/7"

Bad (copied)       content: "PRD v2 deadline: FE+BE assembly done + first external QA applied"
Good               content: "The v2 deadline targets a fully playable flow, and it is the first
                             milestone that involves external QA."
```

## Card types

### `knowledge` cards

Hold one atomic idea with a `source_ref`. A knowledge card never has children. If you find yourself wanting to put cards under a knowledge card, the parent is really a section and should be a structure card.

### `structure` cards

Act as sections or folders. They organize the tree and usually need no `source_ref` (an exception: a structure card that stands for a whole source, such as a paper, carries that source's URL).

The **content of a structure card is a short description of what the section is and when to open it.** Agents decide whether to descend into a branch from this description, and atom's optional Jev search judges structure cards from roughly the first 200 characters of it. Put the nature and role in the first sentence.

- Describe the section's essence, not its children. Listing child titles or topics in the description works today and goes stale with the next card added.
- If a section is an open-ended collection, say so: "Notes from articles and talks I found useful. Topics are not restricted."
- If a section is narrow, state the limit: "Rules for reorganizing this tree. Open only when moving or grooming cards, not for looking up facts."
- A structure card with an empty description is hard for agents to choose, however good the cards under it are.

## Creating cards

Place each card under the structure card whose description matches it. Avoid creating cards at the root; if no section fits, create the section (with a description) first.

```text
create_card(
  card_type="knowledge",
  title="QA understaffing blocks the v2 release",       # ≤ 50 chars
  content="QA understaffing is the main blocker for the v2 release; feature work is done.",
  source_type="github",
  source_ref="https://github.com/acme/app/issues/42",
  parent_node_id="<section node_id>",
  tags=["release", "qa"],                               # optional
  references=["<related card_id>"]                      # optional
)
```

- **Omit `position`.** The card is appended as the last child. `position` is an internal sort key, not "insert as the Nth child", and a guessed value can collide with existing siblings. To put the card somewhere specific, create it first, then `move_node(node_id=..., before=<sibling node_id>)` or `after=`/`to="start"`.
- `create_card` returns the new card together with its `node_id`. Keep both: card tools take `card_id`, tree tools take `node_id`.
- Creating under a symlink node writes the card under that card's canonical node.
- To create a section and its cards in one step, use `batch_op` with `temp_id`/`parent_temp_id`; if any item fails, nothing is written:

```text
batch_op(creates=[
  {"temp_id": "s1", "card_type": "structure", "title": "Release risks",
   "content": "Known risks to upcoming releases and what they block.", "parent_node_id": "<node_id>"},
  {"temp_id": "k1", "card_type": "knowledge", "title": "QA understaffing blocks the v2 release",
   "content": "...", "source_ref": "https://...", "parent_temp_id": "s1"}
])
```

## Linking cards

### `references`: "to understand this card, read that one too"

Store related card UUIDs in `references`; `get_backlinks(card_id)` finds every card that references a given card. `update_card(references=[...])` **replaces the whole array**, so read the card first and send the merged list.

### Symlinks: "this card also belongs in that context"

`create_symlink(card_id, parent_node_id)` places an existing card under another parent without copying it. Edits to the card show up in every placement. A symlink to a structure card shows the canonical node's children, and `compile_subtree` marks symlinked titles with `~`.

Never copy a card's content into a second card to make it appear elsewhere; two copies drift apart.

| You want to say | Use |
| :--- | :--- |
| "This idea depends on that idea" | `references` |
| "This card belongs in that section as well" | `create_symlink` |
| "These cards form a topic" | a `structure` card that groups them |

## Updating cards

1. Read the current card: `get_card(card_id)` returns its fields and `version`.
2. Write with optimistic locking: `update_card(card_id, content=..., expected_version=<version>)`. If another agent changed the card in between, you get a `VersionConflict`; re-read, merge, and retry instead of overwriting.
3. Only the fields you pass are changed. Changing `content` sets `content_timestamp` to now; pass `content_timestamp` yourself when the fact describes an earlier moment.
4. When the content changes, check that `source_ref` still points to where the new content came from.

`card_type` cannot be changed by `update_card`. To split a card that grew beyond one idea, create a structure card in its place, write the atomic knowledge cards under it, and retire the original.

## Retiring a card

Prefer correcting a card to deleting it.

- If the fact is now wrong and the old value has no further use, update the card to the current fact.
- If the history matters, keep the card and start the content with `[Invalidated YYYY-MM-DD] <why, and which card replaces it>`.
- Check `get_backlinks(card_id)` first. Deleting a referenced card leaves other cards pointing at a card that no longer exists.

Deletion is destructive and reaches beyond the card: `delete_card` removes the card from every placement and also deletes the subtree under it, including descendant cards that are not placed anywhere else. To remove only one placement (for example a symlink), use `delete_node` on that node. The `atom-tree-cleanup` skill covers deleting sections safely.

## Workflow summary

1. `search_cards` for an existing card; update it if it already holds the idea.
2. Find the section whose description fits (`compile_subtree(titles_only=true)`); create the section with a description if none fits.
3. `create_card` with one idea, your own words, `source_ref`, and no `position`.
4. Link with `references` or `create_symlink`.
5. Confirm with `compile_subtree(node_id=<section>, depth=1)` that the card sits where you meant.
