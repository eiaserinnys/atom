import path from "node:path";
import { fileURLToPath } from "node:url";

import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { findUserByEmail, insertUser, listUsers } from "../../src/db/queries/users.js";
import { seedAllowedAdmin } from "../../src/db/seed-admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations-sqlite");

let db: SqliteAdapter;
let infos: string[];
let warnings: string[];
const log = {
  info: (message: string) => { infos.push(message); },
  warn: (message: string) => { warnings.push(message); },
};

beforeEach(async () => {
  db = new SqliteAdapter(":memory:");
  await db.runMigrations(MIGRATIONS_DIR);
  infos = [];
  warnings = [];
});

afterEach(async () => {
  await db.close();
});

describe("seedAllowedAdmin", () => {
  it.each([undefined, "", "   "])("skips an empty ALLOWED_EMAIL (%j) with one warning", async (value) => {
    expect(await seedAllowedAdmin(db, value, log)).toBe("skipped");

    expect(await listUsers(db)).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ALLOWED_EMAIL is empty");
  });

  it("skips the example value with one warning that names it", async () => {
    expect(await seedAllowedAdmin(db, "your-email@gmail.com", log)).toBe("skipped");

    expect(await listUsers(db)).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("your-email@gmail.com");
  });

  it("still skips an address that is not an email", async () => {
    expect(await seedAllowedAdmin(db, "@example.test", log)).toBe("skipped");

    expect(await listUsers(db)).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("creates the admin for a real address", async () => {
    expect(await seedAllowedAdmin(db, "me@example.com", log)).toBe("created");

    expect((await findUserByEmail(db, "me@example.com"))?.role).toBe("admin");
    expect(warnings).toEqual([]);
    expect(infos).toEqual(["[seed] Migrated ALLOWED_EMAIL=me@example.com as admin user"]);
  });

  it("creates the admin when other users already exist, such as after a first start with the example value", async () => {
    await insertUser(db, { email: "your-email@gmail.com", role: "admin" });
    await insertUser(db, { email: "owner@local", role: "admin" });

    expect(await seedAllowedAdmin(db, "me@example.com", log)).toBe("created");

    expect((await listUsers(db)).map((user) => user.email).sort())
      .toEqual(["me@example.com", "owner@local", "your-email@gmail.com"]);
  });

  it("leaves an existing user's role alone and creates nobody twice", async () => {
    await insertUser(db, { email: "me@example.com", role: "editor" });

    expect(await seedAllowedAdmin(db, "me@example.com", log)).toBe("exists");
    expect(await seedAllowedAdmin(db, "me@example.com", log)).toBe("exists");

    const users = await listUsers(db);
    expect(users).toHaveLength(1);
    expect(users[0]?.role).toBe("editor");
    expect(infos).toEqual([]);
  });

  it("does not delete the example account that was created earlier", async () => {
    await insertUser(db, { email: "your-email@gmail.com", role: "admin" });

    await seedAllowedAdmin(db, "me@example.com", log);

    expect(await findUserByEmail(db, "your-email@gmail.com")).not.toBeNull();
  });
});
