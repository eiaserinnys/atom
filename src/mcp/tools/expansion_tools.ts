import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NeighborService, NeighborServiceResult } from "../../services/embeddings/neighbors.js";
import { EMBEDDING_POLICY } from "../../services/embeddings/policy.js";
import { runConfiguredJevEvaluation, JevEvaluationRequestError } from "../../services/jev-search/evaluate.js";
import { JEV_SEARCH_POLICY } from "../../services/jev-search/config.js";
import type { JevEvaluationInput, JevEvaluationResponse } from "../../shared/visual-search.js";

export interface ExpansionToolDependencies {
  neighbors: NeighborService | null;
  evaluate(input: JevEvaluationInput, signal?: AbortSignal): Promise<JevEvaluationResponse>;
}

export function registerExpansionTools(server: McpServer, overrides: Partial<ExpansionToolDependencies> & Pick<ExpansionToolDependencies, "neighbors">): void {
  const deps: ExpansionToolDependencies = {
    evaluate: runConfiguredJevEvaluation,
    ...overrides,
  };

  server.tool(
    "get_card_neighbors",
    "Get embedding neighbors for one card. The result includes canonical paths and card types. The API index may return loading or not-ready status; call again when ready.",
    {
      card_id: z.string().uuid().describe("Card UUID whose embedding neighbors should be returned."),
      limit: z.number().int().min(1).max(EMBEDDING_POLICY.neighborsMaxLimit).optional().describe("Max neighbors to return (default 20, range 1-50)."),
    },
    async ({ card_id, limit }) => {
      if (!deps.neighbors) return toolError("NEIGHBORS_HTTP_ONLY", "Use get_card_neighbors through the HTTP MCP endpoint.");
      try {
        const result = await deps.neighbors.get(card_id, limit ?? EMBEDDING_POLICY.neighborsDefaultLimit);
        if (result.statusCode === 200 || result.statusCode === 202) return toolSuccess(result.body);
        return neighborError(result);
      } catch {
        return toolError("INDEX_UNAVAILABLE", "The embedding index is unavailable.");
      }
    },
  );

  server.tool(
    "evaluate_cards",
    "Score how directly each card's content helps with the original query and context. Send the original query/context and card IDs. Compare scores with summary.selection_threshold from the first search_cards(engine='jev') response; use 0.5 when it is null. Use include_trace=true to include the sanitized audit.",
    {
      query: z.string().min(1).describe("Original Jev search query (normalized length 1-400)."),
      card_ids: z.array(z.string().uuid()).min(1).max(JEV_SEARCH_POLICY.batchCandidates).describe("Cards to evaluate (1-48 unique UUIDs)."),
      context: z.object({
        agent: z.string().nullable().optional(),
        project: z.string().nullable().optional(),
        task: z.string().nullable().optional(),
      }).optional().describe("Original Jev search context; keep it unchanged between search and evaluation."),
      include_trace: z.boolean().optional().describe("Include sanitized request/response audit calls in the result."),
    },
    async ({ query, context, card_ids, include_trace }, extra) => {
      const input: JevEvaluationInput = { query, context, card_ids };
      try {
        const result = await deps.evaluate(input, extra.signal);
        if (include_trace) return toolSuccess(result);
        const { audit: _audit, ...compact } = result;
        return toolSuccess(compact);
      } catch (cause) {
        if (cause instanceof JevEvaluationRequestError) {
          return toolError(fixedEvaluationCode(cause.code), fixedEvaluationMessage(cause.code), {
            ...(cause.evaluation_id ? { evaluation_id: cause.evaluation_id } : {}),
            ...(include_trace && cause.audit ? { audit: cause.audit } : {}),
          });
        }
        return toolError("JEV_EVALUATION_FAILED", "Jev evaluation failed.");
      }
    },
  );
}

function neighborError(result: Exclude<NeighborServiceResult, { statusCode: 200 | 202 }>) {
  const body = result.body;
  const details = {
    ...(body.error.reason ? { reason: body.error.reason } : {}),
    ...(body.key_configured === undefined ? {} : { key_configured: body.key_configured }),
  };
  const message = body.error.code === "CARD_NOT_FOUND" ? "Card was not found."
    : body.error.code === "CARD_NOT_EMBEDDABLE" ? "Card has no embeddable content."
    : body.error.code === "CARD_NOT_IN_TREE" ? "Card has no canonical tree node."
    : body.error.code === "EMBEDDING_NOT_READY" ? "The card embedding is not ready."
    : "The embedding index is unavailable.";
  return toolError(body.error.code, message, details);
}

function fixedEvaluationCode(code: string): string {
  if (code === "BAD_NOUL_RESPONSE") return "BAD_NOUL_RESPONSE";
  if (code === "JEV_UPSTREAM_AUTH" || code === "JEV_UPSTREAM_UNAVAILABLE" || /^JEV_UPSTREAM_\d+$/.test(code) || code === "JEV_BAD_RESPONSE") return code;
  if (["JEV_QUERY_REQUIRED", "JEV_QUERY_INVALID", "JEV_CONTEXT_INVALID", "JEV_EVALUATION_IDS_INVALID", "JEV_EVALUATION_PAYLOAD_TOO_LARGE", "JEV_EVALUATION_BUSY", "JEV_NOT_CONFIGURED", "JEV_EVALUATION_TIMEOUT", "JEV_EVALUATION_CANCELLED"].includes(code)) return code;
  return "JEV_EVALUATION_FAILED";
}

function fixedEvaluationMessage(code: string): string {
  if (code === "JEV_QUERY_REQUIRED") return "A search query is required.";
  if (code === "JEV_QUERY_INVALID") return "Jev query must be between 1 and 400 characters.";
  if (code === "JEV_CONTEXT_INVALID") return "Jev context fields must be text with at most 160 characters.";
  if (code === "JEV_EVALUATION_IDS_INVALID") return "Evaluation card_ids must contain 1 to 48 unique UUIDs.";
  if (code === "JEV_EVALUATION_PAYLOAD_TOO_LARGE") return "Evaluation payload exceeds the configured limit.";
  if (code === "JEV_EVALUATION_BUSY") return "Jev evaluation is busy.";
  if (code === "JEV_NOT_CONFIGURED") return "Jev evaluation is not configured.";
  if (code === "JEV_EVALUATION_TIMEOUT") return "Jev evaluation reached its time limit.";
  if (code === "JEV_EVALUATION_CANCELLED") return "Jev evaluation was cancelled.";
  if (code === "BAD_NOUL_RESPONSE") return "Jev response did not include a valid score for every candidate.";
  if (code === "JEV_UPSTREAM_AUTH") return "Jev authentication failed.";
  if (code === "JEV_UPSTREAM_UNAVAILABLE") return "Jev service is unavailable.";
  if (/^JEV_UPSTREAM_\d+$/.test(code)) return "Jev service returned an error.";
  if (code === "JEV_BAD_RESPONSE") return "Jev returned an invalid response.";
  return "Jev evaluation failed.";
}

function toolSuccess(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function toolError(code: string, message: string, details: Record<string, unknown> = {}) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message, ...("reason" in details ? { reason: details["reason"] } : {}) }, ...("key_configured" in details ? { key_configured: details["key_configured"] } : {}), ...("evaluation_id" in details ? { evaluation_id: details["evaluation_id"] } : {}), ...("audit" in details ? { audit: details["audit"] } : {}) }) }] };
}
