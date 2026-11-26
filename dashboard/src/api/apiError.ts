import type { TFunction } from 'i18next';

const CODE_LIKE = /^[A-Z][A-Z0-9_]+$/;

const KNOWN_CODE_TEXT: Record<string, string> = {
  VERSION_CONFLICT: 'card.unsaved_changes',
  STARTUP_WOULD_FAIL: 'errors.startup_would_fail',
  NODE_NOT_FOUND: 'errors.not_found',
  CARD_NOT_FOUND: 'errors.not_found',
  PARENT_NOT_FOUND: 'errors.not_found',
  SAME_PASSWORD: 'auth.password_same',
  INVALID_CURRENT_PASSWORD: 'auth.password_wrong_current',
  SESSION_INVALID: 'auth.password_session_lost',
};

const CODES_WITH_SERVER_REASON = new Set(['STARTUP_WOULD_FAIL']);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly serverText: string | undefined;

  constructor(status: number, code?: string, serverText?: string) {
    super(code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.serverText = serverText;
  }
}

export class VersionConflictError extends ApiError {
  readonly currentVersion: number;

  constructor(currentVersion: number, serverText?: string) {
    super(409, 'VERSION_CONFLICT', serverText);
    this.currentVersion = currentVersion;
  }
}

export interface ErrorBody {
  code?: string;
  text?: string;
  fields: Record<string, unknown>;
}

function readableText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || /^[{[<]/.test(text)) return undefined;
  return text;
}

/**
 * The three bodies the server sends: `{ error, code }`, `{ error: string }` or `{ error: { code } }`,
 * and Fastify's own `{ statusCode, error, message }`. Anything that is not a JSON object yields nothing.
 */
export function parseErrorBody(raw: string): ErrorBody {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { fields: {} };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { fields: {} };
  const fields = body as Record<string, unknown>;
  const { error, code, message } = fields;
  const nestedCode = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const errorText = readableText(error);
  const codeFromError = errorText && CODE_LIKE.test(errorText) ? errorText : undefined;
  const resolvedCode = [code, nestedCode, codeFromError].find((value): value is string => typeof value === 'string');
  const text = readableText(message) ?? (errorText === resolvedCode ? undefined : errorText);
  return { code: resolvedCode, text, fields };
}

function statusText(status: number, t: TFunction): string {
  if (status === 403) return t('errors.forbidden');
  if (status === 404) return t('errors.not_found');
  if (status === 429) return t('errors.busy');
  if (status >= 500) return t('errors.server');
  return t('errors.failed');
}

/** The text a person reads for a failed API call: never a JSON body, a status prefix or HTML. */
export function describeApiError(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError)) return t('errors.failed');
  const knownKey = error.code ? KNOWN_CODE_TEXT[error.code] : undefined;
  if (knownKey) {
    const known = t(knownKey);
    return error.code && CODES_WITH_SERVER_REASON.has(error.code) && error.serverText
      ? `${known} ${error.serverText}`
      : known;
  }
  return error.serverText ?? statusText(error.status, t);
}
