import type { Card } from "../../src/shared/types.js";
import type { UnfurlAdapter, UnfurlCredentials, UnfurlResult } from "../../src/unfurl/interface.js";
import { parseSnapshot } from "../../src/unfurl/utils.js";
import { TrelloAdapter } from "../../src/unfurl/adapters/trello/index.js";
import { AdapterRegistry } from "../../src/unfurl/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<Card> & { id: string; title: string }): Card {
  return {
    id: overrides.id,
    card_type: overrides.card_type ?? "knowledge",
    title: overrides.title,
    content: overrides.content ?? null,
    references: overrides.references ?? [],
    tags: overrides.tags ?? [],
    card_timestamp: overrides.card_timestamp ?? "2026-01-01T00:00:00Z",
    content_timestamp: overrides.content_timestamp ?? null,
    source_type: overrides.source_type ?? null,
    source_ref: overrides.source_ref ?? null,
    source_snapshot: overrides.source_snapshot ?? null,
    source_checksum: overrides.source_checksum ?? null,
    source_checked_at: overrides.source_checked_at ?? null,
    staleness: overrides.staleness ?? "unverified",
    version: overrides.version ?? 1,
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
    created_by: overrides.created_by ?? null,
    updated_by: overrides.updated_by ?? null,
  };
}

function makeUnfurlResult(text: string = "resolved"): UnfurlResult {
  return {
    text,
    snapshot: JSON.stringify({ text }),
    unfurlData: { text },
  };
}

// ---------------------------------------------------------------------------
// parseSnapshot
// ---------------------------------------------------------------------------

