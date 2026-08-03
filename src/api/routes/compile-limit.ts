export type CompileLimitParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

const COMPILE_LIMIT_ERROR = "limit must be a positive safe integer";

export function parseCompileLimit(raw: unknown): CompileLimitParseResult {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) {
    return { ok: false, error: COMPILE_LIMIT_ERROR };
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: COMPILE_LIMIT_ERROR };
  }

  return { ok: true, value };
}
