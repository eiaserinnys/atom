import { request } from './request';
import type { CompileOptions, UnfurlEntry } from './types';

export const compileApi = {
  compile(nodeId: string, options?: CompileOptions): Promise<{ markdown: string }> {
    const params = new URLSearchParams();
    if (options?.depth === Infinity) {
      params.set('depth', 'Infinity');
    } else if (options?.depth !== undefined) {
      params.set('depth', String(options.depth));
    }
    if (options?.include_ids) params.set('include_ids', 'true');
    if (options?.titles_only) params.set('titles_only', 'true');
    if (options?.numbering) params.set('numbering', 'true');
    if (options?.max_chars !== undefined) params.set('max_chars', String(options.max_chars));
    if (options?.exclude_nodes?.length) {
      params.set('exclude_nodes', options.exclude_nodes.join(','));
    }
    const qs = params.toString();
    return request(`/tree/${nodeId}/compile${qs ? `?${qs}` : ''}`);
  },

  compileWithRefs(
    nodeId: string,
    depth: number,
    resolveRefs: 'cached' | 'fresh',
    credentials: Record<string, Record<string, string>>
  ): Promise<{ markdown: string; unfurls?: Record<string, UnfurlEntry> }> {
    return request(`/tree/${nodeId}/compile`, {
      method: 'POST',
      body: JSON.stringify({ depth: depth === Infinity ? null : depth, resolveRefs, credentials }),
    });
  },
};
