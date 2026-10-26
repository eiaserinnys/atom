import { describe, expect, test } from 'vitest';
import { applyExplorationEvent, createExplorationModel, projectExploration } from './exploration-model.js';

const A = 'card-a';
const B = 'card-b';
const C = 'card-c';
const X = 'card-x';

function card(cardId: string, nodeId: string, values: Record<string, unknown> = {}) {
  return {
    card_id: cardId,
    node_id: nodeId,
    card_type: 'knowledge',
    title: cardId,
    path: [],
    excerpt: '',
    similarity: 0,
    tree_relation: null,
    display_column_id: 'initial',
    column_label: '입구',
    selected: false,
    rank: 0,
    score: null,
    ...values,
  };
}

function started(id: string, fromCardId: string, kind: 'expand' | 'evaluate', requestedCardIds: string[] = []) {
  return { type: 'started' as const, id, kind, fromCardId, query: null, viaOperationId: null, requestedCardIds };
}

describe('exploration model', () => {
  test('deduplicates cards into expansion columns and keeps references to their first display', () => {
    const initial = createExplorationModel({
      query: 'original query',
      selectionThreshold: 0.5,
      initialCards: [
        card(A, 'node-a', { selected: true, rank: 1, score: 0.91 }),
        card(C, 'node-c', { selected: true, rank: 2, score: 0.71 }),
        card(X, 'node-x-first', { score: 0.88, initial_evaluation: { score: 0.88, call_id: 'initial-call', question_key: 'content_2' } }),
      ],
    });
    const afterStart = applyExplorationEvent(initial, started('expand-1', A, 'expand'));
    const afterExpansion = applyExplorationEvent(afterStart, {
      type: 'expansion_succeeded',
      operationId: 'expand-1',
      response: { neighbors: [
        { ...card(B, 'node-b', { similarity: 0.81, title: 'New neighbor' }) },
        { ...card(X, 'node-x-alias', { similarity: 0.77, title: 'Repeated neighbor' }) },
      ] },
    });
    const view = projectExploration(afterExpansion);

    expect(view.cards.map((entry: any) => entry.cardId)).toEqual([A, C, X, B]);
    expect(view.cards.find((entry: any) => entry.cardId === X)).toMatchObject({ nodeId: 'node-x-first', sourceLabel: '입구' });
    expect(view.cards.find((entry: any) => entry.cardId === B)).toMatchObject({ nodeId: 'node-b', sourceLabel: '확장 1', cardType: 'knowledge' });
    expect(view.columns).toContainEqual(expect.objectContaining({ id: 'expand-1', label: '확장 1', cardIds: [B], referenceIds: ['expand-1:ref:0'] }));
    expect(view.references).toEqual([expect.objectContaining({ id: 'expand-1:ref:0', fromCardId: A, toCardId: X, similarity: 0.77 })]);
    expect(view.resultOrder).toEqual([A, C]);
    expect(projectExploration(initial).cards).toHaveLength(3);
  });

  test('merges only explicit evaluation results, preserves initial ranks, and appends later scores without reordering', () => {
    let model = createExplorationModel({
      query: 'original query',
      selectionThreshold: 0.5,
      initialCards: [
        card(A, 'node-a', { selected: true, rank: 1, score: 0.91 }),
        card(C, 'node-c', { selected: true, rank: 2, score: 0.71 }),
        card(X, 'node-x', { score: 0.88, initial_evaluation: { score: 0.88, call_id: 'initial-call', question_key: 'content_2' } }),
      ],
    });
    model = applyExplorationEvent(model, started('expand-1', A, 'expand'));
    model = applyExplorationEvent(model, {
      type: 'expansion_succeeded', operationId: 'expand-1',
      response: { neighbors: [
        card(X, 'node-x-alias', { similarity: 0.77 }),
        card(B, 'node-b', { similarity: 0.81 }),
      ] },
    });
    model = applyExplorationEvent(model, { type: 'completed', operationId: 'expand-1' });

    expect(projectExploration(model).resultOrder).toEqual([A, C]);
    model = applyExplorationEvent(model, started('evaluate-1', A, 'evaluate', [B, X]));
    model = applyExplorationEvent(model, { type: 'evaluations_reused', operationId: 'evaluate-1', cardIds: [X] });
    model = applyExplorationEvent(model, {
      type: 'evaluation_batch_succeeded', operationId: 'evaluate-1',
      response: { results: [
        { card_id: B, card_version: 1, score: 0.7, call_id: 'eval-1', question_key: 'content_0' },
      ], audit: { calls: [] } },
    });
    model = applyExplorationEvent(model, { type: 'completed', operationId: 'evaluate-1' });
    expect(projectExploration(model).resultOrder).toEqual([A, C, X, B]);
    expect(projectExploration(model).results.map((entry: any) => [entry.cardId, entry.rank])).toEqual([[A, 1], [C, 2], [X, 3], [B, 4]]);

    model = applyExplorationEvent(model, started('expand-2', C, 'expand'));
    model = applyExplorationEvent(model, {
      type: 'expansion_succeeded', operationId: 'expand-2',
      response: { neighbors: [card('card-d', 'node-d', { similarity: 0.95 })] },
    });
    model = applyExplorationEvent(model, { type: 'completed', operationId: 'expand-2' });
    model = applyExplorationEvent(model, started('evaluate-2', C, 'evaluate', ['card-d']));
    model = applyExplorationEvent(model, {
      type: 'evaluation_batch_succeeded', operationId: 'evaluate-2',
      response: { results: [{ card_id: 'card-d', card_version: 1, score: 0.99, call_id: 'eval-2', question_key: 'content_0' }], audit: { calls: [] } },
    });
    model = applyExplorationEvent(model, { type: 'completed', operationId: 'evaluate-2' });

    expect(projectExploration(model).resultOrder).toEqual([A, C, X, B, 'card-d']);
    expect(projectExploration(model).results.map((entry: any) => entry.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  test('uses query expansion labels and never treats query similarity as relevance', () => {
    let model = createExplorationModel({ query: 'original query', selectionThreshold: 0.5, initialCards: [card(A, 'node-a')] });
    model = applyExplorationEvent(model, {
      type: 'started', id: 'query-expand-1', kind: 'expand', fromCardId: null, query: 'original query',
      viaOperationId: null, requestedCardIds: [],
    });
    model = applyExplorationEvent(model, {
      type: 'expansion_succeeded', operationId: 'query-expand-1',
      response: { neighbors: [card(A, 'node-a-alias', { similarity: 0.9 }), card(B, 'node-b', { similarity: 0.8 })] },
    });
    const view = projectExploration(model);
    expect(view.cards.find((entry: any) => entry.cardId === B)).toMatchObject({ sourceLabel: '질의 확장 1', score: null, selected: false });
    expect(view.cards.find((entry: any) => entry.cardId === A)?.nodeId).toBe('node-a');
    expect(view.references).toEqual([expect.objectContaining({ fromCardId: null, toCardId: A, similarity: 0.9 })]);
    expect(view.resultOrder).toEqual([]);
  });
});
