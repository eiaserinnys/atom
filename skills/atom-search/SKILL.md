---
name: atom-search
description: |
  How to find knowledge in an atom knowledge base: rewriting search_cards queries until they hit, and drilling down
  the tree with get_tree, compile_subtree, and list_children without flooding your context.
  Use whenever you need to look something up in atom, check whether a card already exists before writing one,
  or answer "what do we know about X?". Read-only: works with a read-scoped agent key.
  Card writing is covered by atom-zettelkasten; reorganizing the tree by atom-tree-cleanup.
---

# Finding Knowledge in atom

There are two ways into an atom tree: **search** (`search_cards`) when you know words that should appear in the card, and **browse** (`get_tree` → `compile_subtree` → `list_children`) when you know roughly where it should live or need a broad overview. Most lookups start with search and fall back to browsing.

Tool names below are the bare MCP tool names; your client may prefix them (Claude Code: `mcp__atom__search_cards` when the server is registered as `atom`).

## Search: rewrite the query before giving up

`search_cards` is lexical full-text search ranked by relevance (BM25-style `ts_rank` on PostgreSQL, FTS on SQLite). A card matches only if it contains your words. Apart from a small built-in set of term expansions in the fallback below, there are no synonyms, so a card about "atomic transactions" is invisible to the query "do several things at once". **A miss usually means the wrong words, not a missing card.**

### Step 1: Try the request as written

```text
search_cards(query="apply several changes at once", limit=10)
```

With the default `strategy="auto"`, a plain query (no `OR`, quotes, or `-`) that returns nothing is retried: first as an OR of its terms when it has four or more, then with the small built-in set of term expansions. `strategy="strict"` turns the retries off. Stop here if the results answer the question.

### Step 2: Extract terms and OR them together

Pull out the technical or domain words the card would actually use, and join variants with `OR`:

```text
search_cards(query="transaction OR atomic OR batch OR bulk", limit=10)
```

- Symptom → mechanism: "the tree view is blank on my phone" → `mobile OR responsive OR layout`
- Paraphrase → term of art: "do it all at once" → `transaction OR batch OR atomic`
- Include spelling variants, singular and plural forms, abbreviations, and the other language if the tree is bilingual.

### Step 3: Move up or down a level of abstraction

- Abstract → concrete: from a goal to the parameter or function that implements it ("hide old entries" → `journal_limit OR limit OR latest`).
- Concrete → abstract: from a tool name to the design idea behind it (`batch_op` → `atomic OR transaction OR rollback`).

### Step 4: Narrow the results

Too many hits, or hits from the wrong context:

- `root_node_id` limits the search to one branch.
- `card_type` (`structure` or `knowledge`), `tags` (cards carrying all listed tags), `source_type`, `updated_after` / `updated_before` filter further.
- Every result carries `node_path`, the titles from the root down to the card's parent (starting at the `root_node_id` branch when you set one). Read it to tell "incident notes" apart from "design notes" without opening each card.

Only after steps 1 to 3 fail should you conclude the knowledge is not in atom. Say which queries you tried.

### Query syntax

| Query | Meaning |
| :--- | :--- |
| `release blocker` | both words (AND) |
| `release OR blocker` | either word |
| `"release blocker"` | exact phrase |
| `release -mobile` | `release`, excluding cards that contain `mobile` |

Keep the rewritten query faithful to the original intent. Expanding "do it all at once" into `concurrency OR threads` drifts from batching to a different topic.

## Browse: progressive disclosure

Use browsing for broad questions ("what do we know about deployment?") and when search keeps missing. Read outlines first and full content only for the branches you need.

1. **Find the roots.** `get_tree()` lists root-level nodes.
2. **Read an outline.** `compile_subtree(node_id, titles_only=true, depth=2)` returns an indented title tree with `[node:… card:…]` IDs and each card's character count. Add `max_chars` to cap a very large outline.
3. **Decide where to open.** Structure cards carry a short description of what their section collects. Read it (with `get_card`, or by compiling that node at `depth=1`) to judge whether the answer is likely inside.
4. **Read content.** `compile_subtree(node_id, depth=1..3)` returns the branch as Markdown with headings per depth. Use `exclude_nodes=[...]` to skip noisy sub-branches, `get_card(card_id)` for a single card, and `list_children(parent_node_id)` for the direct children with their card data.

Things to know while browsing:

- `depth` defaults to 3. `depth=null` compiles the whole branch without a limit; use it only on small branches.
- A node with `journal_limit` shows only its latest N children (the last N in position order) when compiled. Use `list_children` to see all of them.
- Symlinked titles are prefixed with `~`. A branch that would loop back into itself is marked `*(cycle)*` instead of being expanded again.
- `compile_subtree(..., numbering=true)` adds `1`, `1.1`, `1.1.1` numbers, which makes it easy to refer to sections in a plan.

If you have rewritten `search_cards` queries five or more times, switch to browsing: compile two or three likely parent nodes at `depth=2`, scan the outlines, and open only the matching branches.

## Optional engines

These depend on how the atom server is configured.

- `search_cards(query, engine="jev")` asks the Jev service to judge structure descriptions and card contents instead of matching words. It needs `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` on the server, returns 6 results by default, and does not accept the BM25 filters (`tags`, `card_type`, dates, `source_type`, `strategy`).
- `evaluate_cards(query, card_ids)` scores up to 48 candidate cards for relevance (0 to 1) with Jev.
- `get_card_neighbors(card_id)` returns cards with similar embeddings. It needs an OpenAI key configured on the server and works over HTTP MCP only.

## Before creating a card

Run this protocol before every `create_card` to avoid a second card for an idea that already has one. If you find it, update it (see `atom-zettelkasten`).
