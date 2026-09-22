/**
 * Plain-text excerpt of a card body for GET /api/tree/outline?excerpt_chars=N.
 *
 * Enough to infer what a card is about without shipping its body:
 * fenced code blocks are dropped whole (an unterminated fence runs to the
 * end), table delimiter rows and horizontal rules are dropped, the markdown
 * symbols ` * _ > # | are removed and all whitespace collapses to single
 * spaces. The result is cut to `maxChars` code points (never splitting a
 * surrogate pair) with a trailing "…" when anything was cut.
 */

/** Raw body prefix the outline query reads per card when an excerpt is requested. */
export const EXCERPT_SOURCE_CHARS = 4000;

const FENCED_BLOCK = /^[ \t]*(`{3,}|~{3,})[^\n]*\n?[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
// A line made only of | : - and blanks that contains "---": a table
// delimiter row or a horizontal rule. One character class, so matching stays
// linear — a cell-by-cell pattern backtracked super-linearly on lines that
// look like a delimiter and fail late.
const RULE_OR_TABLE_DELIMITER = /^(?=[^\r\n]*---)[ \t\r|:-]+$/gm;
const MARKDOWN_SYMBOLS = /[`*_>#|]/g;

export function toOutlineExcerpt(content: string | null, maxChars: number): string | null {
  if (content === null) return null;

  const plain = content
    .replace(FENCED_BLOCK, " ")
    .replace(RULE_OR_TABLE_DELIMITER, " ")
    .replace(MARKDOWN_SYMBOLS, " ")
    .replace(/\s+/g, " ")
    .trim();

  const codePoints = Array.from(plain);
  if (codePoints.length <= maxChars) return plain;
  return `${codePoints.slice(0, maxChars).join("").trimEnd()}…`;
}
