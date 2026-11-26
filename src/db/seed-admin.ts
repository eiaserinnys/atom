import type { Queryable } from "./queryable.js";
import { findUserByEmail, insertUser } from "./queries/users.js";

const EXAMPLE_EMAIL_PREFIX = "your-email@";

export type SeedAdminOutcome = "created" | "exists" | "skipped";

/**
 * Creates the ALLOWED_EMAIL admin unless that user is already there.
 * Existing users keep their role; nothing else in the users table is read or changed.
 */
export async function seedAllowedAdmin(
  db: Queryable,
  allowedEmail: string | undefined,
  log: { info(message: string): void; warn(message: string): void },
): Promise<SeedAdminOutcome> {
  const email = allowedEmail?.trim() ?? "";
  if (email === "") {
    log.warn("ALLOWED_EMAIL is empty, so no first admin was created. Set it to your email and restart.");
    return "skipped";
  }
  if (email.toLowerCase().startsWith(EXAMPLE_EMAIL_PREFIX)) {
    log.warn(`ALLOWED_EMAIL=${email} is the example value, so no first admin was created. Set it to your email and restart.`);
    return "skipped";
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
    log.warn("Set ALLOWED_EMAIL to a full email address to create the first admin.");
    return "skipped";
  }
  if (await findUserByEmail(db, email)) return "exists";
  await insertUser(db, { email, display_name: "Admin", role: "admin" });
  log.info(`[seed] Migrated ALLOWED_EMAIL=${email} as admin user`);
  return "created";
}
