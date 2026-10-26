import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../config/policy.js";
import { runConfiguredJevEvaluation, JevEvaluationRequestError } from "../../services/jev-search/evaluate.js";
import type { JevEvaluationInput, JevEvaluationResponse } from "../../shared/visual-search.js";

export interface SearchEvaluateHandlerDependencies {
  evaluate(input: JevEvaluationInput, signal: AbortSignal): Promise<JevEvaluationResponse>;
}

export function createSearchEvaluateRoutes(overrides: Partial<SearchEvaluateHandlerDependencies> = {}): FastifyPluginAsync {
  const deps: SearchEvaluateHandlerDependencies = { evaluate: runConfiguredJevEvaluation, ...overrides };
  return async app => {
    app.post("/search/evaluate", {
      errorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply) {
        if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
          return reply.code(400).send({ error: { code: "JEV_EVALUATION_INPUT_INVALID", message: "Evaluation request must be valid JSON." } });
        }
        return reply.send(error);
      },
    }, async (request, reply) => {
      if (!requireRole(request, reply, "viewer")) return reply;
      const controller = new AbortController();
      const onResponseClose = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once("close", onResponseClose);
      try {
        return await deps.evaluate(request.body as JevEvaluationInput, controller.signal);
      } catch (cause) {
        if (cause instanceof JevEvaluationRequestError) {
          return reply.code(cause.statusCode).send({
            error: { code: cause.code, message: cause.message },
            ...(cause.evaluation_id ? { evaluation_id: cause.evaluation_id } : {}),
            ...(cause.audit ? { audit: cause.audit } : {}),
          });
        }
        return reply.code(500).send({ error: { code: "JEV_EVALUATION_FAILED", message: "Jev evaluation failed." } });
      } finally {
        reply.raw.off("close", onResponseClose);
      }
    });
  };
}
