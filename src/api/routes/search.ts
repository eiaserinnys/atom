import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { normalizeSearchRootNodeId, searchCards } from "../../services/search.service.js";
import { runConfiguredJevSearch } from "../../services/jev-search/service.js";
import { JevSearchRequestError } from "../../services/jev-search/config.js";
import type { JevSearchInput, JevSearchObserver, JevSearchResponse } from "../../shared/jev-search.js";
import type { SearchFilters, SearchResult, CardType } from "../../shared/types.js";

export interface SearchHandlerDependencies {
  searchCards(filters: SearchFilters): Promise<SearchResult[]>;
  runJev(input: JevSearchInput, signal: AbortSignal, observer?: JevSearchObserver): Promise<JevSearchResponse>;
  normalizeSearchRootNodeId?(rootNodeId: string | null | undefined): Promise<string | null | undefined>;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/search", createSearchHandler());
}

export function createSearchHandler(overrides: Partial<SearchHandlerDependencies> = {}) {
  const deps: SearchHandlerDependencies = {
    searchCards,
    runJev: runConfiguredJevSearch,
    normalizeSearchRootNodeId,
    ...overrides,
  };

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const qs = req.query as Record<string, string>;
    const rawEngine = readSingle(req.query, "engine");
    if (rawEngine.invalid) return reply.code(400).send({ error: "engine must be a single value" });
    const engine = rawEngine.value;
    if (engine !== undefined && engine !== "bm25" && engine !== "jev") {
      return reply.code(400).send({ error: "engine must be one of: bm25, jev" });
    }
    if (engine === "jev") return handleJevSearch(req, reply, deps);
    if (engine === "bm25" && ["context_agent", "context_project", "context_task"].some((key) => hasQueryKey(req.query, key))) {
      return reply.code(400).send({ error: { code: "JEV_CONTEXT_REQUIRES_JEV", message: "Context fields require engine=jev." } });
    }

    if (!qs["q"]) return reply.code(400).send({ error: "q parameter required" });

    let limit: number | undefined;
    if (qs["limit"]) {
      limit = parseInt(qs["limit"], 10);
      if (isNaN(limit) || limit <= 0) {
        return reply.code(400).send({ error: "limit must be a positive integer" });
      }
    }

    const validCardTypes: CardType[] = ["structure", "knowledge"];
    if (qs["card_type"] && !validCardTypes.includes(qs["card_type"] as CardType)) {
      return reply.code(400).send({ error: `card_type must be one of: ${validCardTypes.join(", ")}` });
    }

    if (qs["updated_after"] && isNaN(Date.parse(qs["updated_after"]))) {
      return reply.code(400).send({ error: "updated_after must be a valid ISO 8601 timestamp" });
    }
    if (qs["updated_before"] && isNaN(Date.parse(qs["updated_before"]))) {
      return reply.code(400).send({ error: "updated_before must be a valid ISO 8601 timestamp" });
    }

    const strategy = qs["strategy"];
    if (strategy && strategy !== "auto" && strategy !== "strict") {
      return reply.code(400).send({ error: "strategy must be one of: auto, strict" });
    }

    const rawTags = qs["tags"]?.split(",").map((tag) => tag.trim()).filter(Boolean);
    const filters: SearchFilters = {
      query: qs["q"],
      limit,
      root_node_id: qs["rootNodeId"] || qs["root_node_id"] || undefined,
      tags: rawTags?.length ? rawTags : undefined,
      card_type: qs["card_type"] as CardType | undefined,
      updated_after: qs["updated_after"] || undefined,
      updated_before: qs["updated_before"] || undefined,
      source_type: qs["source_type"] || undefined,
      strategy: strategy as SearchFilters["strategy"] | undefined,
    };

    return deps.searchCards(filters);
  };
}

