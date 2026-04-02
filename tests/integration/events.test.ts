/**
 * Integration tests for atom Event Bus + SSE endpoint.
 *
 * Tests:
 *  - Event emit cases (6): createCard, updateCard, deleteCard, createSymlink,
 *    deleteNode, moveNode each emit the correct AtomEvent.
 *  - SSE HTTP cases (2): GET /events responds with correct SSE headers;
 *    a mutation performed after connecting triggers an SSE message.
 *
 * Requires TEST_DATABASE_URL to point to a running PostgreSQL instance.
 */

import pg from "pg";
import path from "path";
import http from "http";
import Fastify from "fastify";
import { setPool, closePool, runMigrations } from "../../src/db/client.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { eventBus } from "../../src/events/eventBus.js";
import type { AtomEvent } from "../../src/events/eventBus.js";
import { eventsRoutes } from "../../src/api/routes/events.js";

const { Pool } = pg;

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/db/migrations");

let pool: pg.Pool;

// ---------------------------------------------------------------------------
// Test app for SSE HTTP tests
// ---------------------------------------------------------------------------

let testApp: ReturnType<typeof Fastify>;
let testPort: number;

async function buildTestApp(): Promise<void> {
  // GOOGLE_CLIENT_ID unset → authMiddleware bypass mode (all requests pass)
  testApp = Fastify({ logger: false });
  testApp.register(eventsRoutes);
  // Bind to random free port
  await testApp.listen({ port: 0, host: "127.0.0.1" });
  const addr = testApp.server.address();
  testPort = typeof addr === "object" && addr ? addr.port : 0;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

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
  await buildTestApp();
}, 30000);

afterAll(async () => {
  await testApp.close();
  await closePool();
}, 10000);

afterEach(async () => {
  // Delete in FK order: tree_nodes → cards → agents → users
  await pool.query("DELETE FROM tree_nodes");
  await pool.query("DELETE FROM cards");
  await pool.query("DELETE FROM agents");
  await pool.query("DELETE FROM users");
});

// ---------------------------------------------------------------------------
// Helper: capture next event from eventBus
// ---------------------------------------------------------------------------

function nextEvent(timeoutMs = 5000): Promise<AtomEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.off("atom:event", handler);
      reject(new Error("Timed out waiting for atom:event"));
    }, timeoutMs);

    const handler = (event: AtomEvent) => {
      clearTimeout(timer);
      eventBus.off("atom:event", handler);
      resolve(event);
    };

    eventBus.on("atom:event", handler);
  });
}

// ---------------------------------------------------------------------------
// Event emit cases
// ---------------------------------------------------------------------------

describe("Event Bus — emit cases", () => {
  it("createCard emits card:created", async () => {
    const eventPromise = nextEvent();
    const { card, node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "EventBus Card",
      content: "hello",
    });
    const event = await eventPromise;

    expect(event.type).toBe("card:created");
    if (event.type === "card:created") {
      expect(event.cardId).toBe(card.id);
      expect(event.nodeId).toBe(node_id);
      expect(event.parentNodeId).toBeNull();
      expect(event.data.title).toBe("EventBus Card");
    }
  });

  it("updateCard emits card:updated", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "Before",
    });

    const eventPromise = nextEvent();
    await cardService.updateCard(card.id, { title: "After" });
    const event = await eventPromise;

    expect(event.type).toBe("card:updated");
    if (event.type === "card:updated") {
      expect(event.cardId).toBe(card.id);
      expect(event.data.title).toBe("After");
    }
  });

  it("deleteCard emits card:deleted", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge",
      title: "To Delete",
    });

    const eventPromise = nextEvent();
    await cardService.deleteCard(card.id);
    const event = await eventPromise;

    expect(event.type).toBe("card:deleted");
    if (event.type === "card:deleted") {
      expect(event.cardId).toBe(card.id);
    }
  });

  it("createSymlink emits node:created", async () => {
    const { card: cardA, node_id: nodeA } = await cardService.createCard({
      card_type: "structure",
      title: "A",
    });
    const { node_id: nodeB } = await cardService.createCard({
      card_type: "knowledge",
      title: "B",
      parent_node_id: nodeA,
    });

    const eventPromise = nextEvent();
    const symlink = await treeService.createSymlink(cardA.id, nodeB);
    const event = await eventPromise;

    expect(event.type).toBe("node:created");
    if (event.type === "node:created") {
      expect(event.nodeId).toBe(symlink.id);
      expect(event.cardId).toBe(cardA.id);
      expect(event.parentNodeId).toBe(nodeB);
    }
  });

  it("deleteNode emits node:deleted", async () => {
    const { node_id } = await cardService.createCard({
      card_type: "knowledge",
      title: "Node to delete",
    });

    const eventPromise = nextEvent();
    await treeService.deleteNode(node_id);
    const event = await eventPromise;

    expect(event.type).toBe("node:deleted");
    if (event.type === "node:deleted") {
      expect(event.nodeId).toBe(node_id);
    }
  });

  it("moveNode emits node:moved", async () => {
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

    const eventPromise = nextEvent();
    await treeService.moveNode(child, rootB);
    const event = await eventPromise;

    expect(event.type).toBe("node:moved");
    if (event.type === "node:moved") {
      expect(event.nodeId).toBe(child);
      expect(event.newParentNodeId).toBe(rootB);
    }
  });
});

// ---------------------------------------------------------------------------
// SSE HTTP cases
// ---------------------------------------------------------------------------

describe("SSE endpoint — HTTP cases", () => {
  it("GET /events responds with SSE headers", (done) => {
    const req = http.get(
      `http://127.0.0.1:${testPort}/events`,
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(res.headers["cache-control"]).toContain("no-cache");
        req.destroy();
        done();
      }
    );
    req.on("error", done);
  });

  it("SSE delivers mutation event to connected client", (done) => {
    let cardId: string;
    let chunks = "";

    const req = http.get(
      `http://127.0.0.1:${testPort}/events`,
      (res) => {
        res.setEncoding("utf-8");

        res.on("data", (chunk: string) => {
          chunks += chunk;
          if (chunks.includes("card:created")) {
            req.destroy();
          }
        });

        res.on("close", () => {
          try {
            expect(chunks).toContain("card:created");
            expect(chunks).toContain(cardId);
            done();
          } catch (err) {
            done(err);
          }
        });

        // Trigger mutation after SSE connection is established
        setTimeout(async () => {
          try {
            const { card } = await cardService.createCard({
              card_type: "knowledge",
              title: "SSE Test Card",
            });
            cardId = card.id;
          } catch (err) {
            done(err);
          }
        }, 100);
      }
    );

    req.on("error", (err) => {
      // Ignore aborted error from req.destroy()
      if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
        done(err);
      }
    });

    // Safety timeout
    setTimeout(() => {
      req.destroy();
    }, 4000);
  });
});
