---
name: atom-reference-digest
description: |
  Digest external resources (URLs, GitHub repos, PDFs, papers, etc.) into atom using the Zettelkasten method.
  Reads the source → breaks it down into reference > [type] > [source] > [section] > atomic knowledge cards →
  places them in the knowledge tree via symlinks (clustering + grooming) →
  derives insights and suggests them to the user for approval.
  Use for requests like:
  - "digest this PDF", "add this resource to atom", "turn this link into knowledge cards"
  - "summarize this repo", "review this paper and save it"
  - dropping a link with "organize this" or "save to atom"
  If there's a resource and the user seems to want it in atom, proactively invoke this skill.
---

# atom Reference Digest Skill

Read an external resource, break it into a knowledge structure, place it in the atom reference tree,
and link it into the knowledge tree via symlinks.

Card writing principles follow the `atom-zettelkasten` skill.

## Source Type Classification

| Type node | Detection | Fetch method |
|-----------|-----------|--------------|
| Web document | General URL (not github.com), PDF link | `WebFetch` (Claude Code built-in) |
| Git repo | github.com URL | shallow clone + analysis |
| Paper | arxiv.org, PDF file, academic URL | `Read` tool (PDF) or `WebFetch` |

If the type is unclear, ask the user or default to `Web document`.
Add new types to this table as needed.

## Reference Tree Structure

```
Reference [structure]                      ← root (create if missing)
├── Web document [structure]
│   └── {source name} [structure]          ← source root, source_ref = original URL
│       ├── {Section A} [structure]
│       │   ├── {knowledge card} [knowledge]   ← source_ref required
│       │   └── {knowledge card} [knowledge]
│       └── {Section B} [structure]
│           └── {knowledge card} [knowledge]
├── Git repo [structure]
│   └── {repo name} [structure]            ← source_ref = github URL
│       └── ...
└── Paper [structure]
    └── {paper title (year)} [structure]   ← source_ref = paper URL or file path
        └── ...
```

## Workflow

### Step 1: Determine source type and fetch

Fetch according to source type:

**Web document:**
Use the Claude Code built-in `WebFetch` tool. For bot-blocked sites (openai.com, x.com, linkedin.com, etc.)
fall back to other means (search, etc.).

**Git repo:**
```bash
# Use an appropriate temp directory (e.g. /tmp on Linux/macOS, %TEMP% on Windows)
git clone --depth 1 "<REPO_URL>" "{temp directory}/{repo name}"
```
Analyze in order: README → directory structure → key source files.

**Paper (PDF):**
Read directly using the `Read` tool's `pages` parameter. For papers over 10 pages, focus on
key sections only: Abstract, Introduction, Method, Results, Conclusion.

**Report to user after fetching (required):**

After fetching, always report to the user and ask whether additional investigation is needed:

```
I've read {source name}.

Overview: {1–3 sentence summary}
Main sections: {section list}

Let me know if you'd like me to investigate anything further.
Otherwise I'll proceed with the digest.
```

### Step 2: Design section structure (reference tree)

Convert the source's top-level outline into an atom tree structure.
Aim for 3–7 knowledge cards per section; break into subsections if more than 10.

**Check for duplicates:**
```python
mcp__atom__search_cards(query="{source name or key terms}", limit=10)
```
If similar cards already exist, consider updating instead of creating.

**Find or create the reference root:**
```python
mcp__atom__get_tree()                                      # find root nodes
mcp__atom__list_children(parent_node_id="{root ID}")       # look for Reference node
# create if missing
mcp__atom__create_card(title="Reference", card_type="structure", parent_node_id="{root ID}")
# find or create type node (Web document / Git repo / Paper)
mcp__atom__list_children(parent_node_id="{reference node ID}")
```

**Create cards top-down:**
```python
# Source root structure card
mcp__atom__create_card(
    title="{source name}",
    content="{one sentence on what this source is about}",
    card_type="structure",
    source_ref="{original URL or file path}",  # required
    parent_node_id="{type node ID}"
)

# Section structure card
mcp__atom__create_card(
    title="{section title}",
    card_type="structure",
    parent_node_id="{source root node ID}"
)

# Knowledge card (atomic idea, in your own words)
mcp__atom__create_card(
    title="{title summarizing the idea, ≤50 chars}",
    content="{atomic knowledge in your own words, 1–3 sentences}",
    card_type="knowledge",
    source_ref="{original URL}",  # required — must be a clickable URL
    parent_node_id="{section node ID}"
)
```

