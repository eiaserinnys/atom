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

  it("returns an empty string when the body is only markup", () => {
    expect(toOutlineExcerpt("```\ncode only\n```", 200)).toBe("");
  });
});
