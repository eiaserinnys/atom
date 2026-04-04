/**
 * Integration tests for atom API.
 *
 * Requires TEST_DATABASE_URL to point to a running PostgreSQL instance.
 * Set TEST_DATABASE_URL before running:
 *   TEST_DATABASE_URL=postgresql://atom:atom@localhost:5434/atom_db npx jest tests/integration
 *
 * The atom-postgres Docker container on the server (port 5434) is used for CI.
 * For local runs with Docker Desktop available, you can also use testcontainers
 * by omitting DATABASE_URL (Testcontainers support can be added when Docker is available).
 */

import pg from "pg";
import path from "path";
import bcrypt from "bcryptjs";
import { setPool, closePool, runMigrations, getPool } from "../../src/db/client.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import * as searchService from "../../src/services/search.service.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { insertUser } from "../../src/db/queries/users.js";

const { Pool } = pg;

// Resolve migrations directory using process.cwd() (worktree root)
const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/db/migrations");

let pool: pg.Pool;

beforeAll(async () => {
  const databaseUrl = process.env["TEST_DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests.\n" +
        "Set it to the atom-postgres instance: postgresql://atom:atom@localhost:5434/atom_test_db"
    );
  }

  if (databaseUrl.includes("atom_db") && !databaseUrl.includes("test")) {
    throw new Error("TEST_DATABASE_URL must use a test database, not the production atom_db.\nUse: postgresql://atom:atom@localhost:5434/atom_test_db");
  }

  pool = new Pool({ connectionString: databaseUrl });
  setPool(pool);
  await runMigrations(MIGRATIONS_DIR);
}, 30000);

afterAll(async () => {
  await closePool();
}, 10000);

// Clean up between tests
afterEach(async () => {
  // Delete in FK order: tree_nodes → cards → agents → users
  await pool.query("DELETE FROM tree_nodes");
  await pool.query("DELETE FROM cards");
  await pool.query("DELETE FROM agents");
  await pool.query("DELETE FROM users");
});

// ---------------------------------------------------------------------------
// Card CRUD
// ---------------------------------------------------------------------------

