/**
 * Integration tests for relative positioning rekey behavior.
 *
 * Requires TEST_DATABASE_URL pointing to a test PostgreSQL instance.
 */

import { executeBatchOp } from "../../src/services/batch.service.js";
import * as cardService from "../../src/services/card.service.js";
import * as treeService from "../../src/services/tree.service.js";
import { selectChildren } from "../../src/db/queries/tree.js";
import { setupRelativePositionIntegrationTest } from "./relative-position-fixtures.js";

const getPool = setupRelativePositionIntegrationTest();

describe("rekey on adjacent positions", () => {
  it("inserts between adjacent siblings by rekeying", async () => {
    const parentResult = await executeBatchOp({
      creates: [
        { temp_id: "p", card_type: "structure", title: "Parent" },
        {
          temp_id: "a",
          card_type: "knowledge",
          title: "A",
          parent_temp_id: "p",
          position: 100,
        },
        {
          temp_id: "b",
          card_type: "knowledge",
          title: "B",
          parent_temp_id: "p",
          position: 101,
        },
      ],
    });
    const parentNodeId = parentResult.created.find((c) => c.temp_id === "p")!.node_id;
    const aNodeId = parentResult.created.find((c) => c.temp_id === "a")!.node_id;
    const bNodeId = parentResult.created.find((c) => c.temp_id === "b")!.node_id;

    const { node_id: moverNodeId } = await cardService.createCard({
      card_type: "knowledge",
      title: "Mover",
    });

    const { node: moved } = await treeService.moveNode(moverNodeId, {
      parent_node_id: parentNodeId,
      before: bNodeId,
    });
    expect(moved).not.toBeNull();

    const children = await selectChildren(getPool(), parentNodeId);
    expect(children.map((n) => n.id)).toEqual([aNodeId, moverNodeId, bNodeId]);
    for (const child of children) {
      expect(Number.isInteger(child.position)).toBe(true);
    }
  });
});
