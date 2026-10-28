export interface EdgePoint { x: number; y: number }
export interface EdgeShape { s: number; x1: number; x2: number; lane: boolean; ly: number }
export function edgeShape(dir: number, lane: boolean, a: EdgePoint, b: EdgePoint, metrics: { laneY: number; backLaneY: number }): EdgeShape;
export function curvePoint(shape: EdgeShape, a: EdgePoint, b: EdgePoint, t: number): EdgePoint;
export function lanePoint(shape: EdgeShape, a: EdgePoint, b: EdgePoint, t: number): EdgePoint;
