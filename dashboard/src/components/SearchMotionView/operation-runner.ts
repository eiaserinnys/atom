import { visualSearchApi, type VisualSearchApiResult, type VisualSearchApiError } from '../../api/visualSearchApi';
import type { MotionPlayer } from './player.js';
import type { EvaluationResponse, JevAuditCall, OperationRecord, OperationSnapshot, VisualOperationEvent, VisualSearchNeighborsResponse } from './operation-types';

class OperationApiError extends Error {
  readonly auditCalls: JevAuditCall[];
  constructor(code: string, auditCalls: JevAuditCall[]) { super(code); this.auditCalls = auditCalls; }
}

function waitForIndex(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); reject(new Error('CANCELLED')); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

function unwrap<T>(result: VisualSearchApiResult<T>): T {
  if (result.status !== 200) {
    const body = result.body as VisualSearchApiError;
    throw new OperationApiError(body.error?.code ?? 'VISUAL_SEARCH_FAILED', body.audit?.calls ?? []);
  }
  return result.body as T;
}

export async function runVisualOperation(
  player: MotionPlayer, kind: 'expand' | 'evaluate' | 'query', snapshot: OperationSnapshot,
  signal: AbortSignal, api = visualSearchApi, retry?: OperationRecord,
) {
  const id = retry?.id ?? crypto.randomUUID();
  if (retry) player.applyOperation({ type: 'started', id, kind: retry.kind,
    fromCardId: retry.fromCardId, query: retry.query, viaOperationId: retry.viaOperationId, requestedCardIds: retry.requestedCardIds });
  else player.applyOperation({ type: 'started', id, kind: kind === 'evaluate' ? 'evaluate' : 'expand',
    fromCardId: kind === 'query' ? null : snapshot.selectedCardId, query: kind === 'query' ? snapshot.query : null,
    viaOperationId: kind === 'evaluate' ? snapshot.operations.findLast(op => op.kind === 'expand' && op.fromCardId === snapshot.selectedCardId && op.status === 'succeeded')?.id ?? snapshot.selectedArrivalOperationId : snapshot.selectedArrivalOperationId,
    requestedCardIds: kind === 'evaluate' ? snapshot.evaluationTargetCardIds : [],
  });
  const revision = player.getSnapshot().revision;
  const apply = (event: VisualOperationEvent) => !signal.aborted && player.applyOperation(event, revision);
  let evaluationOnly = Boolean(retry);
  try {
    let targets = retry ? (retry.kind === 'evaluate' ? retry.requestedCardIds : retry.resultCardIds) : snapshot.evaluationTargetCardIds;
    if (kind !== 'evaluate' && !retry) {
      let response: VisualSearchNeighborsResponse;
      for (;;) {
        const result = kind === 'query'
          ? await api.expand({ query: snapshot.query, exclude_card_ids: snapshot.graphCardIds, limit: 12 }, signal)
          : await api.neighbors(snapshot.selectedCardId!, signal, 12);
        if (signal.aborted || player.getSnapshot().revision !== revision) return;
        if (result.status === 202) {
          apply({ type: 'index_loading', operationId: id });
          await waitForIndex((result.body as VisualSearchApiError).retry_after_ms ?? 1000, signal); continue;
        }
        response = unwrap(result); break;
      }
      if (!apply({ type: 'expansion_succeeded', operationId: id, response })) return;
      targets = response.neighbors.map(n => n.card_id);
      evaluationOnly = kind === 'query';
    }
    if (kind !== 'expand') {
      const cached = targets.filter(cardId => snapshot.cachedEvaluations.has(cardId));
      if (cached.length) apply({ type: 'evaluations_reused', operationId: id, cardIds: cached });
      const missing = targets.filter(cardId => !snapshot.cachedEvaluations.has(cardId));
      for (let index = 0; index < missing.length; index += 12) {
        const response: EvaluationResponse = unwrap(await api.evaluate({ query: snapshot.query, context: snapshot.context, card_ids: missing.slice(index, index + 12) }, signal));
        if (!apply({ type: 'evaluation_batch_succeeded', operationId: id, response })) return;
      }
    }
    apply({ type: 'completed', operationId: id });
  } catch (cause) {
    if (signal.aborted || player.getSnapshot().revision !== revision) return;
    const code = cause instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(cause.message) ? cause.message : 'VISUAL_SEARCH_FAILED';
    apply({ type: 'failed', operationId: id, errorCode: code, auditCalls: cause instanceof OperationApiError ? cause.auditCalls : [] });
    return { code, retry: evaluationOnly || kind === 'evaluate' ? id : null };
  }
}
