import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import Fastify from "fastify";
import { parse } from "dotenv";
import { configRoutes } from "../../src/api/routes/config.js";
import { checkSaveKeepsStartupValid } from "../../src/api/config/save-guard.js";
import { ENV_FILE_PATH } from "../../src/config/load-env.js";
import { planPasswordSave } from "../../src/api/admin-password.js";
import { inspectStartupConfig } from "../../src/api/startup-config.js";
import { setPendingRestart } from "../../src/api/state.js";

const STARTUP_KEYS = [
  "ATOM_ENV_FILE", "AUTH_BYPASS", "DASHBOARD_ADMIN_PASSWORD", "JWT_SECRET", "FRONTEND_URL",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL",
  "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_CALLBACK_URL",
];

const OAUTH_FILE = [
  "API_PORT=4200",
  "GOOGLE_CLIENT_ID=google-id-value",
  "GOOGLE_CLIENT_SECRET=google-secret-value",
  "GOOGLE_CALLBACK_URL=https://atom.example/api/auth/google/callback",
  "JWT_SECRET=jwt-secret-value",
  "FRONTEND_URL=https://dashboard.example",
].join("\n");

const PASSWORD_FILE = [
  "API_PORT=4200",
  "DASHBOARD_ADMIN_PASSWORD=admin-password-value",
  "JWT_SECRET=jwt-secret-value",
].join("\n");

const SECRET_VALUES = [
  "google-id-value", "google-secret-value", "jwt-secret-value", "admin-password-value", "oauth-id-from-form",
];

