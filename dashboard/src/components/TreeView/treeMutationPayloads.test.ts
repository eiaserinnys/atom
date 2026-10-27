import { describe, expect, test } from 'vitest';
import {
  buildCreateCardPayload,
  buildEditCardPayload,
  buildMoveNodePayload,
} from './treeMutationPayloads';

describe('tree mutation payload builders', () => {
  test('preserves create payload for child cards and omits empty content during JSON serialization', () => {
    expect(buildCreateCardPayload({
      cardType: 'knowledge',
      title: 'New note',
      content: '',
      parentNodeId: 'parent-1',
    })).toStrictEqual({
      card_type: 'knowledge',
      title: 'New note',
      content: undefined,
      parent_node_id: 'parent-1',
    });
  });

  test('preserves root create payload with null parent', () => {
    expect(buildCreateCardPayload({
      cardType: 'structure',
      title: 'Root folder',
      content: 'body',
      parentNodeId: null,
    })).toStrictEqual({
      card_type: 'structure',
      title: 'Root folder',
      content: 'body',
      parent_node_id: null,
    });
  });

  test('preserves an explicit empty edit body and the version captured when editing began', () => {
    expect(buildEditCardPayload({ cardId: 'card-1', title: 'Renamed', content: '', expectedVersion: 4 })).toStrictEqual({
      title: 'Renamed',
      content: '',
      expected_version: 4,
    });
  });

  test('preserves move payload conversion through the relative move contract', () => {
    expect(buildMoveNodePayload({
      nodeId: 'moving',
      parentNodeId: 'parent-1',
      before: 'target',
    })).toStrictEqual({
      parent_node_id: 'parent-1',
      before: 'target',
    });
  });
});
