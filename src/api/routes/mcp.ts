import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerCardTools } from "../../mcp/tools/card_tools.js";
import { registerTreeTools } from "../../mcp/tools/tree_tools.js";
import { registerSearchTools } from "../../mcp/tools/search_tools.js";
import { registerBatchTools } from "../../mcp/tools/batch_tools.js";
import { findActiveAgents } from "../../db/queries/agents.js";
import { getPool } from "../../db/client.js";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    const secret = request.headers['x-api-key'] as string | undefined;
    if (!secret) {
      return reply.status(401).send({ error: 'Unauthorized: x-api-key header required' });
    }

    const agents = await findActiveAgents(getPool());
    const agent = (await Promise.all(
      agents.map(async (a) => (await bcrypt.compare(secret, a.secret_hash)) ? a : null)
    )).find(Boolean) ?? null;

    if (!agent) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const server = new McpServer({ name: "atom", version: "0.1.0" });
    registerCardTools(server, agent.agent_id);
    registerTreeTools(server, agent.agent_id);
    registerSearchTools(server);
    registerBatchTools(server, agent.agent_id);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — 세션 없이 매 요청 독립 처리
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
