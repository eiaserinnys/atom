import { extractMarkdownHeadings } from "../../src/shared/compile-markdown-headings.js";

describe("extractMarkdownHeadings", () => {
  it("collects ATX headings outside matching fenced code blocks and strips inline markup", () => {
    const markdown = [
      "# Root <!-- node:root card:root depth:0 -->",
      "   ## `code` **bold** _italic_ ###",
      "```js",
      "# ignored backtick heading",
      "~~~~",
      "## also ignored until the matching fence",
      "````",
      "~~~ts",
      "### ignored tilde heading",
      "~~~~~",
      "#### After fences <!-- source:example -->",
      "##### <!-- empty after comment -->",
      "outside `inline` heading text",
    ].join("\n");

    expect(extractMarkdownHeadings(markdown)).toEqual([
      { level: 1, text: "Root" },
      { level: 2, text: "code bold italic" },
      { level: 4, text: "After fences" },
    ]);
  });
});
