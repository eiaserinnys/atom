import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfig } from "../../src/config/load-env.js";
import { restartNeedsManualStart } from "../../src/config/restart-mode.js";

let directory: string;
let envFile: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "atom-load-env-"));
  envFile = path.join(directory, ".env");
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("lets .env values win over the shell, for the database too", () => {
    fs.writeFileSync(envFile, "DATABASE_URL=postgresql://app:secret@db.example:5433/atom_main\nAUTH_BYPASS=1\n");
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: "postgresql://other:hunter2@elsewhere/other_db",
      AUTH_BYPASS: "0",
      KEEP: "shell",
    };

    const loaded = loadConfig({ envFile, env });

    expect(loaded.envFileFound).toBe(true);
    expect(env["DATABASE_URL"]).toBe("postgresql://app:secret@db.example:5433/atom_main");
    expect(env["AUTH_BYPASS"]).toBe("1");
    expect(env["KEEP"]).toBe("shell");
    expect(loaded.description).toBe("[config] database: PostgreSQL db.example:5433/atom_main (DATABASE_URL from .env)");
  });

  it("uses the shell as it is when there is no .env", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://app:secret@db.example/atom_main" };

    const loaded = loadConfig({ envFile: path.join(directory, "missing.env"), env });

    expect(loaded.envFileFound).toBe(false);
    expect(env["DATABASE_URL"]).toBe("postgresql://app:secret@db.example/atom_main");
    expect(loaded.description).toBe("[config] database: PostgreSQL db.example/atom_main (DATABASE_URL from shell)");
  });

  it("never prints the user name or password", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://someuser:s3cr3t-pass@db.example/atom_main" };

    const { description } = loadConfig({ envFile: path.join(directory, "missing.env"), env });

    expect(description).not.toContain("someuser");
    expect(description).not.toContain("s3cr3t-pass");
  });

  it("names the SQLite file and where its path came from", () => {
    fs.writeFileSync(envFile, "SQLITE_PATH=/data/atom.db\n");

    expect(loadConfig({ envFile, env: {} }).description)
      .toBe("[config] database: SQLite /data/atom.db (SQLITE_PATH from .env)");
    expect(loadConfig({ envFile: path.join(directory, "missing.env"), env: { SQLITE_PATH: "/shell/atom.db" } }).description)
      .toBe("[config] database: SQLite /shell/atom.db (SQLITE_PATH from shell)");
  });

  it("falls back to atom.db in the working directory", () => {
    const loaded = loadConfig({ envFile: path.join(directory, "missing.env"), env: {}, cwd: "/work" });

    expect(loaded.description).toBe(`[config] database: SQLite ${path.join("/work", "atom.db")} (default)`);
  });

  it("lets an empty DATABASE_URL in .env choose SQLite over a shell value", () => {
    fs.writeFileSync(envFile, "DATABASE_URL=\n");
    const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://app@db.example/atom_main" };

    const loaded = loadConfig({ envFile, env, cwd: "/work" });

    expect(loaded.description).toBe(`[config] database: SQLite ${path.join("/work", "atom.db")} (default)`);
  });

  it("reads the file named by ATOM_ENV_FILE instead of the repository .env", () => {
    fs.writeFileSync(envFile, "SQLITE_PATH=/from/atom-env-file.db\n");
    const env: NodeJS.ProcessEnv = { ATOM_ENV_FILE: envFile, SQLITE_PATH: "/shell.db" };

    expect(loadConfig({ env }).description)
      .toBe("[config] database: SQLite /from/atom-env-file.db (SQLITE_PATH from .env)");
  });
});

describe("restartNeedsManualStart", () => {
  it("is true when the server runs under tsx (npm run dev, tsx watch, node --import tsx)", () => {
    expect(restartNeedsManualStart([
      "--require", "/app/node_modules/tsx/dist/preflight.cjs",
      "--import", "file:///app/node_modules/tsx/dist/loader.mjs",
    ])).toBe(true);
    expect(restartNeedsManualStart(["--import", "tsx"])).toBe(true);
    expect(restartNeedsManualStart(["--require", "C:\\app\\node_modules\\tsx\\dist\\preflight.cjs"])).toBe(true);
  });

  it("is false for a compiled server, which a process manager or container brings back", () => {
    expect(restartNeedsManualStart([])).toBe(false);
    expect(restartNeedsManualStart(["--max-old-space-size=512"])).toBe(false);
  });
});
