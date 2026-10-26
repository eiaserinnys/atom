const PLAINTEXT_CONFIG_KEYS = new Set([
  "API_PORT",
  "NODE_ENV",
  "FRONTEND_URL",
  "AUTH_BYPASS",
  "ALLOWED_EMAIL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CALLBACK_URL",
  "SLACK_CLIENT_ID",
  "SLACK_CALLBACK_URL",
  "SLACK_ALLOWED_TEAM_ID",
  "ADAPTER_PACKAGES",
  "TYPESAFE_BASE_URL",
  "SQLITE_PATH",
  "SEARCH_MOTION_PAGE_URL",
  "MCP_AGENT_ID",
]);

export interface ConfigEnvEntry {
  key: string;
  value: string;
}

export function isSensitiveEnvKey(key: string): boolean {
  return !PLAINTEXT_CONFIG_KEYS.has(key);
}

export function isDbOwnedConfigEnvKey(key: string): boolean {
  return key.toUpperCase() === "OPENAI_API_KEY";
}

export function parseConfigEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (isDbOwnedConfigEnvKey(key)) continue;
    result[key] = isSensitiveEnvKey(key) && value ? "***" : value;
  }
  return result;
}

export function updateConfigEnvContent(
  content: string,
  entries: ConfigEnvEntry[],
): string {
  if (entries.some((entry) => isDbOwnedConfigEnvKey(entry.key))) {
    throw new Error("OPENAI_KEY_DB_ONLY");
  }
  const lines = content.split("\n");
  const updates = new Map(entries.map((entry) => [entry.key, entry.value]));
  const handled = new Set<string>();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!updates.has(key)) return line;

    const newValue = updates.get(key)!;
    if (isSensitiveEnvKey(key) && newValue === "***") {
      handled.add(key);
      return line;
    }
    handled.add(key);
    return `${key}=${newValue}`;
  });

  for (const [key, value] of updates) {
    if (!handled.has(key) && !(isSensitiveEnvKey(key) && value === "***")) {
      newLines.push(`${key}=${value}`);
    }
  }

  return newLines.join("\n");
}
