import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "../../mcp/register-tools.js";
import type { NeighborService } from "../../services/embeddings/neighbors.js";
import { createScopedMcpServer } from "../../mcp/tool-scope.js";
import { agentKeyVerifier } from "../agent-key-auth.js";
import type { FastifyPluginAsync } from "fastify";

export interface McpRoutesOptions {
  neighborService: NeighborService;
}

export const mcpRoutes: FastifyPluginAsync<McpRoutesOptions> = async (app, { neighborService }) => {
  app.post("/mcp", async (request, reply) => {
    const secret = request.headers['x-api-key'] as string | undefined;
    if (!secret) {
      return reply.status(401).send({ error: 'Unauthorized: x-api-key header required' });
    }

    const agent = await agentKeyVerifier.verify(secret);

    if (!agent) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const server = new McpServer({ name: "atom", version: "0.1.0" });
    const scopedServer = createScopedMcpServer(server, agent.scope);
    registerAllTools(scopedServer, { agentId: agent.agent_id, scope: agent.scope, neighbors: neighborService });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — 세션 없이 매 요청 독립 처리
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
};