All knowledge card `source_ref` values must be clickable URLs:
```
✅ https://github.com/foo/bar
✅ https://arxiv.org/abs/2301.00000
❌ (no source_ref)
```

### Step 3: Place in knowledge tree (symlinks + clustering)

This is the heart of Zettelkasten.
This is the moment when reference material becomes a living knowledge network.

**Find or create the knowledge root:**
```python
mcp__atom__list_children(parent_node_id="{root ID}")  # look for knowledge node
# create if missing
mcp__atom__create_card(title="Knowledge", card_type="structure", parent_node_id="{root ID}")
```

For each knowledge card, ask yourself:
> *"Which context in the knowledge tree does this card belong to?"*

**Clustering principles (don't just place blindly):**
- Place in a category where related cards already exist
- Choose a location that connects conceptually with neighboring cards
- Avoid orphan placements; prefer categories with 2+ related cards
- If no suitable category exists, create a new structure card

**⚠️ Never place knowledge cards directly under a structure card without an intermediate structure:**

Knowledge cards (including symlinks) must always be children of a **structure card**.
Placing a knowledge card directly under a category structure card (e.g. "System Design") is not allowed.
Before placing, check the structure card's children with `list_children`;
if there's no sub-structure to hold the knowledge card, create one first.

```python
# ✅ Correct
Knowledge > System Design [structure]
  └── Resident Search Engine Pattern [structure]  ← create first
      └── Bigram inverted index [knowledge/symlink]

# ❌ Not allowed
Knowledge > System Design [structure]
  └── Bigram inverted index [knowledge/symlink]  ← directly under structure
```

**Verify tree structure before placing (required):**

Before adding symlinks, use `compile_subtree` to review the current structure of the target category
and confirm the new cards fit naturally.
If existing cards are scattered or the category feels off, groom first, then add symlinks.

**Tree grooming (before placing):**
- Consolidate scattered related cards under an appropriate parent structure
- Merge sparse sections with adjacent ones
- If duplicate concepts exist under different names, consider consolidating

```python
# Explore target location + verify structure
mcp__atom__compile_subtree(node_id="{related section node}", depth=2)

# Create symlink
mcp__atom__create_symlink(
    card_id="{knowledge card UUID}",
    parent_node_id="{target location node UUID in knowledge tree}"
)
```

**Symlink decision criteria:**
- Could this knowledge directly influence decisions in a different context?
- Would encountering this card while exploring another topic generate insight?
- Is it connected to current work or active areas of interest?

Don't force connections. If there's no natural link, leaving it only in the reference tree is fine.

### Step 4: Derive insights (optional — must propose to user first)

After linking new cards with existing ones, check whether
deductive (known premises → new conclusion) or inductive (individual cases → general rule)
insights emerge.

If an insight exists, **propose it to the user first** and create only after approval:

```
I derived the following insight. Shall I add it to the knowledge tree?

Title: {insight title}
Content: {1–3 sentences including the basis for the derivation}
Connected cards: {card A}, {card B}
Placement: {location in knowledge tree}
```

If the user approves:
```python
mcp__atom__create_card(
    title="{insight title}",
    content="{1–3 sentences in your own words}",
    card_type="knowledge",
    source_ref="{original source of the cards used}"
)
# symlink to the source cards used
```

### Step 5: Completion report

```
Digest complete: {source name} ({type})

Reference tree:
  Reference > {type} > {source name}
    {Section A}: N cards
    {Section B}: N cards

Knowledge tree links:
  - "{card title}" → {linked location}
  - "{card title}" → {linked location}

{if insights}
New insight: "{insight title}" added

Total: N knowledge cards created
```

## Concept: Reference Notes vs. Permanent Notes

| | Reference Note | Permanent Note |
|--|----------------|---------------|
| Role | Records the existence of a source | Records distilled knowledge |
| Content | Source, title, one-sentence topic | Atomic idea in your own words, 1–3 sentences |
| atom type | `structure` card (also serves as section) | `knowledge` card |
| source_ref | The source itself | URL or section within the source |

**Do not create reference notes as separate cards.** The section structure of the source itself serves as the reference note.

## Workflow Summary

1. Fetch source → report overview to user + ask about additional investigation
2. `search_cards` — check for duplicates
3. `get_tree` + `list_children` — find or create reference root and type node
4. Create structure → knowledge cards top-down
5. `compile_subtree` to review target location in knowledge tree → verify structure + groom → ensure structure card exists → `create_symlink`
6. Check for deductive/inductive insights → propose to user → create if approved
7. Completion report
