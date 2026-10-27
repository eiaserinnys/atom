import { getDb } from "../client.js";
import type { Queryable } from "../queryable.js";

export async function lockTreeStructure(db: Queryable): Promise<void> {
  if (getDb().dbType === "postgres") {
    await db.query("SELECT pg_advisory_xact_lock(725001)");
  }
}
