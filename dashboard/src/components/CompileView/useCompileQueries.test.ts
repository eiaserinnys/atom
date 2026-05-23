import { describe, expect, test } from 'vitest';
import { standardCompileQueryKey, unfurlCompileQueryKey } from './useCompileQueries';

describe('compile query keys', () => {
  test('preserves the standard compile query key shape', () => {
    expect(standardCompileQueryKey('node-1', 5)).toEqual(['compile', 'node-1', 5]);
  });

  test('preserves the unfurl compile query key shape', () => {
    expect(unfurlCompileQueryKey('node-1', Infinity)).toEqual([
      'compile-unfurl',
      'node-1',
      Infinity,
    ]);
  });
});
