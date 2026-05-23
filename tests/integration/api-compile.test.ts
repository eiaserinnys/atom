/**
 * Integration tests split from api.test.ts.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import { setupIntegrationTestDb } from "./integration-harness.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";

setupIntegrationTestDb();

describe("compile_subtree", () => {
  it("compiles a tree to markdown with correct heading levels", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "Root",
      content: "Root content",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      content: "Child content",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2);
    expect(md).toContain("# Root");
    expect(md).toContain("Root content");
    expect(md).toContain("## Child");
    expect(md).toContain("Child content");
  });

  it("depth=0 returns only the root node", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "Root",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "Child",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 0);
    expect(md).toContain("# Root");
    expect(md).not.toContain("Child");
  });

  it("titles_only returns indented tree without content", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "TitlesRoot",
      content: "Should not appear",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "TitlesChild",
      content: "Also hidden",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2, { titlesOnly: true });
    expect(md).toContain("TitlesRoot");
    expect(md).toContain("├── TitlesChild");
    expect(md).not.toContain("Should not appear");
    expect(md).not.toContain("Also hidden");
    expect(md).toContain("chars)");
  });

  it("max_chars truncates output and adds marker", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "MaxRoot",
      content: "A".repeat(200),
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "MaxChild",
      content: "B".repeat(200),
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2, { maxChars: 50 });
    expect(md.length).toBeLessThan(300); // significantly less than full output
    expect(md).toContain("<!-- truncated:");
    expect(md).toContain("chars omitted -->");
  });

  it("exclude_nodes skips subtree in integration", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "ExRoot",
    });
    const { node_id: childId } = await cardService.createCard({
      card_type: "knowledge",
      title: "ExChild",
      content: "Should be excluded",
      parent_node_id: rootId,
    });

    const { markdown: md } = await treeService.compileSubtree(rootId, 2, {
      excludeNodes: new Set([childId]),
    });
    expect(md).toContain("# ExRoot");
    expect(md).not.toContain("ExChild");
  });

  it("compileSubtree exposes node/card IDs by default; includeIds=false yields minimal output (260508)", async () => {
    const { node_id: rootId } = await cardService.createCard({
      card_type: "structure",
      title: "IncludeIdsRoot",
      content: "root content",
    });
    await cardService.createCard({
      card_type: "knowledge",
      title: "IncludeIdsChild",
      content: "child content",
      parent_node_id: rootId,
    });

    // 디폴트 (옵션 미지정) — HTML 주석 노출 (260508 변경)
    const { markdown: mdDefault } = await treeService.compileSubtree(rootId, 2);
    expect(mdDefault).toContain("<!-- node:");
    expect(mdDefault).toContain("card:");
    expect(mdDefault).toContain("IncludeIdsRoot");

    // includeIds=true 명시 — 디폴트와 동일 형식 (헤딩 모드 한정)
    const { markdown: mdWithIds } = await treeService.compileSubtree(rootId, 2, { includeIds: true });
    expect(mdWithIds).toContain("<!-- node:");

    // includeIds=false 명시 — minimal (HTML 주석 미포함)
    const { markdown: mdMinimal } = await treeService.compileSubtree(rootId, 2, { includeIds: false });
    expect(mdMinimal).not.toContain("<!-- node:");
    expect(mdMinimal).toContain("# IncludeIdsRoot");
  });
});
