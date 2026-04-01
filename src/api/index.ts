import Fastify from "fastify";
import { fileURLToPath } from "url";
import path from "path";
import { cardRoutes } from "./routes/cards.js";
import { treeRoutes } from "./routes/tree.js";
import { searchRoutes } from "./routes/search.js";
import { mcpRoutes } from "./routes/mcp.js";
import { authRoutes } from "./routes/auth.js";
import { eventsRoutes } from "./routes/events.js";
import { authMiddleware } from "./middleware/auth.js";
import cookie from "@fastify/cookie";
import { runMigrations } from "../db/client.js";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../.env") });

const app = Fastify({ logger: true });

app.register(cookie);
app.register(authRoutes);
app.addHook('preHandler', authMiddleware);
app.register(cardRoutes);
app.register(treeRoutes);
app.register(searchRoutes);
app.register(mcpRoutes);
app.register(eventsRoutes);

const port = parseInt(process.env["API_PORT"] ?? "");
if (isNaN(port)) {
  throw new Error("API_PORT environment variable is required");
}

const start = async (): Promise<void> => {
  await runMigrations(path.join(__dirname, "../db/migrations"));
  await app.listen({ port, host: "0.0.0.0" });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
