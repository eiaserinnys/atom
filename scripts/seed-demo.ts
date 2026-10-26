/**
 * Seed an empty atom database with the synthetic public demo tree.
 * Usage: npx tsx scripts/seed-demo.ts [--file examples/demo/seed.json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, runMigrations } from "../src/db/client.js";
import { executeBatchOp } from "../src/services/batch.service.js";
import type {
  BatchCreateItem,
  BatchOpInput,
  CardType,
} from "../src/shared/types.js";

interface SeedCard {
  key: string;
  title: string;
  card_type: CardType;
  content: string;
  tags?: string[];
  source_type?: string;
  source_ref?: string;
  journal_limit?: number;
  references?: string[];
  children?: SeedEntry[];
}

interface SeedSymlink {
  symlink: string;
}

type SeedEntry = SeedCard | SeedSymlink;

interface PendingSymlink {
  targetKey: string;
  parentKey: string | null;
}

interface PendingReferences {
  key: string;
  referenceKeys: string[];
}

interface PendingJournalLimit {
  key: string;
  journalLimit: number;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

function getSeedPath(args: string[]): string {
  const defaultPath = path.resolve(scriptDirectory, "../examples/demo/seed.json");
  if (args.length === 0) return defaultPath;
  if (args.length === 2 && args[0] === "--file" && args[1]) {
    return path.resolve(process.cwd(), args[1]);
  }
  throw new Error("Usage: npx tsx scripts/seed-demo.ts [--file examples/demo/seed.json]");
}

function flattenSeed(
  entries: SeedEntry[],
  parentKey: string | null,
  creates: BatchCreateItem[],
  symlinks: PendingSymlink[],
  references: PendingReferences[],
  journalLimits: PendingJournalLimit[]
): void {
  for (const entry of entries) {
    if ("symlink" in entry) {
      symlinks.push({ targetKey: entry.symlink, parentKey });
      continue;
    }

    const create: BatchCreateItem = {
      temp_id: entry.key,
      card_type: entry.card_type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      source_type: entry.source_type,
      source_ref: entry.source_ref,
      ...(parentKey === null
        ? { parent_node_id: null }
        : { parent_temp_id: parentKey }),
    };
    creates.push(create);

    if (entry.references && entry.references.length > 0) {
      references.push({ key: entry.key, referenceKeys: entry.references });
    }
    if (entry.journal_limit !== undefined) {
      journalLimits.push({ key: entry.key, journalLimit: entry.journal_limit });
    }
    if (entry.children) {
      flattenSeed(
        entry.children,
        entry.key,
        creates,
        symlinks,
        references,
        journalLimits
      );
    }
  }
}

async function main(): Promise<void> {
  const seedPath = getSeedPath(process.argv.slice(2));
  let databaseOpened = false;

  try {
    const db = getDb();
    databaseOpened = true;
    const databaseDirectory = path.resolve(scriptDirectory, "../src/db");
    const migrationsDirectory = path.join(
      databaseDirectory,
      db.dbType === "sqlite" ? "migrations-sqlite" : "migrations"
    );
    await runMigrations(migrationsDirectory);

    const { rows } = await db.query<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM tree_nodes"
    );
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error("Refusing to seed: tree_nodes is not empty. Use an empty database.");
    }

    const seed = JSON.parse(await readFile(seedPath, "utf-8")) as SeedEntry[];
    const creates: BatchCreateItem[] = [];
    const symlinkSpecs: PendingSymlink[] = [];
    const referenceSpecs: PendingReferences[] = [];
    const journalLimitSpecs: PendingJournalLimit[] = [];
    flattenSeed(
      seed,
      null,
      creates,
      symlinkSpecs,
      referenceSpecs,
      journalLimitSpecs
    );

    const created = await executeBatchOp({ creates });
    const createdByKey = new Map(
      created.created.map((item) => [item.temp_id, item])
    );
    const cardIdFor = (key: string): string => {
      const item = createdByKey.get(key);
      if (!item) throw new Error(`Seed key not found: ${key}`);
      return item.card_id;
    };
    const nodeIdFor = (key: string): string => {
      const item = createdByKey.get(key);
      if (!item) throw new Error(`Seed key not found: ${key}`);
      return item.node_id;
    };

    const followup: BatchOpInput = {
      symlinks: symlinkSpecs.map(({ targetKey, parentKey }) => ({
        card_id: cardIdFor(targetKey),
        ...(parentKey === null
          ? { parent_node_id: null }
          : { parent_node_id: nodeIdFor(parentKey) }),
      })),
      updates: referenceSpecs.map(({ key, referenceKeys }) => ({
        card_id: cardIdFor(key),
        references: referenceKeys.map(cardIdFor),
      })),
      node_updates: journalLimitSpecs.map(({ key, journalLimit }) => ({
        node_id: nodeIdFor(key),
        journal_limit: journalLimit,
      })),
    };
    const linked = await executeBatchOp(followup);

    const cardCount = created.created.length;
    const symlinkCount = linked.symlinked.length;
    console.log(
      `Seeded ${cardCount} cards, ${cardCount + symlinkCount} nodes, ${symlinkCount} symlinks.`
    );
  } finally {
    if (databaseOpened) await closeDb();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-demo] ${message}`);
  process.exitCode = 1;
});