describe("parseSnapshot", () => {
  it("parses valid JSON snapshot into UnfurlResult", () => {
    const result = makeUnfurlResult("hello");
    const parsed = parseSnapshot(result.snapshot);
    // snapshot JSON contains the serialized UnfurlResult fields
    // parsed.text comes from the stored JSON
    expect(parsed.text).toBe("hello");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSnapshot("not json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveRefs — tested via a lightweight inline re-implementation
// to avoid needing a live DB (getPool) in unit tests
// ---------------------------------------------------------------------------

/**
 * Minimal in-process version of resolveRefs that accepts injectable
 * adapter and updateSnapshot for unit testing without DB.
 */
async function resolveRefsTestable(
  cardCache: Map<string, Card>,
  mode: "cached" | "fresh",
  credentials: Record<string, UnfurlCredentials>,
  findAdapter: (sourceType: string) => UnfurlAdapter | undefined,
  onSnapshotWrite: (cardId: string, snapshot: string) => void,
  findByRef?: (ref: string) => UnfurlAdapter | undefined,
  onSourceTypeRepair?: (cardId: string, sourceType: string) => void
): Promise<Map<string, { ok: boolean; result?: UnfurlResult; error?: string; sourceType: string }>> {
  const resolved = new Map<string, { ok: boolean; result?: UnfurlResult; error?: string; sourceType: string }>();

  await Promise.allSettled(
    Array.from(cardCache.entries()).map(async ([cardId, card]) => {
      if (!card.source_ref || !card.source_type) return;
      const adapter =
        findAdapter(card.source_type) ??
        findByRef?.(card.source_ref);
      if (!adapter) return;

      // source_type 미스매치: fallback으로 찾은 경우 자동 수복 (fire-and-forget)
      if (!findAdapter(card.source_type)) {
        Promise.resolve().then(() => onSourceTypeRepair?.(cardId, adapter.sourceType)).catch(() => {});
      }

      const creds = credentials[adapter.sourceType] ?? {};

      if (mode === "cached" && card.source_snapshot) {
        try {
          const result = parseSnapshot(card.source_snapshot);
          resolved.set(cardId, { ok: true, result, sourceType: card.source_type });
        } catch (e) {
          resolved.set(cardId, { ok: false, error: String(e), sourceType: card.source_type });
        }
        return;
      }

      try {
        const result = await adapter.resolve(card.source_ref, creds);
        resolved.set(cardId, { ok: true, result, sourceType: card.source_type });
        // fire-and-forget write-back (captured by callback in tests)
        Promise.resolve().then(() => onSnapshotWrite(cardId, result.snapshot)).catch(() => {});
      } catch (e) {
        resolved.set(cardId, { ok: false, error: String(e), sourceType: card.source_type });
      }
    })
  );

  return resolved;
}

describe("resolveRefs", () => {
  const mockResult = makeUnfurlResult("live data");

  let resolveCallCount = 0;
  let resolveCalledWith: Array<[string, UnfurlCredentials]> = [];

  const mockAdapter: UnfurlAdapter = {
    sourceType: "trello",
    credentialFields: [],
    async resolve(ref: string, creds: UnfurlCredentials): Promise<UnfurlResult> {
      resolveCallCount++;
      resolveCalledWith.push([ref, creds]);
      return mockResult;
    },
  };

  beforeEach(() => {
    resolveCallCount = 0;
    resolveCalledWith = [];
  });

  it("'cached' 모드: source_snapshot 있으면 parseSnapshot으로 반환하고 adapter.resolve 호출 안 함", async () => {
    const cachedResult = makeUnfurlResult("cached data");
    const card = makeCard({
      id: "card-1",
      title: "Test",
      source_type: "trello",
      source_ref: "ABC123",
      source_snapshot: cachedResult.snapshot,
    });

    const cardCache = new Map([["card-1", card]]);
    const snapshotWrites: string[] = [];

    const result = await resolveRefsTestable(
      cardCache,
      "cached",
      { trello: { apiKey: "k", token: "t" } },
      (t) => (t === "trello" ? mockAdapter : undefined),
      (id) => snapshotWrites.push(id)
    );

    expect(result.get("card-1")?.ok).toBe(true);
    expect(result.get("card-1")?.result?.text).toBe("cached data");
    expect(resolveCallCount).toBe(0);
    expect(snapshotWrites).toHaveLength(0);
  });

  it("'cached' 모드: snapshot 없으면 adapter.resolve() 호출하고 snapshot write-back", async () => {
    const card = makeCard({
      id: "card-2",
      title: "Test",
      source_type: "trello",
      source_ref: "DEF456",
      source_snapshot: null,
    });

    const cardCache = new Map([["card-2", card]]);
    const snapshotWrites: string[] = [];

    const result = await resolveRefsTestable(
      cardCache,
      "cached",
      { trello: { apiKey: "k", token: "t" } },
      (t) => (t === "trello" ? mockAdapter : undefined),
      (id) => snapshotWrites.push(id)
    );

    expect(result.get("card-2")?.ok).toBe(true);
    expect(result.get("card-2")?.result?.text).toBe("live data");
    expect(resolveCallCount).toBe(1);
    expect(resolveCalledWith[0][0]).toBe("DEF456");
    expect(resolveCalledWith[0][1]).toEqual({ apiKey: "k", token: "t" });

    // flush microtasks for fire-and-forget
    await new Promise((r) => setTimeout(r, 0));
    expect(snapshotWrites).toContain("card-2");
  });

  it("'fresh' 모드: snapshot 있어도 항상 adapter.resolve() 호출", async () => {
    const cachedResult = makeUnfurlResult("old cached");
    const card = makeCard({
      id: "card-3",
      title: "Test",
      source_type: "trello",
      source_ref: "GHI789",
      source_snapshot: cachedResult.snapshot,
    });

    const cardCache = new Map([["card-3", card]]);
    const snapshotWrites: string[] = [];

    const result = await resolveRefsTestable(
      cardCache,
      "fresh",
      { trello: { apiKey: "k", token: "t" } },
      (t) => (t === "trello" ? mockAdapter : undefined),
      (id) => snapshotWrites.push(id)
    );

    expect(result.get("card-3")?.ok).toBe(true);
    expect(result.get("card-3")?.result?.text).toBe("live data");
    expect(resolveCallCount).toBe(1);
    expect(resolveCalledWith[0][0]).toBe("GHI789");
  });

  it("adapter 없는 source_type: skip하고 나머지 정상 처리", async () => {
    const card1 = makeCard({
      id: "card-4",
      title: "GitHub",
      source_type: "github",
      source_ref: "some-repo",
    });
    const card2 = makeCard({
      id: "card-5",
      title: "Trello",
      source_type: "trello",
      source_ref: "JKL012",
    });

    const cardCache = new Map([
      ["card-4", card1],
      ["card-5", card2],
    ]);

    const result = await resolveRefsTestable(
      cardCache,
      "fresh",
      { trello: { apiKey: "k", token: "t" } },
      (t) => (t === "trello" ? mockAdapter : undefined), // github adapter 없음
      () => {}
    );

    expect(result.has("card-4")).toBe(false); // skip됨
    expect(result.get("card-5")?.ok).toBe(true);
    expect(resolveCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TrelloAdapter
// ---------------------------------------------------------------------------

describe("TrelloAdapter", () => {
  let adapter: TrelloAdapter;
  let fetchCalls: Array<string> = [];
  let fetchResponses: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown> }> = [];

  const mockFetch = async (url: string): Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }> => {
    fetchCalls.push(url);
    const response = fetchResponses.shift();
    if (!response) throw new Error("No mock response configured");
    return response;
  };

  beforeAll(() => {
    adapter = new TrelloAdapter();
    global.fetch = mockFetch as typeof fetch;
  });

  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  const mockApiResponse = {
    id: "card-id-abc",
    name: "Test Card",
    desc: "A description",
    shortUrl: "https://trello.com/c/ABC123",
    labels: [{ name: "Bug", color: "red" }],
    members: [{ fullName: "Jane Doe" }],
    due: "2026-05-01T00:00:00.000Z",
    dueComplete: false,
    checklists: [
      {
        name: "Subtasks",
        checkItems: [
          { name: "Step 1", state: "complete" },
          { name: "Step 2", state: "incomplete" },
        ],
      },
    ],
  };

  it("resolve: fetch mock으로 정상 응답 테스트 — UnfurlResult 반환", async () => {
    fetchResponses.push({ ok: true, json: async () => mockApiResponse });

    const result = await adapter.resolve("ABC123", { apiKey: "key", token: "tok" });

    expect(result.text).toContain("Test Card");
    expect(result.text).toContain("Bug");
    expect(result.text).toContain("Jane Doe");
    expect(result.text).toContain("Step 1");
    expect(result.text).toContain("Step 2");
    expect(result.text).toContain("[x] Step 1");
    expect(result.text).toContain("[ ] Step 2");

    const data = JSON.parse(result.snapshot);
    expect(data.id).toBe("card-id-abc");
    expect(data.name).toBe("Test Card");
    expect(data.checklists[0].items).toHaveLength(2);
  });

  it("resolve: trello.com URL에서 shortLink 추출", async () => {
    fetchResponses.push({ ok: true, json: async () => mockApiResponse });

    await adapter.resolve("https://trello.com/c/ABC123/my-card-title", {
      apiKey: "key",
      token: "tok",
    });

    expect(fetchCalls[0]).toContain("/cards/ABC123");
  });

  it("resolve: API 에러 시 throw", async () => {
    fetchResponses.push({ ok: false, status: 401 });

    await expect(
      adapter.resolve("ABC123", { apiKey: "bad-key", token: "bad-tok" })
    ).rejects.toThrow("401");
  });

  it("resolve: apiKey 누락 시 throw", async () => {
    await expect(
      adapter.resolve("ABC123", { token: "tok" })
    ).rejects.toThrow("apiKey and token are required");
  });

  it("canHandle: trello.com/c/ URL에 대해 true 반환", () => {
    expect(adapter.canHandle("https://trello.com/c/ABC123")).toBe(true);
    expect(adapter.canHandle("https://trello.com/c/ABC123/my-card-title")).toBe(true);
  });

  it("canHandle: trello.com/c/ 포함하지 않는 ref에 대해 false 반환", () => {
    expect(adapter.canHandle("ABC123")).toBe(false);
    expect(adapter.canHandle("https://github.com/org/repo")).toBe(false);
    expect(adapter.canHandle("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AdapterRegistry.findByRef
// ---------------------------------------------------------------------------

describe("AdapterRegistry.findByRef", () => {
  it("canHandle이 true인 어댑터를 반환한다", () => {
    const registry = new AdapterRegistry();
    const trello = new TrelloAdapter();
    registry.register(trello);

    const found = registry.findByRef("https://trello.com/c/SHORTLINK");
    expect(found).toBe(trello);
  });

  it("매칭되는 어댑터가 없으면 undefined 반환", () => {
    const registry = new AdapterRegistry();
    registry.register(new TrelloAdapter());

    const found = registry.findByRef("https://github.com/org/repo");
    expect(found).toBeUndefined();
  });

  it("canHandle이 없는 어댑터는 findByRef에서 무시된다", () => {
    const registry = new AdapterRegistry();
    const noCanHandle: UnfurlAdapter = {
      sourceType: "web",
      credentialFields: [],
      async resolve() {
        return { text: "", snapshot: "{}", unfurlData: null };
      },
      // canHandle 미구현
    };
    registry.register(noCanHandle);

    const found = registry.findByRef("https://trello.com/c/SHORTLINK");
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveRefs fallback: source_type="web", source_ref="https://trello.com/c/..."
// ---------------------------------------------------------------------------

describe("resolveRefs — canHandle fallback", () => {
  const mockResult = makeUnfurlResult("trello via fallback");

  const trelloAdapter: UnfurlAdapter = {
    sourceType: "trello",
    credentialFields: [],
    canHandle: (ref: string) => ref.includes("trello.com/c/"),
    async resolve(ref: string, creds: UnfurlCredentials): Promise<UnfurlResult> {
      void ref; void creds;
      return mockResult;
    },
  };

  it("source_type='web'이어도 source_ref가 trello URL이면 TrelloAdapter로 unfurl된다", async () => {
    const card = makeCard({
      id: "card-fallback-1",
      title: "Trello card via web type",
      source_type: "web",
      source_ref: "https://trello.com/c/SHORTLINK",
      source_snapshot: null,
    });

    const cardCache = new Map([["card-fallback-1", card]]);
    const snapshotWrites: string[] = [];
    const sourceTypeRepairs: Array<{ cardId: string; sourceType: string }> = [];

    const result = await resolveRefsTestable(
      cardCache,
      "fresh",
      { trello: { apiKey: "k", token: "t" } },
      (_t) => undefined, // "web" 어댑터 없음
      (id) => snapshotWrites.push(id),
      (ref) => (ref.includes("trello.com/c/") ? trelloAdapter : undefined),
      (cardId, sourceType) => sourceTypeRepairs.push({ cardId, sourceType })
    );

    expect(result.get("card-fallback-1")?.ok).toBe(true);
    expect(result.get("card-fallback-1")?.result?.text).toBe("trello via fallback");

    // flush microtasks for fire-and-forget
    await new Promise((r) => setTimeout(r, 0));
    expect(sourceTypeRepairs).toContainEqual({ cardId: "card-fallback-1", sourceType: "trello" });
  });

  it("source_type='web'이고 ref도 trello URL이 아니면 skip된다", async () => {
    const card = makeCard({
      id: "card-fallback-2",
      title: "Unknown web",
      source_type: "web",
      source_ref: "https://example.com/article",
      source_snapshot: null,
    });

    const cardCache = new Map([["card-fallback-2", card]]);

    const result = await resolveRefsTestable(
      cardCache,
      "fresh",
      {},
      (_t) => undefined,
      () => {},
      (ref) => (ref.includes("trello.com/c/") ? trelloAdapter : undefined)
    );

    expect(result.has("card-fallback-2")).toBe(false);
  });
});
