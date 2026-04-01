import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerCardTools } from "../../mcp/tools/card_tools.js";
import { registerTreeTools } from "../../mcp/tools/tree_tools.js";
import { registerSearchTools } from "../../mcp/tools/search_tools.js";
import { registerBatchTools } from "../../mcp/tools/batch_tools.js";
import type { FastifyInstance } from "fastify";

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    const secret = process.env["MCP_SECRET"];
    if (!secret) {
      return reply.status(500).send({ error: "MCP_SECRET not configured" });
    }

    const auth = request.headers["authorization"];
    if (auth !== `Bearer ${secret}`) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const server = new McpServer({ name: "atom", version: "0.1.0" });
    registerCardTools(server);
    registerTreeTools(server);
    registerSearchTools(server);
    registerBatchTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — 세션 없이 매 요청 독립 처리
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
