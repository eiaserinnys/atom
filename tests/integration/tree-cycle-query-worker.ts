// A separate process bounds synchronous SQLite recursive-query regressions.
import { SqliteAdapter } from "../../src/db/adapters/sqlite.js";
import { setDb } from "../../src/db/client.js";
import { getNodeBreadcrumb } from "../../src/db/queries/tree.js";
import { searchByBm25 } from "../../src/db/queries/search.js";
import { getNeighborPathRows } from "../../src/db/queries/embedding-neighbors.js";
import { selectNodeById } from "../../src/db/queries/tree.js";

const db = new SqliteAdapter(process.argv[2]);
setDb(db);
try {
  const result = process.argv[4] === "neighbors"
    ? await getNeighborPathRows(db, [(await selectNodeById(db, process.argv[3]))!.card_id])
    : process.argv[4] === "search"
    ? await searchByBm25(db, { query: "cycleneedle", root_node_id: process.argv[3] })
    : await getNodeBreadcrumb(db, process.argv[3]);
  console.log(JSON.stringify(result));
} finally {
  await db.close();
}
