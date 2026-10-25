import {
  EmbeddingClientError,
  requestEmbeddings,
  splitEmbeddingBatches,
} from "../../src/services/embeddings/client.js";
import { EMBEDDING_POLICY } from "../../src/services/embeddings/policy.js";

describe("embedding request policy", () => {
  it("splits at both the input count and 30000-token request boundaries", () => {
    const byCount = splitEmbeddingBatches(Array.from({ length: 33 }, () => ({ inputTokens: [1], tokenCount: 1 })));
    expect(byCount.map(batch => batch.length)).toEqual([32, 1]);
    const byTokens = splitEmbeddingBatches(Array.from({ length: 3 }, () => ({ inputTokens: [1], tokenCount: 15_000 })));
    expect(byTokens.map(batch => batch.length)).toEqual([2, 1]);
  });

  it("sends token IDs with fixed model policy and orders responses by index", async () => {
    const vectors = Array.from({ length: 2 }, (_, index) => {
      const vector = new Array<number>(EMBEDDING_POLICY.dimensions).fill(0);
      vector[0] = index + 1;
      return vector;
    });
    let requestBody = "";
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ data: [
        { index: 1, embedding: vectors[1] },
        { index: 0, embedding: vectors[0] },
      ] }), { status: 200 });
    }) as typeof fetch;
    const result = await requestEmbeddings("test-only-key", [[11], [22]], new AbortController().signal, fetcher);
    const parsed = JSON.parse(requestBody);
    expect(parsed).toMatchObject({ model: EMBEDDING_POLICY.model, dimensions: 3072, encoding_format: "float", input: [[11], [22]] });
    expect(result.map(vector => vector[0])).toEqual([1, 2]);
  });

  it("classifies 401 without reading or echoing its body", async () => {
    const secret = ["fake", "upstream", "body"].join("-");
    let bodyCanceled = false;
    const response = new Response(secret, { status: 401 });
    const originalCancel = response.body?.cancel.bind(response.body);
    if (response.body && originalCancel) {
      response.body.cancel = async () => { bodyCanceled = true; return originalCancel(); };
    }
    const fetcher = (async () => response) as typeof fetch;
    let error: unknown;
    try {
      await requestEmbeddings("test-only-key", [[1]], new AbortController().signal, fetcher);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof EmbeddingClientError).toBe(true);
    expect(error && typeof error === "object" && "kind" in error ? error.kind : null).toBe("OPENAI_AUTH");
    expect(String(error).includes(secret)).toBe(false);
    expect(bodyCanceled).toBe(true);
  });

  it("records a parsed Retry-After delay and rejects malformed response data without details", async () => {
    const limited = (async () => new Response("", { status: 429, headers: { "retry-after": "2" } })) as typeof fetch;
    await expect(requestEmbeddings("test-only-key", [[1]], new AbortController().signal, limited))
      .rejects.toMatchObject({ kind: "OPENAI_RATE_LIMIT", httpStatus: 429, retryAfterMs: 2000 });
    const malformed = (async () => new Response("untrusted", { status: 200 })) as typeof fetch;
    let error: unknown;
    try {
      await requestEmbeddings("test-only-key", [[1]], new AbortController().signal, malformed);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof EmbeddingClientError).toBe(true);
    expect(String(error).includes("untrusted")).toBe(false);
  });
});
