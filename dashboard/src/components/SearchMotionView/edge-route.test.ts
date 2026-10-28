import { describe, expect, test } from 'vitest';
import { curvePoint, edgeShape, lanePoint } from './edge-route.js';

const metrics = { laneY: -9, backLaneY: -13 };

describe('edge route geometry', () => {
  test('uses right-to-left forward and left-to-right backward anchors', () => {
    const forward = edgeShape(1, true, { x: 100, y: 20 }, { x: 500, y: 80 }, metrics);
    expect(forward).toEqual({ s: 1, x1: 300, x2: 300, lane: true, ly: -9 });

    const backward = edgeShape(-1, true, { x: 500, y: 80 }, { x: 100, y: 20 }, metrics);
    expect(backward).toEqual({ s: -1, x1: 300, x2: 300, lane: true, ly: -13 });
  });

  test('keeps same-column edges outside the nodes and ignores their lane', () => {
    const shape = edgeShape(0, true, { x: 120, y: 20 }, { x: 120, y: 80 }, metrics);
    expect(shape).toEqual({ s: -1, x1: 156, x2: 156, lane: false, ly: -9 });
  });

  test('curve endpoints match the anchors', () => {
    const a = { x: 100, y: 20 };
    const b = { x: 500, y: 80 };
    const shape = edgeShape(1, false, a, b, metrics);
    expect(curvePoint(shape, a, b, 0)).toEqual(a);
    expect(curvePoint(shape, a, b, 1)).toEqual(b);
  });

  test('turns the upper lane outward on both ends for reverse edges', () => {
    const forwardStart = { x: 100, y: 80 };
    const forwardEnd = { x: 500, y: 120 };
    const forward = edgeShape(1, true, forwardStart, forwardEnd, metrics);
    expect(lanePoint(forward, forwardStart, forwardEnd, 0.06).x).toBeGreaterThan(forwardStart.x);
    expect(lanePoint(forward, forwardStart, forwardEnd, 0.94).x).toBeLessThan(forwardEnd.x);

    const backwardStart = { x: 500, y: 120 };
    const backwardEnd = { x: 100, y: 80 };
    const backward = edgeShape(-1, true, backwardStart, backwardEnd, metrics);
    expect(lanePoint(backward, backwardStart, backwardEnd, 0.06).x).toBeLessThan(backwardStart.x);
    expect(lanePoint(backward, backwardStart, backwardEnd, 0.94).x).toBeGreaterThan(backwardEnd.x);
  });
});
