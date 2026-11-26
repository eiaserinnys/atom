import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentScope } from "../shared/types.js";

export const READ_ONLY_MCP_TOOLS = [
  "get_card",
  "get_backlinks",
  "get_node",
  "list_children",
  "get_tree",
  "compile_subtree",
  "search_cards",
  "get_card_neighbors",
  "evaluate_cards",
] as const;

export const WRITE_MCP_TOOLS = [
  "create_card",
  "update_card",
  "delete_card",
  "create_symlink",
  "move_node",
  "update_node",
  "delete_node",
  "batch_op",
] as const;

const READ_ONLY_TOOL_NAMES = new Set<string>(READ_ONLY_MCP_TOOLS);
const WRITE_TOOL_NAMES = new Set<string>(WRITE_MCP_TOOLS);

export function createScopedMcpServer(server: McpServer, scope: AgentScope): McpServer {
  const registerTool = server.tool.bind(server) as unknown as (name: string, ...args: unknown[]) => unknown;
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "tool") return Reflect.get(target, property, receiver);
      return (name: string, ...args: unknown[]) => {
        if (!READ_ONLY_TOOL_NAMES.has(name) && !WRITE_TOOL_NAMES.has(name)) {
          throw new Error(`MCP tool is missing a scope classification: ${name}`);
        }
        if (scope === "read" && WRITE_TOOL_NAMES.has(name)) return undefined;
        return registerTool(name, ...args);
      };
    },
  });
}

type ToolCallHandler = (request: { params: { name: string } }, extra: unknown) => Promise<unknown>;

export function writeToolDisabledMessage(toolName: string): string {
  return `This API key has read scope, so write tools are disabled (${toolName}). Use an API key with write scope.`;
}

/**
 * A read key's tools/list leaves out the write tools. Calling one by name would then read
 * as "Tool x not found", so answer it with the real reason. Other names are left to the SDK.
 * Call after the tools are registered.
 */
export function explainDisabledWriteTools(server: McpServer, scope: AgentScope): void {
  if (scope !== "read") return;
  const handlers = (server.server as unknown as { _requestHandlers: Map<string, ToolCallHandler> })._requestHandlers;
  const sdkHandler = handlers.get(CallToolRequestSchema.shape.method.value);
  if (!sdkHandler) throw new Error("MCP tools/call handler is not registered; register the tools first");
  server.server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    WRITE_TOOL_NAMES.has(request.params.name)
      ? { isError: true, content: [{ type: "text" as const, text: writeToolDisabledMessage(request.params.name) }] }
      : (sdkHandler(request, extra) as never)
  );
}
