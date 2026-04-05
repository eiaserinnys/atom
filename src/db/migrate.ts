import { fileURLToPath } from "url";
import path from "path";
import { runMigrations, getDb, closeDb } from "./client.js";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../.env") });

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
