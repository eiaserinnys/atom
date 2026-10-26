import { describe, test, expect } from 'vitest';
import { createModel, applyEvent } from './model.js';
import samples from './samples.json';

const originalSampleTitles: Record<string, string> = {
  '검색창과 홉별 검색 모션 연동': 'SearchBar와 Jev 홉별 검색 모션 통합',
};

describe('approved r5 run reducer', () => {
  for (const [name, events] of Object.entries(samples)) test(`${name}: ordered events select the exact final result IDs/ranks and retain audit requests`, () => {
    const model = createModel();
    for (const event of events) applyEvent(model, event);
    const done = events.at(-1)!.data as { results: { node_id: string }[]; stop_reason: string };
    const selected = [...model.nodes.values()].filter(n => n.selected).sort((a,b) => a.rank-b.rank);
    expect(selected.map(n => n.nodeId)).toEqual(done.results.map(r => r.node_id));
    expect(selected.map(n => n.rank)).toEqual(selected.map((_,i) => i+1));
    expect(model.terminal.stop).toBe(done.stop_reason);
    expect(selected.length).toBeGreaterThan(0);
    const audited = selected.find(n => n.asked !== null)!;
    const instructions = model.calls.get(audited.asked!.step)!.request.questions[audited.asked!.key].instructions;
    expect(instructions).toContain(originalSampleTitles[audited.title] ?? audited.title);
  });
});
