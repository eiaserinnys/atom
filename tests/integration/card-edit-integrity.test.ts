import Fastify, { type FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cardRoutes } from "../../src/api/routes/cards.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { createCard, getCard } from "../../src/services/card.service.js";
import { registerCardTools } from "../../src/mcp/tools/card_tools.js";
import { getIntegrationTestPool, setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

let app: FastifyInstance;
let client: Client;
let server: McpServer;
const secret = "card-edit-integrity-test-key";

beforeEach(async () => {
  agentKeyVerifier.clear();
  await insertAgent(getIntegrationTestPool(), {
    agent_id: "edit-integrity", secret_hash: await bcrypt.hash(secret, 4),
  });
  app = Fastify({ logger: false });
  await app.register(cardRoutes);
  await app.register(cardApiRoutes);
  server = new McpServer({ name: "edit-integrity", version: "1" });
  registerCardTools(server, "edit-integrity");
  client = new Client({ name: "edit-integrity-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await server.close();
  await app.close();
});

describe.each(["browser PUT", "agent PATCH", "MCP update_card"])("%s edit version contract", (entry) => {
  it("rejects stale writes, accepts the current version and keeps unversioned writes compatible", async () => {
    const { card } = await createCard({ card_type: "knowledge", title: "Versioned card", content: "original" });
    const update = async (content: string, expected_version?: number) => {
      const fields = { content, ...(expected_version === undefined ? {} : { expected_version }) };
      if (entry === "MCP update_card") {
        return { kind: "mcp" as const, result: await client.callTool({ name: "update_card", arguments: { card_id: card.id, ...fields } }) };
      }
      return { kind: "http" as const, result: await app.inject({
        method: entry === "browser PUT" ? "PUT" : "PATCH",
        url: entry === "browser PUT" ? `/cards/${card.id}` : `/api/cards/${card.id}`,
        headers: { "x-api-key": secret }, payload: fields,
      }) };
    };

    const first = await update("fresh", 1);
    if (first.kind === "http") expect(first.result.statusCode).toBe(200);
    else expect(first.result.isError).not.toBe(true);
    expect((await getCard(card.id))?.version).toBe(2);

    const stale = await update("stale", 1);
    if (stale.kind === "http") {
      expect(stale.result.statusCode).toBe(409);
      expect(stale.result.json()).toEqual({ error: "VERSION_CONFLICT", current_version: 2 });
    } else {
      expect(stale.result.isError).toBe(true);
      expect(stale.result.content).toEqual([{ type: "text", text: `VersionConflict: card ${card.id} expected version 1, actual 2` }]);
    }
    expect(await getCard(card.id)).toMatchObject({ content: "fresh", version: 2 });

    const unversioned = await update("legacy overwrite");
    if (unversioned.kind === "http") expect(unversioned.result.statusCode).toBe(200);
    else expect(unversioned.result.isError).not.toBe(true);
    expect(await getCard(card.id)).toMatchObject({ content: "legacy overwrite", version: 3 });
  });
});
