import path from "node:path";
import { parseEnvFileContent, resolveEnvFilePath } from "../../config/load-env.js";
import { inspectStartupConfig } from "../startup-config.js";

export const STARTUP_WOULD_FAIL = "STARTUP_WOULD_FAIL";

export type SaveVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether the server could start again with `nextContent` saved as `savedFile`.
 * The next start sees the shell environment with the env file's values on top (the same rule the config loader applies),
 * and the start check is the one the server runs. When the loader reads a different file (ATOM_ENV_FILE),
 * this save never reaches the next start, so it is not judged. The reason names keys, never values.
 */
export function checkSaveKeepsStartupValid(
  savedFile: string,
  nextContent: string,
  shell: NodeJS.ProcessEnv = process.env,
): SaveVerdict {
  const loaderFile = resolveEnvFilePath(shell);
  if (path.resolve(loaderFile) !== path.resolve(savedFile)) return { ok: true };
  const nextStartEnv = { ...shell, ...parseEnvFileContent(nextContent) };
  const { errors } = inspectStartupConfig(nextStartEnv, { envFile: loaderFile, envFileFound: true });
  if (errors.length === 0) return { ok: true };
  return { ok: false, reason: errors[0]!.split("\n")[0]! };
}
