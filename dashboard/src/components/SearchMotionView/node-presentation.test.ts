import { expect, test } from 'vitest';
import { fitZoom, nodeTextLayout, resolveDisplayPath } from './node-presentation.js';

test('N1: automatic fit retains readable 50%, explicit fit can reach 25%', () => {
  expect(fitZoom(390, 300, 1300, 900, true)).toBe(.5);
  expect(fitZoom(390, 300, 1300, 900, false)).toBeCloseTo(.3);
  expect(fitZoom(390, 300, 2000, 2000, false)).toBe(.25);
});

test('B3/B4: compact titles stay 14 screen px, center without a path, and hide together below 50%', () => {
  for (const zoom of [.5, .72, .76]) {
    const layout = nodeTextLayout(['Folder', 'Card'], zoom);
    expect(layout.titleSize * zoom).toBeCloseTo(14, 8);
    expect(layout.titleY).toBe(24);
    expect(layout.showPath).toBe(false);
  }
  expect(nodeTextLayout(['Card'], 1).titleY).toBe(24);
  expect(nodeTextLayout(['Folder', 'Card'], 1).showPath).toBe(true);
  expect(nodeTextLayout(['Folder', 'Card'], .46).showText).toBe(false);
});
test('B4: event ancestors and already cached tree nodes fill lexical paths without fetching', () => {
  const node = { nodeId: 'c', title: 'Card', path: ['Card'], physicalParent: 'p' };
  const graph = new Map([['parent', { nodeId: 'p', title: 'Folder', physicalParent: 'root' }]]);
  expect(resolveDisplayPath(node, graph)).toEqual(['Folder', 'Card']);
  expect(resolveDisplayPath(node, graph, [{ id: 'root', card: { title: 'Root' }, parent_node_id: null }])).toEqual(['Root', 'Folder', 'Card']);
});
