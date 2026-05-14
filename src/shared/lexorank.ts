/**
 * LexoRank — fractional indexing keys for tree_nodes.position.
 *
 * Cycle A1 (260514.01.atom-ordering-redesign) introduced the TEXT column
 * with byte-wise sortable string keys. The external API surface keeps
 * `position: number` for backward compatibility — conversion happens at
 * the DB boundary via `posToKey` (write) and `keyToPos` (read).
 *
 * Cycle A2 removed the park-territory variant alongside the
 * park-and-assign batch.service workaround that used it. Non-negative
 * positions are the only legal input; negative inputs throw at
 * `posToKey`. `keyToPos` keeps a defensive park-prefix guard so that
 * any malformed key (e.g. a stale legacy row, or a future bug
 * introducing prefixes) never silently leaks into a JSON response.
 *
 * Design:
 *   - Normal territory: zero-padded 10-digit decimal (`'0000000100'` = 100).
 *     Byte-wise sort identical to integer sort for any fixed digit count.
 *
 *   - `keyBetween` and `rekeyEvenly` are implemented for future cycle B
 *     activation (new `before/after` MCP interface, automatic rekeying).
 *     They are NOT called at runtime yet — absolute positions are still
 *     the only external input.
 *
 *   - `keyToPos` defensively throws on park-prefixed, wrong-length, or
 *     non-digit keys so a malformed value can never reach a response via
 *     `rowToNode`. After cycle A2 these conditions are unreachable in
 *     practice, but the guard is the canonical boundary validation
 *     (design-principles §4 + §7) and costs nothing.
 *
 * Single canonical conversion site (design-principles §3):
 *   ALL `number ↔ string` conversions for tree_nodes.position must go
 *   through `posToKey` / `keyToPos`. Do not re-implement the conversion
 *   elsewhere (queries/tree.ts, batch.service.ts, config.ts) — import
 *   these functions instead.
 */

/** Normal-territory alphabet — ASCII digits, byte-wise ordered. */
export const NORMAL_ALPHABET = "0123456789";

/** Digit count of a normal zero-padded key. */
export const NORMAL_DIGIT_COUNT = 10;

/** Signed 32-bit integer bounds — matches PostgreSQL INTEGER range. */
const INT32_MAX = 2_147_483_647;

const NORMAL_KEY_RE = /^[0-9]{10}$/;

function padMagnitude(n: number): string {
  return String(n).padStart(NORMAL_DIGIT_COUNT, "0");
}

/**
 * Convert a non-negative integer to its sortable key string.
 *
 * - n ∈ [0, 2147483647]: zero-padded 10-digit decimal (e.g. 100 → '0000000100').
 *
 * Throws on non-integer, NaN, Infinity, negative, or out-of-range input.
 * Cycle A2: negative input is rejected at this boundary — the park
 * territory that previously accepted [-2_000_000_000, -1] is gone.
 *
 * @example
 *   posToKey(0)   // '0000000000'
 *   posToKey(100) // '0000000100'
 *   posToKey(-1)  // throws
 */
export function posToKey(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`posToKey: non-finite input: ${n}`);
  }
  if (!Number.isInteger(n)) {
    throw new Error(`posToKey: non-integer input: ${n}`);
  }
  if (n < 0 || n > INT32_MAX) {
    throw new Error(`posToKey: out-of-range input: ${n}`);
  }
  return padMagnitude(n);
}

/**
 * Inverse of `posToKey` for normal-territory keys.
 *
 * Cycle A2 defensive guard:
 *   The park prefixes (`!`, `"`) that the obsolete park-and-assign
 *   strategy used are no longer produced by `posToKey`. The guard below
 *   is kept as a *boundary defense* (design-principles §7) — any value
 *   reaching `rowToNode` with these prefixes would indicate a legacy
 *   migration leak or a future bug. We fail loudly rather than coerce.
 *
 *   Wrong length and non-digit characters are likewise rejected;
 *   `keyBetween` outputs (fractional, extended-digit keys) would land
 *   here and throw, which is correct until cycle B switches the
 *   response type from `number` to `string`.
 *
 * @example
 *   keyToPos('0000000100') // 100
 *   keyToPos('!0000000000')         // throws (legacy park prefix)
 *   keyToPos('00000001005')         // throws (length mismatch — fractional)
 *   keyToPos('000000010A')          // throws (non-digit)
 */
export function keyToPos(key: string): number {
  if (typeof key !== "string") {
    throw new Error(`keyToPos: non-string input: ${typeof key}`);
  }
  // Boundary defense — legacy park prefixes should never reach here
  // after cycle A2, but throw loudly if they do.
  if (key.startsWith("!") || key.startsWith('"')) {
    throw new Error(`keyToPos: legacy park prefix detected: ${JSON.stringify(key)}`);
  }
  if (key.length !== NORMAL_DIGIT_COUNT) {
    throw new Error(
      `keyToPos: invalid length ${key.length} (expected ${NORMAL_DIGIT_COUNT}): ${JSON.stringify(key)}`
    );
  }
  if (!NORMAL_KEY_RE.test(key)) {
    throw new Error(`keyToPos: non-digit character in key: ${JSON.stringify(key)}`);
  }
  return parseInt(key, 10);
}

