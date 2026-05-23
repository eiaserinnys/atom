import path from "path";
import { fileURLToPath } from "url";
import { setPool, closePool, runMigrations } from "../../src/db/client.js";
import { PostgresAdapter } from "../../src/db/adapters/postgres.js";
import { executeBatchOp } from "../../src/services/batch.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

export function setupRelativePositionIntegrationTest() {
  let pool = null;

  const getPool = () => {
    if (!pool) {
      throw new Error("Postgres test pool has not been initialized");
    }
    return pool;
  };

  beforeAll(async () => {
    const databaseUrl = process.env["TEST_DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL is required.\n" +
          "Set it to: postgresql://atom:atom@localhost:5434/atom_test_db"
      );
    }
    if (!databaseUrl.includes("test")) {
      throw new Error("TEST_DATABASE_URL must contain 'test'. Got: " + databaseUrl);
    }
    pool = new PostgresAdapter(databaseUrl);
    setPool(pool);
    await runMigrations(MIGRATIONS_DIR);
  }, 30000);

  afterAll(async () => {
    await closePool();
  }, 10000);

  afterEach(async () => {
    await getPool().query("DELETE FROM tree_nodes");
    await getPool().query("DELETE FROM cards");
  });

  return getPool;
}

export async function createParentWithChildren(childCount, spacing = 100) {
  const creates = [
    { temp_id: "parent", card_type: "structure", title: "Parent" },
    ...Array.from({ length: childCount }, (_, i) => ({
      temp_id: `c${i}`,
      card_type: "knowledge",
      title: `Child ${i}`,
      parent_temp_id: "parent",
      position: (i + 1) * spacing,
    })),
  ];
  const result = await executeBatchOp({ creates });
  const parentNodeId = result.created.find((c) => c.temp_id === "parent").node_id;
  const childNodeIds = Array.from({ length: childCount }, (_, i) =>
    result.created.find((c) => c.temp_id === `c${i}`).node_id
  );
  return { parentNodeId, childNodeIds };
}
