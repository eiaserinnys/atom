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

export function createEmbeddingHash(
  text: string,
  model: string = EMBEDDING_POLICY.model,
  dimensions: number = EMBEDDING_POLICY.dimensions,
): string {
  return createHash("sha256")
    .update(JSON.stringify([model, dimensions, text]), "utf8")
    .digest("hex");
}

export function createEmbeddingInput(title: string, content: string): EmbeddingInput {
  return createEmbeddingInputFromText(`${title}\n\n${content}`);
}

export function createEmbeddingInputFromText(text: string): EmbeddingInput {
  const contentHash = createEmbeddingHash(text);
  encoder ??= getEncoding("cl100k_base");
  const allTokens = encoder.encode(text, [], []);
  const inputTokens = allTokens.slice(0, EMBEDDING_POLICY.maxInputTokens);
  return {
    text,
    contentHash,
    inputTokens,
    tokenCount: inputTokens.length,
    truncated: allTokens.length > EMBEDDING_POLICY.maxInputTokens,
  };
}
