import { fileURLToPath } from "url";
import path from "path";
import { runMigrations, getDb, closeDb } from "./client.js";
import { loadConfig } from "../config/load-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log(loadConfig().description);

const db = getDb();
const migrationsDir = db.dbType === 'sqlite'
  ? path.join(__dirname, "migrations-sqlite")
  : path.join(__dirname, "migrations");

runMigrations(migrationsDir)
  .then(() => {
    console.log("Migrations complete");
    return closeDb();
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