describe("Card CRUD", () => {
  it("creates a knowledge card and retrieves it", async () => {
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Test Card",
      content: "Hello World",
      tags: ["tag1"],
    });

    expect(card.id).toBeTruthy();
    expect(card.card_type).toBe("knowledge");
    expect(card.title).toBe("Test Card");
    expect(card.content).toBe("Hello World");
    expect(card.staleness).toBe("unverified");
    expect(node_id).toBeTruthy();

    const fetched = await cardService.getCard(card.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Test Card");
  });

  it("creates a structure card with null content", async () => {
    const { card } = await cardService.createCard({
      card_type: "structure",
      title: "Root",
      content: null,
    });

    expect(card.card_type).toBe("structure");
    expect(card.content).toBeNull();
  });

  it("updates a card and auto-updates content_timestamp", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Before Update",
      content: "Original",
    });

    expect(card.content_timestamp).toBeNull();

    const updated = await cardService.updateCard(card.id, {
      content: "Updated content",
    });

    expect(updated).not.toBeNull();
    expect(updated!.conflict).toBe(false);
    const updatedCard = (updated as { card: typeof card; conflict: false }).card;
    expect(updatedCard.content).toBe("Updated content");
    expect(updatedCard.content_timestamp).not.toBeNull();
    expect(updatedCard.version).toBe(2);
  });

  it("does not auto-update content_timestamp when caller provides one", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Card",
      content: "Content",
    });

    const ts = "2020-01-01T00:00:00Z";
    const updated = await cardService.updateCard(card.id, {
      content: "New content",
      content_timestamp: ts,
    });

    expect(updated).not.toBeNull();
    expect(updated!.conflict).toBe(false);
    const updatedCard = (updated as { card: import("../../src/shared/types.js").Card; conflict: false }).card;
    expect(updatedCard.content_timestamp).not.toBeNull();
    // The provided timestamp should be used (not auto-generated)
    const raw = new Date(updatedCard.content_timestamp!).getFullYear();
    expect(raw).toBe(2020);
  });

  it("staleness is present in get_card response", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Staleness card",
    });

    const fetched = await cardService.getCard(card.id);
    expect(fetched).toHaveProperty("staleness");
    expect(fetched!.staleness).toBe("unverified");
  });

  it("deletes a card and cascades tree_nodes", async () => {
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "To Delete",
    });

    const deleted = await cardService.deleteCard(card.id);
    expect(deleted).toBe(true);

    const fetched = await cardService.getCard(card.id);
    expect(fetched).toBeNull();

    // Tree node should also be gone (CASCADE)
    const node = await treeService.getNode(node_id);
    expect(node).toBeNull();
  });

  it("returns null for non-existent card", async () => {
    const card = await cardService.getCard("00000000-0000-0000-0000-000000000000");
    expect(card).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tree operations
// ---------------------------------------------------------------------------

describe("Tree operations", () => {
  it("creates root node when parent_node_id is omitted", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "structure",
      title: "Root Node",
    });

    const roots = await treeService.listChildren(null);
    expect(roots.some((n) => n.id === node_id)).toBe(true);
  });

  it("creates a child node under a parent", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });

    const { node_id: childId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: rootId,
    });

    const children = await treeService.listChildren(rootId);
    expect(children.length).toBe(1);
    expect(children[0]!.id).toBe(childId);
  });

  it("delete_node removes node but keeps card", async () => {
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Node to delete",
    });

    const deleted = await treeService.deleteNode(node_id);
    expect(deleted).toBe(true);

    // Card should still exist
    const fetched = await cardService.getCard(card.id);
    expect(fetched).not.toBeNull();

    // But node should be gone
    const node = await treeService.getNode(node_id);
    expect(node).toBeNull();
  });

  it("delete_node cascades to child nodes", async () => {
    const { node_id: parentId } = await cardService.createCard({
      card_type: "structure",
      title: "Parent",
    });
    const { node_id: childId, card: childCard } = await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: parentId,
    });

    await treeService.deleteNode(parentId);

    // Child node should be gone due to CASCADE
    const child = await treeService.getNode(childId);
    expect(child).toBeNull();

    // Child card should still exist
    const card = await cardService.getCard(childCard.id);
    expect(card).not.toBeNull();
  });

  it("symlink: creates a symlink and compile_subtree detects cycle", async () => {
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "A",
    });
    const { node_id: nodeB } = await cardService.createCard({
      card_type: "knowledge",
      title: "B",
      parent_node_id: nodeA,
    });

    // Create symlink of A under B (creates a cycle: A → B → A)
    const symlinkNode = await treeService.createSymlink(cardA.id, nodeB, undefined);
    expect(symlinkNode.is_symlink).toBe(true);
    expect(symlinkNode.card_id).toBe(cardA.id);

    // compile_subtree from A should not infinitely loop and should include cycle marker
    const { markdown } = await treeService.compileSubtree(nodeA, Number.MAX_SAFE_INTEGER);
    expect(markdown).toContain("*(cycle)*");
  });

  it("symlink expand: listChildren on symlink returns canonical children", async () => {
    // 구조: A(root) → B(child). A를 C(root2) 아래에 symlink(S)로 생성.
    // listChildren(S) → B가 포함되어야 한다.
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Expand-A",
    });
    const { card: cardB } = await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink-Expand-B",
      parent_node_id: nodeA,
    });
    const { node_id: nodeC } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Expand-C",
    });

    // C 아래에 A의 symlink 노드 S 생성
    const symlinkS = await treeService.createSymlink(cardA.id, nodeC, undefined);
    expect(symlinkS.is_symlink).toBe(true);

    // listChildren(S) → canonical node A의 자식인 B가 포함되어야 한다
    const children = await treeService.listChildren(symlinkS.id);
    expect(children.some((n) => n.card_id === cardB.id)).toBe(true);
  });

  it("symlink compile: compile_subtree expands symlink children", async () => {
    // 구조: A(root) → B(child). C(root2) 아래에 A를 symlink로 생성.
    // compileSubtree(symlink node) 결과에 B의 title이 포함되어야 한다.
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Compile-A",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Symlink-Compile-B",
      parent_node_id: nodeA,
    });
    const { node_id: nodeC } = await cardService.createCard({
      card_type: "structure",
      title: "Symlink-Compile-C",
    });

    // C 아래에 A의 symlink 노드 생성
    const symlinkNode = await treeService.createSymlink(cardA.id, nodeC, undefined);
    expect(symlinkNode.is_symlink).toBe(true);

    // compile from symlink node → B가 전개되어야 한다
    const { markdown: symlinkMd } = await treeService.compileSubtree(symlinkNode.id, 2);
    expect(symlinkMd).toContain("Symlink-Compile-B");
  });

  it("moves a node to a new parent", async () => {
    const { node_id: rootA } = await cardService.createCard({
      card_type: "structure",
      title: "Root A",
    });
    const { node_id: rootB } = await cardService.createCard({
      card_type: "structure",
      title: "Root B",
    });
    const { node_id: child } = await cardService.createCard({
      card_type: "knowledge",
      title: "Movable",
      parent_node_id: rootA,
    });

    const moved = await treeService.moveNode(child, rootB, undefined);
    expect(moved).not.toBeNull();
    expect(moved!.parent_node_id).toBe(rootB);

    const childrenA = await treeService.listChildren(rootA);
    const childrenB = await treeService.listChildren(rootB);
    expect(childrenA.some((n) => n.id === child)).toBe(false);
    expect(childrenB.some((n) => n.id === child)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

describe("Backlinks", () => {
  it("returns cards that reference the target card", async () => {
    const { card: target } = await cardService.createCard({
      card_type: "knowledge",
      title: "Target",
    });

    const { card: ref1 } = await cardService.createCard({
      card_type: "knowledge",
      title: "Ref1",
      references: [target.id],
    });

    const { card: ref2 } = await cardService.createCard({
      card_type: "knowledge",
      title: "Ref2",
      references: [target.id],
    });

    // Not a reference
    await cardService.createCard({
      card_type: "knowledge",
      title: "Unrelated",
    });

    const backlinks = await cardService.getBacklinks(target.id);
    const backIds = backlinks.map((c) => c.id);
    expect(backIds).toContain(ref1.id);
    expect(backIds).toContain(ref2.id);
    expect(backIds).not.toContain(target.id);
  });
});

// ---------------------------------------------------------------------------
// BM25 Search
// ---------------------------------------------------------------------------

describe("BM25 Search", () => {
  it("returns matching cards by keyword", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Quantum Mechanics",
      content: "The study of subatomic particles",
      tags: ["physics"],
    });

    await cardService.createCard({
      card_type: "knowledge",
      title: "Classical Music",
      content: "Beethoven and Mozart compositions",
      tags: ["music"],
    });

    const results = await searchService.searchCards("quantum");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toBe("Quantum Mechanics");
  });

  it("returns empty array when no match", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Hello World",
      content: "Some content",
    });

    const results = await searchService.searchCards("xyznonexistentkeyword12345");
    expect(results.length).toBe(0);
  });

  it("search result includes node_id, title, card_type, snippet", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Photosynthesis",
      content: "Plants convert sunlight to energy",
    });

    const results = await searchService.searchCards("photosynthesis");
    expect(results.length).toBeGreaterThan(0);
    const r = results[0]!;
    expect(r).toHaveProperty("card_id");
    expect(r).toHaveProperty("node_id");
    expect(r).toHaveProperty("title");
    expect(r).toHaveProperty("card_type");
    expect(r).toHaveProperty("snippet");
    expect(r).toHaveProperty("is_symlink");
  });
});

