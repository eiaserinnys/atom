import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerCardTools } from "../../mcp/tools/card_tools.js";
import { registerTreeTools } from "../../mcp/tools/tree_tools.js";
import { registerSearchTools } from "../../mcp/tools/search_tools.js";
import { registerBatchTools } from "../../mcp/tools/batch_tools.js";
import { findAgentByAgentId } from "../../db/queries/agents.js";
import { getPool } from "../../db/client.js";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7);

    // Token format: '{agent_id}:{plaintext_secret}'
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) {
      return reply.status(401).send({ error: 'Invalid token format' });
    }
    const agentId = token.slice(0, colonIdx);
    const secret = token.slice(colonIdx + 1);

    const agent = await findAgentByAgentId(getPool(), agentId);
    if (!agent || !agent.is_active) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    if (!(await bcrypt.compare(secret, agent.secret_hash))) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const server = new McpServer({ name: "atom", version: "0.1.0" });
    registerCardTools(server, agentId);
    registerTreeTools(server, agentId);
    registerSearchTools(server);
    registerBatchTools(server, agentId);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — 세션 없이 매 요청 독립 처리
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
