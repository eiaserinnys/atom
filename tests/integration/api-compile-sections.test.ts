import Fastify, { type FastifyInstance } from "fastify";

import { treeRoutes } from "../../src/api/routes/tree.js";
import * as cardService from "../../src/services/card.service.js";
import { adapterRegistry } from "../../src/unfurl/registry.js";
import { setupIntegrationTestDb } from "./integration-harness.js";

setupIntegrationTestDb();

interface CompileSectionFixture {
  heading: string;
  content?: string | null;
  unfurl_text?: string | null;
}

function joinSections(sections: CompileSectionFixture[]): string {
  return sections.map((section) => {
    const lines = [section.heading];
    if (section.content) lines.push(section.content);
    if (section.unfurl_text) lines.push(section.unfurl_text);
    return lines.join("\n");
  }).join("\n");
}

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(treeRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("compile section routes", () => {
  it("GET sections join exactly to the numbered GET compile response", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure", title: "Section root", content: "Root body\n## Root inner",
    });
    await cardService.createCard({
      card_type: "knowledge", title: "Section child", content: "Child body\n### Child inner",
      parent_node_id: rootId,
    });

    const sectionsResponse = await app.inject({
      method: "GET", url: `/tree/${rootId}/compile/sections?depth=2&head_chars=200000`,
    });
    const compileResponse = await app.inject({
      method: "GET", url: `/tree/${rootId}/compile?depth=2&numbering=true&include_ids=true`,
    });

    expect(sectionsResponse.statusCode).toBe(200);
    expect(compileResponse.statusCode).toBe(200);
    const sectionsBody = sectionsResponse.json();
    expect(sectionsBody.sections[1].heading).toMatch(/^## 1 Section child /);
    expect(sectionsBody.sections[1].title).toBe("1 Section child");
    expect(joinSections(sectionsBody.sections)).toBe(compileResponse.json().markdown);

    const limitedResponse = await app.inject({
      method: "GET", url: `/tree/${rootId}/compile/sections?depth=2&head_chars=1`,
    });
    const limitedSections = limitedResponse.json().sections;
    expect(limitedSections[0].content).toBe("Root body\n## Root inner");
    expect(Object.hasOwn(limitedSections[1], "content")).toBe(false);
  });

  it("POST sections join exactly to the existing POST compile response without numbering", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure", title: "Preview root", content: "Root body",
    });
    await cardService.createCard({
      card_type: "knowledge", title: "Preview child", content: "Child body",
      parent_node_id: rootId,
    });

    const sectionsResponse = await app.inject({
      method: "POST", url: `/tree/${rootId}/compile/sections`,
      payload: { depth: 2, head_chars: 200000 },
    });
    const compileResponse = await app.inject({
      method: "POST", url: `/tree/${rootId}/compile`, payload: { depth: 2 },
    });

    expect(sectionsResponse.statusCode).toBe(200);
    expect(compileResponse.statusCode).toBe(200);
    const sectionsBody = sectionsResponse.json();
    expect(sectionsBody.sections[1].heading).toMatch(/^## Preview child /);
    expect(sectionsBody.sections[1].title).toBe("Preview child");
    expect(joinSections(sectionsBody.sections)).toBe(compileResponse.json().markdown);
  });

  it("POST sections preserves resolved link preview text and unfurl metadata", async () => {
    adapterRegistry.register({
      sourceType: "compile-sections-test",
      credentialFields: [],
      canHandle: (ref) => ref.startsWith("sections://"),
      resolve: async () => ({ text: "Resolved preview", snapshot: "{}", unfurlData: { kind: "test" } }),
    });
    const { node_id: rootId, card } = await cardService.createCard({
      card_type: "knowledge", title: "Linked section", content: "Link body",
      source_type: "compile-sections-test", source_ref: "sections://item",
    });
    const payload = { depth: 2, resolveRefs: "fresh", head_chars: 200000 };

    const sectionsResponse = await app.inject({
      method: "POST", url: `/tree/${rootId}/compile/sections`, payload,
    });
    const compileResponse = await app.inject({
      method: "POST", url: `/tree/${rootId}/compile`, payload,
    });

    expect(sectionsResponse.statusCode).toBe(200);
    expect(compileResponse.statusCode).toBe(200);
    const sectionsBody = sectionsResponse.json();
    const compileBody = compileResponse.json();
    expect(sectionsBody.sections[0].unfurl_text).toBe("Resolved preview");
    expect(sectionsBody.unfurls).toEqual(compileBody.unfurls);
    expect(sectionsBody.unfurls).toHaveProperty(card.id);
    expect(joinSections(sectionsBody.sections)).toBe(compileBody.markdown);
  });

  it("POST contents resolves the static route and deduplicates card IDs", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge", title: "Content target", content: "requested body",
    });

    const response = await app.inject({
      method: "POST", url: "/tree/compile/contents",
      payload: { card_ids: [card.id, card.id, "00000000-0000-4000-8000-000000000001"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().contents).toEqual({
      [card.id]: { version: card.version, content: "requested body" },
    });
  });

  it.each([-1, 200001, "abc", ""]) (
    "rejects head_chars=%p outside the documented range",
    async (headChars) => {
      const { node_id: rootId } = await cardService.createCard({
        card_type: "structure", title: "Invalid head chars",
      });
      const response = await app.inject({
        method: "GET", url: `/tree/${rootId}/compile/sections?head_chars=${encodeURIComponent(String(headChars))}`,
      });
      expect(response.statusCode).toBe(400);
      const postResponse = await app.inject({
        method: "POST", url: `/tree/${rootId}/compile/sections`,
        payload: { head_chars: headChars },
      });
      expect(postResponse.statusCode).toBe(400);
    }
  );

  it("rejects card_ids outside the 1–200 item array boundary", async () => {
    const responseFor = (cardIds: unknown) => app.inject({
      method: "POST", url: "/tree/compile/contents", payload: { card_ids: cardIds },
    });
    expect((await responseFor([])).statusCode).toBe(400);
    expect((await responseFor(Array.from({ length: 201 }, (_, index) => `card-${index}`))).statusCode).toBe(400);
    expect((await responseFor("not-an-array")).statusCode).toBe(400);
  });

  it("rejects a blank or overlong find query", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure", title: "Find root",
    });
    expect((await app.inject({ method: "GET", url: `/tree/${rootId}/compile/find?q=%20%20` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/tree/${rootId}/compile/find?q=${"x".repeat(201)}` })).statusCode).toBe(400);
  });

  it("finds non-overlapping matches in section titles and bodies", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure", title: "Needle root", content: "Needle aaa",
    });
    await cardService.createCard({
      card_type: "knowledge", title: "Other", content: "AAA",
      parent_node_id: rootId,
    });

    const response = await app.inject({
      method: "GET", url: `/tree/${rootId}/compile/find?depth=2&q=needle`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ matches: [{ index: 0, count: 2 }], total: 2 });

    const nonOverlappingResponse = await app.inject({
      method: "GET", url: `/tree/${rootId}/compile/find?depth=2&q=aa`,
    });
    expect(nonOverlappingResponse.json()).toEqual({ matches: [{ index: 0, count: 1 }, { index: 1, count: 1 }], total: 2 });
  });

  it("returns card content and version through the batch query", async () => {
    const { card } = await cardService.createCard({
      card_type: "knowledge", title: "Versioned body", content: null,
    });
    const response = await app.inject({
      method: "POST", url: "/tree/compile/contents", payload: { card_ids: [card.id] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().contents[card.id]).toEqual({ version: card.version, content: null });
  });
});