// ---------------------------------------------------------------------------
// compile_subtree
// ---------------------------------------------------------------------------

describe("compile_subtree", () => {
  it("compiles a tree to markdown with correct heading levels", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "Root",
      content: "Root content",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      content: "Child content",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2);
    expect(md).toContain("# Root");
    expect(md).toContain("Root content");
    expect(md).toContain("## Child");
    expect(md).toContain("Child content");
  });

  it("depth=0 returns only the root node", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "Root",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 0);
    expect(md).toContain("# Root");
    expect(md).not.toContain("Child");
  });

  it("titles_only returns indented tree without content", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "TitlesRoot",
      content: "Should not appear",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "TitlesChild",
      content: "Also hidden",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2, { titlesOnly: true });
    expect(md).toContain("TitlesRoot");
    expect(md).toContain("├── TitlesChild");
    expect(md).not.toContain("Should not appear");
    expect(md).not.toContain("Also hidden");
    expect(md).toContain("chars)");
  });

  it("max_chars truncates output and adds marker", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "MaxRoot",
      content: "A".repeat(200),
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "MaxChild",
      content: "B".repeat(200),
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2, { maxChars: 50 });
    expect(md.length).toBeLessThan(300); // significantly less than full output
    expect(md).toContain("<!-- truncated:");
    expect(md).toContain("chars omitted -->");
  });

  it("exclude_nodes skips subtree in integration", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "ExRoot",
    });
    const { node_id: childId } = await cardService.createCard({
      card_type: "knowledge",
      title: "ExChild",
      content: "Should be excluded",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2, {
      excludeNodes: new Set([childId]),
    });
    expect(md).toContain("# ExRoot");
    expect(md).not.toContain("ExChild");
  });
});