async function handleJevSearch(req: FastifyRequest, reply: FastifyReply, deps: SearchHandlerDependencies) {
  const unsupported = ["tags", "card_type", "updated_after", "updated_before", "source_type", "strategy"];
  if (unsupported.some((key) => hasQueryKey(req.query, key))) {
    return reply.code(400).send({ error: { code: "JEV_UNSUPPORTED_FILTER", message: "Jev search does not support BM25 filters." } });
  }

  const query = readSingle(req.query, "q");
  const rawLimit = readSingle(req.query, "limit");
  const rootCamel = readSingle(req.query, "rootNodeId");
  const rootSnake = readSingle(req.query, "root_node_id");
  const contextAgent = readSingle(req.query, "context_agent");
  const contextProject = readSingle(req.query, "context_project");
  const contextTask = readSingle(req.query, "context_task");
  const stream = readSingle(req.query, "stream");
  const exhaustive = readSingle(req.query, "exhaustive");
  if ([query, rawLimit, rootCamel, rootSnake, contextAgent, contextProject, contextTask, stream, exhaustive].some((field) => field.invalid)) {
    return reply.code(400).send({ error: { code: "JEV_INPUT_INVALID", message: "Jev search inputs must be single values." } });
  }
  if (exhaustive.value !== undefined && exhaustive.value !== "1") {
    return reply.code(400).send({ error: { code: "JEV_EXHAUSTIVE_INVALID", message: "Jev exhaustive must be 1 when supplied." } });
  }
  if (query.value === undefined) {
    return reply.code(400).send({ error: { code: "JEV_QUERY_REQUIRED", message: "A search query is required." } });
  }
  if (rootCamel.value !== undefined && rootSnake.value !== undefined && rootCamel.value !== rootSnake.value) {
    return reply.code(400).send({ error: { code: "JEV_ROOT_ALIAS_CONFLICT", message: "rootNodeId and root_node_id must match." } });
  }
  let limit: number | undefined;
  if (rawLimit.value !== undefined) {
    if (!/^[1-6]$/.test(rawLimit.value)) {
      return reply.code(400).send({ error: { code: "JEV_LIMIT_INVALID", message: "Jev limit must be between 1 and 6." } });
    }
    limit = Number(rawLimit.value);
  }

  const rootNodeId = await (deps.normalizeSearchRootNodeId ?? normalizeSearchRootNodeId)(rootSnake.value ?? rootCamel.value ?? null);
  const input: JevSearchInput = {
    query: query.value,
    root_node_id: rootNodeId ?? null,
    limit,
    exhaustive: exhaustive.value === "1",
    context: {
      agent: contextAgent.value,
      project: contextProject.value,
      task: contextTask.value,
    },
  };
  const controller = new AbortController();
  const onResponseClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once("close", onResponseClose);
  let streaming = false;
  const observer: JevSearchObserver | undefined = stream.value === "1" ? (event) => {
    if (!streaming) {
      reply.header("Content-Type", "text/event-stream; charset=utf-8");
      reply.header("Cache-Control", "no-cache, no-transform");
      reply.header("X-Accel-Buffering", "no");
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.raw.writeHead(200);
      streaming = true;
    }
    if (!reply.raw.destroyed) reply.raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
  } : undefined;
  try {
    const response = await deps.runJev(input, controller.signal, observer);
    if (streaming) {
      reply.raw.end();
      return reply;
    }
    return reply.code(response.status === "error" ? 502 : 200).send(response);
  } catch (error) {
    if (streaming) {
      observer?.({ event: "done", data: { status: "error", complete: false, stop_reason: null,
        completed_at: new Date().toISOString(), results: [], error: { code: "JEV_SEARCH_FAILED", message: "Jev search failed." } } });
      reply.raw.end();
      return reply;
    }
    if (error instanceof JevSearchRequestError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    throw error;
  } finally {
    reply.raw.off("close", onResponseClose);
  }
}

function hasQueryKey(query: unknown, key: string): boolean {
  return !!query && typeof query === "object" && Object.prototype.hasOwnProperty.call(query, key);
}

function readSingle(query: unknown, key: string): { value?: string; invalid: boolean } {
  if (!query || typeof query !== "object") return { invalid: false };
  const value = (query as Record<string, unknown>)[key];
  if (value === undefined) return { invalid: false };
  if (typeof value !== "string") return { invalid: true };
  return { value, invalid: false };
}
