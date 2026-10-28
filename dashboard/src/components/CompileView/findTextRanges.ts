export function findTextRanges(element: Element, query: string): Range[] {
  if (!query) return [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const start = text.length;
    text += node.data;
    if (node.data.length) nodes.push({ node, start, end: text.length });
  }
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: Range[] = [];
  let from = 0;
  for (let index = lower.indexOf(needle, from); index !== -1; index = lower.indexOf(needle, from)) {
    const end = index + needle.length;
    const first = nodes.find(item => item.start <= index && item.end > index);
    const last = nodes.find(item => item.start < end && item.end >= end);
    if (first && last) {
      const range = document.createRange();
      range.setStart(first.node, index - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
    }
    from = end;
  }
  return ranges;
}
