import type {
  EvaluationResponse,
  JevAuditCall,
  VisualSearchNeighborsResponse,
} from '../components/SearchMotionView/operation-types';

export interface VisualSearchApiError {
  error: { code: string; message?: string };
  key_configured?: boolean;
  status?: 'loading';
  retry_after_ms?: number;
  audit?: { calls: JevAuditCall[] };
}

export interface VisualSearchApiResult<T> {
  status: number;
  body: T | VisualSearchApiError;
}

export interface QueryExpansionRequest {
  query: string;
  exclude_card_ids: string[];
  limit?: number;
}

export interface EvaluationRequest {
  query: string;
  context: { agent: string | null; project: string | null; task: string | null };
  card_ids: string[];
}

async function fetchVisualSearch<T>(path: string, init: RequestInit): Promise<VisualSearchApiResult<T>> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body == null ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({ error: { code: 'VISUAL_SEARCH_BAD_RESPONSE' } }));
  return { status: response.status, body: body as T | VisualSearchApiError };
}

export const visualSearchApi = {
  neighbors(cardId: string, signal: AbortSignal, limit = 12): Promise<VisualSearchApiResult<VisualSearchNeighborsResponse>> {
    const params = new URLSearchParams({ limit: String(limit) });
    return fetchVisualSearch(`/cards/${encodeURIComponent(cardId)}/neighbors?${params.toString()}`, {
      method: 'GET',
      signal,
    });
  },

  evaluate(request: EvaluationRequest, signal: AbortSignal): Promise<VisualSearchApiResult<EvaluationResponse>> {
    return fetchVisualSearch('/search/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  },

  expand(request: QueryExpansionRequest, signal: AbortSignal): Promise<VisualSearchApiResult<VisualSearchNeighborsResponse>> {
    return fetchVisualSearch('/search/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  },
};
