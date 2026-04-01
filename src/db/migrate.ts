import { fileURLToPath } from "url";
import path from "path";
import { runMigrations, closePool } from "./client.js";
import { config } from "dotenv";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "migrations");

runMigrations(migrationsDir)
  .then(() => {
    console.log("Migrations complete");
    return closePool();
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
