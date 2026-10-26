import { createHash } from "node:crypto";
import { createEmbeddingHash, createEmbeddingInput } from "../../src/services/embeddings/input.js";
import { EMBEDDING_POLICY } from "../../src/services/embeddings/policy.js";

describe("embedding input", () => {
  it("hashes the complete title/body text and encodes that exact text", () => {
    const result = createEmbeddingInput("제목", "본문 **그대로**\n다음 줄");
    const text = "제목\n\n본문 **그대로**\n다음 줄";
    expect(result.text).toBe(text);
    expect(result.contentHash).toBe(
      createHash("sha256")
        .update(JSON.stringify([EMBEDDING_POLICY.model, EMBEDDING_POLICY.dimensions, text]), "utf8")
        .digest("hex")
    );
    expect(result.tokenCount).toBe(result.inputTokens.length);
    expect(result.truncated).toBe(false);
    expect(result.inputTokens.length).toBeGreaterThan(0);
  });

  it("changes the hash for title, content, model, or dimensions changes", () => {
    const a = createEmbeddingInput("제목", "본문");
    const b = createEmbeddingInput("다른 제목", "본문");
    const c = createEmbeddingInput("제목", "다른 본문");
    expect(new Set([a.contentHash, b.contentHash, c.contentHash]).size).toBe(3);
    expect(createEmbeddingHash(a.text, "different-model", 3072) === a.contentHash).toBe(false);
    expect(createEmbeddingHash(a.text, EMBEDDING_POLICY.model, 1536) === a.contentHash).toBe(false);
  });

  it("counts the cl100k token prefix at the 8191/8192 boundary without decoding it", () => {
    const exactly = createEmbeddingInput("t", "word ".repeat(8188));
    const over = createEmbeddingInput("t", "word ".repeat(8189));
    expect(exactly.tokenCount).toBe(8191);
    expect(exactly.truncated).toBe(false);
    expect(over.tokenCount).toBe(8191);
    expect(over.truncated).toBe(true);
    expect(over.contentHash).not.toBe(exactly.contentHash);
  });

  it("accepts Korean and strings shaped like special tokens as ordinary text", () => {
    const result = createEmbeddingInput("한글 제목", "한글 본문 <|endoftext|> <|im_start|>");
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.text).toContain("<|endoftext|>");
  });
});
