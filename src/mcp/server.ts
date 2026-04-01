import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "url";
import path from "path";
import { registerCardTools } from "./tools/card_tools.js";
import { registerTreeTools } from "./tools/tree_tools.js";
import { registerSearchTools } from "./tools/search_tools.js";
import { registerBatchTools } from "./tools/batch_tools.js";
import { runMigrations } from "../db/client.js";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../.env") });

async function main(): Promise<void> {
  await runMigrations(path.join(__dirname, "../db/migrations"));

  const server = new McpServer({
    name: "atom",
    version: "0.1.0",
  });

  registerCardTools(server);
  registerTreeTools(server);
  registerSearchTools(server);
  registerBatchTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
