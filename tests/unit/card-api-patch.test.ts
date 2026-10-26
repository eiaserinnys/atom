import Fastify from "fastify";
import { jest } from "@jest/globals";

import { agentKeyVerifier } from "../../src/api/agent-key-auth.js";
import { cardApiRoutes } from "../../src/api/routes/card_api.js";
import type { Agent } from "../../src/db/queries/agents.js";

describe("card API patch input", () => {
  it("rejects retired fields with HTTP 400", async () => {
    const verifySpy = jest.spyOn(agentKeyVerifier, "verify").mockResolvedValue({
      id: "agent-row",
      agent_id: "test-agent",
      secret_hash: "hash",
      display_name: null,
      is_active: true,
      created_by: null,
      created_at: "2026-01-01T00:00:00.000Z",
    } as Agent);
    const app = Fastify({ logger: false });

    try {
      await app.register(cardApiRoutes);
      const response = await app.inject({
        method: "PATCH",
        url: "/api/cards/550e8400-e29b-41d4-a716-446655440000",
        headers: { "x-api-key": "test-key" },
        payload: { ["stale" + "ness"]: "stale" },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      verifySpy.mockRestore();
      await app.close();
    }
  });
});
