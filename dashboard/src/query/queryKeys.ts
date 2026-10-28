export function rootTreeQueryKey() {
  return ['tree', null] as const;
}

export function allTreeQueryKey() {
  return ['tree'] as const;
}

export function childrenQueryKey(nodeId: string) {
  return ['children', nodeId] as const;
}

export function allChildrenQueryKey() {
  return ['children'] as const;
}

export function nodeQueryKey(nodeId: string | null) {
  return ['node', nodeId] as const;
}

export function allNodeQueryKey() {
  return ['node'] as const;
}

export function standardCompileQueryKey(nodeId: string | null, depth: number) {
  return ['compile', nodeId, depth] as const;
}

export function standardCompileNodeQueryKey(nodeId: string | null) {
  return ['compile', nodeId] as const;
}

export function compileSectionsQueryKey(nodeId: string | null, depth: number) {
  return ['compile', nodeId, depth, 'sections'] as const;
}

export function unfurlSectionsQueryKey(nodeId: string | null, depth: number) {
  return ['compile-unfurl', nodeId, depth, 'sections'] as const;
}

export function compileFindQueryKey(nodeId: string | null, depth: number, query: string) {
  return ['compile', nodeId, depth, 'find', query] as const;
}

export function unfurlCompileQueryKey(nodeId: string | null, depth: number) {
  return ['compile-unfurl', nodeId, depth] as const;
}

export function unfurlCompileNodeQueryKey(nodeId: string | null) {
  return ['compile-unfurl', nodeId] as const;
}

export function structureTreeQueryKey() {
  return ['structureTree'] as const;
}