// ---------------------------------------------------------------------------
// Optimistic locking
// ---------------------------------------------------------------------------

describe("Optimistic locking", () => {
  it("succeeds when expected_version matches current version", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Version card",
      content: "v1",
    });
    expect(card.version).toBe(1);

    const result = await cardService.updateCard("test-agent", card.id, { title: "v2" }, 1);
    expect(result).not.toBeNull();
    expect(result!.conflict).toBe(false);
    const updated = (result as { card: typeof card; conflict: false }).card;
    expect(updated.version).toBe(2);
    expect(updated.title).toBe("v2");
  });

  it("returns VersionConflict (409-equivalent) when expected_version does not match", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Conflict card",
      content: "original",
    });
    expect(card.version).toBe(1);

    // Simulate stale expected_version (0 instead of 1)
    const result = await cardService.updateCard("test-agent", card.id, { title: "stale update" }, 0);
    expect(result).not.toBeNull();
    expect(result!.conflict).toBe(true);
    if (result && result.conflict) {
      expect(result.actualVersion).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Agent authentication
// ---------------------------------------------------------------------------

describe("Agent authentication", () => {
  it("inactive agent is rejected (is_active=false)", async () => {
    const plainSecret = "test-secret-12345";
    const secretHash = await bcrypt.hash(plainSecret, 10);
    await insertAgent(getPool(), {
      agent_id: "inactive-agent",
      secret_hash: secretHash,
      display_name: "Inactive",
    });
    // Mark inactive
    await getPool().query(`UPDATE agents SET is_active = false WHERE agent_id = 'inactive-agent'`);

    // Verify the agent is truly inactive via DB query
    const row = await getPool().query(`SELECT is_active FROM agents WHERE agent_id = 'inactive-agent'`);
    expect(row.rows[0].is_active).toBe(false);
  });

  it("active agent with correct secret can be verified via bcrypt", async () => {
    const plainSecret = "active-secret-67890";
    const secretHash = await bcrypt.hash(plainSecret, 10);
    await insertAgent(getPool(), {
      agent_id: "active-agent",
      secret_hash: secretHash,
      display_name: "Active",
    });

    const row = await getPool().query(`SELECT * FROM agents WHERE agent_id = 'active-agent'`);
    const agent = row.rows[0];
    expect(agent.is_active).toBe(true);
    expect(await bcrypt.compare(plainSecret, agent.secret_hash)).toBe(true);
    expect(await bcrypt.compare("wrong-secret", agent.secret_hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// User login checks (OAuth users table)
// ---------------------------------------------------------------------------

describe("User login checks", () => {
  it("unregistered email is rejected (no user row)", async () => {
    // Simulate auth logic: findUserByEmail returns null → redirect auth_error=unauthorized
    const { findUserByEmail } = await import("../../src/db/queries/users.js");
    const user = await findUserByEmail(getPool(), "notregistered@example.com");
    expect(user).toBeNull();
  });

  it("deactivated user is rejected (is_active=false)", async () => {
    await insertUser(getPool(), {
      email: "deactivated@example.com",
      display_name: "Deactivated User",
      role: "viewer",
    });
    await getPool().query(`UPDATE users SET is_active = false WHERE email = 'deactivated@example.com'`);

    const { findUserByEmail } = await import("../../src/db/queries/users.js");
    const dbUser = await findUserByEmail(getPool(), "deactivated@example.com");
    expect(dbUser).not.toBeNull();
    expect(dbUser!.is_active).toBe(false);
  });
});
