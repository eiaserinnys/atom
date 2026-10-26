import { jest } from "@jest/globals";
import {
  deserializeEmbeddingInto,
  serializeEmbedding,
} from "../../src/services/embeddings/binary.js";
import { FlatEmbeddingIndex } from "../../src/services/embeddings/flat-index.js";
import { EMBEDDING_POLICY } from "../../src/services/embeddings/policy.js";

function vector(fill: number, first = fill): Float32Array {
  const values = new Float32Array(EMBEDDING_POLICY.dimensions);
  values.fill(fill);
  values[0] = first;
  return values;
}

describe("Float32LE embeddings", () => {
  it("round-trips all 3072 elements through a 12288-byte buffer", () => {
    const original = vector(0.25, -0.75);
    const buffer = serializeEmbedding(original);
    const target = new Float32Array(EMBEDDING_POLICY.dimensions);
    deserializeEmbeddingInto(buffer, target, 0);
    expect(buffer).toHaveLength(12_288);
    expect([...target]).toEqual([...original]);
  });

  it("rejects wrong dimensions and non-finite values at the boundary", () => {
    expect(() => serializeEmbedding(new Float32Array(2))).toThrow("Invalid embedding");
    const invalid = vector(0.1);
    invalid[4] = Number.NaN;
    expect(() => serializeEmbedding(invalid)).toThrow("Invalid embedding");
    expect(() => deserializeEmbeddingInto(Buffer.alloc(4), new Float32Array(3072), 0)).toThrow("Invalid embedding");
  });
});

describe("FlatEmbeddingIndex", () => {
  it("computes exact dot-product top-K, excludes the source and resolves ties by id", () => {
    const index = new FlatEmbeddingIndex();
    index.loadRows([
      { cardId: "source", version: 1, embedding: serializeEmbedding(vector(0, 1)) },
      { cardId: "tie-b", version: 1, embedding: serializeEmbedding(vector(0, 0.5)) },
      { cardId: "tie-a", version: 1, embedding: serializeEmbedding(vector(0, 0.5)) },
      { cardId: "low", version: 1, embedding: serializeEmbedding(vector(0, 0.1)) },
    ]);
    const results = index.nearest(vector(0, 1), "source", new Map([
      ["source", 1], ["tie-a", 1], ["tie-b", 1], ["low", 1],
    ]), 2);
    expect(results.map(result => result.cardId)).toEqual(["tie-a", "tie-b"]);
    expect(results.map(result => result.similarity)).toEqual([0.5, 0.5]);
  });

  it("deduplicates IDs, updates versions in place, and swap-deletes without gaps", async () => {
    const index = new FlatEmbeddingIndex();
    index.loadRows([
      { cardId: "a", version: 1, embedding: serializeEmbedding(vector(0, 0.1)) },
      { cardId: "b", version: 1, embedding: serializeEmbedding(vector(0, 0.2)) },
    ]);
    await index.upsert("a", 2, serializeEmbedding(vector(0, 0.9)));
    await index.upsert("a", 2, serializeEmbedding(vector(0, 0.8)));
    expect(index.size).toBe(2);
    expect(index.versionOf("a")).toBe(2);
    await index.remove("a");
    expect(index.size).toBe(1);
    expect(index.cardIds()).toEqual(["b"]);
  });

  it("shares one lazy load and applies writes queued during loading after its pages", async () => {
    const index = new FlatEmbeddingIndex();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let loads = 0;
    async function* pages() {
      loads += 1;
      await gate;
      yield [{ cardId: "loaded", version: 1, embedding: serializeEmbedding(vector(0, 0.1)) }];
    }
    const countRows = jest.fn(async () => 1);
    const firstLoad = index.ensureLoaded(countRows, pages);
    const secondLoad = index.ensureLoaded(countRows, pages);
    const persist = jest.fn(async () => true);
    const update = index.commitEmbedding("written-during-load", 2, serializeEmbedding(vector(0, 0.2)), persist);
    expect(index.status).toBe("loading");
    expect(index.size).toBe(0);
    release();
    await Promise.all([firstLoad, secondLoad, update]);
    expect(loads).toBe(1);
    expect(countRows).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(index.status).toBe("ready");
    expect(index.cardIds()).toEqual(["loaded", "written-during-load"]);
  });
});
