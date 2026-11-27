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

const STARTUP_REASONS = new Set(['no_login_method', 'oauth_and_bypass', 'password_and_bypass', 'missing_keys']);
const KEY_NAME = /^[A-Z][A-Z0-9_]*$/;

export interface ApiErrorDetail {
  reason?: string;
  keys?: string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly serverText: string | undefined;
  readonly reason: string | undefined;
  readonly keys: string[];

  constructor(status: number, code?: string, serverText?: string, detail: ApiErrorDetail = {}) {
    super(code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.serverText = serverText;
    this.reason = detail.reason;
    this.keys = detail.keys ?? [];
  }
}

export class VersionConflictError extends ApiError {
  readonly currentVersion: number;

  constructor(currentVersion: number, serverText?: string) {
    super(409, 'VERSION_CONFLICT', serverText);
    this.currentVersion = currentVersion;
  }
}

export interface ErrorBody extends ApiErrorDetail {
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
  const keys = Array.isArray(fields['keys']) ? fields['keys'].filter((key): key is string => typeof key === 'string') : [];
  return { code: resolvedCode, text, fields, reason: typeof fields['reason'] === 'string' ? fields['reason'] : undefined, keys };
}

function statusText(status: number, t: TFunction): string {
  if (status === 403) return t('errors.forbidden');
  if (status === 404) return t('errors.not_found');
  if (status === 429) return t('errors.busy');
  if (status >= 500) return t('errors.server');
  return t('errors.failed');
}

/** The one sentence that names why the next start would fail; empty when the kind is unknown or a needed key list is missing. */
function startupReasonText(error: ApiError, t: TFunction): string {
  const { reason } = error;
  if (!reason || !STARTUP_REASONS.has(reason)) return '';
  if (reason !== 'missing_keys') return t(`errors.startup_reason.${reason}`);
  const keys = error.keys.filter((key) => KEY_NAME.test(key));
  return keys.length > 0 ? t('errors.startup_reason.missing_keys', { keys: keys.join(', ') }) : '';
}

/** The text a person reads for a failed API call: never a JSON body, a status prefix or HTML. */
export function describeApiError(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError)) return t('errors.failed');
  const knownKey = error.code ? KNOWN_CODE_TEXT[error.code] : undefined;
  if (knownKey) {
    const known = t(knownKey);
    const reasonText = error.code === 'STARTUP_WOULD_FAIL' ? startupReasonText(error, t) : '';
    return reasonText ? `${known} ${reasonText}` : known;
  }
  if (error.status >= 500) return statusText(error.status, t);
  return error.serverText ?? statusText(error.status, t);
}
