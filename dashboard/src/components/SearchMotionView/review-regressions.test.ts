import { expect, test } from 'vitest';
import { createExplorationSession } from './exploration-session.js';

const candidate = (id: string) => ({ ref: id, card_id: id, node_id: id, card_type: 'knowledge', title: id, path: ['Folder', id], hop: 0, origin: 'lexical_seed' });
function search(session: ReturnType<typeof createExplorationSession>, scores: Record<string, number>, selected: string[]) {
  session.receive({ event: 'run', data: { query: 'q', policy: {} } });
  session.receive({ event: 'step_completed', data: { step: { id: 'score', stage: 'content_noul', hop: 0, candidate_refs: Object.keys(scores), decisions: Object.entries(scores).map(([ref, score]) => ({ ref, score, action: 'content_scored', question_key: ref })) }, candidates: Object.keys(scores).map(candidate), call: { stage: 'content_noul', call_id: 'initial' } } });
  session.receive({ event: 'step_completed', data: { step: { id: 'select', stage: 'selection', hop: 0, candidate_refs: [], decisions: [], selected_refs: selected, selection_threshold: .5 }, candidates: [] } });
  session.receive({ event: 'done', data: { status: 'complete', results: [] } });
}
function expand(session: ReturnType<typeof createExplorationSession>, id: string, source: string, targets: string[]) {
  session.apply({ type: 'started', id, kind: 'expand', fromCardId: source });
  session.apply({ type: 'expansion_succeeded', operationId: id, response: { neighbors: targets.map(card_id => ({ ...candidate(card_id), card_id, node_id: card_id, similarity: .8 })) } });
  session.apply({ type: 'completed', operationId: id });
}
test('A2: continuation never admits an existing rejected card with its preserved 0.42 score', () => {
  const session = createExplorationSession(); session.begin('q'); search(session, { a: .8, b: .42 }, ['a']);
  session.begin('q', { resume: true }); search(session, { a: .9, b: .92, c: .75 }, ['a', 'b', 'c']);
  const { projection } = session.project(session.timeline().frames.length);
  expect(projection.resultOrder).toEqual(['a', 'c']);
  expect(projection.cards.find(c => c.cardId === 'b')?.score).toBe(.42);
});
test('B2: same-depth expansion groups share one column; expanding a new child advances one depth', () => {
  const session = createExplorationSession(); session.begin('q'); search(session, { a: .8, b: .6 }, ['a', 'b']);
  expand(session, 'e1', 'a', ['c']); expand(session, 'e2', 'b', ['d']); expand(session, 'e3', 'c', ['e']);
  const { scene } = session.project(session.timeline().frames.length);
  const nodes = [...scene.nodes.values()];
  const hop = (id: string) => nodes.find(n => n.cardId === id)!.hop;
  expect(hop('c')).toBe(hop('d'));
  expect(hop('e')).toBe(hop('c') + 1);
});
test('B11/B13: another branch cannot replace first score/evidence and cached cards never show judging', () => {
  const session = createExplorationSession(); session.begin('q'); search(session, { a: .9, b: .6 }, ['a', 'b']);
  expand(session, 'e1', 'b', ['a', 'new']);
  session.apply({ type: 'started', id: 'eval', kind: 'evaluate', fromCardId: 'b', requestedCardIds: ['a', 'new'] });
  let projected = session.project(session.timeline().frames.length);
  expect(projected.scene.nodes.get('a').judging).toBeNull();
  expect([...projected.scene.nodes.values()].find(n => n.cardId === 'new')?.judging).toBe('eval');
  session.apply({ type: 'evaluation_batch_succeeded', operationId: 'eval', response: { results: [{ card_id: 'a', score: .27, call_id: 'later' }], audit: { calls: [] } } });
  session.apply({ type: 'completed', operationId: 'eval' });
  projected = session.project(session.timeline().frames.length);
  expect(projected.scene.nodes.get('a').score).toBe(.9);
  expect(projected.scene.nodes.get('a').asked).toEqual({ step: 'score', key: 'a' });
});