describe("PUT /api/config/env refuses a save the server could not start with", () => {
  let savedEnv: Record<string, string | undefined>;
  let logLines: string[];

  beforeEach(() => {
    savedEnv = Object.fromEntries(STARTUP_KEYS.map((key) => [key, process.env[key]]));
    STARTUP_KEYS.forEach((key) => delete process.env[key]);
    logLines = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setPendingRestart(false);
    for (const key of STARTUP_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  async function putEnv(fileContent: string, entries: { key: string; value: string }[]) {
    jest.restoreAllMocks();
    logLines = [];
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(fileContent);
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    const app = Fastify({ logger: { level: "warn", stream: { write: (line: string) => { logLines.push(line); } } } });
    app.addHook("preHandler", async (request) => {
      request.jwtUser = { id: "test-admin", email: "admin@example.test", name: "Test Admin", role: "admin" };
    });
    await app.register(configRoutes);
    try {
      const response = await app.inject({ method: "PUT", url: "/api/config/env", payload: entries });
      return { response, writeSpy };
    } finally {
      await app.close();
    }
  }

  function expectRefused(result: Awaited<ReturnType<typeof putEnv>>, reasonPart: string, reason: string, keys: string[]) {
    expect(result.response.statusCode).toBe(400);
    const body = result.response.json();
    expect(body.code).toBe("STARTUP_WOULD_FAIL");
    expect(body.error).toContain(reasonPart);
    expect(body.reason).toBe(reason);
    expect(body.keys).toEqual(keys);
    expect(result.writeSpy).not.toHaveBeenCalled();
    const visible = result.response.body + logLines.join("");
    SECRET_VALUES.forEach((value) => expect(visible).not.toContain(value));
    expect(logLines.join("")).toContain("env save rejected");
  }

  it("refuses to empty the only login method", async () => {
    const result = await putEnv(OAUTH_FILE, [{ key: "GOOGLE_CLIENT_ID", value: "" }]);
    expectRefused(result, "No login method", "no_login_method", []);
  });

  it("refuses Google ID alone in password mode", async () => {
    const result = await putEnv(PASSWORD_FILE, [{ key: "GOOGLE_CLIENT_ID", value: "oauth-id-from-form" }]);
    expectRefused(
      result, "GOOGLE_CLIENT_SECRET", "missing_keys",
      ["FRONTEND_URL", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"],
    );
  });

  it("refuses an OAuth ID on top of bypass", async () => {
    const result = await putEnv("API_PORT=4200\nAUTH_BYPASS=1", [
      { key: "GOOGLE_CLIENT_ID", value: "oauth-id-from-form" },
      { key: "GOOGLE_CLIENT_SECRET", value: "google-secret-value" },
      { key: "GOOGLE_CALLBACK_URL", value: "https://atom.example/cb" },
    ]);
    expectRefused(result, "AUTH_BYPASS=1 cannot be combined", "oauth_and_bypass", ["AUTH_BYPASS", "GOOGLE_CLIENT_ID"]);
  });

  it("refuses a password on top of bypass", async () => {
    const result = await putEnv("API_PORT=4200\nAUTH_BYPASS=1", [
      { key: "DASHBOARD_ADMIN_PASSWORD", value: "admin-password-value" },
    ]);
    expectRefused(result, "AUTH_BYPASS=1 cannot be combined with DASHBOARD_ADMIN_PASSWORD", "password_and_bypass", ["AUTH_BYPASS", "DASHBOARD_ADMIN_PASSWORD"]);
  });

  it("refuses a password mode that has no JWT_SECRET", async () => {
    const result = await putEnv(PASSWORD_FILE, [{ key: "JWT_SECRET", value: "" }]);
    expectRefused(result, "JWT_SECRET", "missing_keys", ["JWT_SECRET"]);
  });

  it("refuses an empty administrator password", async () => {
    const result = await putEnv(PASSWORD_FILE, [{ key: "DASHBOARD_ADMIN_PASSWORD", value: "" }]);
    expectRefused(result, "No login method", "no_login_method", []);
  });

  it("logs a failed write on the server with the error text, and keeps secret values out of the log", async () => {
    jest.restoreAllMocks();
    logLines = [];
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(OAUTH_FILE);
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("EACCES: permission denied, open '/srv/atom/.env'"); });
    const app = Fastify({ logger: { level: "error", stream: { write: (line: string) => { logLines.push(line); } } } });
    app.addHook("preHandler", async (request) => {
      request.jwtUser = { id: "test-admin", email: "admin@example.test", name: "Test Admin", role: "admin" };
    });
    await app.register(configRoutes);
    const response = await app.inject({ method: "PUT", url: "/api/config/env", payload: [{ key: "ALLOWED_EMAIL", value: "admin@example.test" }] });
    await app.close();

    expect(response.statusCode).toBe(500);
    const logged = logLines.map((line) => JSON.parse(line));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 50, msg: "Failed to write .env" });
    expect(logged[0].err.message).toContain("EACCES: permission denied");
    SECRET_VALUES.forEach((value) => expect(logLines.join("")).not.toContain(value));
  });

  it("logs a failed read of the env file on the server", async () => {
    jest.restoreAllMocks();
    logLines = [];
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("EIO: i/o error, read"); });
    const app = Fastify({ logger: { level: "error", stream: { write: (line: string) => { logLines.push(line); } } } });
    app.addHook("preHandler", async (request) => {
      request.jwtUser = { id: "test-admin", email: "admin@example.test", name: "Test Admin", role: "admin" };
    });
    await app.register(configRoutes);
    const response = await app.inject({ method: "GET", url: "/api/config/env" });
    await app.close();

    expect(response.statusCode).toBe(500);
    const logged = logLines.map((line) => JSON.parse(line));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 50, msg: "Failed to read .env" });
    expect(logged[0].err.message).toContain("EIO");
  });

  it("saves a settings change that keeps the server startable", async () => {
    const { response, writeSpy } = await putEnv(OAUTH_FILE, [{ key: "ALLOWED_EMAIL", value: "admin@example.test" }]);
    expect(response.statusCode).toBe(200);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(String(writeSpy.mock.calls[0]?.[1])).toBe(`${OAUTH_FILE}\nALLOWED_EMAIL=admin@example.test`);
  });

  it("keeps a value that exists only in the shell when the form does not send that key", async () => {
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: "shell-google-id",
      GOOGLE_CLIENT_SECRET: "shell-google-secret",
      GOOGLE_CALLBACK_URL: "https://atom.example/cb",
      JWT_SECRET: "shell-jwt",
      FRONTEND_URL: "https://dashboard.example",
    });
    const kept = await putEnv("API_PORT=4200", [{ key: "ALLOWED_EMAIL", value: "admin@example.test" }]);
    expect(kept.response.statusCode).toBe(200);
    expect(String(kept.writeSpy.mock.calls[0]?.[1])).not.toContain("GOOGLE_CLIENT_ID");

    const blanked = await putEnv("API_PORT=4200", [{ key: "GOOGLE_CLIENT_ID", value: "" }]);
    expectRefused(blanked, "No login method", "no_login_method", []);
  });

  it("judges a sensitive key sent as *** by the value already saved", async () => {
    const kept = await putEnv(PASSWORD_FILE, [
      { key: "DASHBOARD_ADMIN_PASSWORD", value: "***" },
      { key: "ALLOWED_EMAIL", value: "admin@example.test" },
    ]);
    expect(kept.response.statusCode).toBe(200);
    expect(String(kept.writeSpy.mock.calls[0]?.[1])).toBe(`${PASSWORD_FILE}\nALLOWED_EMAIL=admin@example.test`);

    const nothingToKeep = await putEnv("API_PORT=4200", [{ key: "DASHBOARD_ADMIN_PASSWORD", value: "***" }]);
    expectRefused(nothingToKeep, "No login method", "no_login_method", []);
  });

  it("does not judge a save the loader never reads (ATOM_ENV_FILE points at another file)", async () => {
    process.env["ATOM_ENV_FILE"] = path.join(os.tmpdir(), "another-atom.env");
    const { response, writeSpy } = await putEnv(OAUTH_FILE, [{ key: "GOOGLE_CLIENT_ID", value: "" }]);
    expect(response.statusCode).toBe(200);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  describe("judges a save when ATOM_ENV_FILE names the saved file in another spelling", () => {
    let dir: string;

    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-save-guard-link-")); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it("as a relative path", async () => {
      process.env["ATOM_ENV_FILE"] = path.relative(process.cwd(), ENV_FILE_PATH);
      expect(path.isAbsolute(process.env["ATOM_ENV_FILE"])).toBe(false);
      const result = await putEnv(OAUTH_FILE, [{ key: "GOOGLE_CLIENT_ID", value: "" }]);
      expectRefused(result, "No login method", "no_login_method", []);
    });

    it("through a symlink to the folder that holds it", async () => {
      const link = path.join(dir, "folder-link");
      fs.symlinkSync(path.dirname(ENV_FILE_PATH), link);
      process.env["ATOM_ENV_FILE"] = path.join(link, path.basename(ENV_FILE_PATH));
      const result = await putEnv(OAUTH_FILE, [{ key: "GOOGLE_CLIENT_ID", value: "" }]);
      expectRefused(result, "No login method", "no_login_method", []);
    });

    it("through a symlink to the file itself", () => {
      const real = path.join(dir, "real.env");
      const link = path.join(dir, "file-link.env");
      fs.writeFileSync(real, OAUTH_FILE);
      fs.symlinkSync(real, link);
      const refused = checkSaveKeepsStartupValid(real, "API_PORT=4200", { ATOM_ENV_FILE: link });
      expect(refused).toMatchObject({ ok: false, reason: "no_login_method" });
      expect(checkSaveKeepsStartupValid(real, OAUTH_FILE, { ATOM_ENV_FILE: link })).toEqual({ ok: true });
    });
  });
});

