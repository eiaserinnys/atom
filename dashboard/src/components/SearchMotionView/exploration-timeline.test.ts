import { describe, expect, test } from 'vitest';
import { buildExplorationTimeline, groupExplorationChapters, projectAt, truncateTimeline } from './exploration-timeline.js';

const initialFrames = [
  { id: 'initial-1', segmentId: 'initial', events: [{ type: 'initial', value: 1 }] },
  { id: 'initial-2', segmentId: 'initial', events: [{ type: 'initial', value: 2 }] },
];

const operationEvents = [
  { type: 'started', id: 'expand-1', kind: 'expand', fromCardId: 'card-a', query: null, viaOperationId: null, requestedCardIds: [] },
  { type: 'index_loading', operationId: 'expand-1' },
  { type: 'expansion_succeeded', operationId: 'expand-1', value: 'expanded' },
  { type: 'completed', operationId: 'expand-1' },
  { type: 'started', id: 'evaluate-1', kind: 'evaluate', fromCardId: 'card-a', query: null, viaOperationId: null, requestedCardIds: ['card-b'] },
  { type: 'evaluations_reused', operationId: 'evaluate-1', cardIds: [] },
  { type: 'completed', operationId: 'evaluate-1' },
  { type: 'started', id: 'query-expand-1', kind: 'expand', fromCardId: null, query: 'seed query', viaOperationId: null, requestedCardIds: [] },
  { type: 'expansion_succeeded', operationId: 'query-expand-1', value: 'query-candidate' },
  { type: 'evaluation_batch_succeeded', operationId: 'query-expand-1', value: 'query-score' },
  { type: 'completed', operationId: 'query-expand-1' },
];

describe('exploration timeline', () => {
  test('keeps initial boundaries, one expansion frame, two evaluation frames, and two query-expansion frames', () => {
    const timeline = buildExplorationTimeline(initialFrames, operationEvents as never);
    expect(timeline.frames.map((frame: any) => frame.id)).toEqual([
      'initial-1', 'initial-2', 'expand-1:expand', 'evaluate-1:start', 'evaluate-1:end',
      'query-expand-1:expand', 'query-expand-1:evaluate',
    ]);
    expect(timeline.frames).toHaveLength(initialFrames.length + 1 + 2 + 2);
    expect(timeline.frames.slice(5).map((frame: any) => frame.operationId)).toEqual(['query-expand-1', 'query-expand-1']);
  });

  test('projects only the cursor prefix and truncates future frames, operation events, and chapters', () => {
    const timeline = buildExplorationTimeline(initialFrames, operationEvents as never);
    const sum = (state: number, event: any) => state + (typeof event.value === 'number' ? event.value : 0);
    expect(projectAt(timeline, 2, 0, sum)).toBe(3);
    expect(projectAt(timeline, timeline.frames.length, 0, sum)).toBe(3);

    const branch = truncateTimeline(timeline, 5);
    expect(branch.frames.map((frame: any) => frame.id)).toEqual(timeline.frames.slice(0, 5).map((frame: any) => frame.id));
    expect(projectAt(branch, branch.frames.length, 0, sum)).toBe(3);
    expect(groupExplorationChapters(branch).map((chapter: any) => chapter.operationIds)).toEqual([[], ['expand-1', 'evaluate-1']]);
  });

  test('groups a same-source expansion and evaluation in one chapter while query expansion gets its own', () => {
    const timeline = buildExplorationTimeline(initialFrames, operationEvents as never);
    const chapters = groupExplorationChapters(timeline);
    expect(chapters).toEqual([
      expect.objectContaining({ id: 'initial', label: '0 검색', operationIds: [], frameIds: ['initial-1', 'initial-2'] }),
      expect.objectContaining({ id: 'expand-1', label: '확장 1', operationIds: ['expand-1', 'evaluate-1'], frameIds: ['expand-1:expand', 'evaluate-1:start', 'evaluate-1:end'] }),
      expect.objectContaining({ id: 'query-expand-1', label: '질의 확장 1', operationIds: ['query-expand-1'], frameIds: ['query-expand-1:expand', 'query-expand-1:evaluate'] }),
    ]);
  });
});
