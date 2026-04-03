import type { UnfurlResult } from "./interface.js";

export function parseSnapshot(snapshot: string): UnfurlResult {
  return JSON.parse(snapshot) as UnfurlResult;
}