describe("password save paths write settings the server can start with", () => {
  let dir: string;
  let envFile: string;
  let previousEnvFile: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-save-guard-"));
    envFile = path.join(dir, "atom.env");
    previousEnvFile = process.env["ATOM_ENV_FILE"];
    process.env["ATOM_ENV_FILE"] = envFile;
  });

  afterEach(() => {
    if (previousEnvFile === undefined) delete process.env["ATOM_ENV_FILE"];
    else process.env["ATOM_ENV_FILE"] = previousEnvFile;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("changing the password keeps the same login method and JWT_SECRET", () => {
    fs.writeFileSync(envFile, PASSWORD_FILE);
    const plan = planPasswordSave("another-password-1");
    expect(plan).not.toBeNull();
    const next = parse(plan!.content);
    expect(inspectStartupConfig(next, { envFile, envFileFound: true }).errors).toEqual([]);
  });

  it("setup on a fresh file writes a password and a JWT_SECRET together", () => {
    const plan = planPasswordSave("first-password-1", { alsoSet: { JWT_SECRET: "generated-secret" }, templateIfMissing: "API_PORT=4200\n" });
    expect(plan).not.toBeNull();
    const next = parse(plan!.content);
    expect(inspectStartupConfig(next, { envFile, envFileFound: false }).errors).toEqual([]);
  });
});
