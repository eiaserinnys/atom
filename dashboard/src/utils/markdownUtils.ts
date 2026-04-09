/**
 * Pre-processes a markdown string to close any unclosed fenced code blocks.
 *
 * When compile_subtree concatenates multiple card contents, a card with an
 * opening fence (```) that has no matching closing fence will cause all
 * subsequent content to be rendered as a code block. This function detects
 * such unclosed fences and appends the closing fence at the end.
 *
 * Follows CommonMark §4.5: a fence is opened by a line starting with 3+ ` or ~
 * and closed by a line containing only the same character repeated at least
 * as many times as the opening fence.
 */
export function closeUnclosedCodeFences(md: string): string {
  const lines = md.split('\n');
  let fenceOpen = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const stripped = line.trimStart();
    if (!fenceOpen) {
      const m = stripped.match(/^(`{3,}|~{3,})/);
      if (m) {
        fenceOpen = true;
        fenceChar = m[1]![0]!;
        fenceLen = m[1]!.length;
      }
    } else {
      const closeRe = new RegExp(
        `^${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`
      );
      if (closeRe.test(stripped)) {
        fenceOpen = false;
      }
    }
  }

  return fenceOpen ? md + '\n' + fenceChar.repeat(fenceLen) + '\n' : md;
}
