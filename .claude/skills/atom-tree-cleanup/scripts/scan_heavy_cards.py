"""
Scan an atom tree for cards with long content.

Usage:
    python .claude/skills/atom-tree-cleanup/scripts/scan_heavy_cards.py <node_id> [--threshold 300] [--depth 10]

Output:
    Cards whose content length exceeds the threshold, sorted by length descending.
    Shows node_id, title, content length, and card type.

Configuration (priority order):
    1. Environment variables: ATOM_BASE_URL, ATOM_API_KEY
    2. .mcp.json (searched upward from script location, then from cwd)

Expected .mcp.json structure:
    {
      "mcpServers": {
        "atom": {
          "url": "http://localhost:4200/mcp",
          "headers": { "x-api-key": "your-api-key" }
        }
      }
    }
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path


def _find_mcp_json(*search_roots: Path) -> Path | None:
    """Search upward from each root for .mcp.json. Returns the first found."""
    for start in search_roots:
        current = start
        for _ in range(10):
            candidate = current / ".mcp.json"
            if candidate.exists():
                return candidate
            parent = current.parent
            if parent == current:
                break
            current = parent
    return None


def load_atom_config() -> tuple[str, str]:
    """Load atom base_url and api_key.

    Priority:
    1. Environment variables ATOM_BASE_URL, ATOM_API_KEY
    2. .mcp.json (searched upward from script directory, then from cwd)
    """
    import os

    base_url = os.environ.get("ATOM_BASE_URL", "")
    api_key = os.environ.get("ATOM_API_KEY", "")
    if base_url and api_key:
        return base_url.rstrip("/"), api_key

    candidate = _find_mcp_json(
        Path(__file__).resolve().parent,  # from script directory upward
        Path.cwd(),                        # from current working directory upward
    )
    if candidate is None:
        raise RuntimeError(
            "Could not find .mcp.json. "
            "Either set ATOM_BASE_URL and ATOM_API_KEY environment variables, "
            "or place .mcp.json in your project root with an 'atom' MCP server entry.\n"
            "Expected structure:\n"
            '  { "mcpServers": { "atom": { "url": "http://...", "headers": { "x-api-key": "..." } } } }'
        )

    with open(candidate, encoding="utf-8") as f:
        mcp_config = json.load(f)

    atom_server = mcp_config.get("mcpServers", {}).get("atom", {})
    if not atom_server:
        raise RuntimeError(f"No 'atom' MCP server entry found in {candidate}")

    raw_url: str = atom_server.get("url", "")
    # Strip /mcp suffix to get the base URL (e.g. http://localhost:4200/mcp → http://localhost:4200)
    if raw_url.endswith("/mcp"):
        base_url = raw_url[: -len("/mcp")]
    else:
        base_url = raw_url.rstrip("/")

    headers = atom_server.get("headers", {})
    api_key = headers.get("x-api-key", "")
    if not api_key:
        raise RuntimeError(f"No 'x-api-key' header found in atom server config in {candidate}")

    return base_url, api_key


def get_children(base_url: str, api_key: str, node_id: str) -> list[dict]:
    """Return the direct children of a node."""
    url = f"{base_url}/api/tree/{node_id}/children"
    req = urllib.request.Request(
        url,
        headers={"x-api-key": api_key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  ⚠  HTTP {e.code} — {node_id}: {e.reason}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  ⚠  Request failed — {node_id}: {e}", file=sys.stderr)
        return []


def scan(
    base_url: str,
    api_key: str,
    node_id: str,
    threshold: int,
    max_depth: int,
    current_depth: int = 0,
) -> tuple[list[dict], int]:
    """Recursively scan node_id and return (heavy_cards, total_card_count).

    heavy_cards: cards whose content length >= threshold
    total_card_count: total number of cards visited (for summary output)
    """
    if current_depth >= max_depth:
        return [], 0

    children = get_children(base_url, api_key, node_id)
    heavy: list[dict] = []
    total = len(children)

    for child in children:
        card = child.get("card", {})
        content: str = card.get("content") or ""
        content_len = len(content)
        card_type: str = card.get("card_type", "unknown")
        title: str = card.get("title", "(no title)")
        child_node_id: str = child.get("id", "")

        if content_len >= threshold:
            heavy.append(
                {
                    "node_id": child_node_id,
                    "title": title,
                    "card_type": card_type,
                    "chars": content_len,
                }
            )

        child_heavy, child_total = scan(
            base_url, api_key, child_node_id, threshold, max_depth, current_depth + 1
        )
        heavy.extend(child_heavy)
        total += child_total

    return heavy, total


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan an atom subtree for cards with long content (decomposition candidates)."
    )
    parser.add_argument("node_id", help="Root node ID to scan")
    parser.add_argument(
        "--threshold",
        type=int,
        default=300,
        help=(
            "Content length threshold in characters (default: 300). "
            "Cards exceeding this are flagged as decomposition candidates — "
            "a knowledge card should ideally hold 1–3 sentences (~300 chars)."
        ),
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=10,
        help="Maximum traversal depth (default: 10)",
    )
    args = parser.parse_args()

    try:
        base_url, api_key = load_atom_config()
    except RuntimeError as e:
        print(f"❌ Config error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[Scanning] node_id={args.node_id}  threshold={args.threshold} chars  depth={args.depth}")

    heavy_cards, total_checked = scan(base_url, api_key, args.node_id, args.threshold, args.depth)
    heavy_cards.sort(key=lambda c: c["chars"], reverse=True)

    print(
        f"\n[Result]  {len(heavy_cards)} of {total_checked} cards exceed "
        f"the threshold ({args.threshold} chars).\n"
    )

    if not heavy_cards:
        print("  (no cards exceed the threshold)")
        return

    for i, entry in enumerate(heavy_cards, 1):
        print(f"  {i:>3}. {entry['title']}  ({entry['card_type']})  — {entry['chars']:,} chars")
        print(f"       node: {entry['node_id']}")


if __name__ == "__main__":
    main()
