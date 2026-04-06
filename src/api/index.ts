import Fastify from "fastify";
import { fileURLToPath } from "url";
import path from "path";
import { cardRoutes } from "./routes/cards.js";
import { treeRoutes } from "./routes/tree.js";
import { searchRoutes } from "./routes/search.js";
import { mcpRoutes } from "./routes/mcp.js";
import { authRoutes } from "./routes/auth.js";
import { eventsRoutes } from "./routes/events.js";
import { batchRoutes } from "./routes/batch.js";
import { configRoutes } from "./routes/config.js";
import { unfurlRoutes } from "./routes/unfurl.js";
import { cardApiRoutes } from "./routes/card_api.js";
import { systemRoutes } from "./routes/system.js";
import { authMiddleware } from "./middleware/auth.js";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { runMigrations, getDb } from "../db/client.js";
import { config } from "dotenv";
import { loadAdapters } from "../unfurl/loader.js";
import { adapterRegistry } from "../unfurl/registry.js";
import { userExists, insertUser } from "../db/queries/users.js";
import { findAgentByAgentId, insertAgent } from "../db/queries/agents.js";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../.env"), override: true });

const app = Fastify({ logger: true });

const frontendUrl = process.env["FRONTEND_URL"];
app.register(cors, {
  origin: frontendUrl ? [frontendUrl] : true,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
});
app.register(cookie);

// Version info — no auth required
app.get('/api/version', async (_req, reply) => {
  return reply.send({
    commit: process.env['GIT_COMMIT_SHA'] || 'dev',
    buildDate: process.env['BUILD_DATE'] || 'unknown',
    uptime: Math.floor(process.uptime()),
  });
});

app.register(authRoutes);
app.addHook('preHandler', authMiddleware);
app.register(cardRoutes);
app.register(treeRoutes);
app.register(searchRoutes);
app.register(mcpRoutes);
app.register(eventsRoutes);
app.register(batchRoutes);
app.register(configRoutes);
app.register(unfurlRoutes);
app.register(cardApiRoutes);
app.register(systemRoutes);

const port = parseInt(process.env["API_PORT"] ?? "");
if (isNaN(port)) {
  throw new Error("API_PORT environment variable is required");
}

async function seedMigration(): Promise<void> {
  const db = getDb();

  // ALLOWED_EMAIL → users 테이블 admin 마이그레이션
  const allowedEmail = process.env["ALLOWED_EMAIL"];
  if (allowedEmail && !(await userExists(db))) {
    await insertUser(db, { email: allowedEmail, display_name: "Admin", role: "admin" });
    console.log(`[seed] Migrated ALLOWED_EMAIL=${allowedEmail} as admin user`);
  }

  // MCP_SECRET → agents.legacy 마이그레이션
  const mcpSecret = process.env["MCP_SECRET"];
  if (mcpSecret && (await findAgentByAgentId(db, "legacy")) === null) {
    const secretHash = await bcrypt.hash(mcpSecret, 10);
    await insertAgent(db, {
      agent_id: "legacy",
      secret_hash: secretHash,
      display_name: "Legacy Agent (migrated from MCP_SECRET)",
    });
    console.log("[seed] Migrated MCP_SECRET as legacy agent");
  }
}

const start = async (): Promise<void> => {
  const db = getDb();
  const migrationsDir = db.dbType === 'sqlite'
    ? path.join(__dirname, "../db/migrations-sqlite")
    : path.join(__dirname, "../db/migrations");
  await runMigrations(migrationsDir);
  await seedMigration();
  await loadAdapters(adapterRegistry);
  await app.listen({ port, host: "0.0.0.0" });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
