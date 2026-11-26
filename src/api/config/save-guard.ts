import fs from "node:fs";
import path from "node:path";
import { parseEnvFileContent, resolveEnvFilePath } from "../../config/load-env.js";
import { inspectStartupConfig, type StartupFailureReason } from "../startup-config.js";

export const STARTUP_WOULD_FAIL = "STARTUP_WOULD_FAIL";

export type SaveVerdict =
  | { ok: true }
  | { ok: false; error: string; reason: StartupFailureReason; keys: string[] };

/** The file's real location; a file that does not exist yet is its folder's real location plus its name. */
function realLocation(file: string): string {
  const absolute = path.resolve(file);
  try {
    return fs.realpathSync(absolute);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
    } catch {
      return absolute;
    }
  }
}

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
  if (realLocation(loaderFile) !== realLocation(savedFile)) return { ok: true };
  const nextStartEnv = { ...shell, ...parseEnvFileContent(nextContent) };
  const { failures } = inspectStartupConfig(nextStartEnv, { envFile: loaderFile, envFileFound: true });
  const first = failures[0];
  if (!first) return { ok: true };
  return { ok: false, error: first.message.split("\n")[0]!, reason: first.reason, keys: first.keys };
}
