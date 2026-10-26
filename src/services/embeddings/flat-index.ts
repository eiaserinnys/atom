import { deserializeEmbeddingInto } from "./binary.js";
import { EMBEDDING_POLICY } from "./policy.js";

export interface StoredEmbedding {
  cardId: string;
  version: number;
  embedding: Uint8Array;
}

export interface NeighborScore {
  cardId: string;
  version: number;
  similarity: number;
}

export type FlatIndexStatus = "unloaded" | "loading" | "ready";

export class FlatEmbeddingIndex {
  private vectors = new Float32Array(0);
  private ids: string[] = [];
  private versions: number[] = [];
  private slotById = new Map<string, number>();
  private capacity = 0;
  private loadPromise: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private indexStatus: FlatIndexStatus = "unloaded";

  get status(): FlatIndexStatus { return this.indexStatus; }
  get size(): number { return this.ids.length; }

  async waitForLoad(): Promise<void> { await this.loadPromise; }

  async ensureLoaded(countRows: () => Promise<number>, loadPages: () => AsyncIterable<StoredEmbedding[]>): Promise<void> {
    if (this.indexStatus === "ready") return;
    if (this.loadPromise) return this.loadPromise;
    this.indexStatus = "loading";
    const loading = this.serialize(async () => {
      this.reset();
      this.ensureCapacity(await countRows() + EMBEDDING_POLICY.indexPageSize);
      for await (const page of loadPages()) {
        for (const row of page) this.insert(row.cardId, row.version, row.embedding);
      }
      this.indexStatus = "ready";
    }).catch(() => {
      this.reset();
      this.indexStatus = "unloaded";
      throw new Error("INDEX_UNAVAILABLE");
    }).finally(() => {
      if (this.loadPromise === loading) this.loadPromise = null;
    });
    this.loadPromise = loading;
    return loading;
  }

  loadRows(rows: Iterable<StoredEmbedding>): void {
    this.reset();
    for (const row of rows) this.insert(row.cardId, row.version, row.embedding);
    this.indexStatus = "ready";
  }

  async upsert(cardId: string, version: number, embedding: Uint8Array): Promise<void> {
    if (this.indexStatus === "unloaded") return;
    await this.serialize(() => {
      if (this.indexStatus === "ready") this.insert(cardId, version, embedding);
    });
  }

  async commitEmbedding(
    cardId: string,
    version: number,
    embedding: Uint8Array,
    persist: () => Promise<boolean>,
  ): Promise<boolean> {
    return this.serialize(async () => {
      const saved = await persist();
      if (saved && this.indexStatus === "ready") this.insert(cardId, version, embedding);
      return saved;
    });
  }

  async commitVersion(cardId: string, version: number, persist: () => Promise<boolean>): Promise<boolean> {
    return this.serialize(async () => {
      const saved = await persist();
      const slot = this.slotById.get(cardId);
      if (saved && slot !== undefined && this.indexStatus === "ready") this.versions[slot] = version;
      return saved;
    });
  }

  async commitRemoval(persist: () => Promise<string[]>): Promise<string[]> {
    return this.serialize(async () => {
      const deleted = await persist();
      if (this.indexStatus === "ready") {
        for (const cardId of deleted) this.removeNow(cardId);
      }
      return deleted;
    });
  }

  async setVersion(cardId: string, version: number): Promise<void> {
    if (this.indexStatus === "unloaded") return;
    await this.serialize(() => {
      const slot = this.slotById.get(cardId);
      if (slot !== undefined && this.indexStatus === "ready") this.versions[slot] = version;
    });
  }

  async remove(cardId: string): Promise<void> {
    if (this.indexStatus === "unloaded") return;
    await this.serialize(() => {
      if (this.indexStatus !== "ready") return;
      this.removeNow(cardId);
    });
  }

  nearest(
    query: Float32Array,
    sourceCardId: string | null,
    currentVersions: ReadonlyMap<string, number>,
    limit: number,
  ): NeighborScore[] {
    const vectors = this.vectors;
    const ids = this.ids;
    const versions = this.versions;
    const dimensions = EMBEDDING_POLICY.dimensions;
    if (query.length !== dimensions) throw new Error("Invalid embedding");
    const top: NeighborScore[] = [];
    for (let slot = 0; slot < ids.length; slot += 1) {
      const cardId = ids[slot];
      const version = versions[slot];
      if (cardId === sourceCardId || currentVersions.get(cardId) !== version) continue;
      const start = slot * dimensions;
      let similarity = 0;
      for (let i = 0; i < dimensions; i += 1) {
        similarity += query[i] * vectors[start + i];
      }
      const last = top[top.length - 1];
      if (top.length === limit && last
        && (similarity < last.similarity || (similarity === last.similarity && cardId >= last.cardId))) continue;
      const candidate = { cardId, version, similarity };
      let index = top.findIndex(item => similarity > item.similarity || (similarity === item.similarity && cardId < item.cardId));
      if (index < 0) index = top.length;
      if (index < limit) {
        top.splice(index, 0, candidate);
        if (top.length > limit) top.pop();
      }
    }
    return top;
  }

  vectorFor(cardId: string): Float32Array | null {
    const slot = this.slotById.get(cardId);
    if (slot === undefined || this.indexStatus !== "ready") return null;
    const start = slot * EMBEDDING_POLICY.dimensions;
    return this.vectors.subarray(start, start + EMBEDDING_POLICY.dimensions);
  }

  versionOf(cardId: string): number | undefined {
    const slot = this.slotById.get(cardId);
    return slot === undefined ? undefined : this.versions[slot];
  }

  cardIds(): string[] { return [...this.ids]; }

  private insert(cardId: string, version: number, embedding: Uint8Array): void {
    const existing = this.slotById.get(cardId);
    const slot = existing ?? this.ids.length;
    if (existing === undefined) {
      this.ensureCapacity(slot + 1);
      this.ids.push(cardId);
      this.versions.push(version);
      this.slotById.set(cardId, slot);
    } else {
      this.versions[slot] = version;
    }
    deserializeEmbeddingInto(embedding, this.vectors, slot * EMBEDDING_POLICY.dimensions);
  }

  private removeNow(cardId: string): void {
    const slot = this.slotById.get(cardId);
    if (slot === undefined) return;
    const lastSlot = this.ids.length - 1;
    if (slot !== lastSlot) {
      const lastId = this.ids[lastSlot];
      const start = lastSlot * EMBEDDING_POLICY.dimensions;
      this.vectors.copyWithin(slot * EMBEDDING_POLICY.dimensions, start, start + EMBEDDING_POLICY.dimensions);
      this.ids[slot] = lastId;
      this.versions[slot] = this.versions[lastSlot];
      this.slotById.set(lastId, slot);
    }
    this.ids.pop();
    this.versions.pop();
    this.slotById.delete(cardId);
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    const capacity = Math.max(required, this.capacity + EMBEDDING_POLICY.indexPageSize);
    const next = new Float32Array(capacity * EMBEDDING_POLICY.dimensions);
    next.set(this.vectors);
    this.vectors = next;
    this.capacity = capacity;
  }

  private reset(): void {
    this.vectors = new Float32Array(0);
    this.ids = [];
    this.versions = [];
    this.slotById.clear();
    this.capacity = 0;
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.mutationTail.then(operation);
    this.mutationTail = next.then(() => undefined, () => undefined);
    return next;
  }
}
