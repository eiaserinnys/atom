/**
 * Integration tests split from api.test.ts.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import { setupIntegrationTestDb } from "./integration-harness.js";
import * as cardService from "../../src/services/card.service.js";
import * as searchService from "../../src/services/search.service.js";

setupIntegrationTestDb();

describe("BM25 Search", () => {
  it("returns matching cards by keyword", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Quantum Mechanics",
      content: "The study of subatomic particles",
      tags: ["physics"],
    });

    await cardService.createCard({
      card_type: "knowledge",
      title: "Classical Music",
      content: "Beethoven and Mozart compositions",
      tags: ["music"],
    });

    const results = await searchService.searchCards({ query: "quantum" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toBe("Quantum Mechanics");
  });

  it("returns empty array when no match", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Hello World",
      content: "Some content",
    });

    const results = await searchService.searchCards({ query: "xyznonexistentkeyword12345" });
    expect(results.length).toBe(0);
  });

  it("search result includes node_id, title, card_type, snippet", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Photosynthesis",
      content: "Plants convert sunlight to energy",
    });

    const results = await searchService.searchCards({ query: "photosynthesis" });
    expect(results.length).toBeGreaterThan(0);
    const r = results[0]!;
    expect(r).toHaveProperty("card_id");
    expect(r).toHaveProperty("node_id");
    expect(r).toHaveProperty("title");
    expect(r).toHaveProperty("card_type");
    expect(r).toHaveProperty("snippet");
    expect(r).toHaveProperty("is_symlink");
    expect(r).toHaveProperty("node_path");
  });

  it("supports OR search with websearch syntax", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Astrophysics Overview",
      content: "The study of stars and galaxies",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Oceanography Basics",
      content: "The study of ocean currents",
    });

    const results = await searchService.searchCards({ query: "astrophysics OR oceanography" });
    const titles = results.map((r) => r.title);
    expect(titles).toContain("Astrophysics Overview");
    expect(titles).toContain("Oceanography Basics");
  });

  it("relaxes long plain-language queries when strict BM25 returns zero", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Search Cards BM25 Recovery",
      content: "root_node_id filters websearch_to_tsquery query protocol",
    });

    const query =
      "search_cards BM25 natural language missing words root_node_id filters";

    const strictResults = await searchService.searchCards({
      query,
      strategy: "strict",
    });
    expect(strictResults.length).toBe(0);

    const relaxedResults = await searchService.searchCards({ query });
    expect(relaxedResults.length).toBeGreaterThan(0);
    expect(relaxedResults.map((r) => r.title)).toContain("Search Cards BM25 Recovery");
  });

  it("expands short domain queries with synonyms when strict BM25 returns zero", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Responsive Layout Recovery",
      content: "mobile responsive layout fallback",
    });

    const strictResults = await searchService.searchCards({
      query: "treeview broken",
      strategy: "strict",
    });
    expect(strictResults.length).toBe(0);

    const expandedResults = await searchService.searchCards({ query: "treeview broken" });
    expect(expandedResults.map((r) => r.title)).toContain("Responsive Layout Recovery");
  });

  it("keeps explicit phrase and exclusion queries strict", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Explicit Search Syntax Guard",
      content: "alpha beta root_node_id filters excluded",
    });

    const phraseResults = await searchService.searchCards({
      query: '"alpha gamma" root_node_id filters',
    });
    expect(phraseResults.length).toBe(0);

    const excludeResults = await searchService.searchCards({
      query: "root_node_id filters -excluded",
    });
    expect(excludeResults.length).toBe(0);
  });

  it("includes node_path breadcrumb in search results", async () => {
    const rootResult = await cardService.createCard({
      card_type: "structure",
      title: "RootSection",
      content: null,
    });
    const parentResult = await cardService.createCard({
      card_type: "structure",
      title: "ParentSection",
      content: null,
      parent_node_id: rootResult.node_id!,
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "LeafCard Breadcrumb Test",
      content: "Testing the breadcrumb path",
      parent_node_id: parentResult.node_id!,
    });

    const results = await searchService.searchCards({ query: "breadcrumb" });
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.title === "LeafCard Breadcrumb Test");
    expect(r).toBeDefined();
    expect(r!.node_path).toEqual(["RootSection", "ParentSection"]);
  });
});

describe("Search Filters", () => {
  it("filters by tags (AND semantics)", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "FilterTag Physics Chemistry",
      content: "Atoms and molecules study",
      tags: ["physics", "chemistry"],
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "FilterTag Physics Only",
      content: "Atoms in isolation study",
      tags: ["physics"],
    });

    // Filter by both tags — only the first card has both
    const results = await searchService.searchCards({
      query: "atoms",
      tags: ["physics", "chemistry"],
    });
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("FilterTag Physics Chemistry");
  });

  it("filters by card_type", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "CardTypeFilter Knowledge Item",
      content: "This is knowledge content",
    });
    await cardService.createCard({
      card_type: "structure",
      title: "CardTypeFilter Structure Item",
      content: "This is structure content",
    });

    const knowledgeResults = await searchService.searchCards({
      query: "cardtypefilter",
      card_type: "knowledge",
    });
    expect(knowledgeResults.length).toBe(1);
    expect(knowledgeResults[0]!.card_type).toBe("knowledge");

    const structureResults = await searchService.searchCards({
      query: "cardtypefilter",
      card_type: "structure",
    });
    expect(structureResults.length).toBe(1);
    expect(structureResults[0]!.card_type).toBe("structure");
  });

  it("filters by source_type", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "SourceTypeFilter Trello Card",
      content: "Imported from trello board",
      source_type: "trello",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "SourceTypeFilter GitHub Issue",
      content: "Imported from github repo",
      source_type: "github",
    });

    const results = await searchService.searchCards({
      query: "sourcetypefilter",
      source_type: "trello",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("SourceTypeFilter Trello Card");
  });

  it("filters by updated_after / updated_before", async () => {
    // Create cards — they'll have current timestamps
    await cardService.createCard({
      card_type: "knowledge",
      title: "DateFilter Recent Card",
      content: "Created recently for date filter test",
    });

    // Search with updated_after far in the past → should find the card
    const pastResults = await searchService.searchCards({
      query: "datefilter",
      updated_after: "2000-01-01T00:00:00Z",
    });
    expect(pastResults.length).toBe(1);

    // Search with updated_after far in the future → should find nothing
    const futureResults = await searchService.searchCards({
      query: "datefilter",
      updated_after: "2099-01-01T00:00:00Z",
    });
    expect(futureResults.length).toBe(0);

    // Search with updated_before far in the past → should find nothing
    const beforePastResults = await searchService.searchCards({
      query: "datefilter",
      updated_before: "2000-01-01T00:00:00Z",
    });
    expect(beforePastResults.length).toBe(0);
  });

  it("combines multiple filters (compound conditions)", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "Compound Alpha Filter Test",
      content: "Testing compound filter combination",
      tags: ["alpha"],
      source_type: "trello",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Compound Beta Filter Test",
      content: "Another compound filter combination test",
      tags: ["beta"],
      source_type: "github",
    });
    await cardService.createCard({
      card_type: "structure",
      title: "Compound Alpha Structure Filter",
      content: "Structure with alpha tag compound",
      tags: ["alpha"],
      source_type: "trello",
    });

    // tags=alpha + card_type=knowledge + source_type=trello → only first card
    const results = await searchService.searchCards({
      query: "compound",
      tags: ["alpha"],
      card_type: "knowledge",
      source_type: "trello",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Compound Alpha Filter Test");
  });

  it("returns empty when tag does not exist on any card", async () => {
    await cardService.createCard({
      card_type: "knowledge",
      title: "NoSuchTag Card",
      content: "Content for no such tag test",
      tags: ["existing"],
    });

    const results = await searchService.searchCards({
      query: "nosuchtag",
      tags: ["nonexistent_tag_xyz"],
    });
    expect(results.length).toBe(0);
  });
});
