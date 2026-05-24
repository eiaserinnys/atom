import {
  buildRelaxedPlainQuery,
  buildSearchFallbackQueries,
} from "../../src/services/search.service.js";

describe("search fallback query builders", () => {
  it("keeps the existing long plain-language OR fallback", () => {
    expect(
      buildRelaxedPlainQuery("search_cards BM25 natural language missing words")
    ).toBe("search_cards OR BM25 OR natural OR language OR missing OR words");
  });

  it("adds domain synonym fallback for short zero-result style queries", () => {
    expect(buildSearchFallbackQueries("treeview broken")).toContain(
      "treeview OR broken OR tree OR TreeView OR layout OR responsive OR mobile"
    );
  });

  it("does not rewrite explicit websearch syntax", () => {
    expect(buildSearchFallbackQueries('"treeview broken" OR responsive')).toEqual([]);
  });
});
