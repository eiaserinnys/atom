import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
