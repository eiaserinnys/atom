import fs from "node:fs";
import { jest } from "@jest/globals";
import Fastify from "fastify";
import { configRoutes } from "../../src/api/routes/config.js";
import { setPendingRestart } from "../../src/api/state.js";

const envContent = [
  "API_PORT=4200",
  "DATABASE_URL=postgresql://user:secret@db.example/atom",
  "TYPESAFE_API_KEY=typesafe-secret",
  "UNKNOWN_VALUE=surprise",
  "GOOGLE_CLIENT_SECRET=google-secret",
  "OPENAI_API_KEY=openai-db-key",
].join("\n");

describe("/api/config/env masking", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setPendingRestart(false);
  });

  it("masks values outside the allowlist and preserves them when PUT receives ***", async () => {
    const existsSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);
    const readSpy = jest.spyOn(fs, "readFileSync").mockReturnValue(envContent);
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    const app = Fastify({ logger: false });
    app.addHook("preHandler", async (request) => {
      request.jwtUser = {
        id: "test-admin",
        email: "admin@example.test",
        name: "Test Admin",
        role: "admin",
      };
    });
    await app.register(configRoutes);

    try {
      const get = await app.inject({ method: "GET", url: "/api/config/env" });
      expect(get.statusCode).toBe(200);
      expect(get.json()).toEqual({
        API_PORT: "4200",
        DATABASE_URL: "***",
        TYPESAFE_API_KEY: "***",
        UNKNOWN_VALUE: "***",
        GOOGLE_CLIENT_SECRET: "***",
      });

      const put = await app.inject({
        method: "PUT",
        url: "/api/config/env",
        payload: [
          { key: "API_PORT", value: "4300" },
          { key: "DATABASE_URL", value: "***" },
          { key: "TYPESAFE_API_KEY", value: "***" },
          { key: "UNKNOWN_VALUE", value: "***" },
        ],
      });

      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ ok: true });
      expect(writeSpy.mock.calls[0]?.[1]).toBe([
        "API_PORT=4300",
        "DATABASE_URL=postgresql://user:secret@db.example/atom",
        "TYPESAFE_API_KEY=typesafe-secret",
        "UNKNOWN_VALUE=surprise",
        "GOOGLE_CLIENT_SECRET=google-secret",
        "OPENAI_API_KEY=openai-db-key",
      ].join("\n"));
      expect(existsSpy).toHaveBeenCalled();
      expect(readSpy).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
