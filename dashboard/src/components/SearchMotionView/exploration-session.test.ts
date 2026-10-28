import { expect, test } from 'vitest';
import { createExplorationSession } from './exploration-session.js';
import samples from './fixtures/samples.json';

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

test('continues search on hop columns with mapped links, gauges, and a continuation root', () => {
  const session = createExplorationSession();
  session.begin('query');
  samples.atom.forEach(event => session.receive(event));
  const initial = session.project(session.timeline().frames.length);
  expect(initial.scene.nodes.has('__root__')).toBe(false);

  const existingTarget = [...initial.scene.nodes.values()].find(node => node.origin === 'hit_parent' && node.cardId)!;
  const originalTarget = { ref: existingTarget.ref, hop: existingTarget.hop };
  const events: any[] = structuredClone(samples.atom);
  const sourceRef = 'step-000001:0003';
  let freshTargetRef = '';
  let continuationSource: any;
  for (const event of events) {
    for (const candidate of event.data.candidates ?? []) {
      candidate.card_id = `continued-${candidate.card_id}`;
      candidate.node_id = `continued-${candidate.node_id}`;
    }
    if (event.event !== 'step_completed') continue;
    if (event.data.step.stage === 'lexical_seed') {
      continuationSource = event.data.candidates.find((candidate: any) => candidate.ref === sourceRef);
      continuationSource.hop = 4;
    }
    if (event.data.step.stage === 'sufficiency_noul') {
      event.data.step.sufficiency_score = 0.2 + event.data.step.hop / 10;
    }
    if (event.data.step.stage === 'hit_parent') {
      const freshTarget = event.data.candidates.find((candidate: any) => candidate.origin === 'hit_parent');
      freshTargetRef = freshTarget.ref;
      continuationSource.physical_parent_node_id = freshTarget.node_id;
      const repeatedTarget = structuredClone(freshTarget);
      repeatedTarget.ref = 'continued-existing-hit-parent';
      repeatedTarget.card_id = existingTarget.cardId;
      repeatedTarget.node_id = existingTarget.nodeId;
      repeatedTarget.hit_ref = sourceRef;
      event.data.candidates.push(repeatedTarget);
      event.data.step.candidate_refs = [sourceRef, freshTarget.ref, repeatedTarget.ref];
    }
  }
  events.splice(1, 0, {
    event: 'step_completed',
    data: { step: { id: 'continued-widen', seq: 0, hop: 4, stage: 'widen', started_at: '2026-10-25T11:00:00.001Z', completed_at: '2026-10-25T11:00:00.002Z', decisions: [], candidate_refs: [], widen_reason: 'test' }, candidates: [], call: null },
  });

  session.begin('query', { resume: true });
  events.forEach(event => session.receive(event));
  const continued = session.project(session.timeline().frames.length);
  const continuedHit = continued.scene.nodes.get(`search-2:${freshTargetRef}`)!;
  expect(continuedHit.hop).toBe(1);
  expect(continuedHit.parent).not.toBeNull();
  expect(continued.scene.nodes.has(continuedHit.parent)).toBe(true);
  expect(continuedHit.climbFrom.length).toBeGreaterThan(0);
  expect(continuedHit.climbFrom.every((ref: string) => continued.scene.nodes.has(ref))).toBe(true);
  expect(continued.scene.nodes.has('__root__')).toBe(true);

  const target = continued.scene.nodes.get(originalTarget.ref)!;
  expect(target.hop).toBe(originalTarget.hop);
  expect(target.climbFrom).toContain(`search-2:${sourceRef}`);
  expect(continued.scene.nodes.has(`search-2:${sourceRef}`)).toBe(true);
  expect([...continued.scene.columnLabels.values()]).not.toContain('추가 검색');

  const gauge = continued.scene.suff.get(1);
  expect(gauge.score).toBeCloseTo(0.3);
  expect(gauge.step).toBe('search-2:step-000008');
  expect(gauge.refs.length).toBeGreaterThan(0);
  expect(gauge.refs.every((ref: string) => continued.scene.nodes.has(ref))).toBe(true);
});

test('places expansion after the highest search hop, including continuation hops', () => {
  const session = createExplorationSession();
  session.begin('query');
  samples.atom.forEach(event => session.receive(event));
  const first = session.project(session.timeline().frames.length);
  const events: any[] = structuredClone(samples.atom);
  for (const event of events) {
    for (const candidate of event.data.candidates ?? []) {
      candidate.card_id = `continued-${candidate.card_id}`;
      candidate.node_id = `continued-${candidate.node_id}`;
    }
    if (event.event === 'step_completed' && event.data.step.stage === 'lexical_seed') {
      event.data.candidates.find((candidate: any) => candidate.ref === 'step-000001:0003').hop = 4;
    }
  }
  events.splice(1, 0, {
    event: 'step_completed',
    data: { step: { id: 'continued-widen', seq: 0, hop: 4, stage: 'widen', started_at: '2026-10-25T11:00:00.001Z', completed_at: '2026-10-25T11:00:00.002Z', decisions: [], candidate_refs: [], widen_reason: 'test' }, candidates: [], call: null },
  });
  session.begin('query', { resume: true });
  events.forEach(event => session.receive(event));
  const source = [...first.scene.nodes.values()].find(node => node.cardId)!;
  session.apply({ type: 'started', id: 'expand-after-continuation', kind: 'expand', fromCardId: source.cardId });
  session.apply({ type: 'expansion_succeeded', operationId: 'expand-after-continuation', response: { neighbors: [
    { card_id: 'expanded-after-search', node_id: 'expanded-node', card_type: 'knowledge', title: 'expanded', path: [], similarity: 0.8, tree_relation: null },
  ] } });
  session.apply({ type: 'completed', operationId: 'expand-after-continuation' });

  const result = session.project(session.timeline().frames.length);
  const expanded = [...result.scene.nodes.values()].find(node => node.cardId === 'expanded-after-search')!;
  expect(expanded.hop).toBe(5);
  expect([...result.scene.columnLabels.values()]).not.toContain('추가 검색');
});