/**
 * Byte-wise key comparison. Suitable as `Array.prototype.sort` comparator.
 *
 * Equivalent to JavaScript's default `<` / `>` for strings (UTF-16 code units),
 * which matches PostgreSQL `COLLATE "C"` and SQLite `COLLATE BINARY` for the
 * ASCII-only character set used by this module.
 */
export function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Fractional indexing — keyBetween, rekeyEvenly
// ---------------------------------------------------------------------------
//
// These functions are implemented for future cycle B (new `before/after` MCP
// interface) activation. They are NOT called at runtime yet — absolute
// positions remain the only external input. The unit suite covers them so
// cycle B can adopt them without algorithmic surprises.

function isNormalKey(key: string): boolean {
  return NORMAL_KEY_RE.test(key);
}

/**
 * Produce a key K with `prev < K < next` (byte-wise).
 *
 * - `prev = null`: K is less than `next` (insert at the start).
 * - `next = null`: K is greater than `prev` (insert at the end).
 * - Both null: returns an arbitrary middle key (initial insert).
 *
 * Throws if `prev >= next` (caller must order inputs).
 *
 * Algorithm (normal territory only):
 *   - Both keys normal, BigInt difference ≥ 2 → integer midpoint, zero-padded.
 *   - Both keys normal, BigInt difference == 1 → extend digits by appending '5'.
 *   - One side null → midpoint between the other side and the open boundary.
 *
 * Non-normal inputs throw — `keyBetween` only operates on the canonical
 * zero-padded alphabet.
 */
export function keyBetween(prev: string | null, next: string | null): string {
  if (prev !== null && next !== null && !(prev < next)) {
    throw new Error(`keyBetween: prev (${prev}) must be strictly less than next (${next})`);
  }

  // Both null: arbitrary middle of normal territory.
  if (prev === null && next === null) {
    return padMagnitude(500_000_000);
  }

  // prev null: produce key < next.
  if (prev === null) {
    if (!isNormalKey(next!)) {
      throw new Error(`keyBetween: non-normal next not supported: ${next}`);
    }
    const n = BigInt(next!);
    if (n === 0n) {
      // next is the smallest normal key; can't go below in zero-padded space.
      // Cycle B can extend territory if needed. For now: throw.
      throw new Error(`keyBetween: cannot insert before '${next}' (zero key)`);
    }
    return String(n / 2n).padStart(NORMAL_DIGIT_COUNT, "0");
  }

  // next null: produce key > prev.
  if (next === null) {
    if (!isNormalKey(prev!)) {
      throw new Error(`keyBetween: non-normal prev not supported: ${prev}`);
    }
    const p = BigInt(prev!);
    const MAX = 9_999_999_999n;
    if (p >= MAX) {
      // Extend digit count by appending '5'.
      return prev + "5";
    }
    // Midpoint between prev and MAX
    return String(p + (MAX - p) / 2n).padStart(NORMAL_DIGIT_COUNT, "0");
  }

  // Both non-null. Both must be normal-territory.
  if (!isNormalKey(prev) || !isNormalKey(next)) {
    throw new Error(`keyBetween: non-normal inputs not supported (prev=${prev}, next=${next})`);
  }
  const p = BigInt(prev);
  const n = BigInt(next);
  const diff = n - p;
  if (diff >= 2n) {
    return String(p + diff / 2n).padStart(NORMAL_DIGIT_COUNT, "0");
  }
  // diff === 1n — adjacent. Extend digits by appending '5' to prev.
  // Result is prev + "5" which is byte-wise > prev (longer with same prefix)
  // and byte-wise < next (shares first 9 digits with prev, last digit of next
  // is one greater).
  return prev + "5";
}

/**
 * Produce `count` evenly-spaced keys in ascending order.
 *
 * Used by rekeying jobs (cycle B) when a parent's sibling keys grow too
 * long from repeated inserts at the same position. The output keys span
 * the normal territory at uniform intervals.
 *
 * @param count number of keys to produce (≥ 0). count=0 returns [].
 */
export function rekeyEvenly(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`rekeyEvenly: count must be a non-negative integer: ${count}`);
  }
  if (count === 0) return [];
  // Evenly spaced in [100, 100*count] — same spacing as legacy integer scheme.
  const result: string[] = [];
  for (let i = 1; i <= count; i++) {
    result.push(posToKey(i * 100));
  }
  return result;
}
