import type { UnfurlAdapter, UnfurlResult } from "../../src/unfurl/interface.js";
import { parseSnapshot } from "../../src/unfurl/utils.js";
import { TrelloAdapter } from "../../src/unfurl/adapters/trello/index.js";
import { AdapterRegistry } from "../../src/unfurl/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUnfurlResult(text: string = "resolved"): UnfurlResult {
  const unfurlData = { text };
  return {
    text,
    snapshot: JSON.stringify({ text, unfurlData }),
    unfurlData,
  };
}

// ---------------------------------------------------------------------------
// parseSnapshot
// ---------------------------------------------------------------------------

describe("parseSnapshot", () => {
  it("parses valid JSON snapshot into UnfurlResult", () => {
    const result = makeUnfurlResult("hello");
    const parsed = parseSnapshot(result.snapshot);
    expect(parsed.text).toBe("hello");
    expect(parsed.unfurlData).toEqual({ text: "hello" });
  });

  it("parses legacy format (raw unfurlData) with backward compat", () => {
    const legacy = JSON.stringify({ id: "abc", name: "Test Card" });
    const parsed = parseSnapshot(legacy);
    expect(parsed.unfurlData).toEqual({ id: "abc", name: "Test Card" });
    expect(parsed.text).toBe("");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSnapshot("not json")).toThrow();
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
    expect(data.unfurlData.id).toBe("card-id-abc");
    expect(data.unfurlData.name).toBe("Test Card");
    expect(data.unfurlData.checklists[0].items).toHaveLength(2);
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
