import type { Card } from "../../src/shared/types.js";
import { resolveCompileRefs, type CompileUnfurlDeps } from "../../src/services/compile-unfurl.service.js";
import type { UnfurlAdapter, UnfurlCredentials, UnfurlResult } from "../../src/unfurl/interface.js";

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
  const unfurlData = { text };
  return {
    text,
    snapshot: JSON.stringify({ text, unfurlData }),
    unfurlData,
  };
}

function makeCompileUnfurlDeps(options: {
  findAdapter: (sourceType: string) => UnfurlAdapter | undefined;
  findAdapterByRef?: (ref: string) => UnfurlAdapter | undefined;
  onSnapshotWrite?: (cardId: string, snapshot: string) => void | Promise<void>;
  onSourceTypeRepair?: (cardId: string, sourceType: string) => void | Promise<void>;
  onLogError?: (message: string, error: unknown) => void;
}): CompileUnfurlDeps {
  return {
    findAdapter: options.findAdapter,
    findAdapterByRef: options.findAdapterByRef ?? (() => undefined),
    writeSnapshot: async (cardId, snapshot) => {
      await options.onSnapshotWrite?.(cardId, snapshot);
    },
    repairSourceType: async (cardId, sourceType) => {
      await options.onSourceTypeRepair?.(cardId, sourceType);
    },
    logError: options.onLogError ?? (() => {}),
  };
}

describe("resolveCompileRefs", () => {
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

    const snapshotWrites: string[] = [];
    const result = await resolveCompileRefs(
      new Map([["card-1", card]]),
      "cached",
      { trello: { apiKey: "k", token: "t" } },
      makeCompileUnfurlDeps({
        findAdapter: (t) => (t === "trello" ? mockAdapter : undefined),
        onSnapshotWrite: (id) => {
          snapshotWrites.push(id);
        },
      })
    );

    const resolved = result.get("card-1");
    expect(resolved?.ok && resolved.result.text).toBe("cached data");
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

    const snapshotWrites: string[] = [];
    const result = await resolveCompileRefs(
      new Map([["card-2", card]]),
      "cached",
      { trello: { apiKey: "k", token: "t" } },
      makeCompileUnfurlDeps({
        findAdapter: (t) => (t === "trello" ? mockAdapter : undefined),
        onSnapshotWrite: (id) => {
          snapshotWrites.push(id);
        },
      })
    );

    const resolved = result.get("card-2");
    expect(resolved?.ok && resolved.result.text).toBe("live data");
    expect(resolveCallCount).toBe(1);
    expect(resolveCalledWith[0][0]).toBe("DEF456");
    expect(resolveCalledWith[0][1]).toEqual({ apiKey: "k", token: "t" });

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

    const result = await resolveCompileRefs(
      new Map([["card-3", card]]),
      "fresh",
      { trello: { apiKey: "k", token: "t" } },
      makeCompileUnfurlDeps({
        findAdapter: (t) => (t === "trello" ? mockAdapter : undefined),
      })
    );

    const resolved = result.get("card-3");
    expect(resolved?.ok && resolved.result.text).toBe("live data");
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

    const result = await resolveCompileRefs(
      new Map([
        ["card-4", card1],
        ["card-5", card2],
      ]),
      "fresh",
      { trello: { apiKey: "k", token: "t" } },
      makeCompileUnfurlDeps({
        findAdapter: (t) => (t === "trello" ? mockAdapter : undefined),
      })
    );

    expect(result.has("card-4")).toBe(false);
    expect(result.get("card-5")?.ok).toBe(true);
    expect(resolveCallCount).toBe(1);
  });

  it("'cached' 모드: snapshot 파싱 실패는 실패 result로 기록하고 compile을 깨지 않는다", async () => {
    const card = makeCard({
      id: "card-bad-snapshot",
      title: "Bad snapshot",
      source_type: "trello",
      source_ref: "BAD",
      source_snapshot: "not json",
    });

    const result = await resolveCompileRefs(
      new Map([["card-bad-snapshot", card]]),
      "cached",
      {},
      makeCompileUnfurlDeps({
        findAdapter: (t) => (t === "trello" ? mockAdapter : undefined),
      })
    );

    const resolved = result.get("card-bad-snapshot");
    expect(resolved?.ok).toBe(false);
    expect(resolved?.ok === false && resolved.error).toContain("SyntaxError");
    expect(resolveCallCount).toBe(0);
  });

  it("adapter.resolve 실패는 실패 result로 기록하고 다른 카드 처리를 계속한다", async () => {
    const failingAdapter: UnfurlAdapter = {
      sourceType: "broken",
      credentialFields: [],
      async resolve(): Promise<UnfurlResult> {
        throw new Error("adapter down");
      },
    };

    const brokenCard = makeCard({
      id: "card-broken",
      title: "Broken",
      source_type: "broken",
      source_ref: "BROKEN",
    });
    const goodCard = makeCard({
      id: "card-good",
      title: "Good",
      source_type: "trello",
      source_ref: "GOOD",
    });

    const result = await resolveCompileRefs(
      new Map([
        ["card-broken", brokenCard],
        ["card-good", goodCard],
      ]),
      "fresh",
      {},
      makeCompileUnfurlDeps({
        findAdapter: (t) => {
          if (t === "broken") return failingAdapter;
          if (t === "trello") return mockAdapter;
          return undefined;
        },
      })
    );

    const broken = result.get("card-broken");
    const good = result.get("card-good");
    expect(broken?.ok).toBe(false);
    expect(broken?.ok === false && broken.error).toContain("adapter down");
    expect(good?.ok).toBe(true);
  });

  it("snapshot write-back 실패는 fire-and-forget으로 기록하고 성공 result는 유지한다", async () => {
    const card = makeCard({
      id: "card-write-fail",
      title: "Write fail",
      source_type: "trello",
      source_ref: "WRITEFAIL",
    });
    const errors: Array<{ message: string; error: unknown }> = [];

    const result = await resolveCompileRefs(
      new Map([["card-write-fail", card]]),
      "fresh",
      {},
      makeCompileUnfurlDeps({
        findAdapter: (t) => (t === "trello" ? mockAdapter : undefined),
        onSnapshotWrite: async () => {
          throw new Error("write failed");
        },
        onLogError: (message, error) => errors.push({ message, error }),
      })
    );

    expect(result.get("card-write-fail")?.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(errors[0]?.message).toBe("[unfurl] snapshot write failed");
    expect(errors[0]?.error).toBeInstanceOf(Error);
  });
});

