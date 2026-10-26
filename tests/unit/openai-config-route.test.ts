import { jest } from "@jest/globals";
import Fastify from "fastify";
import type { DatabaseAdapter } from "../../src/db/adapter.js";
import { createOpenAIConfigRoutes } from "../../src/api/routes/openai-config.js";

const FAKE_KEY = ["fake", "key", "from", "test"].join("-");

function fakeDb() {
  const state: { key: string | null; savedAt: string | null } = { key: null, savedAt: null };
  const calls: string[] = [];
  const raw: any = {
    dbType: "sqlite" as const,
    async query(sql: string, values: unknown[] = []) {
      calls.push(sql);
      if (sql.includes("SELECT openai_api_key IS NOT NULL")) {
        return { rows: [{ configured: state.key !== null, last_saved_at: state.savedAt }], rowCount: 1, command: "", oid: 0, fields: [] };
      }
      if (sql.includes("SELECT openai_api_key")) {
        return { rows: state.key === null ? [] : [{ openai_api_key: state.key }], rowCount: state.key === null ? 0 : 1, command: "", oid: 0, fields: [] };
      }
      if (sql.includes("INSERT INTO app_settings")) {
        const changed = state.key !== values[0];
        state.key = values[0] as string;
        state.savedAt = values[1] as string;
        return { rows: [{ changed }], rowCount: 1, command: "", oid: 0, fields: [] };
      }
      if (sql.includes("UPDATE app_settings")) {
        const changed = state.key !== null;
        state.key = null;
        return { rows: [{ changed, openai_key_saved_at: state.savedAt }], rowCount: changed ? 1 : 0, command: "", oid: 0, fields: [] };
      }
      if (sql.includes("COUNT(CASE WHEN")) {
        return { rows: [{ target_cards: "5", completed_cards: "2" }], rowCount: 1, command: "", oid: 0, fields: [] };
      }
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    },
    async transaction<T>(fn: (client: any) => Promise<T>) { return fn(raw); },
    async close() {},
    async runMigrations() {},
  };
  return { db: raw as DatabaseAdapter, state, calls };
}

function makeApp(role: "admin" | "editor" | "viewer" | null, db: DatabaseAdapter, sync = { credentialsChanged: jest.fn(), requestRun: jest.fn(), status: () => ({ running: false, paused_reason: "no_key" as const, last_error: null }) }) {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async req => {
    if (role) req.jwtUser = { id: "user", email: "user@example.test", name: "User", role };
  });
  app.register(createOpenAIConfigRoutes({ db, sync }));
  return { app, sync };
}

describe("OpenAI config routes", () => {
  it("stores a key but returns only metadata, and immediately signals the worker", async () => {
    const { db, state } = fakeDb();
    const { app, sync } = makeApp("admin", db);
    const save = await app.inject({ method: "PUT", url: "/api/config/openai/key", payload: { api_key: ` ${FAKE_KEY} ` } });
    const get = await app.inject("/api/config/openai");
    expect(save.statusCode).toBe(200);
    expect(save.body.includes(FAKE_KEY)).toBe(false);
    expect(get.body.includes(FAKE_KEY)).toBe(false);
    expect(get.json().key).toMatchObject({ configured: true });
    expect(get.json().embedding).toMatchObject({ completed_cards: 2, target_cards: 5 });
    expect(state.key === FAKE_KEY).toBe(true);
    expect(sync.credentialsChanged).toHaveBeenCalledTimes(1);
    await app.inject({ method: "PUT", url: "/api/config/openai/key", payload: { api_key: FAKE_KEY } });
    expect(sync.credentialsChanged).toHaveBeenCalledTimes(1);
    expect(sync.requestRun).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects blank input, removes the key without a request body, and never includes DB error text", async () => {
    const { db, state } = fakeDb();
    const { app, sync } = makeApp("admin", db);
    expect((await app.inject({ method: "PUT", url: "/api/config/openai/key", payload: { api_key: "  " } })).json().error.code).toBe("OPENAI_KEY_REQUIRED");
    await app.inject({ method: "PUT", url: "/api/config/openai/key", payload: { api_key: FAKE_KEY } });
    const deleted = await app.inject({ method: "DELETE", url: "/api/config/openai/key" });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().key.configured).toBe(false);
    expect(state.key).toBeNull();
    expect(sync.credentialsChanged).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("allows only admins and emits fixed errors without upstream/DB details", async () => {
    for (const role of ["editor", "viewer"] as const) {
      const { db } = fakeDb();
      const { app } = makeApp(role, db);
      expect((await app.inject("/api/config/openai")).statusCode).toBe(403);
      await app.close();
    }
    const { db } = fakeDb();
    db.query = async () => { throw new Error(`sensitive ${FAKE_KEY} detail`); };
    const { app } = makeApp("admin", db);
    const response = await app.inject("/api/config/openai");
    expect(response.statusCode).toBe(500);
    expect(response.body.includes(FAKE_KEY)).toBe(false);
    expect(response.body).not.toContain("sensitive");
    await app.close();

    const { db: unauthenticatedDb } = fakeDb();
    const unauthenticated = makeApp(null, unauthenticatedDb);
    expect((await unauthenticated.app.inject("/api/config/openai")).statusCode).toBe(401);
    await unauthenticated.app.close();

    const invalid = makeApp("admin", unauthenticatedDb);
    const invalidJson = await invalid.app.inject({
      method: "PUT", url: "/api/config/openai/key",
      headers: { "content-type": "application/json" }, payload: "invalid-json",
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(invalidJson.body.includes("invalid-json")).toBe(false);
    await invalid.app.close();
  });
});
