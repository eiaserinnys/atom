import { updateCardSnapshot, updateCardSourceType } from "../db/queries/cards.js";
import type { Queryable } from "../db/queryable.js";
import type { ResolvedRef } from "../shared/bfs.js";
import type { Card } from "../shared/types.js";
import type { UnfurlAdapter, UnfurlCredentials } from "../unfurl/interface.js";
import { adapterRegistry } from "../unfurl/registry.js";
import { parseSnapshot } from "../unfurl/utils.js";

export interface CompileUnfurlDeps {
  findAdapter(sourceType: string): UnfurlAdapter | undefined;
  findAdapterByRef(ref: string): UnfurlAdapter | undefined;
  writeSnapshot(cardId: string, snapshot: string, sourceRef: string): Promise<void>;
  repairSourceType(cardId: string, sourceType: string): Promise<void>;
  logError(message: string, error: unknown): void;
}

export type CompileUnfurls = Record<
  string,
  { ok: boolean; data?: Record<string, unknown> | null; error?: string; sourceType: string }
>;

export function createCompileUnfurlDeps(db: Queryable): CompileUnfurlDeps {
  return {
    findAdapter: (sourceType) => adapterRegistry.find(sourceType),
    findAdapterByRef: (ref) => adapterRegistry.findByRef(ref),
    writeSnapshot: (cardId, snapshot, sourceRef) => updateCardSnapshot(db, cardId, snapshot, sourceRef),
    repairSourceType: (cardId, sourceType) => updateCardSourceType(db, cardId, sourceType),
    logError: (message, error) => console.error(message, error),
  };
}

export async function resolveCompileRefs(
  cardCache: ReadonlyMap<string, Card>,
  mode: "cached" | "fresh",
  credentials: Record<string, UnfurlCredentials>,
  deps: CompileUnfurlDeps,
  canWriteRefs: boolean
): Promise<Map<string, ResolvedRef>> {
  const resolved = new Map<string, ResolvedRef>();

  await Promise.allSettled(
    Array.from(cardCache.entries()).map(async ([cardId, card]) => {
      const sourceRef = card.source_ref;
      const sourceType = card.source_type;
      if (!sourceRef || !sourceType) return;

      const typedAdapter = deps.findAdapter(sourceType);
      const adapter = typedAdapter ?? deps.findAdapterByRef(sourceRef);
      if (!adapter) return;

      if (!typedAdapter && canWriteRefs) {
        runFireAndForget(
          () => deps.repairSourceType(cardId, adapter.sourceType),
          "[unfurl] source_type repair failed",
          deps
        );
      }

      if (mode === "cached" && card.source_snapshot) {
        try {
          const result = parseSnapshot(card.source_snapshot);
          resolved.set(cardId, { ok: true, result, sourceType });
        } catch (error) {
          resolved.set(cardId, { ok: false, error: serializeError(error), sourceType });
        }
        return;
      }

      try {
        const result = await adapter.resolve(sourceRef, credentials[adapter.sourceType] ?? {});
        resolved.set(cardId, { ok: true, result, sourceType });
        if (canWriteRefs) {
          runFireAndForget(
            () => deps.writeSnapshot(cardId, result.snapshot, sourceRef),
            "[unfurl] snapshot write failed",
            deps
          );
        }
      } catch (error) {
        resolved.set(cardId, { ok: false, error: serializeError(error), sourceType });
      }
    })
  );

  return resolved;
}

export function buildCompileUnfurls(
  resolvedRefsMap: ReadonlyMap<string, ResolvedRef> | undefined
): CompileUnfurls | undefined {
  if (!resolvedRefsMap || resolvedRefsMap.size === 0) return undefined;

  const unfurls: CompileUnfurls = {};
  for (const [cardId, resolved] of resolvedRefsMap.entries()) {
    if (resolved.ok) {
      unfurls[cardId] = {
        ok: true,
        data: resolved.result.unfurlData,
        sourceType: resolved.sourceType,
      };
    } else {
      unfurls[cardId] = {
        ok: false,
        error: resolved.error,
        sourceType: resolved.sourceType,
      };
    }
  }
  return unfurls;
}

function runFireAndForget(
  action: () => Promise<void>,
  errorMessage: string,
  deps: Pick<CompileUnfurlDeps, "logError">
): void {
  try {
    void action().catch((error) => deps.logError(errorMessage, error));
  } catch (error) {
    deps.logError(errorMessage, error);
  }
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    const json = JSON.stringify(error);
    return json !== "{}" ? json : String(error);
  } catch {
    return String(error);
  }
}
