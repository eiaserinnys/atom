import { expect, test } from 'vitest';
import { createExplorationSession } from './exploration-session.js';
import samples from './samples.json';

test('projects initial search and operations from the same prefix, truncates future cards and replays without requests', () => {
  const session = createExplorationSession();
  session.begin('query');
  for (const event of samples.atom) session.receive(event);
  const initialLength = session.timeline().frames.length;
  const initial = session.project(initialLength);
  const source = [...initial.scene.nodes.values()].find(n => n.cardId)!;
  session.apply({ type: 'started', id: 'expand', kind: 'expand', fromCardId: source.cardId });
  session.apply({ type: 'expansion_succeeded', operationId: 'expand', response: { neighbors: [
    { card_id: 'new', node_id: 'new-node', card_type: 'knowledge', title: 'new', path: [], similarity: 0.8, tree_relation: null },
    { card_id: source.cardId, node_id: source.nodeId, card_type: source.type, title: source.title, path: [], similarity: 0.7, tree_relation: null },
  ] } });
  session.apply({ type: 'completed', operationId: 'expand' });
  session.apply({ type: 'started', id: 'evaluate', kind: 'evaluate', fromCardId: source.cardId, requestedCardIds: ['new'] });
  session.apply({ type: 'evaluation_batch_succeeded', operationId: 'evaluate', response: { results: [{ card_id: 'new', score: 0.99 }], audit: { calls: [] } } });
  session.apply({ type: 'completed', operationId: 'evaluate' });
  const total = session.timeline().frames.length;
  expect(total).toBe(initialLength + 3);
  const final = session.project(total);
  expect(final.projection.resultOrder).toEqual([...initial.projection.resultOrder, 'new']);
  expect(final.projection.references).toHaveLength(1);
  expect(session.project(initialLength).projection.cards.some(n => n.cardId === 'new')).toBe(false);
  expect(session.project(total).projection.resultOrder).toEqual(final.projection.resultOrder);
  session.truncate(initialLength);
  expect(session.timeline().frames).toHaveLength(initialLength);
  expect(session.project(initialLength).projection.evaluations.has('new')).toBe(false);
});

test('preserves first positions and ranks when an exhaustive search segment repeats cards', () => {
  const session = createExplorationSession();
  session.begin('query');
  samples.atom.forEach(event => session.receive(event));
  const before = session.project(session.timeline().frames.length);
  session.begin('query', { resume: true });
  samples.atom.forEach(event => session.receive(event));
  const after = session.project(session.timeline().frames.length);
  expect(after.projection.resultOrder).toEqual(before.projection.resultOrder);
  expect(after.projection.cards.map(n => [n.cardId, n.renderNode?.ref, n.columnLabel])).toEqual(before.projection.cards.map(n => [n.cardId, n.renderNode?.ref, n.columnLabel]));
  expect(session.timeline().frames.length).toBe(26);
});
