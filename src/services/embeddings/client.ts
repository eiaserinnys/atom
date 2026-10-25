import type { EmbeddingErrorKind } from "../../shared/embeddings.js";
import { EMBEDDING_POLICY } from "./policy.js";

export class EmbeddingClientError extends Error {
  constructor(
    readonly kind: EmbeddingErrorKind,
    readonly httpStatus: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(kind);
    this.name = "EmbeddingClientError";
  }
}

export interface EmbeddingBatchInput {
  inputTokens: number[];
  tokenCount: number;
}

export function splitEmbeddingBatches<T extends EmbeddingBatchInput>(inputs: readonly T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let tokenCount = 0;
  for (const input of inputs) {
    if (current.length > 0 &&
      (current.length >= EMBEDDING_POLICY.maxInputsPerRequest || tokenCount + input.tokenCount > EMBEDDING_POLICY.maxRequestTokens)) {
      batches.push(current);
      current = [];
      tokenCount = 0;
    }
    current.push(input);
    tokenCount += input.tokenCount;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function requestEmbeddings(
  apiKey: string,
  inputs: readonly number[][],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_POLICY.model,
        dimensions: EMBEDDING_POLICY.dimensions,
        encoding_format: "float",
        input: inputs,
      }),
      signal,
    });
  } catch {
    throw new EmbeddingClientError("OPENAI_NETWORK", null);
  }

  if (!response.ok) {
    const status = response.status;
    const retryAfterMs = status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : null;
    try { await response.body?.cancel(); } catch { /* upstream body is intentionally discarded */ }
    if (status === 401) throw new EmbeddingClientError("OPENAI_AUTH", status);
    if (status === 429) throw new EmbeddingClientError("OPENAI_RATE_LIMIT", status, retryAfterMs);
    if (status >= 500) throw new EmbeddingClientError("OPENAI_UPSTREAM", status);
    throw new EmbeddingClientError("OPENAI_REQUEST", status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EmbeddingClientError("OPENAI_BAD_RESPONSE", response.status);
  }
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>)["data"] : null;
  if (!Array.isArray(data) || data.length !== inputs.length) {
    throw new EmbeddingClientError("OPENAI_BAD_RESPONSE", response.status);
  }
  const ordered: number[][] = new Array(inputs.length);
  const seen = new Set<number>();
  for (const row of data) {
    if (!row || typeof row !== "object") throw new EmbeddingClientError("OPENAI_BAD_RESPONSE", response.status);
    const index = (row as Record<string, unknown>)["index"];
    const vector = (row as Record<string, unknown>)["embedding"];
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= inputs.length || seen.has(index as number) ||
      !Array.isArray(vector) || vector.length !== EMBEDDING_POLICY.dimensions ||
      vector.some(value => typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
      throw new EmbeddingClientError("OPENAI_BAD_RESPONSE", response.status);
    }
    seen.add(index as number);
    ordered[index as number] = vector as number[];
  }
  if (seen.size !== inputs.length) throw new EmbeddingClientError("OPENAI_BAD_RESPONSE", response.status);
  return ordered;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - Date.now());
}
