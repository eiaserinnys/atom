import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { jest } from "@jest/globals";
import { getEncoding, Tiktoken } from "js-tiktoken";
import { createEmbeddingHash, createEmbeddingInput, createEmbeddingInputFromText } from "../../src/services/embeddings/input.js";
import { EMBEDDING_POLICY } from "../../src/services/embeddings/policy.js";

describe("embedding input", () => {
  it("hashes the complete title/body text and encodes that exact text", async () => {
    const result = await createEmbeddingInput("제목", "본문 **그대로**\n다음 줄");
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

  it("changes the hash for title, content, model, or dimensions changes", async () => {
    const a = await createEmbeddingInput("제목", "본문");
    const b = await createEmbeddingInput("다른 제목", "본문");
    const c = await createEmbeddingInput("제목", "다른 본문");
    expect(new Set([a.contentHash, b.contentHash, c.contentHash]).size).toBe(3);
    expect(createEmbeddingHash(a.text, "different-model", 3072) === a.contentHash).toBe(false);
    expect(createEmbeddingHash(a.text, EMBEDDING_POLICY.model, 1536) === a.contentHash).toBe(false);
  });

  it("caps the chunked token prefix and marks remaining text as truncated", async () => {
    const exactly = await createEmbeddingInput("t", "word ".repeat(8188));
    const over = await createEmbeddingInput("t", "word ".repeat(8189));
    expect(exactly.tokenCount).toBe(8191);
    expect(exactly.truncated).toBe(false);
    expect(over.tokenCount).toBe(8191);
    expect(over.truncated).toBe(true);
    expect(over.contentHash).not.toBe(exactly.contentHash);
  });

  it("accepts Korean and strings shaped like special tokens as ordinary text", async () => {
    const result = await createEmbeddingInput("한글 제목", "한글 본문 <|endoftext|> <|im_start|>");
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.text).toContain("<|endoftext|>");
  });

  it("shares exact text tokenization while query text has no title separator", async () => {
    const card = await createEmbeddingInput("제목", "본문");
    const fromText = await createEmbeddingInputFromText(card.text);
    expect(fromText).toEqual(card);

    const query = await createEmbeddingInputFromText("query text");
    expect(query.text).toBe("query text");
    expect(query.contentHash).toBe(createEmbeddingHash("query text"));
    expect(query.tokenCount).toBe(query.inputTokens.length);
    expect(query.truncated).toBe(false);
  });

  it("matches whole-text encoding for a single chunk", async () => {
    const text = "Ordinary text, café, emoji 🐱, and punctuation.";
    const result = await createEmbeddingInputFromText(text);
    expect(result.inputTokens).toEqual(getEncoding("cl100k_base").encode(text, [], []));
  });

  it("keeps a surrogate pair together at a chunk boundary", async () => {
    const prefix = "a".repeat(63);
    const text = `${prefix}🦊`;
    const result = await createEmbeddingInputFromText(text);
    const encoder = getEncoding("cl100k_base");
    expect(result.inputTokens).toEqual([
      ...encoder.encode(prefix, [], []),
      ...encoder.encode("🦊", [], []),
    ]);
  });

  it("never passes more than 64 code units to the encoder", async () => {
    const inputs: Array<[string, string]> = [
      ["Korean no-space", "가".repeat(8192)],
      ["ASCII no-space", "a".repeat(8192)],
      ["English sentence", "The quick brown fox jumps over the lazy dog. ".repeat(8)],
      ["Korean sentence", "빠르게 걷는 고양이는 낯선 숲속에서 작은 등불을 발견했다. ".repeat(8)],
    ];
    const encodeSpy = jest.spyOn(Tiktoken.prototype, "encode").mockImplementation(text => [text.length]);

    try {
      for (const [, text] of inputs) {
        const firstCall = encodeSpy.mock.calls.length;
        await createEmbeddingInputFromText(text);
        const chunks = encodeSpy.mock.calls.slice(firstCall).map(([encodedText]) => encodedText);
        expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThanOrEqual(64);
        expect(chunks.length).toBeGreaterThan(1);
      }
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it("keeps timer gaps below 250 ms for 8 KiB of the slowest Korean pattern", async () => {
    const text = "가".repeat(8192);
    let previousTick = performance.now();
    let maxGapMs = 0;
    let ticks = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - previousTick);
      previousTick = now;
      ticks += 1;
    }, 10);

    const result = await createEmbeddingInputFromText(text);
    await new Promise(resolve => setTimeout(resolve, 25));
    clearInterval(timer);

    expect(result.text).toBe(text);
    expect(ticks).toBeGreaterThan(0);
    const load = loadavg().map(value => value.toFixed(2)).join("/");
    console.info(`A06 timer gap: ${maxGapMs.toFixed(1)} ms; uptime loadavg 1m/5m/15m: ${load}`);
    expect(maxGapMs).toBeLessThanOrEqual(250);
  }, 60_000);

  it("reports token-count drift for sentence chunks without imposing a threshold", async () => {
    const texts: Array<[string, string]> = [
      ["English", "The quick brown fox jumps over the lazy dog. ".repeat(8)],
      ["Korean", "빠르게 걷는 고양이는 낯선 숲속에서 작은 등불을 발견했다. ".repeat(8)],
    ];
    const encoder = getEncoding("cl100k_base");

    for (const [label, text] of texts) {
      const chunked = await createEmbeddingInputFromText(text);
      const wholeTokenCount = encoder.encode(text, [], []).length;
      console.info(`A06 ${label} token counts: whole=${wholeTokenCount}, chunked=${chunked.tokenCount}`);
      expect(chunked.truncated).toBe(false);
    }
  });
});