describe("resolveCompileRefs — canHandle fallback", () => {
  const mockResult = makeUnfurlResult("trello via fallback");

  const trelloAdapter: UnfurlAdapter = {
    sourceType: "trello",
    credentialFields: [],
    canHandle: (ref: string) => ref.includes("trello.com/c/"),
    async resolve(ref: string, creds: UnfurlCredentials): Promise<UnfurlResult> {
      void ref;
      void creds;
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
    const snapshotWrites: string[] = [];
    const sourceTypeRepairs: Array<{ cardId: string; sourceType: string }> = [];

    const result = await resolveCompileRefs(
      new Map([["card-fallback-1", card]]),
      "fresh",
      { trello: { apiKey: "k", token: "t" } },
      makeCompileUnfurlDeps({
        findAdapter: (_t) => undefined,
        findAdapterByRef: (ref) => (ref.includes("trello.com/c/") ? trelloAdapter : undefined),
        onSnapshotWrite: (id) => {
          snapshotWrites.push(id);
        },
        onSourceTypeRepair: (cardId, sourceType) => {
          sourceTypeRepairs.push({ cardId, sourceType });
        },
      })
    );

    const resolved = result.get("card-fallback-1");
    expect(resolved?.ok && resolved.result.text).toBe("trello via fallback");

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

    const result = await resolveCompileRefs(
      new Map([["card-fallback-2", card]]),
      "fresh",
      {},
      makeCompileUnfurlDeps({
        findAdapter: (_t) => undefined,
        findAdapterByRef: (ref) => (ref.includes("trello.com/c/") ? trelloAdapter : undefined),
      })
    );

    expect(result.has("card-fallback-2")).toBe(false);
  });

  it("source_type repair 실패는 fire-and-forget으로 기록하고 성공 result는 유지한다", async () => {
    const card = makeCard({
      id: "card-fallback-repair-fail",
      title: "Repair fail",
      source_type: "web",
      source_ref: "https://trello.com/c/SHORTLINK",
      source_snapshot: null,
    });
    const errors: Array<{ message: string; error: unknown }> = [];

    const result = await resolveCompileRefs(
      new Map([["card-fallback-repair-fail", card]]),
      "fresh",
      {},
      makeCompileUnfurlDeps({
        findAdapter: (_t) => undefined,
        findAdapterByRef: (ref) => (ref.includes("trello.com/c/") ? trelloAdapter : undefined),
        onSourceTypeRepair: async () => {
          throw new Error("repair failed");
        },
        onLogError: (message, error) => errors.push({ message, error }),
      })
    );

    expect(result.get("card-fallback-repair-fail")?.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(errors[0]?.message).toBe("[unfurl] source_type repair failed");
    expect(errors[0]?.error).toBeInstanceOf(Error);
  });
});
