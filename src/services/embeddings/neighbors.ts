import type { DatabaseAdapter } from "../../db/adapter.js";
import { getNeighborCardRows, getNeighborPathRows } from "../../db/queries/embedding-neighbors.js";
import { countIndexEmbeddings, listCurrentEligibleVersions, listIndexEmbeddings } from "../../db/queries/embeddings.js";
import { getOpenAIKeyMetadata } from "../../db/queries/openai-settings.js";
import type { CardNeighbor, CardNeighborsResponse, NeighborPathEntry } from "../../shared/embeddings.js";
import { toOutlineExcerpt } from "../outline-excerpt.js";
import type { FlatEmbeddingIndex, StoredEmbedding } from "./flat-index.js";
import { EMBEDDING_POLICY } from "./policy.js";

export type NeighborServiceResult =
  | { statusCode: 200; body: CardNeighborsResponse }
  | { statusCode: 202; body: { status: "loading"; retry_after_ms: 1000 } }
  | { statusCode: 400 | 404 | 409 | 422 | 503; body: { error: { code: string; reason?: string }; key_configured?: boolean } };

export interface NeighborService {
  get(cardId: string, limit: number): Promise<NeighborServiceResult>;
  waitForLoad(): Promise<void>;
}

export function createNeighborService(db: DatabaseAdapter, index: FlatEmbeddingIndex): NeighborService {
  let loadFailed = false;

  async function* loadPages(): AsyncIterable<StoredEmbedding[]> {
    let afterId: string | null = null;
    for (;;) {
      const page = await listIndexEmbeddings(db, afterId);
      if (page.length === 0) return;
      yield page;
      afterId = page[page.length - 1].cardId;
      if (page.length < EMBEDDING_POLICY.indexPageSize) return;
    }
  }

  async function get(cardId: string, limit: number): Promise<NeighborServiceResult> {
    const sourceCard = await db.query(
      `SELECT id AS card_id, title, content, version,
              (TRIM(COALESCE(content, '')) <> '') AS has_content
       FROM cards WHERE id = $1`,
      [cardId]
    );
    const card = sourceCard.rows[0];
    if (!card) return { statusCode: 404, body: { error: { code: "CARD_NOT_FOUND" } } };
    if (!Boolean(card["has_content"])) {
      return { statusCode: 422, body: { error: { code: "CARD_NOT_EMBEDDABLE" } } };
    }
    const canonical = await db.query(
      `SELECT id FROM tree_nodes WHERE card_id = $1 AND is_symlink = FALSE ORDER BY created_at, id LIMIT 1`,
      [cardId]
    );
    if (canonical.rows.length === 0) {
      return { statusCode: 409, body: { error: { code: "CARD_NOT_IN_TREE" } } };
    }

    if (index.status === "unloaded") {
      if (loadFailed) {
        loadFailed = false;
        return { statusCode: 503, body: { error: { code: "INDEX_UNAVAILABLE" } } };
      }
      void index.ensureLoaded(() => countIndexEmbeddings(db), loadPages)
        .then(() => { loadFailed = false; })
        .catch(() => { loadFailed = true; });
      return { statusCode: 202, body: { status: "loading", retry_after_ms: 1000 } };
    }
    if (index.status === "loading") return { statusCode: 202, body: { status: "loading", retry_after_ms: 1000 } };

    const [keyMetadata, currentVersions] = await Promise.all([
      getOpenAIKeyMetadata(db),
      listCurrentEligibleVersions(db),
    ]);
    const currentVersion = currentVersions.get(cardId);
    const sourceVector = index.vectorFor(cardId);
    if (currentVersion === undefined || index.versionOf(cardId) !== currentVersion || !sourceVector) {
      return {
        statusCode: 409,
        body: { error: { code: "EMBEDDING_NOT_READY", reason: keyMetadata.configured ? "pending" : "no_key" }, key_configured: keyMetadata.configured },
      };
    }

    const scores = index.nearest(sourceVector, cardId, currentVersions, limit);
    const cardIds = [cardId, ...scores.map(row => row.cardId)];
    const [cards, pathRows] = await Promise.all([
      getNeighborCardRows(db, cardIds),
      getNeighborPathRows(db, cardIds),
    ]);
    const cardById = new Map(cards.map(row => [row.card_id, row]));
    const paths = new Map<string, NeighborPathEntry[]>();
    const fullNodePaths = new Map<string, string[]>();
    for (const row of pathRows) {
      const path = paths.get(row.card_id) ?? [];
      path.push({ node_id: row.node_id, title: row.title });
      paths.set(row.card_id, path);
    }
    for (const [id, path] of paths) fullNodePaths.set(id, path.map(entry => entry.node_id));
    const source = cardById.get(cardId);
    const sourcePath = paths.get(cardId) ?? [];
    if (!source) return { statusCode: 409, body: { error: { code: "CARD_NOT_IN_TREE" } } };
    const neighbors: CardNeighbor[] = scores.flatMap(score => {
      const row = cardById.get(score.cardId);
      const fullPath = paths.get(score.cardId);
      const sourceIds = fullNodePaths.get(cardId) ?? [];
      const targetIds = fullNodePaths.get(score.cardId) ?? [];
      if (!row || !fullPath || targetIds.length === 0) return [];
      let commonAncestorDepth = 0;
      while (commonAncestorDepth < sourceIds.length && commonAncestorDepth < targetIds.length && sourceIds[commonAncestorDepth] === targetIds[commonAncestorDepth]) {
        commonAncestorDepth += 1;
      }
      const excerpt = toOutlineExcerpt(row.content, EMBEDDING_POLICY.excerptMaxChars) ?? "";
      return [{
        card_id: score.cardId,
        node_id: row.node_id,
        title: row.title,
        similarity: Math.max(-1, Math.min(1, score.similarity)),
        excerpt,
        path: fullPath.slice(0, -1),
        tree_relation: {
          common_ancestor_depth: commonAncestorDepth,
          tree_distance: sourceIds.length + targetIds.length - 2 * commonAncestorDepth,
          same_top_level_branch: sourceIds.length > 0 && sourceIds[0] === targetIds[0],
        },
      }];
    });
    return {
      statusCode: 200,
      body: {
        status: "ready",
        model: EMBEDDING_POLICY.model,
        dimensions: EMBEDDING_POLICY.dimensions,
        key_configured: keyMetadata.configured,
        index: { indexed_cards: [...currentVersions].filter(([id, version]) => index.versionOf(id) === version).length },
        source: { card_id: cardId, node_id: source.node_id, title: source.title, path: sourcePath.slice(0, -1) },
        neighbors,
      },
    };
  }

  return { get, waitForLoad: () => index.waitForLoad() };
}
