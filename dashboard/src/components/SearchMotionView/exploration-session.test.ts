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

test('a continuation card displays the evidence from its own search segment', () => {
  const session = createExplorationSession(); session.begin('query');
  samples.atom.forEach(event => session.receive(event));
  const events: any[] = structuredClone(samples.atom);
  const candidate = events.find(event => event.event === 'step_completed' && event.data.candidates.length)?.data.candidates[0];
  candidate.card_id = 'continuation-only'; candidate.node_id = 'continuation-node';
  for (const event of events) {
    if (event.data.call?.stage === 'content_noul') {
      for (const question of Object.values(event.data.call.request.questions) as any[]) question.instructions = 'Evidence from continued search';
    }
  }
  session.begin('query', { resume: true }); events.forEach(event => session.receive(event));
  const { scene } = session.project(session.timeline().frames.length);
  const node = [...scene.nodes.values()].find((node: any) => node.cardId === 'continuation-only');
  const question = scene.calls.get(node.asked.step)?.request.questions[node.asked.key];
  expect(question?.instructions).toBe('Evidence from continued search');
});

test('content relevance never changes an existing structure traversal verdict', () => {
  const session = createExplorationSession(); session.begin('query');
  samples.atom.forEach(event => session.receive(event));
  const { scene: initial } = session.project(session.timeline().frames.length);
  const target: any = [...initial.nodes.values()].find((node: any) => node.cardId && node.type === 'structure' && node.verdict === 'open');
  const source: any = [...initial.nodes.values()].find((node: any) => node.cardId && node.type === 'knowledge');
  session.apply({ type: 'started', id: 'expand', kind: 'expand', fromCardId: source.cardId });
  session.apply({ type: 'expansion_succeeded', operationId: 'expand', response: { neighbors: [{ card_id: target.cardId, node_id: target.nodeId, card_type: 'structure', title: target.title, path: [], similarity: .8, tree_relation: null }] } });
  session.apply({ type: 'completed', operationId: 'expand' });
  session.apply({ type: 'started', id: 'evaluate', kind: 'evaluate', fromCardId: source.cardId, requestedCardIds: [target.cardId] });
  session.apply({ type: 'evaluation_batch_succeeded', operationId: 'evaluate', response: { results: [{ card_id: target.cardId, score: .1 }], audit: { calls: [] } } });
  session.apply({ type: 'completed', operationId: 'evaluate' });
  const node = session.project(session.timeline().frames.length).scene.nodes.get(target.ref);
  expect(node.score).toBe(target.score);
  expect(node.asked).toEqual(target.asked);
  expect(node.verdict).toBe('open');
});
