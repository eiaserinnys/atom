/**
 * LexoRank — fractional indexing keys for tree_nodes.position.
 *
 * Cycle A1 (260514.01.atom-ordering-redesign):
 *   This module replaces the integer position column with a TEXT column
 *   that uses byte-wise sortable string keys. The external API surface
 *   (MCP zod schemas, REST routes, response types) keeps `position: number`
 *   for backward compatibility — the conversion happens at the DB boundary
 *   via `posToKey` (write) and `keyToPos` (read).
 *
 * Design:
 *   - Normal territory: zero-padded 10-digit decimal (`'0000000100'` = 100).
 *     Byte-wise sort identical to integer sort for any fixed digit count.
 *   - Park territory (for batch.service park-and-assign):
 *       Group park (-2B to -1B-1):    `!` prefix + 10-digit magnitude
 *       Non-group park (-1B to -1):   `"` prefix + 10-digit magnitude
 *     Park prefixes are ASCII 0x21 / 0x22, below '0' (0x30), so park keys
 *     always sort before normal keys byte-wise.
 *
 *   - `keyBetween` and `rekeyEvenly` are implemented for future cycle B
 *     activation (new `before/after` MCP interface, automatic rekeying).
 *     They are NOT called at runtime in cycle A1 — park-and-assign remains
 *     the active mechanism.
 *
 *   - `keyToPos` defensively throws on park-prefixed or non-conforming keys
 *     so that a transactional intermediate state (park keys mid-Phase 1~4)
 *     can never leak into a JSON response via `rowToNode`.
 *
 * Single canonical conversion site (design-principles §3):
 *   ALL `number ↔ string` conversions for tree_nodes.position must go
 *   through `posToKey` / `keyToPos`. Do not re-implement the conversion
 *   elsewhere (queries/tree.ts, batch.service.ts, config.ts) — import
 *   these functions instead.
 */

/** Normal-territory alphabet — ASCII digits, byte-wise ordered. */
export const NORMAL_ALPHABET = "0123456789";

/** Park-group prefix (-2_000_000_000 to -1_000_000_001). ASCII 0x21. */
export const PARK_GROUP_PREFIX = "!";

/** Park-non-group prefix (-1_000_000_000 to -1). ASCII 0x22. */
export const PARK_NONGROUP_PREFIX = '"';

/** Digit count of a normal zero-padded key. */
export const NORMAL_DIGIT_COUNT = 10;

/** Magnitude offset for park-group integers (so magnitude is non-negative). */
const PARK_GROUP_BASE = -2_000_000_000;
/** Magnitude offset for park-non-group integers. */
const PARK_NONGROUP_BASE = -1_000_000_000;

/** Signed 32-bit integer bounds — matches PostgreSQL INTEGER range. */
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

const NORMAL_KEY_RE = /^[0-9]{10}$/;

function padMagnitude(n: number): string {
  return String(n).padStart(NORMAL_DIGIT_COUNT, "0");
}

/**
 * Convert a signed integer to its sortable key string.
 *
 * - n ∈ [0, 2147483647]: zero-padded 10-digit decimal (e.g. 100 → '0000000100').
 * - n ∈ [-1_000_000_000, -1]: PARK_NONGROUP_PREFIX + 10-digit magnitude.
 * - n ∈ [-2_000_000_000, -1_000_000_001]: PARK_GROUP_PREFIX + 10-digit magnitude.
 *
 * Throws on non-integer, NaN, Infinity, or out-of-range input.
 *
 * @example
 *   posToKey(0)              // '0000000000'
 *   posToKey(100)            // '0000000100'
 *   posToKey(-1)             // '"0999999999'
 *   posToKey(-2_000_000_000) // '!0000000000'
 */
export function posToKey(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`posToKey: non-finite input: ${n}`);
  }
  if (!Number.isInteger(n)) {
    throw new Error(`posToKey: non-integer input: ${n}`);
  }
  if (n < INT32_MIN || n > INT32_MAX) {
    throw new Error(`posToKey: out-of-range input: ${n}`);
  }

  if (n >= 0) {
    // Normal territory
    return padMagnitude(n);
  }
  if (n >= PARK_NONGROUP_BASE) {
    // Park-non-group: -1B ≤ n ≤ -1
    // magnitude = n - PARK_NONGROUP_BASE ∈ [0, 999_999_999]
    return PARK_NONGROUP_PREFIX + padMagnitude(n - PARK_NONGROUP_BASE);
  }
  // Park-group: -2B ≤ n ≤ -1B-1
  // magnitude = n - PARK_GROUP_BASE ∈ [0, 999_999_999]
  return PARK_GROUP_PREFIX + padMagnitude(n - PARK_GROUP_BASE);
}

/**
 * Inverse of `posToKey` for normal-territory keys.
 *
 * Throws on park-prefixed keys (defensive — they should never reach a
 * response), keys of wrong length, or keys containing non-digit characters.
 * The latter catches fractional keys produced by `keyBetween` that have
 * extended digit count beyond NORMAL_DIGIT_COUNT.
 *
 * @example
 *   keyToPos('0000000100') // 100
 *   keyToPos('!0000000000')         // throws (park prefix)
 *   keyToPos('00000001005')         // throws (length mismatch — fractional)
 *   keyToPos('000000010A')          // throws (non-digit)
 */
export function keyToPos(key: string): number {
  if (typeof key !== "string") {
    throw new Error(`keyToPos: non-string input: ${typeof key}`);
  }
  if (
    key.startsWith(PARK_GROUP_PREFIX) ||
    key.startsWith(PARK_NONGROUP_PREFIX)
  ) {
    throw new Error(`keyToPos: park prefix leaked to response: ${JSON.stringify(key)}`);
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
// interface) activation. Cycle A1 does NOT call them at runtime — park-and-
// assign remains the active mechanism for batch reorder. They are tested via
// the unit suite to ensure correctness when cycle B starts using them.

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
 * Park-territory inputs throw (cycle A1 does not need fractional between
 * park keys; park-and-assign uses integer arithmetic at the boundary).
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
      throw new Error(`keyBetween: park-territory next not supported: ${next}`);
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
      throw new Error(`keyBetween: park-territory prev not supported: ${prev}`);
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

  // Both non-null. Both must be normal-territory (cycle A1 limitation).
  if (!isNormalKey(prev) || !isNormalKey(next)) {
    throw new Error(`keyBetween: park-territory inputs not supported (prev=${prev}, next=${next})`);
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
