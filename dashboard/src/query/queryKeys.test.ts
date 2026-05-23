import { describe, expect, test } from 'vitest';
import {
  allChildrenQueryKey,
  allNodeQueryKey,
  allTreeQueryKey,
  childrenQueryKey,
  nodeQueryKey,
  rootTreeQueryKey,
  standardCompileNodeQueryKey,
  standardCompileQueryKey,
  structureTreeQueryKey,
  unfurlCompileNodeQueryKey,
  unfurlCompileQueryKey,
} from './queryKeys';

describe('dashboard query keys', () => {
  test('preserves tree and children query key contracts', () => {
    expect(rootTreeQueryKey()).toEqual(['tree', null]);
    expect(allTreeQueryKey()).toEqual(['tree']);
    expect(childrenQueryKey('node-1')).toEqual(['children', 'node-1']);
    expect(allChildrenQueryKey()).toEqual(['children']);
  });

  test('preserves node query key contracts', () => {
    expect(nodeQueryKey('node-1')).toEqual(['node', 'node-1']);
    expect(nodeQueryKey(null)).toEqual(['node', null]);
    expect(allNodeQueryKey()).toEqual(['node']);
  });

  test('preserves compile query key contracts', () => {
    expect(standardCompileQueryKey('node-1', 5)).toEqual(['compile', 'node-1', 5]);
    expect(standardCompileNodeQueryKey('node-1')).toEqual(['compile', 'node-1']);
    expect(unfurlCompileQueryKey('node-1', Infinity)).toEqual([
      'compile-unfurl',
      'node-1',
      Infinity,
    ]);
    expect(unfurlCompileNodeQueryKey('node-1')).toEqual(['compile-unfurl', 'node-1']);
  });

  test('preserves structure tree query key contract', () => {
    expect(structureTreeQueryKey()).toEqual(['structureTree']);
  });
});
