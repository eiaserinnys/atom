export function edgeShape(dir, lane, a, b, { laneY, backLaneY }) {
  const s = dir > 0 ? 1 : -1;
  let x1; let x2;
  const ly = dir < 0 ? backLaneY : laneY;
  if (dir > 0) {
    const dx = Math.max(34, (b.x - a.x) * 0.5);
    x1 = a.x + dx;
    x2 = b.x - dx;
  } else if (dir < 0) {
    const dx = Math.max(34, (a.x - b.x) * 0.5);
    x1 = a.x - dx;
    x2 = b.x + dx;
  } else {
    x1 = a.x + 36;
    x2 = b.x + 36;
  }
  return { s, x1, x2, lane: lane && dir !== 0, ly };
}

export function curvePoint(shape, a, b, t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * shape.x1 + 3 * u * t * t * shape.x2 + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y,
  };
}

export function lanePoint(shape, a, b, t) {
  const { s, ly } = shape;
  const r = 24;
  const cub = (p0, p1, p2, p3, u) => {
    const w = 1 - u;
    return w * w * w * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u * u * u * p3;
  };
  if (t < 0.12) {
    const u = t / 0.12;
    return { x: cub(a.x, a.x + s * r, a.x + s * r, a.x + 2 * s * r, u), y: cub(a.y, a.y, ly, ly, u) };
  }
  if (t > 0.88) {
    const u = (t - 0.88) / 0.12;
    return { x: cub(b.x - 2 * s * r, b.x - s * r, b.x - s * r, b.x, u), y: cub(ly, ly, b.y, b.y, u) };
  }
  return { x: a.x + 2 * s * r + (b.x - 2 * s * r - (a.x + 2 * s * r)) * ((t - 0.12) / 0.76), y: ly };
}
