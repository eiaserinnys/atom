import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

export const ENV_FILE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.env",
);

export type LoadedConfig = {
  envFile: string;
  envFileFound: boolean;
  description: string;
};

export type LoadConfigOptions = {
  envFile?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export function parseEnvFileContent(content: string): Record<string, string> {
  return parse(content);
}

function readEnvFile(envFile: string): Record<string, string> | null {
  let content: string;
  try {
    content = fs.readFileSync(envFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseEnvFileContent(content);
}

function describePostgres(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `PostgreSQL ${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "PostgreSQL (DATABASE_URL is not a valid URL)";
  }
}

function describeDatabase(
  env: NodeJS.ProcessEnv,
  fileKeys: ReadonlySet<string>,
  cwd: string,
): string {
  const sourceOf = (key: string): ".env" | "shell" => (fileKeys.has(key) ? ".env" : "shell");
  if (env["DATABASE_URL"]) {
    return `${describePostgres(env["DATABASE_URL"])} (DATABASE_URL from ${sourceOf("DATABASE_URL")})`;
  }
  if (env["SQLITE_PATH"]) {
    return `SQLite ${env["SQLITE_PATH"]} (SQLITE_PATH from ${sourceOf("SQLITE_PATH")})`;
  }
  return `SQLite ${path.join(cwd, "atom.db")} (default)`;
}

export function resolveEnvFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env["ATOM_ENV_FILE"] ?? ENV_FILE_PATH;
}

/**
 * Every entry point (API server, stdio MCP, migrate, seed-demo) loads settings here:
 * values in the .env file win over the shell, and the shell is used as-is when there is no .env.
 * ATOM_ENV_FILE (shell only) points at a different env file, e.g. a missing one for tests.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const envFile = options.envFile ?? resolveEnvFilePath(env);
  const fromFile = readEnvFile(envFile);
  if (fromFile) Object.assign(env, fromFile);
  const fileKeys = new Set(fromFile ? Object.keys(fromFile) : []);
  return {
    envFile,
    envFileFound: fromFile !== null,
    description: `[config] database: ${describeDatabase(env, fileKeys, options.cwd ?? process.cwd())}`,
  };
}
