import { describe, expect, test, vi } from 'vitest';
import {
  applyInitialNodePathRestore,
  resolveNodePath,
  restoreInitialNodePath,
} from './useInitialNodePathRestore';

function node(parentNodeId: string | null) {
  return { parent_node_id: parentNodeId };
}

describe('initial node path restore', () => {
  test('resolves a target-to-parent-to-root chain as a root-to-target path', async () => {
    const getNode = vi.fn(async (nodeId: string) => {
      if (nodeId === 'target') return node('parent');
      if (nodeId === 'parent') return node('root');
      if (nodeId === 'root') return node(null);
      throw new Error(`unexpected node ${nodeId}`);
    });

    await expect(resolveNodePath(getNode, 'target')).resolves.toEqual([
      'root',
      'parent',
      'target',
    ]);
    expect(getNode).toHaveBeenCalledTimes(3);
    expect(getNode.mock.calls.map(([nodeId]) => nodeId)).toEqual(['target', 'parent', 'root']);
  });

  test('expands only ancestors and then selects the target', () => {
    const calls: string[] = [];

    applyInitialNodePathRestore(
      { targetId: 'target', path: ['root', 'parent', 'target'] },
      {
        expandAncestors: (nodeIds) => calls.push(`expand:${nodeIds.join(',')}`),
        selectNode: (nodeId) => calls.push(`select:${nodeId}`),
      }
    );

    expect(calls).toEqual(['expand:root,parent', 'select:target']);
  });

  test('does not expand or select when the first target lookup fails', async () => {
    const getNode = vi.fn(async () => {
      throw new Error('not found');
    });
    const expandAncestors = vi.fn();
    const selectNode = vi.fn();

    await restoreInitialNodePath({
      targetId: 'target',
      rootsLoaded: true,
      getNode,
      expandAncestors,
      selectNode,
    });

    expect(getNode).toHaveBeenCalledTimes(1);
    expect(expandAncestors).not.toHaveBeenCalled();
    expect(selectNode).not.toHaveBeenCalled();
  });

  test('keeps target selection when an ancestor lookup fails after the target is found', async () => {
    const getNode = vi.fn(async (nodeId: string) => {
      if (nodeId === 'target') return node('missing-parent');
      throw new Error(`missing ${nodeId}`);
    });
    const expandAncestors = vi.fn();
    const selectNode = vi.fn();

    await restoreInitialNodePath({
      targetId: 'target',
      rootsLoaded: true,
      getNode,
      expandAncestors,
      selectNode,
    });

    expect(getNode.mock.calls.map(([nodeId]) => nodeId)).toEqual(['target', 'missing-parent']);
    expect(expandAncestors).toHaveBeenCalledWith([]);
    expect(selectNode).toHaveBeenCalledWith('target');
  });

  test('does not call getNode before there is a target and loaded roots', async () => {
    const getNode = vi.fn(async () => node(null));

    await restoreInitialNodePath({
      targetId: undefined,
      rootsLoaded: true,
      getNode,
      expandAncestors: vi.fn(),
      selectNode: vi.fn(),
    });
    await restoreInitialNodePath({
      targetId: 'target',
      rootsLoaded: false,
      getNode,
      expandAncestors: vi.fn(),
      selectNode: vi.fn(),
    });

    expect(getNode).not.toHaveBeenCalled();
  });
});
