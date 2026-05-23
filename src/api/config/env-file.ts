const MASKED_KEY_PATTERNS = ["SECRET", "PASSWORD", "TOKEN"];

export interface ConfigEnvEntry {
  key: string;
  value: string;
}

export function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return MASKED_KEY_PATTERNS.some((pattern) => upper.includes(pattern));
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
    result[key] = isSensitiveEnvKey(key) && value ? "***" : value;
  }
  return result;
}

export function updateConfigEnvContent(
  content: string,
  entries: ConfigEnvEntry[],
): string {
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
