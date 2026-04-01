import Fastify from "fastify";
import { fileURLToPath } from "url";
import path from "path";
import { cardRoutes } from "./routes/cards.js";
import { treeRoutes } from "./routes/tree.js";
import { searchRoutes } from "./routes/search.js";
import { runMigrations } from "../db/client.js";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../.env") });

const app = Fastify({ logger: true });

app.register(cardRoutes);
app.register(treeRoutes);
app.register(searchRoutes);

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
