import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { DatabaseAdapter } from "../../db/adapter.js";
import { deleteOpenAIKey, getOpenAIConfigResponse, getOpenAIKeyMetadata, saveOpenAIKey } from "../../db/queries/openai-settings.js";
import type { EmbeddingPauseReason, OpenAIConfigResponse } from "../../shared/embeddings.js";
import { requireRole } from "../config/policy.js";

export interface OpenAIConfigSync {
  requestRun(): void;
  credentialsChanged(): void;
  status(): {
    running: boolean;
    paused_reason: EmbeddingPauseReason;
    last_error: OpenAIConfigResponse["embedding"]["last_error"];
  };
}

export interface OpenAIConfigRouteDeps {
  db: DatabaseAdapter;
  sync: OpenAIConfigSync;
  now?: () => string;
}

const routePath = "/api/config/openai";

export function createOpenAIConfigRoutes(deps: OpenAIConfigRouteDeps): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler((error, request, reply) => {
      if (request.url.startsWith(routePath)) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
        const status = statusCode === 400 ? 400 : 500;
        return reply.code(status).send({
          error: { code: status === 400 ? "OPENAI_CONFIG_INVALID_REQUEST" : "OPENAI_CONFIG_UNAVAILABLE" },
        });
      }
      return reply.send(error);
    });

    app.get(routePath, async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      try {
        return reply.send(await getOpenAIConfigResponse(deps.db, deps.sync.status()));
      } catch {
        return reply.code(500).send({ error: { code: "OPENAI_CONFIG_UNAVAILABLE" } });
      }
    });

    app.put<{ Body: unknown }>(`${routePath}/key`, async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      const apiKey = readApiKey(request);
      if (apiKey === null) {
        const code = isBlankApiKey(request) ? "OPENAI_KEY_REQUIRED" : "OPENAI_CONFIG_INVALID_REQUEST";
        return reply.code(400).send({ error: { code } });
      }
      try {
        const changed = await saveOpenAIKey(deps.db, apiKey, (deps.now ?? (() => new Date().toISOString()))());
        if (changed) deps.sync.credentialsChanged();
        else deps.sync.requestRun();
        const key = await getOpenAIKeyMetadata(deps.db);
        return reply.send({ key });
      } catch {
        return reply.code(500).send({ error: { code: "OPENAI_CONFIG_UNAVAILABLE" } });
      }
    });

    app.delete(`${routePath}/key`, async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      try {
        const result = await deleteOpenAIKey(deps.db);
        deps.sync.credentialsChanged();
        return reply.send({ key: { configured: false, last_saved_at: result.last_saved_at } });
      } catch {
        return reply.code(500).send({ error: { code: "OPENAI_CONFIG_UNAVAILABLE" } });
      }
    });
  };
}

function readApiKey(request: FastifyRequest): string | null {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)["api_key"];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isBlankApiKey(request: FastifyRequest): boolean {
  const body = request.body;
  return !!body && typeof body === "object" && !Array.isArray(body) &&
    typeof (body as Record<string, unknown>)["api_key"] === "string" &&
    ((body as Record<string, unknown>)["api_key"] as string).trim().length === 0;
}
