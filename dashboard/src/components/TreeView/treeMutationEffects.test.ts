import { describe, expect, test } from 'vitest';
import {
  applyCreateSuccess,
  applyDeleteError,
  applyDeleteSuccess,
  applyEditSuccess,
  applyMoveSuccess,
  getDeleteErrorMessage,
  type TreeMutationSideEffects,
} from './treeMutationEffects';

function recordEffects() {
  const calls: string[] = [];
  const effects: TreeMutationSideEffects = {
    expandParent: (nodeId) => calls.push(`expandParent:${nodeId}`),
    selectNode: (nodeId) => calls.push(`selectNode:${nodeId ?? 'null'}`),
    closeModal: () => calls.push('closeModal'),
    clearDeleteError: () => calls.push('clearDeleteError'),
    setDeleteError: (message) => calls.push(`setDeleteError:${message}`),
  };
  return { calls, effects };
}

describe('tree mutation side effects', () => {
  test('create success expands child parent, selects created node, and closes modal', () => {
    const { calls, effects } = recordEffects();

    applyCreateSuccess({ createdNodeId: 'new-node', parentNodeId: 'parent-1' }, effects);

    expect(calls).toEqual([
      'expandParent:parent-1',
      'selectNode:new-node',
      'closeModal',
    ]);
  });

  test('root create success does not expand a parent', () => {
    const { calls, effects } = recordEffects();

    applyCreateSuccess({ createdNodeId: 'root-node', parentNodeId: null }, effects);

    expect(calls).toEqual([
      'selectNode:root-node',
      'closeModal',
    ]);
  });

  test('edit success closes modal without invalidating the full tree', () => {
    const { calls, effects } = recordEffects();

    applyEditSuccess(effects);

    expect(calls).toEqual(['closeModal']);
  });

  test('selected delete success clears selection, closes modal, and clears delete error', () => {
    const { calls, effects } = recordEffects();

    applyDeleteSuccess({ deletedNodeId: 'node-1', selectedNodeId: 'node-1' }, effects);

    expect(calls).toEqual([
      'selectNode:null',
      'closeModal',
      'clearDeleteError',
    ]);
  });

  test('non-selected delete success keeps selection and clears delete error', () => {
    const { calls, effects } = recordEffects();

    applyDeleteSuccess({ deletedNodeId: 'node-1', selectedNodeId: 'node-2' }, effects);

    expect(calls).toEqual([
      'closeModal',
      'clearDeleteError',
    ]);
  });

  test('delete error preserves Error messages and falls back for non-Error values', () => {
    expect(getDeleteErrorMessage(new Error('cannot delete'))).toBe('cannot delete');
    expect(getDeleteErrorMessage({ message: 'plain object' })).toBe('삭제 중 오류가 발생했습니다.');

    const { calls, effects } = recordEffects();
    applyDeleteError(new Error('cannot delete'), effects);

    expect(calls).toEqual(['setDeleteError:cannot delete']);
  });

  test('move success leaves data updates to SSE; modal close remains a caller onSuccess concern', () => {
    const { calls } = recordEffects();

    applyMoveSuccess();

    expect(calls).toEqual([]);
  });
});
