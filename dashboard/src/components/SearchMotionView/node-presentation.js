// Use paths already present in events and the shared tree query cache. Never fetch.
export function resolveDisplayPath(node, graph, cachedTrees = []) {
  if (node.path?.length > 1) return node.path;
  const known = new Map([...graph.values()].filter(n => n.nodeId).map(n => [n.nodeId, { title: n.title, parent: n.physicalParent }]));
  const visit = rows => {
    for (const row of rows) {
      if (!row?.card || !row.id) continue;
      known.set(row.id, { title: row.card.title, parent: row.parent_node_id });
      if (row.children) visit(row.children);
    }
  };
  visit(cachedTrees);
  const path = [node.title]; const seen = new Set([node.nodeId]);
  let parent = known.get(node.nodeId)?.parent ?? node.physicalParent;
  while (parent && !seen.has(parent) && known.has(parent)) {
    seen.add(parent); const item = known.get(parent); path.unshift(item.title); parent = item.parent;
  }
  return path;
}

export function nodeTextLayout(path, zoom, height = 48) {
  const showPath = zoom >= 1 && path.length > 1;
  return { showText: zoom >= .5, showPath, titleY: showPath ? 15 : height / 2, titleSize: 14 / Math.min(1, zoom) };
}

export function fitZoom(availableWidth, availableHeight, width, height, automatic) {
  return Math.max(automatic ? .5 : .25, Math.min(1, availableWidth / width, availableHeight / height));
}

export function operationGroups(nodes, operations) {
  const order = new Map(operations.map((operation, index) => [operation.id, index]));
  return [...Map.groupBy(nodes, node => node.displayColumn).values()]
    .sort((a, b) => (order.get(a[0].displayColumn) ?? Infinity) - (order.get(b[0].displayColumn) ?? Infinity));
}
