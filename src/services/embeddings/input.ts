import { createHash } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import { EMBEDDING_POLICY } from "./policy.js";

export interface EmbeddingInput {
  text: string;
  contentHash: string;
  inputTokens: number[];
  tokenCount: number;
  truncated: boolean;
}

let encoder: ReturnType<typeof getEncoding> | undefined;
const MAX_CHUNK_CODE_UNITS = 64;
const YIELD_INTERVAL_MS = 8;

export function createEmbeddingHash(
  text: string,
  model: string = EMBEDDING_POLICY.model,
  dimensions: number = EMBEDDING_POLICY.dimensions,
): string {
  return createHash("sha256")
    .update(JSON.stringify([model, dimensions, text]), "utf8")
    .digest("hex");
}

export async function createEmbeddingInput(title: string, content: string): Promise<EmbeddingInput> {
  return createEmbeddingInputFromText(`${title}\n\n${content}`);
}

export async function createEmbeddingInputFromText(text: string): Promise<EmbeddingInput> {
  const contentHash = createEmbeddingHash(text);
  encoder ??= getEncoding("cl100k_base");
  const inputTokens: number[] = [];
  let offset = 0;
  let truncated = false;
  let lastYieldAt = performance.now();

  while (offset < text.length) {
    const limit = Math.min(offset + MAX_CHUNK_CODE_UNITS, text.length);
    let end = limit;
    if (limit < text.length) {
      const backHalfStart = offset + MAX_CHUNK_CODE_UNITS / 2;
      for (let index = limit - 1; index >= backHalfStart; index -= 1) {
        if (/\s/.test(text[index] ?? "")) {
          end = index;
          break;
        }
      }
      if (end === limit) {
        const lastUnit = text.charCodeAt(end - 1);
        const nextUnit = text.charCodeAt(end);
        if (lastUnit >= 0xd800 && lastUnit <= 0xdbff && nextUnit >= 0xdc00 && nextUnit <= 0xdfff) end -= 1;
      }
    }

    const chunkTokens = encoder.encode(text.slice(offset, end), [], []);
    const remainingTokens = EMBEDDING_POLICY.maxInputTokens - inputTokens.length;
    if (chunkTokens.length > remainingTokens) {
      inputTokens.push(...chunkTokens.slice(0, remainingTokens));
      truncated = true;
      break;
    }
    // Chunk boundaries can slightly change BPE tokens; embeddings use this capped input prefix.
    inputTokens.push(...chunkTokens);
    offset = end;
    if (inputTokens.length >= EMBEDDING_POLICY.maxInputTokens) {
      truncated = offset < text.length;
      break;
    }
    if (offset < text.length && performance.now() - lastYieldAt >= YIELD_INTERVAL_MS) {
      await new Promise<void>(resolve => setImmediate(resolve));
      lastYieldAt = performance.now();
    }
  }

  return {
    text,
    contentHash,
    inputTokens,
    tokenCount: inputTokens.length,
    truncated,
  };
}
