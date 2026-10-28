export interface MarkdownHeading {
  level: number;
  text: string;
}

/** Extract plain-text ATX headings, skipping the same fenced code blocks used by the dashboard. */
export function extractMarkdownHeadings(markdown: string | null): MarkdownHeading[] {
  if (!markdown) return [];

  const headings: MarkdownHeading[] = [];
  let fenceChar: string | null = null;
  let fenceLength = 0;

  for (const line of markdown.split("\n")) {
    const stripped = line.trimStart();
    if (fenceChar !== null) {
      const closePattern = fenceChar === "`" ? /^`{3,}\s*$/ : /^~{3,}\s*$/;
      const closingFence = stripped.match(closePattern)?.[0].trimEnd() ?? "";
      if (closingFence.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }

    const openingFence = stripped.match(/^(`{3,}|~{3,})/);
    if (openingFence) {
      fenceChar = openingFence[1]![0]!;
      fenceLength = openingFence[1]!.length;
      continue;
    }

    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
    if (!match) continue;

    const text = match[2]!
      .replace(/<!--.*?-->/g, "")
      .replace(/[`*_]/g, "")
      .trim();
    if (text) headings.push({ level: match[1]!.length, text });
  }

  return headings;
}
