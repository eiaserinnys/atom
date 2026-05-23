import { topologicalSortCreates } from "../../src/services/batch.service.js";

describe("topologicalSortCreates", () => {
  it("returns items in dependency order", () => {
    const items = [
      { temp_id: "c", parent_temp_id: "b", card_type: "knowledge" as const, title: "C" },
      { temp_id: "a", card_type: "structure" as const, title: "A" },
      { temp_id: "b", parent_temp_id: "a", card_type: "structure" as const, title: "B" },
    ];
    const sorted = topologicalSortCreates(items);
    const ids = sorted.map((i) => i.temp_id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("throws on circular parent_temp_id", () => {
    const items = [
      { temp_id: "a", parent_temp_id: "b", card_type: "structure" as const, title: "A" },
      { temp_id: "b", parent_temp_id: "a", card_type: "structure" as const, title: "B" },
    ];
    expect(() => topologicalSortCreates(items)).toThrow(/[Cc]ircular/);
  });

  it("throws on unknown parent_temp_id", () => {
    const items = [
      { temp_id: "a", parent_temp_id: "nonexistent", card_type: "structure" as const, title: "A" },
    ];
    expect(() => topologicalSortCreates(items)).toThrow(/not found/);
  });
});
