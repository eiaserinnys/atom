import { expect, test, vi } from 'vitest';
import { runVisualOperation } from './operation-runner';
import { createExplorationSession } from './exploration-session.js';
import type { MotionPlayer } from './player.js';
import type { OperationSnapshot } from './operation-types';
import type { visualSearchApi } from '../../api/visualSearchApi';
import samples from './fixtures/samples.json';

function setup() {
  const history = createExplorationSession(); history.begin('original');
  samples.atom.forEach(event => history.receive(event));
  let revision = 0;
  const eventTypes: string[] = [];
  const player = {
    getRecord: () => ({ log: history.exportLog(), cursor: history.timeline().frames.length, complete: true, camera: { x: 0, y: 0, z: 1 } }),
    getSnapshot(): OperationSnapshot {
      const { projection } = history.project(history.timeline().frames.length);
      return {
        revision, query: 'original', context: { agent: null, project: null, task: null }, live: true,
        initialSearchComplete: true, selectedCardId: projection.cards[0].cardId, selectionThreshold: projection.selectionThreshold,
        graphCardIds: projection.cards.map(c => c.cardId),
        cachedEvaluations: new Map<string, { score: number }>(
          Array.from(projection.evaluations, ([id, evaluation]) => [id, { score: evaluation.score }]),
        ),
        operations: projection.operations as OperationSnapshot['operations'], resultOrder: projection.resultOrder,
        evaluationTargetCardIds: [], activeOperation: null, selectedArrivalOperationId: null, continueSearch: false,
      };
    },
    applyOperation(event: any, expected?: number) {
      if (expected != null && expected !== revision) return false;
      if (event.type === 'started') revision++;
      eventTypes.push(event.type);
      history.apply(event); return true;
    },
  } as MotionPlayer;
  const response = { status: 200, body: { neighbors: [{ card_id: 'new-card', node_id: 'new-node', card_type: 'knowledge', title: 'new', path: [], similarity: .8, tree_relation: null }] } };
  const api = {
    expand: vi.fn().mockResolvedValue(response), neighbors: vi.fn().mockResolvedValue(response),
    evaluate: vi.fn().mockResolvedValue({ status: 200, body: { results: [{ card_id: 'new-card', score: .99 }], audit: { calls: [] } } }),
  } as unknown as typeof visualSearchApi;
  return { player, api, history, eventTypes, branch: () => { revision++; } };
}

test('query expansion excludes the whole graph, evaluates automatically and keeps two frames', async () => {
  const { player, api, history } = setup();
  const before = player.getSnapshot();
  const initialFrames = history.timeline().frames.length;
  await runVisualOperation(player, 'query', before, new AbortController().signal, api);
  expect(api.expand).toHaveBeenCalledWith({ query: 'original', exclude_card_ids: before.graphCardIds, limit: 12 }, expect.any(AbortSignal));
  expect(api.evaluate).toHaveBeenCalledWith({ query: 'original', context: before.context, card_ids: ['new-card'] }, expect.any(AbortSignal));
  expect(history.timeline().frames).toHaveLength(initialFrames + 2);
  expect(player.getSnapshot().resultOrder).toEqual([...before.resultOrder, 'new-card']);
  await runVisualOperation(player, 'query', player.getSnapshot(), new AbortController().signal, api);
  expect(vi.mocked(api.expand).mock.calls[1][0].exclude_card_ids).toContain('new-card');
  expect(history.project(initialFrames + 2, true).projection.operations.at(-1)?.status).toBe('running');
});

test('failed automatic evaluation preserves candidates and retry only evaluates', async () => {
  const { player, api, eventTypes } = setup();
  const audit = { call_id: 'failed-call', run_id: 'evaluation', seq: 1, stage: 'content_noul', candidate_count: 1,
    disposition: 'error' as const, started_at: '', completed_at: null, latency_ms: null, usage: null,
    request: {}, response: null, error: { code: 'JEV_UPSTREAM_UNAVAILABLE', message: 'Unavailable' } };
  vi.mocked(api.evaluate).mockResolvedValueOnce({ status: 429, body: { error: { code: 'JEV_EVALUATION_BUSY' }, audit: { calls: [audit] } } });
  const failure = await runVisualOperation(player, 'query', player.getSnapshot(), new AbortController().signal, api);
  expect(failure?.code).toBe('JEV_EVALUATION_BUSY');
  expect(player.getSnapshot().graphCardIds).toContain('new-card');
  expect(player.getSnapshot().operations.at(-1)?.auditCalls).toEqual([audit]);
  const retry = player.getSnapshot().operations.find(op => op.id === failure?.retry)!;
  await runVisualOperation(player, 'query', player.getSnapshot(), new AbortController().signal, api, retry);
  expect(api.expand).toHaveBeenCalledTimes(1);
  expect(player.getSnapshot().resultOrder).toContain('new-card');
  expect(eventTypes.every(type => ['started', 'index_loading', 'expansion_succeeded', 'evaluations_reused', 'evaluation_batch_succeeded', 'completed', 'failed'].includes(type))).toBe(true);
});

test('a response from a discarded branch cannot add cards to the current projection', async () => {
  const { player, api, branch } = setup();
  let resolve!: (value: any) => void;
  vi.mocked(api.expand).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const run = runVisualOperation(player, 'query', player.getSnapshot(), new AbortController().signal, api);
  branch();
  resolve({ status: 200, body: { neighbors: [{ card_id: 'stale', node_id: 'stale', title: 'stale' }] } });
  await run;
  expect(player.getSnapshot().graphCardIds).not.toContain('stale');
  expect(api.evaluate).not.toHaveBeenCalled();
});

test('B10: failed manual evaluation retries its requested cards without expanding again', async () => {
  const { player, api } = setup();
  const snapshot = { ...player.getSnapshot(), evaluationTargetCardIds: ['new-card'] };
  vi.mocked(api.evaluate).mockResolvedValueOnce({ status: 503, body: { error: { code: 'JEV_UNAVAILABLE' } } });
  const failure = await runVisualOperation(player, 'evaluate', snapshot, new AbortController().signal, api);
  const retry = player.getSnapshot().operations.find(op => op.id === failure?.retry)!;
  await runVisualOperation(player, 'evaluate', player.getSnapshot(), new AbortController().signal, api, retry);
  expect(api.evaluate).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.evaluate).mock.calls[1][0].card_ids).toEqual(['new-card']);
  expect(api.neighbors).not.toHaveBeenCalled();
});
