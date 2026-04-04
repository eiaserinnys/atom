import type { UnfurlResult } from "./interface.js";

export function parseSnapshot(snapshot: string): UnfurlResult {
  const parsed = JSON.parse(snapshot) as Record<string, unknown>;
  // New format: { text, unfurlData }
  if ('unfurlData' in parsed) {
    return {
      text: (parsed.text as string) ?? '',
      snapshot,
      unfurlData: parsed.unfurlData as Record<string, unknown> | null,
    };
  }
  // Legacy format: raw unfurlData stored directly (backward compat)
  return {
    text: '',
    snapshot,
    unfurlData: parsed,
  };
}
