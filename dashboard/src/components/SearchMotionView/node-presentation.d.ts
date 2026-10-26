export function resolveDisplayPath(node: Record<string, any>, graph: Map<string, any>, cachedTrees?: any[]): string[];
export function nodeTextLayout(path: string[], zoom: number, height?: number): { showText: boolean; showPath: boolean; titleY: number; titleSize: number };
export function fitZoom(availableWidth: number, availableHeight: number, width: number, height: number, automatic: boolean): number;
export function operationGroups<T extends { displayColumn: string }>(nodes: T[], operations: { id: string }[]): T[][];
