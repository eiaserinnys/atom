import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runConfiguredJevEvaluation } from "../services/jev-search/evaluate.js";
import type { ExpansionToolDependencies } from "./tools/expansion_tools.js";
import type { AgentScope } from "../shared/types.js";
import { registerCardTools } from "./tools/card_tools.js";
import { registerTreeTools } from "./tools/tree_tools.js";
import { registerSearchTools } from "./tools/search_tools.js";
import { registerBatchTools } from "./tools/batch_tools.js";
import { registerExpansionTools } from "./tools/expansion_tools.js";

export interface RegisterAllToolsOptions {
  agentId: string;
  scope?: AgentScope;
  neighbors: ExpansionToolDependencies["neighbors"];
}

export function registerAllTools(
  server: McpServer,
  { agentId, scope, neighbors }: RegisterAllToolsOptions
): void {
  registerCardTools(server, agentId);
  registerTreeTools(server, scope);
  registerSearchTools(server);
  registerBatchTools(server, agentId);
  registerExpansionTools(server, { neighbors, evaluate: runConfiguredJevEvaluation });
}
