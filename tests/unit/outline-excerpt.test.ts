/**
 * Outline excerpt — plain-text preview of a card body (pure function).
 */
import { toOutlineExcerpt } from "../../src/services/outline-excerpt.js";

describe("toOutlineExcerpt", () => {
  it("returns null when the card has no body", () => {
    expect(toOutlineExcerpt(null, 200)).toBeNull();
  });

  it("strips markdown symbols and normalizes whitespace", () => {
    const body = "# Title\n\n> quoted **bold** and _em_\n\n| a | b |\n\n`inline`   code";
    expect(toOutlineExcerpt(body, 200)).toBe("Title quoted bold and em a b inline code");
  });

  it("drops fenced code blocks, including an unterminated trailing fence", () => {
    const body = "Intro line\n```bash\nrm -rf /tmp/x\n```\nAfter fence\n~~~\nleft open";
    expect(toOutlineExcerpt(body, 200)).toBe("Intro line After fence");
  });

  it("drops table delimiter rows and horizontal rules", () => {
    const body = "| k | v |\n|---|:--:|\n| x | y |\n\n---\nend";
    expect(toOutlineExcerpt(body, 200)).toBe("k v x y end");
  });

  it("keeps a short body whole, without an ellipsis", () => {
    expect(toOutlineExcerpt("short body", 200)).toBe("short body");
    expect(toOutlineExcerpt("x".repeat(200), 200)).toBe("x".repeat(200));
  });

  it("cuts to maxChars and appends an ellipsis", () => {
    expect(toOutlineExcerpt("x".repeat(201), 200)).toBe(`${"x".repeat(200)}…`);
    expect(toOutlineExcerpt("abcdef ghij", 7)).toBe("abcdef…");
  });

  it("counts code points, never splitting a surrogate pair", () => {
    const body = "😀".repeat(5);
    expect(toOutlineExcerpt(body, 3)).toBe("😀😀😀…");
  });

  it("handles CRLF delimiter rows", () => {
    expect(toOutlineExcerpt("| k | v |\r\n|---|---|\r\n| x | y |", 200)).toBe("k v x y");
  });

  // Delimiter-like lines that fail late used to backtrack super-linearly and
  // block the event loop: each input below took ~2-3s with the old pattern
  // (and grows exponentially / cubically with one more cell or more spaces).
  // Sized so a regression fails in seconds instead of hanging the suite; the
  // linear pattern takes well under a millisecond, so the bound cannot flake.
  it.each([
    ["empty cells after a delimiter start", `Intro\n| --- ${"|   ".repeat(12)}| x |\nmore`],
    ["pipes after a rule", `---${"| ".repeat(24)}x`],
    ["spaces after a delimiter cell", `---|${" ".repeat(1600)}x`],
  ])("stays fast on adversarial input: %s", (_label, body) => {
    const start = performance.now();
    toOutlineExcerpt(body, 400);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("returns an empty string when the body is only markup", () => {
    expect(toOutlineExcerpt("```\ncode only\n```", 200)).toBe("");
  });
});
