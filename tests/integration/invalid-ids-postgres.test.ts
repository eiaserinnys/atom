/**
 * A value that is not a UUID must be a 400 before it reaches PostgreSQL,
 * which would otherwise fail with 22P02 and answer 500.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { batchRoutes } from "../../src/api/routes/batch.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { searchRoutes } from "../../src/api/routes/search.js";
import { treeRoutes } from "../../src/api/routes/tree.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { createCard } from "../../src/services/card.service.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

const KEY = "invalid-ids-postgres-key";
const BAD = "not-a-uuid";
const invalid = (label: string) => `Invalid ${label}: ${BAD} (UUID expected)`;

let app: FastifyInstance;

beforeEach(async () => {
  agentKeyVerifier.clear();
  await insertAgent(getIntegrationTestPool(), { agent_id: "invalid-ids-agent", secret_hash: await bcrypt.hash(KEY, 4), scope: "write" });
  app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("preHandler", async (request) => {
    request.jwtUser = { id: "bypass", email: "bypass@local", name: "Bypass Admin", role: "admin" };
  });
  await app.register(cardRoutes);
  await app.register(treeRoutes);
  await app.register(searchRoutes);
  await app.register(batchRoutes);
  await app.register(cardApiRoutes);
});

afterEach(async () => {
  await app.close();
});

const error = (res: { json(): unknown }) => (res.json() as { error: string }).error;

describe("PostgreSQL never sees a malformed ID", () => {
  it("path IDs on the dashboard and the agent-key routes", async () => {
    const dashboard = await app.inject({ method: "GET", url: `/tree/${BAD}/children` });
    expect([dashboard.statusCode, error(dashboard)]).toEqual([400, invalid("node_id")]);
    const agent = await app.inject({ method: "GET", url: `/api/tree/${BAD}/children`, headers: { "x-api-key": KEY } });
    expect([agent.statusCode, error(agent)]).toEqual([400, invalid("node_id")]);
    const card = await app.inject({ method: "GET", url: `/cards/${BAD}` });
    expect([card.statusCode, error(card)]).toEqual([400, invalid("card_id")]);
  });

  it("search root_node_id and the ID arrays in request bodies", async () => {
    const search = await app.inject({ method: "GET", url: `/search?q=anything&root_node_id=${BAD}` });
    expect([search.statusCode, error(search)]).toEqual([400, invalid("root_node_id")]);

    const { card } = await createCard({ card_type: "knowledge", title: "Postgres body ids", content: "body" });
    const references = await app.inject({ method: "POST", url: "/cards", payload: { title: "refs", references: [BAD] } });
    expect([references.statusCode, error(references)]).toEqual([400, invalid("references[0]")]);
    const contents = await app.inject({ method: "POST", url: "/tree/compile/contents", payload: { card_ids: [card.id, BAD] } });
    expect([contents.statusCode, error(contents)]).toEqual([400, invalid("card_ids[1]")]);
    const batch = await app.inject({
      method: "POST",
      url: "/batch",
      payload: { child_orders: [{ parent_node_id: null, order: [BAD] }] },
    });
    expect([batch.statusCode, error(batch)]).toEqual([400, invalid("child_orders[0].order[0]")]);
  });
});
