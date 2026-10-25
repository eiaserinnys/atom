// Approved r5 renderer port. The animation closure retains shared camera/scene state
// to preserve the reviewed drawing and playback behavior; the pure reducer is model.js.
import { createModel, applyEvent } from "./model.js";

export function createMotionPlayer(root, callbacks, samples) {
  let disposed = false;
  const cleanup = [];
  const timers = new Set();
  const animationFrames = new Set();
  const setTimeout = (fn, ms) => { const id = window.setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; };
  const clearTimeout = (id) => { window.clearTimeout(id); timers.delete(id); };
  const requestAnimationFrame = (fn) => { const id = window.requestAnimationFrame(t => { animationFrames.delete(id); if (!disposed) fn(t); }); animationFrames.add(id); return id; };
  const listen = (el, type, fn, options) => { el.addEventListener(type, fn, options); cleanup.push(() => el.removeEventListener(type, fn, options)); };
  const dashboard = {
    syncSearchOutcome(m, sent, verdict) { callbacks.onResults([...m.nodes.values()].map(n => ({ ...n, reason: verdict(n).word, sentText: sent(n, true)?.text || '', sample: !live }))); },
    selectFromSearch(n, reason, sent) { callbacks.onSelect({ ...n, reason, sentText: sent?.text || '', sample: !live }); }
  };
  let live = false;
  let lastQuery = '';

  "use strict";
  // =====================================================================
  // 시안의 재생기. 입력은 설계 v2의 스트림 사건(run, step_started, step_completed, done)뿐이다.
  // 실제 페이지에서는 표본 대신 fetch 본문 스트림에서 읽은 사건을 player.receive(event)로 넣으면 된다.
  // =====================================================================
  const $ = (id) => root.querySelector(`[data-motion-id="${id}"]`);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const params = new URLSearchParams(location.search);

  const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => mqReduce.matches || params.get("motion") === "reduce";
  const ROOT = "__root__";
  let dpr = 1; let W = 0; let H = 0;
  const JEV = new Set(["structure_noul", "content_noul", "sufficiency_noul"]);

  // ------------------------------------------------------------------ 1. 사건을 모델로
  const eventTime = (ev) => Date.parse(ev.event === "run" ? ev.data.started_at : ev.event === "step_started" ? ev.data.started_at : ev.event === "done" ? ev.data.completed_at : (ev.data.step.completed_at ?? ev.data.step.started_at));
  const isAlive = (n) => n.type === "root" || n.verdict === "open" || n.verdict === "hit" || n.selected;
  const isDim = (n) => !n.selected && (n.verdict === "closed" || n.verdict === "low" || n.verdict === "nobody");
  function stopLabel(t) {
    if (!t) return "";
    if (t.stop === "sufficient") return "충분함";
    if (t.stop === "exhausted") return "탐색 완료";
    return { CALL_BUDGET: "호출 상한", RUN_TIME_LIMIT: "시간 상한", CANDIDATE_LIMIT: "후보 상한", CANCELLED: "취소" }[t.code] || (t.status === "error" ? "오류" : "끝");
  }
  const hopName = (h) => (h === 0 ? "입구" : "홉 " + h);
  function narrate(m) {
    const l = m.last; if (!l) return "";
    if (l.stage === "run_terminal") return stopLabel(m.terminal);
    if (l.stage === "selection") return "선정";
    const name = { lexical_seed: "낱말 씨앗", structure_noul: "문", content_noul: "채점", sufficiency_noul: "찾았나", hit_parent: "윗구조", atom_outline: "펼침", widen: "그물 넓히기", deferred_scan: "큰 모음 훑기" }[l.stage] || l.stage;
    return hopName(l.hop) + " " + name;
  }

  // ------------------------------------------------------------------ 2. 자리 잡기
  const M = { colW: 196, gap: 64, rowH: 64, pitch: 78, lowPitch: 78, chipH: 20, bandGap: 8, groupGap: 4, padX: 24, padTop: 50, headerH: 38, pileH: 24, pendCap: 14, cell: 5, laneY: -9 };
  const ui = { showLow: false, expanded: new Set(), follow: true };
  const colX = (hop) => hop * (M.colW + M.gap);
  // 열은 홉. 한 열 안에서 위 띠는 살아 있는 것(열린 구조, 맞은 카드, 선정)과 아직 판정 전인 것,
  // 아래 띠는 닫히거나 낮은 것. 넘치는 것은 부모별 더미(+N)로 접는다.
  function layout(m) {
    const pos = new Map(); const piles = new Map(); const hidden = new Map(); const cols = []; const dorm = new Map();
    const byHop = new Map();
    const push = (n) => { if (n.dormant) { dorm.set(n.parent, (dorm.get(n.parent) || 0) + 1); return; } if (!byHop.has(n.hop)) byHop.set(n.hop, []); byHop.get(n.hop).push(n); };
    const root = m.nodes.get(ROOT); if (root) push(root);
    for (const ref of m.order) push(m.nodes.get(ref));
    let height = 0;
    const lastHop = m.run ? Math.max(m.maxHop, 0) : -1;
    const gridCols = Math.floor((M.colW - 16) / M.cell);
    // 입구 하나뿐인 동안에는 씨앗을 여러 줄로 넓게 편다(가장 자주 보는 화면). 다음 홉이 나오면 한 열로 접힌다
    const stride = M.colW + 16;
    const K = lastHop <= 0 && !root && W > 0 ? clamp(Math.floor((W - 2 * M.padX + 16) / stride), 1, 3) : 1;
    const byScore = (a, b) => (b.score ?? 2) - (a.score ?? 2) || a.order - b.order;
    // 더미: 접어 둔 후보가 많으면 점 격자로 그린다. 점 하나가 카드 하나이고 자리는 발견 순서라 바뀌지 않는다
    const placePile = (g, x, yy, hop, rest, foldable) => {
      const segs = [...g.steps.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, done]) => ({ id, done }));
      const grid = rest.length > 24;
      const h = grid ? 26 + Math.ceil(g.all.length / gridCols) * M.cell + 5 : M.pileH;
      const parents = g.merged ? [...new Set(rest.map((n) => n.parent).filter(Boolean))] : g.parent ? [g.parent] : [];
      piles.set(g.key, { key: g.key, x, y: yy, h, grid, cells: grid ? g.all : null, cols: gridCols, count: rest.length, expanded: foldable && rest.length === 0, parents, hop, segs, busy: segs.some((sg) => !sg.done) });
      for (const n of rest) hidden.set(n.ref, g.key);
      return h;
    };
    for (let hop = 0; hop <= lastHop; hop += 1) {
      const x = colX(hop);
      const nodes = byHop.get(hop) || [];
      const groups = new Map();
      for (const n of nodes) {
        const key = hop + "|" + (n.type === "root" ? "@root" : n.parent ?? "@seed");
        if (!groups.has(key)) {
          const anchor = n.parent && (pos.get(n.parent) || piles.get(hidden.get(n.parent)));
          groups.set(key, { key, parent: n.type === "root" ? null : n.parent, anchorY: n.type === "root" ? -2 : anchor ? anchor.y : -1, alive: [], pend: [], low: [], nobody: [], steps: new Map(), all: [] });
        }
        const g = groups.get(key); g.all.push(n.ref);
        if (isAlive(n)) g.alive.push(n); else if (n.verdict === "pending") g.pend.push(n); else if (n.verdict === "nobody") g.nobody.push(n); else g.low.push(n);
        if (n.judging) g.steps.set(n.judging, false);
        if (n.asked) g.steps.set(n.asked.step, true);
      }
      let list = [...groups.values()].sort((a, b) => a.anchorY - b.anchorY);
      let y = 0;
      if (hop === 0 && K > 1) {
        const g = list[0] || { key: "0|@seed", parent: null, alive: [], pend: [], low: [], nobody: [], steps: new Map(), all: [] };
        g.alive.sort(byScore); g.low.sort(byScore);
        const rows = (arr, pitch) => { for (let i = 0; i < arr.length; i += K) { const row = arr.slice(i, i + K); row.forEach((n, k) => pos.set(n.ref, { x: x + k * stride, y })); y += pitch + (row.some((n) => n.selected) ? M.chipH + 2 : 0); } };
        rows(g.alive, M.pitch); rows(g.pend, M.pitch);
        const lows = g.low.concat(g.nobody);
        if (lows.length) { if (y > 0) y += M.bandGap; if (ui.showLow) rows(lows, M.lowPitch); else y += placePile(g, x, y, 0, lows, false) + 6; }
        cols.push({ hop, x, height: y, w: K * stride - 16 }); height = Math.max(height, y);
        continue;
      }
      for (const g of list) {
        g.alive.sort(byScore);
        // 구조가 미뤄 둔 묶음이 있으면 그 아래에 칩 한 줄을 둔다
        for (const n of g.alive) { pos.set(n.ref, { x, y }); y += M.pitch + (n.selected || dorm.has(n.ref) ? M.chipH + 2 : 0); }
      }
      // 부모가 많은 열(루트 아래 등)은 판정 전인 줄과 접는 묶음을 열 하나로 합친다
      if (list.length > 4) {
        const all = { key: hop + "|@all", merged: true, parent: null, alive: [], pend: [], low: [], nobody: [], steps: new Map(), all: nodes.filter((n) => n.type !== "root").map((n) => n.ref) };
        for (const g of list) { all.pend.push(...g.pend); all.low.push(...g.low); all.nobody.push(...g.nobody); for (const [id, done] of g.steps) all.steps.set(id, done); }
        all.pend.sort((a, b) => a.order - b.order);
        list = [all];
      }
      const big = list.filter((g) => g.all.length > 1).length;
      const lowCap = list.filter((g) => g.low.length + g.nobody.length > 0).length <= 1 ? 8 : 4;
      const pendCap = big <= 1 ? M.pendCap : Math.max(2, Math.floor(12 / big));
      for (const g of list) {
        const open = ui.expanded.has(g.key);
        const head = new Set(g.all.slice(0, g.all.length > 96 ? 6 : g.merged ? 12 : pendCap));
        g.low.sort(byScore);
        g.lowAll = g.low.concat(g.nobody);
        g.lowVis = open ? g.lowAll : ui.showLow ? g.lowAll.slice(0, lowCap) : [];
        // 판정 전인 줄은 먼저 발견된 몇 장만 보이고 자리를 지킨다. 더미에서 기다리는 카드를 판정 전에 꺼내 보이지 않는다
        g.pendVis = open ? g.pend : g.pend.filter((n) => head.has(n.ref));
        if (g.pend.length - g.pendVis.length === 1 && g.lowAll.length === g.lowVis.length) g.pendVis = g.pend;
        for (const n of g.pendVis) { pos.set(n.ref, { x, y }); y += M.pitch; }
        // 아직 묻지 않은 카드가 더미에 남아 있으면 더미를 판정 중인 줄 바로 아래에 둔다
        if (g.pend.length > g.pendVis.length) { g.piled = true; const shown = new Set(g.pendVis); y += placePile(g, x, y, hop, g.pend.filter((n) => !shown.has(n)).concat(g.lowAll.slice(g.lowVis.length)), false) + 10; }
      }
      let lower = false;
      for (const g of list) {
        const open = ui.expanded.has(g.key);
        let vis = g.lowVis;
        let rest = g.piled ? [] : g.lowAll.slice(vis.length);
        if (!open && ui.showLow && rest.length === 1) { vis = g.lowAll; rest = []; }
        if (vis.length + rest.length === 0 && !open) continue;
        if (!lower && y > 0) y += M.bandGap; lower = true;
        for (const n of vis) { pos.set(n.ref, { x, y }); y += M.lowPitch; }
        const foldable = open && !g.piled && g.lowAll.length + g.pend.length > lowCap;
        if (rest.length > 0 || foldable) y += placePile(g, x, y, hop, rest, foldable) + 6;
        y += M.groupGap;
      }
      cols.push({ hop, x, height: y, w: M.colW });
      height = Math.max(height, y);
    }
    const wide = K > 1 && lastHop <= 0;
    const last = cols[cols.length - 1];
    return { cols, pos, piles, hidden, dorm, wide, width: wide ? K * stride - 16 : last ? last.x + last.w : 0, height };
  }

  // ------------------------------------------------------------------ 3. 보이는 상태 (스프링, 효과)
  let model = createModel();
  const view = { nodes: new Map(), edges: new Map(), piles: new Map(), gauges: new Map(), fx: [], L: layout(model), stop: 0, ask: 0, askInfo: null, march: 0, hover: null, focus: null, hoverKeys: new Set() };
  const cam = { x: -M.padX, y: -M.padTop, z: 1, tx: -M.padX, ty: -M.padTop, tz: 1, vx: 0, vy: 0, vz: 0, mode: "idle" };

  function spawnOrigin(n, tg) {
    if (n.type === "root") return { x: tg.x, y: tg.y - 16 };
    if (n.origin === "lexical_seed") return { x: tg.x - 46, y: tg.y - 6 };
    const p = n.parent && view.nodes.get(n.parent);
    if (p) return { x: tg.x - 28, y: lerp(p.y, tg.y, 0.85) };
    return { x: tg.x - 28, y: tg.y };
  }
  function spawnDelay(n, i) {
    if (n.type === "root") return 220;
    if (n.origin === "lexical_seed") return 40 + Math.min(340, i * 22);
    if (n.origin === "hit_parent") return 260;
    return 170 + Math.min(260, i * 14);
  }
  function targetOf(n, L) {
    const key = L.hidden.get(n.ref);
    const p = key ? L.piles.get(key) : L.pos.get(n.ref);
    return { x: p.x, y: p.y, a: key ? 0 : 1, alive: isAlive(n) ? 1 : 0, dim: isDim(n) ? 1 : 0, sel: n.selected ? 1 : 0, judge: n.judging ? 1 : 0, score: n.score != null ? 1 : 0, port: n.type !== "structure" ? 0 : n.verdict === "open" ? 1 : n.verdict === "pending" ? 0.45 : 0, read: n.reading > 0 || n.climbing ? 1 : 0, soft: n.byRoot ? 1 : 0 };
  }
  function snapNode(v) { const t = v.t; v.next = null; v.x = t.x; v.y = t.y; v.vx = v.vy = 0; v.a = t.a; v.alive = t.alive; v.dim = t.dim; v.sel = t.sel; v.judge = t.judge; v.scoreA = t.score; v.port = t.port; v.read = t.read; v.wipe = 1; v.born = 0; v.selAt = 0; }

  // 모델이 바뀔 때마다 부른다. animate가 거짓이면 그 자리로 바로 옮긴다(되감기, 건너뛰기, 모션 줄임)
  function sync(now, animate, delta) {
    if (reduced()) animate = false;
    const L = layout(model); view.L = L;
    const addedAt = new Map(); const scoredAt = new Map();
    if (delta) { delta.added.forEach((r, i) => addedAt.set(r, i)); delta.scored.forEach((r, i) => scoredAt.set(r, i)); }
    for (const n of model.nodes.values()) {
      if (n.dormant) continue;
      const tg = targetOf(n, L);
      let v = view.nodes.get(n.ref);
      if (!v) {
        const o = animate ? spawnOrigin(n, tg) : tg;
        v = { ref: n.ref, x: o.x, y: o.y, vx: 0, vy: 0, a: 0, alive: 0, dim: 0, sel: 0, judge: 0, scoreA: 0, port: 0, read: 0, wipe: 1, flash: 0, born: now + (animate ? spawnDelay(n, addedAt.get(n.ref) || 0) : 0), t: tg, next: null, hold: 0, selAt: 0, fit: null };
        view.nodes.set(n.ref, v);
      } else if (animate && scoredAt.has(n.ref)) { v.next = tg; v.hold = now + Math.min(240, scoredAt.get(n.ref) * 12); }
      else if (v.next && now < v.hold) v.next = tg;
      else { v.t = tg; v.next = null; }
      if (!animate) { v.t = tg; v.next = null; snapNode(v); }
    }
    for (const ref of [...view.nodes.keys()]) { const n = model.nodes.get(ref); if (!n || n.dormant) view.nodes.delete(ref); }
    // 더미
    for (const [key, p] of L.piles) {
      let pv = view.piles.get(key);
      if (!pv) { pv = { key, x: p.x, y: p.y, a: 0, n: animate ? 0 : p.count, born: now + (animate ? 320 : 0) }; view.piles.set(key, pv); }
      pv.info = p; pv.tx = p.x; pv.ty = p.y;
      if (!animate) { pv.x = p.x; pv.y = p.y; pv.a = 1; pv.n = p.count; pv.born = 0; pv.ring = p.busy ? 1 : 0; }
    }
    for (const key of [...view.piles.keys()]) if (!L.piles.has(key)) view.piles.delete(key);
    // 선: 부모에서 자식으로, 맞은 카드에서 윗구조로, 부모에서 더미로
    const want = new Set();
    const edge = (key, from, to, kind, primary) => {
      want.add(key);
      let e = view.edges.get(key);
      if (!e) {
        const child = view.nodes.get(to) || view.piles.get(to.slice(1));
        e = { key, from, to, kind, primary, grow: animate ? 0 : 1, born: animate && child ? Math.max(now, child.born - 230) : 0, sel: 0, tSel: 0, selAt: 0 };
        view.edges.set(key, e);
        if (animate && kind !== "bundle" && view.fx.length < 60) view.fx.push({ type: "spark", key, at: e.born, dur: 300 });
      }
      return e;
    };
    const hopOf = (ref) => { const n = model.nodes.get(ref); return n ? n.hop : 0; };
    for (const n of model.nodes.values()) {
      if (n.dormant) continue;
      if (n.origin === "hit_parent") n.climbFrom.forEach((h, i) => edge(h + ">" + n.ref, h, n.ref, "climb", i === 0));
      else if (n.parent) edge(n.parent + ">" + n.ref, n.parent, n.ref, "child", false).lane = n.hop - hopOf(n.parent) > 1;
    }
    for (const [key, p] of L.piles) if (p.count > 0) for (const par of p.parents) edge(par + ">@" + key, par, "@" + key, "bundle", false).lane = p.hop - hopOf(par) > 1;
    for (const key of [...view.edges.keys()]) if (!want.has(key)) view.edges.delete(key);
    // 선정한 카드까지의 길
    const path = new Map(); let longest = new Map();
    const picked = [...model.nodes.values()].filter((n) => n.selected).sort((a, b) => a.rank - b.rank);
    for (const n of picked) {
      const chain = []; let cur = n; let guard = 0;
      while (cur && guard < 24) { guard += 1; const up = cur.origin === "hit_parent" ? cur.climbFrom[0] : cur.parent; if (!up) break; chain.push(up + ">" + cur.ref); cur = model.nodes.get(up); }
      chain.reverse().forEach((k, i) => { if (!path.has(k)) path.set(k, { rank: n.rank, i }); });
      longest.set(n.ref, chain.length);
    }
    for (const e of view.edges.values()) {
      const s = path.get(e.key);
      if (s && !e.tSel) e.selAt = animate ? now + 140 + (s.rank - 1) * 120 + s.i * 180 : 0;
      e.tSel = s ? 1 : 0; if (!animate) e.sel = e.tSel;
    }
    for (const n of picked) { const v = view.nodes.get(n.ref); if (v && v.sel < 0.01 && animate && !v.selAt) v.selAt = now + 140 + (n.rank - 1) * 120 + (longest.get(n.ref) || 0) * 180; }
    // 충분성 눈금
    for (const c of L.cols) {
      let g = view.gauges.get(c.hop); if (!g) { g = { v: 0, a: 0, ok: 0 }; view.gauges.set(c.hop, g); }
      const s = model.suff.get(c.hop); const asking = model.asking && model.asking.hop === c.hop;
      g.tv = s ? s.score : 0; g.ta = s || asking ? 1 : 0; g.tok = s && s.ok ? 1 : 0; g.spin = !!asking; g.th = s ? s.threshold : (model.policy && model.policy.sufficiency_threshold) || 0.7; g.score = s ? s.score : null;
      if (!animate) { g.v = g.tv; g.a = g.ta; g.ok = g.tok; }
    }
    for (const hop of [...view.gauges.keys()]) if (!L.cols.some((c) => c.hop === hop)) view.gauges.delete(hop);
    view.askInfo = model.asking || view.askInfo;
    if (!animate) { view.stop = model.terminal ? 1 : 0; view.ask = model.asking ? 1 : 0; view.fx.length = 0; view.march = 0; }
    // 사건에 붙는 한 번짜리 효과
    if (animate && delta) {
      delta.opened.forEach((r, i) => view.fx.push({ type: "ring", ref: r, port: true, at: now + Math.min(240, (scoredAt.get(r) || 0) * 12) + 60, dur: 520, color: "path" }));
      delta.again.forEach((r) => { const v = view.nodes.get(r); if (v) v.flash = 1; });
      if (delta.scan) { for (let i = 0; i < 2; i += 1) view.fx.push({ type: "ring", ref: delta.scan, port: true, at: now + i * 160, dur: 620, color: "jev" }); const v = view.nodes.get(delta.scan); if (v) v.flash = 1; }
      if (delta.stage === "widen" && delta.event === "step_completed") {
        view.fx.push({ type: "wave", at: now, dur: 760 });
        for (let i = 0; i < 3; i += 1) view.fx.push({ type: "ring", ref: ROOT, at: now + 220 + i * 150, dur: 760, color: "path", big: true });
      }
      if (delta.suff != null) view.fx.push({ type: "gauge", hop: delta.suff, at: now + 380, dur: 560, ok: model.suff.get(delta.suff).ok });
      delta.selected.forEach((r) => { const v = view.nodes.get(r); view.fx.push({ type: "ring", ref: r, at: (v && v.selAt) || now, dur: 620, color: "evidence", box: true }); });
      if (delta.selected.length) view.march = now + 2600;
      if (delta.stage === "run_terminal") view.fx.push({ type: "stamp", at: now, dur: 360 });
    }
    updateHoverKeys();
    invalidate();
  }

  const spring = (cur, vel, target, dt, response) => { const w = (2 * Math.PI) / response; const a = -w * w * (cur - target) - 2 * w * vel; const v = vel + a * dt; return [cur + v * dt, v]; };
  const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  function tick(now, dt) {
    let active = false;
    const live = playing();
    for (const v of view.nodes.values()) {
      if (v.next && now >= v.hold) { if (v.next.alive > v.t.alive) v.wipe = 0; v.t = v.next; v.next = null; }
      if (v.next) active = true;
      if (now < v.born) { active = true; continue; }
      const t = v.t;
      for (let i = 0; i < 2; i += 1) { [v.x, v.vx] = spring(v.x, v.vx, t.x, dt / 2, 0.38); [v.y, v.vy] = spring(v.y, v.vy, t.y, dt / 2, 0.42); }
      v.a = approach(v.a, t.a, dt, 0.08); v.alive = approach(v.alive, t.alive, dt, 0.11); v.dim = approach(v.dim, t.dim, dt, 0.13);
      v.judge = approach(v.judge, t.judge, dt, 0.07); v.scoreA = approach(v.scoreA, t.score, dt, 0.07); v.port = approach(v.port, t.port, dt, 0.09); v.read = approach(v.read, t.read, dt, 0.09);
      v.sel = approach(v.sel, t.sel && now >= v.selAt ? 1 : 0, dt, 0.1);
      if (v.wipe < 1) v.wipe = Math.min(1, v.wipe + dt / 0.3);
      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt / 0.7);
      if (Math.abs(v.x - t.x) > 0.3 || Math.abs(v.y - t.y) > 0.3 || Math.abs(v.vy) > 2 || Math.abs(v.a - t.a) > 0.01 || Math.abs(v.alive - t.alive) > 0.01 || Math.abs(v.dim - t.dim) > 0.01 || Math.abs(v.sel - t.sel) > 0.01 || Math.abs(v.judge - t.judge) > 0.01 || Math.abs(v.scoreA - t.score) > 0.01 || Math.abs(v.port - t.port) > 0.01 || Math.abs(v.read - t.read) > 0.01 || v.wipe < 1 || v.flash > 0) active = true;
      if (live && (t.judge || t.read)) active = true;
    }
    for (const p of view.piles.values()) {
      if (now < p.born) { active = true; continue; }
      p.x = approach(p.x, p.tx, dt, 0.09); p.y = approach(p.y, p.ty, dt, 0.09); p.a = approach(p.a, 1, dt, 0.09); p.n = approach(p.n, p.info.count, dt, 0.1);
      p.ring = approach(p.ring || 0, p.info.busy ? 1 : 0, dt, p.info.busy ? 0.08 : 0.3); if (Math.abs(p.ring - (p.info.busy ? 1 : 0)) > 0.02) active = true;
      if (Math.abs(p.y - p.ty) > 0.3 || p.a < 0.99 || Math.abs(p.n - p.info.count) > 0.4) active = true; else p.n = p.info.count;
      if (live && p.info.busy) active = true;
    }
    for (const e of view.edges.values()) {
      if (now >= e.born && e.grow < 1) e.grow = Math.min(1, e.grow + dt / 0.26);
      if (e.tSel && now >= e.selAt) e.sel = Math.min(1, e.sel + dt / 0.32); else if (!e.tSel) e.sel = Math.max(0, e.sel - dt / 0.2);
      if (e.grow < 1 || e.sel !== e.tSel) active = true;
    }
    for (const g of view.gauges.values()) {
      g.a = approach(g.a, g.ta, dt, 0.08); g.v = approach(g.v, g.tv, dt, 0.16); g.ok = approach(g.ok, g.tok, dt, 0.12);
      if (Math.abs(g.a - g.ta) > 0.01 || Math.abs(g.v - g.tv) > 0.004 || Math.abs(g.ok - g.tok) > 0.01 || (live && g.spin)) active = true;
    }
    view.ask = approach(view.ask, model.asking ? 1 : 0, dt, model.asking ? 0.09 : 0.12);
    view.stop = approach(view.stop, model.terminal ? 1 : 0, dt, 0.09);
    if (Math.abs(view.ask - (model.asking ? 1 : 0)) > 0.01 || Math.abs(view.stop - (model.terminal ? 1 : 0)) > 0.01) active = true;
    if (live && model.inflight.size > 0) active = true;
    view.fx = view.fx.filter((f) => now < f.at + f.dur);
    if (view.fx.length || now < view.march) active = true;
    if (tickCamera(dt)) active = true;
    return active;
  }

  // ------------------------------------------------------------------ 4. 카메라
  const plot = $("plot"); const cv = $("cv"); const ctx = cv.getContext("2d");
  function badgeRoom() { return 0; }
  function bounds(z = cam.z) {
    const vw = W / z; const vh = (H - M.headerH) / z; const L = view.L;
    // 입구만 있는 넓은 배치는 판 가운데에 둔다
    const free = vw - L.width - badgeRoom();
    const minX = L.wide && free > 2 * M.padX ? -free / 2 : -M.padX; const maxX = Math.max(minX, L.width + M.padX + badgeRoom() - vw);
    const minY = -M.padTop; const maxY = Math.max(minY, L.height + 64 - vh);
    return { minX, maxX, minY, maxY, vw, vh };
  }
  const rubber = (over, dim) => (over * dim * 0.55) / (dim + 0.55 * Math.abs(over));
  function tickCamera(dt) {
    if (cam.mode === "glide") {
      cam.x += cam.vx * dt; cam.y += cam.vy * dt;
      const k = Math.exp(-dt / 0.32); cam.vx *= k; cam.vy *= k;
      const b = bounds();
      if (cam.x < b.minX || cam.x > b.maxX || cam.y < b.minY || cam.y > b.maxY || Math.hypot(cam.vx, cam.vy) < 6) { cam.tx = clamp(cam.x, b.minX, b.maxX); cam.ty = clamp(cam.y, b.minY, b.maxY); cam.tz = cam.z; cam.mode = "spring"; }
      return true;
    }
    if (cam.mode === "spring") {
      if (reduced()) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; cam.vx = cam.vy = cam.vz = 0; cam.mode = "idle"; updateZoomLabel(); return false; }
      for (let i = 0; i < 2; i += 1) { [cam.x, cam.vx] = spring(cam.x, cam.vx, cam.tx, dt / 2, 0.42); [cam.y, cam.vy] = spring(cam.y, cam.vy, cam.ty, dt / 2, 0.42); [cam.z, cam.vz] = spring(cam.z, cam.vz, cam.tz, dt / 2, 0.36); }
      updateZoomLabel();
      if (Math.abs(cam.x - cam.tx) < 0.3 && Math.abs(cam.y - cam.ty) < 0.3 && Math.abs(cam.z - cam.tz) < 0.002 && Math.hypot(cam.vx, cam.vy) < 4) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; cam.vx = cam.vy = cam.vz = 0; cam.mode = "idle"; return false; }
      return true;
    }
    return false;
  }
  function moveCamera(x, y, z = cam.tz, instant = false) {
    const b = bounds(z); cam.tx = clamp(x, b.minX, b.maxX); cam.ty = clamp(y, b.minY, b.maxY); cam.tz = z;
    if (instant || reduced()) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; cam.vx = cam.vy = cam.vz = 0; cam.mode = "idle"; updateZoomLabel(); } else cam.mode = "spring";
    invalidate();
  }
  function setFollow(on) { ui.follow = on; $("t-follow").hidden = on || !playing(); }
  // 지금 진행 중인 홉과 그 앞 열이 보이게 한다. 배율은 건드리지 않는다
  function followHop(hop, instant) {
    if (!ui.follow) return;
    const vw = W / cam.tz; const sheetW = sheetInset() / cam.tz;
    const left = colX(Math.max(0, hop - 1)) - M.padX; const right = colX(hop) + M.colW + M.padX + badgeRoom() + sheetW;
    let x = cam.tx;
    if (right - left > vw) x = Math.min(right - vw, colX(hop) - 16); else if (right > x + vw) x = right - vw; else if (left < x) x = left;
    moveCamera(x, -M.padTop, cam.tz, instant);
  }
  function showRefs(refs, instant) {
    const hops = refs.map((r) => model.nodes.get(r)).filter(Boolean).map((n) => n.hop);
    if (!hops.length) return followHop(model.maxHop, instant);
    const vw = W / cam.tz; const left = colX(Math.min(...hops)) - M.padX; const right = colX(Math.max(...hops)) + M.colW + M.padX + badgeRoom() + sheetInset() / cam.tz;
    moveCamera(right - left > vw ? Math.min(right - vw, colX(Math.max(...hops)) - 16) : clamp(cam.tx, right - vw, left), -M.padTop, cam.tz, instant);
  }
  function zoomTo(z, px = W / 2, py = H / 2) {
    z = clamp(z, 0.4, 1.6);
    const wx = px / cam.z + cam.x; const wy = (py - M.headerH) / cam.z + cam.y;
    setFollow(false);
    moveCamera(wx - px / z, wy - (py - M.headerH) / z, z);
  }
  function fitAll(instant = false) {
    const isAuto = instant === true;
    const L = view.L; const w = L.width + 2 * M.padX + badgeRoom(); const h = L.height + M.padTop + 54;
    const minZ = W < 480 ? 0.76 : 0.72;
    const z = clamp(Math.min(W / w, (H - M.headerH) / h), minZ, 1);
    setFollow(false);
    $("t-follow").hidden = ui.follow || !player.playing;
    const targetX = W < w * z ? -M.padX : -M.padX - Math.max(0, (W / z - w) / 2);
    moveCamera(targetX, -M.padTop, z, isAuto);
    for (const v of view.nodes.values()) v.fit = null;
  }
  function updateZoomLabel() { $("zoom").textContent = Math.round(cam.z * 100) + "%"; }

  // ------------------------------------------------------------------ 5. 그리기 (캔버스 하나. 후보가 수백이어도 보이는 것만 그린다)
  let T = null;
  const hex = (s) => { s = s.trim(); if (s.startsWith("#")) { if (s.length === 4) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]; return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; } const m = s.match(/[\d.]+/g) || [0, 0, 0]; return [Number(m[0]), Number(m[1]), Number(m[2])]; };
  const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  function readTokens() {
    const cs = getComputedStyle(root); const g = (n) => hex(cs.getPropertyValue(n));
    const fill = (name) => {
      const raw = cs.getPropertyValue(name).trim();
      const alpha = raw.startsWith("rgba") ? Number(raw.match(/[\d.]+/g)[3])
        : /^#[0-9a-f]{8}$/i.test(raw) ? parseInt(raw.slice(7), 16) / 255
        : /^#[0-9a-f]{4}$/i.test(raw) ? parseInt(raw[4] + raw[4], 16) / 255 : 1;
      return mix(g("--g-node"), hex(raw), alpha);
    };
    T = { plot: g("--g-plot"), node: g("--g-node"), nodeLine: g("--g-node-line"), know: g("--g-know"), knowFill: g("--g-know-fill"), struct: g("--g-struct"), structFill: fill("--g-struct-fill"), path: g("--g-path"), thin: g("--g-thin"), lowText: g("--g-low-text"), lowLine: g("--g-low-line"), jev: g("--g-jev"), ok: g("--g-ok"), evidence: g("--g-evidence"), evidenceInk: g("--g-evidence-ink"), ink: g("--g-ink"), ink2: g("--g-ink-2"), stopFill: g("--g-stop-fill"), stopInk: g("--g-stop-ink"), selBase: g("--g-sel-base"), shell: g("--shell"), focus: g("--brand") };
    if (matchMedia("(forced-colors: active)").matches) {
      const probe = document.createElement("span"); probe.style.cssText = "color:CanvasText;background:Canvas;border-color:Highlight"; document.body.append(probe);
      const pc = getComputedStyle(probe); const text = hex(pc.color); const bg = hex(pc.backgroundColor); const hi = hex(pc.borderTopColor); probe.remove();
      Object.assign(T, { plot: bg, node: bg, nodeLine: text, know: text, knowFill: bg, struct: text, structFill: bg, path: text, thin: text, lowText: text, lowLine: text, jev: hi, ok: hi, evidence: hi, evidenceInk: bg, ink: text, ink2: text, stopFill: bg, stopInk: text, selBase: text, shell: bg, focus: hi });
    }
    for (const v of view.nodes.values()) v.fit = null;
  }
  const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Segoe UI", "Malgun Gothic", sans-serif';
  const font = (w, px) => `${w} ${px}px ${FONT}`;
  const wfont = (w, px) => `${w} ${Math.ceil(Math.max(13, px) / Math.min(1, cam.z || 1))}px ${FONT}`;
  function fitText(text, max, f) {
    ctx.font = f; if (ctx.measureText(text).width <= max) return text;
    let lo = 0; let hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + "…").width <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo) + "…";
  }
  function rr(x, y, w, h, _r) { ctx.beginPath(); ctx.rect(x, y, w, h); }
  const typeOf = (n) => (n.type === "structure" ? [T.struct, T.structFill] : n.type === "root" ? [T.path, T.path] : [T.know, T.knowFill]);

  function anchorOut(ref) { const v = view.nodes.get(ref); return v ? { x: v.x + M.colW, y: v.y + M.rowH / 2, a: v.a, born: v.born } : null; }
  function anchorIn(to) {
    if (to[0] === "@") { const p = view.piles.get(to.slice(1)); return p ? { x: p.x, y: p.y + Math.min(p.info.h / 2, 13), a: Math.max(p.a, performance.now() < p.born + 120 ? 1 : p.a), born: p.born, alive: 0, dim: 1 } : null; }
    const v = view.nodes.get(to); return v ? { x: v.x, y: v.y + M.rowH / 2, a: (v.next || v.t).a > 0 ? Math.max(v.a, performance.now() < v.born + 120 ? 1 : v.a) : v.a, born: v.born, alive: v.alive * ((v.next || v.t).soft ? 0.56 : 1), dim: v.dim } : null;
  }
  function curve(a, b, t0, t1) {
    const dx = Math.max(34, (b.x - a.x) * 0.5); const x1 = a.x + dx; const x2 = b.x - dx;
    if (t0 <= 0 && t1 >= 1) { ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(x1, a.y, x2, b.y, b.x, b.y); return b; }
    const bl = (p0, p1, p2, p3, u, v, w) => (1 - u) * (1 - v) * (1 - w) * p0 + (u * (1 - v) * (1 - w) + (1 - u) * v * (1 - w) + (1 - u) * (1 - v) * w) * p1 + (u * v * (1 - w) + u * (1 - v) * w + (1 - u) * v * w) * p2 + u * v * w * p3;
    const X = (u, v, w) => bl(a.x, x1, x2, b.x, u, v, w); const Y = (u, v, w) => bl(a.y, a.y, b.y, b.y, u, v, w);
    const end = { x: X(t1, t1, t1), y: Y(t1, t1, t1) };
    ctx.moveTo(X(t0, t0, t0), Y(t0, t0, t0)); ctx.bezierCurveTo(X(t0, t0, t1), Y(t0, t0, t1), X(t0, t1, t1), Y(t0, t1, t1), end.x, end.y);
    return end;
  }
  // 선이 화면 세로 범위에 걸치는 구간 [t0, t1]. 걸치지 않으면 null
  function span(a, b, y0, y1) {
    const lo = Math.min(a.y, b.y); const hi = Math.max(a.y, b.y);
    if (hi < y0 || lo > y1) return null;
    if (lo >= y0 && hi <= y1) return FULL;
    const inv = (yy) => { const sgoal = clamp((yy - a.y) / (b.y - a.y), 0, 1); let l = 0; let h = 1; for (let i = 0; i < 14; i += 1) { const m = (l + h) / 2; if (3 * m * m - 2 * m * m * m < sgoal) l = m; else h = m; } return (l + h) / 2; };
    let t0 = 0; let t1 = 1;
    if (a.y < b.y) { if (a.y < y0) t0 = inv(y0); if (b.y > y1) t1 = inv(y1); } else { if (a.y > y1) t0 = inv(y1); if (b.y < y0) t1 = inv(y0); }
    return t1 > t0 ? [t0, t1] : null;
  }
  const FULL = [0, 1];
  function lanePath(a, b) {
    const ly = M.laneY; const r = 24;
    ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + r, a.y, a.x + r, ly, a.x + 2 * r, ly); ctx.lineTo(b.x - 2 * r, ly); ctx.bezierCurveTo(b.x - r, ly, b.x - r, b.y, b.x, b.y);
  }
  function lanePoint(a, b, t) {
    const ly = M.laneY; const r = 24; const cub = (p0, p1, p2, p3, u) => { const w = 1 - u; return w * w * w * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u * u * u * p3; };
    if (t < 0.12) { const u = t / 0.12; return { x: cub(a.x, a.x + r, a.x + r, a.x + 2 * r, u), y: cub(a.y, a.y, ly, ly, u) }; }
    if (t > 0.88) { const u = (t - 0.88) / 0.12; return { x: cub(b.x - 2 * r, b.x - r, b.x - r, b.x, u), y: cub(ly, ly, b.y, b.y, u) }; }
    return { x: lerp(a.x + 2 * r, b.x - 2 * r, (t - 0.12) / 0.76), y: ly };
  }
  function strokeLane(a, b, t) {
    if (t < 1) { ctx.save(); ctx.beginPath(); ctx.rect(a.x - 6, -1e5, (b.x - a.x + 12) * t, 2e5); ctx.clip(); }
    ctx.beginPath(); lanePath(a, b); ctx.stroke();
    if (t < 1) ctx.restore();
  }
  function pointOn(a, b, t) {
    const dx = Math.max(34, (b.x - a.x) * 0.5); const u = 1 - t;
    return { x: u * u * u * a.x + 3 * u * u * t * (a.x + dx) + 3 * u * t * t * (b.x - dx) + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y };
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const z = cam.z; const ox = -cam.x * z; const oy = M.headerH - cam.y * z;
    const text = z >= 0.5;
    const x0 = cam.x - M.colW - 20; const x1 = cam.x + W / z + 20; const y0 = cam.y - 60; const y1 = cam.y + (H - M.headerH) / z + 60;
    ctx.save(); ctx.beginPath(); ctx.rect(0, M.headerH - 10, W, H); ctx.clip();
    ctx.translate(ox, oy); ctx.scale(z, z);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // 선: 흐린 것 먼저, 굵은 것을 위에
    const strong = []; const lanes = [];
    for (const e of view.edges.values()) {
      if (e.grow <= 0 || now < e.born) continue;
      const a = anchorOut(e.from); const b = anchorIn(e.to); if (!a || !b) continue;
      const alpha = Math.min(a.a, b.a); if (alpha < 0.03) continue;
      if ((a.x > x1 && b.x > x1) || (a.x < x0 && b.x < x0)) continue;
      if (e.lane) { if (e.kind === "bundle" || e.sel > 0 || b.alive > 0.5 || view.hoverKeys.has(e.key) || (b.y > y0 && b.y < y1)) lanes.push([e, a, b, alpha, e.kind === "bundle" ? 0 : b.alive]); continue; }
      const sp = span(a, b, y0, y1); if (!sp) continue;
      const s = e.kind === "climb" ? 1 : e.kind === "bundle" ? 0 : b.alive;
      if (s > 0.5 || e.sel > 0 || view.hoverKeys.has(e.key)) { strong.push([e, a, b, alpha, s, sp]); if (s > 0.5) continue; }
      // 흐린 선은 끝이 화면에서 한참 벗어나 있으면 그리지 않는다(펼친 큰 모음에서 수백 줄이 겹칠 뿐이다)
      if (b.y < y0 - 900 || b.y > y1 + 900) continue;
      const dashed = e.kind === "bundle" || b.dim > 0.5;
      ctx.globalAlpha = alpha * (dashed ? 0.85 : 0.6);
      ctx.strokeStyle = css(mix(T.thin, T.path, s)); ctx.lineWidth = e.kind === "bundle" ? 2.4 : 1.1;
      ctx.setLineDash(dashed ? (e.kind === "bundle" ? [2, 5] : [4, 4]) : []);
      ctx.beginPath(); curve(a, b, sp[0], Math.min(sp[1], e.grow)); ctx.stroke();
      if (text && e.grow >= 1 && sp[1] >= 1 && e.kind !== "bundle") { ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - 6, b.y - 3.2); ctx.lineTo(b.x - 6, b.y + 3.2); ctx.fill(); }
    }
    ctx.setLineDash([]);
    for (const [e, a, b, alpha, s, sp] of strong) {
      if (s > 0.5) {
        ctx.globalAlpha = alpha; ctx.strokeStyle = css(T.path); ctx.lineWidth = lerp(1.2, 2.5, s);
        ctx.beginPath(); const tip = curve(a, b, sp[0], Math.min(sp[1], e.grow)); ctx.stroke();
        if (e.grow >= 1 && sp[1] >= 1) { ctx.fillStyle = css(T.path); ctx.beginPath(); ctx.moveTo(tip.x + 1, tip.y); ctx.lineTo(tip.x - 7, tip.y - 4.4); ctx.lineTo(tip.x - 7, tip.y + 4.4); ctx.fill(); }
      }
      if (e.sel > 0) {
        ctx.globalAlpha = alpha; ctx.strokeStyle = css(T.selBase); ctx.lineWidth = 5.4; ctx.beginPath(); curve(a, b, sp[0], Math.min(sp[1], e.sel)); ctx.stroke();
        ctx.strokeStyle = css(T.evidence); ctx.lineWidth = 3.2; ctx.setLineDash([9, 8]); ctx.lineDashOffset = now < view.march ? -(now / 28) % 17 : 0;
        ctx.beginPath(); curve(a, b, sp[0], Math.min(sp[1], e.sel)); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      if (view.hoverKeys.has(e.key)) { ctx.globalAlpha = alpha; ctx.strokeStyle = css(T.jev); ctx.lineWidth = 2.2; ctx.setLineDash([5, 4]); ctx.beginPath(); curve(a, b, sp[0], Math.min(sp[1], e.grow)); ctx.stroke(); ctx.setLineDash([]); }
    }
    for (const [e, a, b, alpha, st] of lanes) {
      const dashed = e.kind === "bundle" || (b.dim > 0.5 && st < 0.5);
      ctx.globalAlpha = alpha * (st > 0.5 ? 1 : dashed ? 0.85 : 0.6); ctx.strokeStyle = css(mix(T.thin, T.path, st)); ctx.lineWidth = e.kind === "bundle" ? 2.4 : lerp(1.1, 2.5, st);
      ctx.setLineDash(dashed ? (e.kind === "bundle" ? [2, 5] : [4, 4]) : []); strokeLane(a, b, e.grow); ctx.setLineDash([]);
      if (e.grow >= 1 && e.kind !== "bundle" && text) { ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(b.x + (st > 0.5 ? 1 : 0), b.y); ctx.lineTo(b.x - 7, b.y - (st > 0.5 ? 4.4 : 3.2)); ctx.lineTo(b.x - 7, b.y + (st > 0.5 ? 4.4 : 3.2)); ctx.fill(); }
      if (e.sel > 0) {
        ctx.globalAlpha = alpha; ctx.strokeStyle = css(T.selBase); ctx.lineWidth = 5.4; strokeLane(a, b, e.sel);
        ctx.strokeStyle = css(T.evidence); ctx.lineWidth = 3.2; ctx.setLineDash([9, 8]); ctx.lineDashOffset = now < view.march ? -(now / 28) % 17 : 0; strokeLane(a, b, e.sel); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      if (view.hoverKeys.has(e.key)) { ctx.globalAlpha = alpha; ctx.strokeStyle = css(T.jev); ctx.lineWidth = 2.2; ctx.setLineDash([5, 4]); strokeLane(a, b, e.grow); ctx.setLineDash([]); }
    }
    // 윗구조 선의 이름표
    if (text && M.gap >= 52) for (const e of view.edges.values()) {
      if (e.kind !== "climb" || !e.primary || e.grow < 1) continue;
      const a = anchorOut(e.from); const b = anchorIn(e.to); if (!a || !b) continue;
      const p = pointOn(a, b, 0.5); ctx.font = font(600, 13); const tw = ctx.measureText("윗구조").width + 14;
      ctx.globalAlpha = Math.min(a.a, b.a); rr(p.x - tw / 2, p.y - 11, tw, 22, 6); ctx.fillStyle = css(T.node); ctx.fill(); ctx.strokeStyle = css(T.path); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = css(T.path); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("윗구조", p.x, p.y + 0.5); ctx.textAlign = "left";
    }
    // 선을 타고 가는 빛
    for (const f of view.fx) {
      if (f.type !== "spark" || now < f.at) continue;
      const e = view.edges.get(f.key); if (!e) continue; const a = anchorOut(e.from); const b = anchorIn(e.to); if (!a || !b || b.a < 0.05) continue;
      const t = easeOut((now - f.at) / f.dur); const p = e.lane ? lanePoint(a, b, t) : pointOn(a, b, t); const fade = 1 - Math.pow((now - f.at) / f.dur, 3);
      ctx.globalAlpha = 0.9 * fade * Math.max(b.a, 0.3); ctx.fillStyle = css(e.kind === "climb" || b.alive > 0.5 ? T.path : T.jev);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, 6.2832); ctx.fill();
      ctx.globalAlpha *= 0.28; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 6.2832); ctx.fill();
    }
    // 더미
    for (const p of view.piles.values()) { if (now < p.born || p.x > x1 || p.x < x0 || p.y + p.info.h < y0 || p.y > y1) continue; drawPile(p, now, text); }
    // 후보
    const root = model.nodes.get(ROOT);
    if (root) drawNode(root, view.nodes.get(ROOT), now, text, x0, x1, y0, y1);
    for (const ref of model.order) drawNode(model.nodes.get(ref), view.nodes.get(ref), now, text, x0, x1, y0, y1);
    // 고리 효과
    for (const f of view.fx) {
      if (f.type !== "ring" || now < f.at) continue;
      const v = view.nodes.get(f.ref); if (!v || v.a < 0.05) continue;
      const t = (now - f.at) / f.dur; const k = easeOut(t); const col = T[f.color];
      ctx.globalAlpha = (1 - t) * 0.7; ctx.strokeStyle = css(col); ctx.lineWidth = lerp(2.4, 0.6, k);
      if (f.box) { const g = k * 12; rr(v.x - g, v.y - g, M.colW + 2 * g, M.rowH + 2 * g, 5 + g); ctx.stroke(); }
      else { const cx = f.port ? v.x + M.colW : v.x + M.colW / 2; const cy = v.y + M.rowH / 2; ctx.beginPath(); ctx.arc(cx, cy, lerp(4, f.big ? 120 : 20, k), 0, 6.2832); ctx.stroke(); }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    drawThreads(now, z, ox, oy);
    drawHeader(now, z, ox);
    // 그물 넓히기: 판 전체를 훑는 빛
    for (const f of view.fx) {
      if (f.type !== "wave" || now < f.at) continue;
      const t = (now - f.at) / f.dur; const x = lerp(-120, W + 360, easeOut(t));
      const g = ctx.createLinearGradient(x - 360, 0, x + 30, 0); g.addColorStop(0, css(T.path, 0)); g.addColorStop(0.86, css(T.path, 0.13 * (1 - t * t))); g.addColorStop(1, css(T.path, 0));
      ctx.fillStyle = g; ctx.fillRect(x - 360, 0, 390, H);
    }
    // 키보드 초점
    if (view.focus && view.focus[0] === "#" && document.activeElement === plot) {
      const c = view.L.cols.find((cc) => cc.hop === Number(view.focus.slice(1)));
      if (c) { const gx = gaugeX(c, z, ox); ctx.strokeStyle = css(T.focus); ctx.lineWidth = 3; rr(gx - 62, 5, ox + (c.x + c.w) * z + 6 - (gx - 62), 32, 8); ctx.stroke(); }
    } else if (view.focus && document.activeElement === plot) {
      const v = view.nodes.get(view.focus) || view.piles.get(view.focus.slice(1));
      if (v) { ctx.save(); ctx.translate(ox, oy); ctx.scale(z, z); ctx.strokeStyle = css(T.focus); ctx.lineWidth = 3 / z; rr(v.x - 4, v.y - 4, M.colW + 8, (view.focus[0] === "@" ? v.info.h : M.rowH) + 8, 8); ctx.stroke(); ctx.restore(); }
    }
  }

  function drawNode(n, v, now, text, x0, x1, y0, y1) {
    if (!v || now < v.born || v.a < 0.03 || v.x > x1 || v.x < x0 || v.y < y0 || v.y > y1) return;
    const x = v.x; const y = v.y; const w = M.colW; const h = M.rowH; const [line, fill] = typeOf(n);
    const alive = v.alive; const dim = v.dim; const isRoot = n.type === "root";
    const va = v.a; v.a = va * (1 - 0.8 * clamp((Math.abs(v.y - v.t.y) - 6) / 80, 0, 1));
    if (v.a < 0.03) { v.a = va; return; }
    ctx.globalAlpha = v.a;
    // 선정: 노란 테
    if (v.sel > 0.02) { ctx.globalAlpha = v.a * v.sel; rr(x - 3.5, y - 3.5, w + 7, h + 7, 8); ctx.strokeStyle = css(T.evidence); ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = v.a; }
    rr(x, y, w, h, 5);
    ctx.fillStyle = css(mix(T.node, fill, alive), 1 - 0.6 * dim); ctx.fill();
    if (v.wipe < 1 && !isRoot) { ctx.save(); ctx.clip(); const k = easeOut(v.wipe); ctx.fillStyle = css(T.node, 1 - k * 0.2); ctx.fillRect(x + w * k, y, w * (1 - k), h); ctx.fillStyle = css(line, 0.35 * (1 - k)); ctx.fillRect(x + w * k - 18, y, 18, h); ctx.restore(); }
    if (v.flash > 0) { rr(x, y, w, h, 5); ctx.fillStyle = css(T.jev, 0.3 * v.flash); ctx.fill(); }
    ctx.lineWidth = 1 + alive; ctx.strokeStyle = css(mix(mix(T.nodeLine, T.lowLine, dim), line, alive));
    if (dim > 0.5 && alive < 0.5) ctx.setLineDash([4, 3]);
    rr(x + 0.5, y + 0.5, w - 1, h - 1, 5); ctx.stroke(); ctx.setLineDash([]);
    // 왼쪽 유형 띠: 지식은 한 줄, 구조는 두 줄
    if (!isRoot) {
      ctx.fillStyle = css(line, 1 - 0.55 * dim);
      ctx.beginPath(); ctx.rect(x, y, 5, h); ctx.fill();
      if (n.type === "structure") ctx.fillRect(x + 7, y + 5, 1.6, h - 10);
    }
    const tx = x + (n.type === "structure" ? 15 : 12); const cy = y + h / 2 + 0.5;
    const portPad = n.type === "structure" ? 4 : 0;
    if (text) {
      const bold = alive > 0.5; const f = wfont(bold ? 650 : 500, 14);
      const scoreFont = wfont(bold ? 600 : 500, 13);
      ctx.font = scoreFont;
      const scoreW = n.score != null ? ctx.measureText(n.score.toFixed(2)).width + 8 : n.byHit || n.judging ? 36 : 4;
      const availableWidth = w - (tx - x) - 8 - scoreW - portPad;
      const key = `${f}/${availableWidth}`;
      if (!v.fit || v.fitKey !== key) { v.fit = fitText(n.title, availableWidth, f); v.fitKey = key; }
      ctx.font = f; ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.fillStyle = isRoot ? css(T.shell) : css(mix(T.ink, T.lowText, dim));
      ctx.fillText(v.fit, tx, cy);
      const sx = x + w - 9 - portPad;
      if (n.score != null && v.scoreA > 0.02) {
        ctx.globalAlpha = v.a * v.scoreA; ctx.font = scoreFont; ctx.textAlign = "right";
        ctx.fillStyle = css(mix(T.ink2, T.lowText, dim)); ctx.fillText(n.score.toFixed(2), sx, cy + (1 - v.scoreA) * 5); ctx.globalAlpha = v.a;
      } else if (n.byHit) {
        ctx.strokeStyle = css(T.path); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(sx - 5, cy + 5); ctx.lineTo(sx - 5, cy - 5); ctx.moveTo(sx - 9, cy - 1); ctx.lineTo(sx - 5, cy - 5); ctx.lineTo(sx - 1, cy - 1); ctx.stroke();
      }
      if (v.judge > 0.02 && n.score == null) {
        for (let i = 0; i < 3; i += 1) { const ph = playing() ? 0.5 + 0.5 * Math.sin(now / 150 - i * 0.9) : 0.6; ctx.globalAlpha = v.a * v.judge * (0.3 + 0.7 * ph); ctx.fillStyle = css(T.jev); ctx.beginPath(); ctx.arc(sx - 18 + i * 7, cy, 2, 0, 6.2832); ctx.fill(); }
        ctx.globalAlpha = v.a;
      }
      ctx.textAlign = "left";
    }
    // Jev가 보는 중: 주황 테와 지나가는 빛
    if (v.judge > 0.02) {
      ctx.globalAlpha = v.a * v.judge; ctx.strokeStyle = css(T.jev); ctx.lineWidth = 1.6; ctx.setLineDash([7, 5]); ctx.lineDashOffset = playing() ? -(now / 22) % 12 : 0;
      rr(x - 2.5, y - 2.5, w + 5, h + 5, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (playing() && !reduced()) {
        const ph = ((now + (v.y % 7) * 40) % 1000) / 1000; const bx = x - 70 + (w + 140) * ph;
        ctx.save(); rr(x, y, w, h, 5); ctx.clip(); const g = ctx.createLinearGradient(bx - 50, 0, bx + 50, 0); g.addColorStop(0, css(T.jev, 0)); g.addColorStop(0.5, css(T.jev, 0.2)); g.addColorStop(1, css(T.jev, 0));
        ctx.fillStyle = g; ctx.fillRect(bx - 50, y, 100, h); ctx.restore();
      }
      ctx.globalAlpha = v.a;
    }
    // 문(구조의 오른쪽 구멍): 빈 원은 아직, 찬 원은 열림
    if (n.type === "structure" && v.port > 0.02) {
      const px = x + w; const py = y + h / 2; const pulse = v.read > 0.02 && playing() ? 1 + 0.35 * v.read * (0.5 + 0.5 * Math.sin(now / 90)) : 1;
      ctx.globalAlpha = v.a * Math.min(1, v.port * 2.2);
      ctx.beginPath(); ctx.arc(px, py, 4.6 * pulse, 0, 6.2832); ctx.fillStyle = css(mix(T.node, T.path, clamp((v.port - 0.45) / 0.55, 0, 1))); ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = css(mix(T.nodeLine, T.path, clamp((v.port - 0.3) / 0.7, 0, 1))); ctx.stroke(); ctx.globalAlpha = v.a;
    }
    if (isRoot || n.climbing) {
      const pulse = v.read > 0.02 && playing() ? 0.5 + 0.5 * Math.sin(now / 90) : 0;
      if (pulse > 0) { ctx.globalAlpha = v.a * 0.5 * pulse; ctx.strokeStyle = css(T.path); ctx.lineWidth = 2; rr(x - 3, y - 3, w + 6, h + 6, 8); ctx.stroke(); ctx.globalAlpha = v.a; }
    }
    // 선정 칩: 순위. 위 결과 줄의 번호와 같다
    if (v.sel > 0.02 && text) {
      const k = easeOut(v.sel); ctx.globalAlpha = v.a * k; const cx = x + 10; const cyy = y + h + 3 - (1 - k) * 8;
      rr(cx, cyy, 30, M.chipH - 4, 6); ctx.fillStyle = css(T.evidence); ctx.fill();
      ctx.fillStyle = css(T.evidenceInk); ctx.font = wfont(700, 13); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n.rank), cx + 15, cyy + (M.chipH - 4) / 2 + 0.5); ctx.textAlign = "left";
    }
    // 미뤄 둔 묶음: 구조 아래의 칩. 열 곳이 떨어지면 꺼내 훑는다
    const put = view.L.dorm.get(n.ref);
    if (put && text) {
      ctx.globalAlpha = v.a; ctx.font = font(600, 13); const label = "안 본 " + put; const cw = ctx.measureText(label).width + 34; const cx = x + 10; const cyy = y + h + 3; const ch = M.chipH - 4;
      for (let i = 1; i >= 0; i -= 1) { rr(cx + 6 + i * 3, cyy + 4 - i * 2, 11, ch - 8, 2); ctx.fillStyle = css(T.node); ctx.fill(); ctx.strokeStyle = css(T.ink2); ctx.lineWidth = 1; ctx.stroke(); }
      rr(cx + 0.5, cyy + 0.5, cw - 1, ch - 1, 6); ctx.strokeStyle = css(T.ink2, 0.7); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css(T.ink2); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(label, cx + 26, cyy + ch / 2 + 0.5);
    }
    // 가리킨 후보
    if (view.hover === n.ref) { ctx.globalAlpha = v.a * 0.55; ctx.strokeStyle = css(T.ink); ctx.lineWidth = 1.4; rr(x - 1.5, y - 1.5, w + 3, h + 3, 6.5); ctx.stroke(); }
    ctx.globalAlpha = 1; v.a = va;
  }

  function drawPile(p, now, text) {
    const x = p.x; const y = p.y; const w = M.colW; const info = p.info; const h = info.h; const top = info.grid ? 13 : h / 2;
    ctx.globalAlpha = p.a * 0.9;
    for (let i = 2; i >= 0; i -= 1) { rr(x + 8 + i * 3, y + top - 8 - i * 2 + 2, 16, 12, 3); ctx.fillStyle = css(T.node); ctx.fill(); ctx.strokeStyle = css(T.lowLine); ctx.lineWidth = 1; ctx.stroke(); }
    rr(x + 0.5, y + 0.5, w - 1, h - 1, 5); ctx.strokeStyle = css(T.lowLine); ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
    if (text) { ctx.font = wfont(600, 13); ctx.fillStyle = css(T.ink2); ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(info.expanded ? "접기" : "+" + Math.round(p.n), x + 38, y + top + 0.5); }
    if (info.grid) {
      // 점 하나가 카드 하나. 회색은 아직, 주황은 Jev가 보는 중, 흐린 색은 낮음, 진한 색은 맞음, 노랑은 선정
      const c = M.cell; const colors = { pend: css(T.nodeLine), jev: css(T.jev), k: css(T.know), s: css(T.struct), kl: css(T.know, 0.3), sl: css(T.struct, 0.3), none: css(T.lowLine, 0.55), sel: css(T.evidence) };
      const pulse = playing() ? 0.6 + 0.4 * Math.sin(now / 110) : 1; let last = "";
      for (let i = 0; i < info.cells.length; i += 1) {
        const v = view.nodes.get(info.cells[i]); const n = model.nodes.get(info.cells[i]); if (!v || !n) continue;
        const st = n.type === "structure";
        let key; let size = 3.2;
        if (v.judge > 0.5) key = "jev"; else if (v.sel > 0.5) { key = "sel"; size = 4.4; } else if (v.alive > 0.5) { key = st ? "s" : "k"; size = 4.4; } else if (v.dim > 0.5) key = n.verdict === "nobody" ? "none" : st ? "sl" : "kl"; else key = "pend";
        if (key !== last) { ctx.fillStyle = colors[key]; ctx.globalAlpha = p.a * (key === "jev" ? pulse : 1); last = key; }
        const cx = x + 8 + (i % info.cols) * c; const cy = y + 26 + Math.floor(i / info.cols) * c;
        ctx.fillRect(cx + (c - 1 - size) / 2, cy + (c - 1 - size) / 2, size, size);
      }
    } else if ((p.ring || 0) > 0.03) {
      // 묶음 고리: 조각 하나가 Jev 호출 하나. 주황은 묻는 중, 남색은 끝남. 동시에 둘셋이 켜질 수 있다
      const cx = x + w - 18; const cy = y + h / 2; const r = 8; const n = info.segs.length; const gap = n > 1 ? 0.22 : 0;
      info.segs.forEach((sg, i) => {
        const a0 = -Math.PI / 2 + (i / n) * 6.2832 + gap / 2; const a1 = -Math.PI / 2 + ((i + 1) / n) * 6.2832 - gap / 2;
        ctx.globalAlpha = p.a * p.ring * (sg.done ? 0.85 : playing() ? 0.55 + 0.45 * Math.sin(now / 120 + i) : 0.9);
        ctx.strokeStyle = css(sg.done ? T.path : T.jev); ctx.lineWidth = sg.done ? 2.2 : 3; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
      });
    }
    if (view.hover === "@" + p.key) { ctx.globalAlpha = 0.5; ctx.strokeStyle = css(T.ink); ctx.lineWidth = 1.4; rr(x - 1.5, y - 1.5, w + 3, h + 3, 6.5); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  const gaugeX = (c, z, ox) => { const sw = c.w * z; ctx.font = font(650, 14); return ox + c.x * z + sw - ctx.measureText("0.00").width - 16; };
  // 열 머리: 홉 이름, 지금 나가 있는 Jev 호출(점), 충분성 눈금
  function drawHeader(now, z, ox) {
    const L = view.L; const cy = 21;
    const fade = ctx.createLinearGradient(0, M.headerH - 12, 0, M.headerH + 2); fade.addColorStop(0, css(T.plot, 1)); fade.addColorStop(1, css(T.plot, 0));
    ctx.fillStyle = css(T.plot); ctx.fillRect(0, 0, W, M.headerH - 12); ctx.fillStyle = fade; ctx.fillRect(0, M.headerH - 12, W, 14);
    ctx.textBaseline = "middle";
    for (const c of L.cols) {
      const sx = ox + c.x * z; const sw = c.w * z; if (sx + sw < -40 || sx > W + 40) continue;
      ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.font = font(700, 15); ctx.fillStyle = css(T.ink);
      const name = sw < 96 ? String(c.hop) : hopName(c.hop); ctx.fillText(name, sx, cy);
      let dx = sx + ctx.measureText(name).width + 10; let k = 0;
      for (const f of model.inflight.values()) {
        if (f.hop !== c.hop || !JEV.has(f.stage)) continue;
        ctx.globalAlpha = playing() ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now / 130 + k * 1.3)) : 0.9; ctx.fillStyle = css(T.jev); ctx.beginPath(); ctx.arc(dx + 3, cy, 3.4, 0, 6.2832); ctx.fill(); dx += 11; k += 1;
      }
      const g = view.gauges.get(c.hop);
      if (g && g.a > 0.02 && sw >= 96) {
        const col = mix(T.jev, T.ok, g.ok); const gx = gaugeX(c, z, ox);
        ctx.globalAlpha = g.a; ctx.lineWidth = 3; ctx.strokeStyle = css(T.thin, 0.45); ctx.beginPath(); ctx.arc(gx, cy, 7, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = css(col); ctx.lineCap = "round"; ctx.beginPath();
        if (g.spin && g.score == null) { const a = playing() ? now / 160 : 0; ctx.arc(gx, cy, 7, a, a + 1.5); } else ctx.arc(gx, cy, 7, -Math.PI / 2, -Math.PI / 2 + 6.2832 * clamp(g.v, 0.001, 1));
        ctx.stroke();
        const ta = -Math.PI / 2 + 6.2832 * g.th; ctx.strokeStyle = css(T.ink, 0.55); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(gx + Math.cos(ta) * 4, cy + Math.sin(ta) * 4); ctx.lineTo(gx + Math.cos(ta) * 10.5, cy + Math.sin(ta) * 10.5); ctx.stroke();
        if (g.score != null) { ctx.textAlign = "right"; ctx.font = font(650, 14); ctx.fillStyle = css(col); ctx.fillText(g.score.toFixed(2), sx + sw, cy); }
        if (sw >= 196) { ctx.textAlign = "right"; ctx.font = font(500, 13); ctx.fillStyle = css(col, 0.9); ctx.fillText("찾음", gx - 15, cy); }
        ctx.textAlign = "left";
      }
    }
    for (const f of view.fx) {
      if (f.type !== "gauge" || now < f.at) continue;
      const c = L.cols.find((cc) => cc.hop === f.hop); if (!c) continue; const t = (now - f.at) / f.dur;
      ctx.globalAlpha = (1 - t) * 0.8; ctx.strokeStyle = css(f.ok ? T.ok : T.jev); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gaugeX(c, z, ox), cy, 7 + easeOut(t) * (f.ok ? 22 : 10), 0, 6.2832); ctx.stroke();
    }
    // 끝난 까닭 (우측 하단 스탬프 배지 - 상단 홉 눈금과 절대 겹치지 않도록 배치)
    if (view.stop > 0.02 && L.cols.length) {
      const label = stopLabel(model.terminal); ctx.font = font(700, 13);
      const tw = ctx.measureText(label).width + 30;
      const bx = Math.max(8, W - tw - 14);
      const by = H - 26;
      let s = 1; for (const f of view.fx) if (f.type === "stamp" && now >= f.at) s = 1 + 0.22 * (1 - easeOut((now - f.at) / f.dur));
      ctx.save(); ctx.translate(bx + tw / 2, by); ctx.scale(s, s); ctx.globalAlpha = view.stop;
      const good = model.terminal && model.terminal.stop === "sufficient";
      rr(-tw / 2, -12, tw, 24, 0); ctx.fillStyle = good ? css(mix(T.plot, T.ok, 0.18)) : css(T.stopFill); ctx.fill(); ctx.strokeStyle = good ? css(T.ok) : css(T.stopInk, 0.7); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = good ? css(T.ok) : css(T.stopInk); ctx.beginPath(); ctx.arc(-tw / 2 + 12, 0, 3.4, 0, 6.2832); ctx.fill();
      ctx.textAlign = "left"; ctx.fillText(label, -tw / 2 + 21, 0.5); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // 충분성을 묻는 동안: 물어본 카드들에서 눈금으로 실이 모인다
  function drawThreads(now, z, ox, oy) {
    const pointed = view.hover && view.hover[0] === "#" ? view.hover : document.activeElement === plot && view.focus && view.focus[0] === "#" ? view.focus : null;
    const held = pointed && model.suff.get(Number(pointed.slice(1)));
    const info = held ? { hop: Number(pointed.slice(1)), refs: held.refs } : view.askInfo; const strength = held ? 1 : view.ask;
    if (!info || strength < 0.02) return;
    const c = view.L.cols.find((cc) => cc.hop === info.hop); if (!c) return;
    const gx = gaugeX(c, z, ox); const gy = 21;
    ctx.save(); ctx.lineWidth = 1.4; ctx.strokeStyle = css(T.jev); ctx.setLineDash([3, 4]); ctx.lineDashOffset = playing() ? -(now / 30) % 7 : 0;
    for (const r of info.refs) {
      const v = view.nodes.get(r); if (!v || v.a < 0.1) continue;
      const x = ox + (v.x + M.colW * 0.5) * z; const y = oy + v.y * z;
      ctx.globalAlpha = 0.75 * strength; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x, gy + 18, gx, gy + 9); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 0.9 * strength; ctx.strokeStyle = css(T.jev); ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(ox + (v.x - 2.5) * z, oy + (v.y - 2.5) * z, (M.colW + 5) * z, (M.rowH + 5) * z); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]);
    }
    ctx.restore();
  }

  let raf = 0; let lastFrame = 0;
  function invalidate() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0; const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016; lastFrame = now;
    const active = tick(now, dt); draw(now); frames += 1;
    if (active) invalidate(); else lastFrame = 0;
  }
  let frames = 0; let lastW = 0;
  function resize() {
    const r = plot.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.round(r.width); H = Math.round(r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const colW = W < 680 ? 168 : 196;
    const gap = W < 680 ? 40 : 64;
    const padX = W < 680 ? 16 : 24;
    const changed = colW !== M.colW || gap !== M.gap || padX !== M.padX || W !== lastW; lastW = W;
    if (changed) {
      M.colW = colW; M.gap = gap; M.padX = padX; M.rowH = W < 680 ? 62 : 64; M.pitch = M.rowH + (W < 680 ? 12 : 14); M.lowPitch = M.pitch; M.padTop = W < 680 ? 46 : 50;
      for (const v of view.nodes.values()) v.fit = null;
      sync(performance.now(), false, null);
      if (W > 0 && player.serverDone && player.applied >= player.events.length) {
        fitAll(true);
        return;
      }
    }
    moveCamera(cam.tx, cam.ty, cam.tz, true); invalidate();
  }

  // ------------------------------------------------------------------ 6. 재생기
  // 서버의 시계(사건이 도착하는 때)와 화면의 시계(사건을 보여 주는 때)는 따로 간다.
  // 화면은 사건을 줄 세워 보여 주되, 결과 줄은 done이 도착하는 즉시 채우고 언제든 건너뛸 수 있다.
  const player = { events: [], ts: [], received: 0, applied: 0, frameEnds: [], total: null, playing: false, serverDone: false, clock0: 0, lastApply: 0, timer: 0, arrive: 0, fast: false, source: null, liveStart: 0 };
  const playing = () => player.playing;
  const GAP = { lexical_seed: 340, structure_noul: 210, content_noul: 210, atom_outline: 260, hit_parent: 340, sufficiency_noul: 330, widen: 500, deferred_scan: 420, selection: 400, run_terminal: 0 };
  const gapAfter = (ev) => (!ev ? 0 : ev.event === "run" ? 100 : ev.event === "step_completed" ? GAP[ev.data.step.stage] ?? 200 : 0);
  // 묻는 중인 모습이 최소한 이만큼은 보이게 한다. 동시에 나간 호출은 같은 때 시작하므로 서로 쌓이지 않는다
  const DWELL = { structure_noul: 220, content_noul: 220, sufficiency_noul: 300, hit_parent: 150, atom_outline: 110, deferred_scan: 240 };
  const shownAt = new Map();
  function resetView() { model = createModel(); view.nodes.clear(); view.edges.clear(); view.piles.clear(); view.gauges.clear(); view.fx.length = 0; view.stop = 0; view.ask = 0; view.askInfo = null; view.march = 0; view.hover = null; view.focus = null; ui.expanded.clear(); hidePop(); }
  function applyNext(animate) {
    const ev = player.events[player.applied]; player.applied += 1;
    if (ev.event === "step_started") shownAt.set(ev.data.id, performance.now());
    const delta = applyEvent(model, ev);
    sync(performance.now(), animate, delta);
    if (ev.event === "done" && dashboard) {
      dashboard.syncSearchOutcome(model, sentText, verdictOf);
    }
    if (animate) {
      if (delta.stage === "selection" || ev.event === "done") fitAll(false); else if (delta.stage && delta.stage !== "run_terminal") followHop(delta.stage === "widen" ? Math.max(0, delta.hop - 1) : delta.hop);
    }
    return delta;
  }
  function pump() {
    clearTimeout(player.timer);
    if (!player.playing) return;
    const now = performance.now();
    while (player.applied < player.received) {
      const i = player.applied; const lag = now - (player.clock0 + player.ts[i]);
      // 화면이 서버보다 뒤처질수록, 그리고 서버가 이미 끝났으면 남은 연출을 줄여 따라붙는다
      const factor = player.fast ? 0 : Math.min(player.serverDone && player.liveStart ? 0.5 : 1, lag > 2200 ? 0.35 : lag > 1100 ? 0.6 : 1);
      const ev = player.events[i]; const began = ev.event === "step_completed" ? shownAt.get(ev.data.step.id) : null;
      const due = Math.max(player.clock0 + player.ts[i], player.lastApply + gapAfter(player.events[i - 1]) * factor, began != null ? began + (DWELL[ev.data.step.stage] || 0) * factor : 0);
      if (now + 1 < due && !reduced()) { player.timer = setTimeout(pump, due - now); break; }
      applyNext(true); player.lastApply = performance.now();
    }
    if (player.applied >= player.events.length && player.serverDone) { player.playing = false; player.fast = false; }
    chrome();
  }
  // 사건 하나가 도착했다. 실제 페이지에서는 스트림을 읽는 쪽이 이 함수를 부른다
  function receive(ev) {
    const t = eventTime(ev); if (player.events.length === 0) player.t0 = t;
    player.events.push(ev); player.ts.push(Math.max(player.ts[player.ts.length - 1] || 0, t - player.t0));
    if (ev.event === "step_completed") player.frameEnds.push(player.events.length);
    if (ev.event === "done") { player.frameEnds[player.frameEnds.length - 1] = player.events.length; player.serverDone = true; player.total = player.frameEnds.length; serverDone(ev.data); }
    player.received = player.events.length;
    if (ev.event === "run") tickSummary();
    pump();
  }
  // resume이 참이면 입구에서 끝난 실행을 그 자리에서 이어 간다(더 찾아보기). 입구까지의 사건은 바로 반영하고 다음 홉부터 펼친다
  function startLive(source, instant = false, resume = false) {
    clearTimeout(player.timer); clearTimeout(player.arrive);
    const t0 = eventTime(source[0]);
    const first = resume ? Math.max(1, source.findIndex((e) => e.event === "step_started" && e.data.hop >= 1)) : 0;
    Object.assign(player, { events: [], ts: [], received: 0, applied: 0, frameEnds: [], total: null, playing: false, serverDone: false, fast: false, source, liveStart: performance.now() });
    resetView(); shownAt.clear(); $("more").hidden = true; closeSheet(false);
    if (!resume) { $("tray").replaceChildren(); if ($("dock-pos")) $("dock-pos").textContent = "0 / 0"; if ($("dock-prev")) $("dock-prev").disabled = true; if ($("dock-next")) $("dock-next").disabled = true; moveCamera(-M.padX, -M.padTop, cam.tz, true); }
    let i = 0;
    for (; i < first; i += 1) receive(source[i]);
    while (player.applied < player.received) applyEvent(model, player.events[player.applied++]);
    sync(performance.now(), false, null);
    player.liveStart = performance.now() - (first ? eventTime(source[first - 1]) - t0 : 0); player.clock0 = player.liveStart; player.lastApply = first ? performance.now() : 0;
    player.playing = !instant; setFollow(true);
    $("status").textContent = resume ? "더 찾아보는 중" : "검색을 시작했다";
    const next = () => {
      const now = performance.now();
      while (i < source.length && (instant || reduced() || now - player.liveStart >= eventTime(source[i]) - t0)) { receive(source[i]); i += 1; }
      if (i < source.length) player.arrive = setTimeout(next, Math.max(0, eventTime(source[i]) - t0 - (performance.now() - player.liveStart)));
    };
    next(); if (instant) { seek(player.frameEnds.length, false); fitAll(true); } tickSummary(); chrome();
  }
  const frameOf = (applied) => { let f = 0; while (f < player.frameEnds.length && player.frameEnds[f] <= applied) f += 1; return f; };
  // 단계 f의 끝 상태로 간다. 바로 다음 단계면 효과와 함께, 아니면 빈 상태에서 다시 쌓는다
  function seek(f, animate = true) {
    clearTimeout(player.timer); player.playing = false; player.fast = false;
    const target = f <= 0 ? Math.min(1, player.received) : player.frameEnds[Math.min(f, player.frameEnds.length) - 1];
    if (target > player.applied && frameOf(player.applied) === f - 1 && animate) { while (player.applied < target) applyNext(true); }
    else if (target !== player.applied) {
      const expanded = new Set(ui.expanded); model = createModel(); ui.expanded = expanded; player.applied = 0; let last = null;
      while (player.applied < target) { last = applyEvent(model, player.events[player.applied]); player.applied += 1; }
      view.fx.length = 0; view.march = 0; view.askInfo = model.asking;
      sync(performance.now(), animate, null);
      for (const v of view.nodes.values()) { v.born = Math.min(v.born, performance.now()); v.selAt = 0; }
      if (ui.follow) { if (model.terminal) fitAll(false); else if (model.last) followHop(model.last.hop); }
    }
    if (dashboard && model.nodes.size > 0) {
      dashboard.syncSearchOutcome(model, sentText, verdictOf);
    }
    chrome();
  }
  function seekEvent(index) { seek(0, false); while (player.applied < Math.min(index, player.received)) applyEvent(model, player.events[player.applied++]); sync(performance.now(), false, null); if (model.last) followHop(model.last.hop, true); chrome(); }
  function play() {
    if (player.playing) { player.playing = false; clearTimeout(player.timer); chrome(); return; }
    if (player.serverDone && player.applied >= player.events.length) { seek(0, false); }
    player.playing = true; player.fast = false; player.liveStart = 0; setFollow(true);
    player.clock0 = performance.now() - (player.ts[player.applied] || 0); player.lastApply = performance.now() - 400; shownAt.clear();
    pump();
  }
  // 건너뛰기: 받은 데까지 바로 보여 주고, 남은 사건은 도착하는 대로 기다림 없이 반영한다
  function skip() {
    clearTimeout(player.timer);
    clearTimeout(player.arrive);
    if (player.source) {
      while (player.received < player.source.length) receive(player.source[player.received]);
    }
    const expanded = new Set(ui.expanded);
    while (player.applied < player.received) applyEvent(model, player.events[player.applied++]);
    ui.expanded = expanded; view.askInfo = model.asking;
    sync(performance.now(), false, null);
    player.fast = !player.serverDone; player.playing = !player.serverDone; setFollow(true);
    fitAll(true);
    if (dashboard) {
      dashboard.syncSearchOutcome(model, sentText, verdictOf);
    }
    chrome();
  }

  // ------------------------------------------------------------------ 7. 화면의 나머지
  let dockDragMoved = false;
  function syncDockActive(idx, scrollCard = true) {
    const tray = $("tray");
    const chips = [...tray.querySelectorAll(".rchip")];
    const total = chips.length;
    if (!total) {
      if ($("dock-pos")) $("dock-pos").textContent = "0 / 0";
      if ($("dock-prev")) $("dock-prev").disabled = true;
      if ($("dock-next")) $("dock-next").disabled = true;
      return null;
    }
    const safeIdx = Math.max(0, Math.min(total - 1, idx));
    chips.forEach((c, i) => c.classList.toggle("active", i === safeIdx));
    if ($("dock-pos")) $("dock-pos").textContent = `${safeIdx + 1} / ${total}`;
    if ($("dock-prev")) $("dock-prev").disabled = safeIdx <= 0;
    if ($("dock-next")) $("dock-next").disabled = safeIdx >= total - 1;
    const activeChip = chips[safeIdx];
    if (scrollCard && activeChip && activeChip.parentElement) {
      const li = activeChip.parentElement;
      
      tray.scrollTo({ left: Math.max(0, li.offsetLeft - (tray.clientWidth - li.offsetWidth) / 2), behavior: reduced() ? "instant" : "smooth" });
    }
    return activeChip;
  }

  function stepDock(delta) {
    const tray = $("tray");
    const chips = [...tray.querySelectorAll(".rchip")];
    if (!chips.length) return;
    let cur = chips.findIndex((c) => c.classList.contains("active"));
    if (cur < 0) cur = 0;
    const nextIdx = Math.max(0, Math.min(chips.length - 1, cur + delta));
    const chip = syncDockActive(nextIdx, true);
    if (chip) {
      if (player.applied < player.events.length) skip();
      const n = [...model.nodes.values()].find((x) => x.nodeId === chip.dataset.nodeId);
      if (n) openSheet(n.ref, chip);
    }
  }

  function setupDockInteractions() {
    const tray = $("tray");
    if (!tray || tray.dataset.bound === "1") return;
    tray.dataset.bound = "1";
    let down = false;
    let startX = 0;
    let startScroll = 0;
    listen(tray, "pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      down = true;
      dockDragMoved = false;
      startX = e.clientX;
      startScroll = tray.scrollLeft;
      tray.classList.add("dragging");
    });
    listen(window, "pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 6) dockDragMoved = true;
      if (dockDragMoved) {
        tray.scrollLeft = startScroll - dx;
      }
    });
    const endDrag = () => {
      if (!down) return;
      down = false;
      tray.classList.remove("dragging");
      setTimeout(() => { dockDragMoved = false; }, 40);
    };
    listen(window, "pointerup", endDrag);
    listen(window, "pointercancel", endDrag);

    const prevBtn = $("dock-prev");
    const nextBtn = $("dock-next");
    if (prevBtn) listen(prevBtn, "click", () => stepDock(-1));
    if (nextBtn) listen(nextBtn, "click", () => stepDock(1));
  }
  setupDockInteractions();

  function serverDone(d) {
    const outcome = createModel();
    for (const event of player.events) applyEvent(outcome, event);
    const oldModel = model; model = outcome;
    dashboard.syncSearchOutcome(outcome, sentText, verdictOf);
    const tray = $("tray"); tray.replaceChildren();
    const dashMap = null;
    const candMap = new Map();
    for (const ev of player.events) {
      if (ev.event === "candidates" && ev.data && Array.isArray(ev.data.items)) {
        for (const it of ev.data.items) {
          candMap.set(it.node_id, { ...it, hop: ev.data.hop });
        }
      }
    }
    d.results.forEach((r, i) => {
      const n = [...model.nodes.values()].find((x) => x.nodeId === r.node_id) || candMap.get(r.node_id);
      const dashNode = dashMap ? dashMap.get(r.node_id) : null;
      const kindLabel = ((n && n.type === "structure") || (dashNode && dashNode.type === "structure")) ? "구조" : "지식";
      const hopNum = n && typeof n.hop === "number" ? n.hop : 2;
      const hopLabel = hopNum === 0 ? "입구" : "홉 " + hopNum;
      const pathArr = n && Array.isArray(n.path) && n.path.length > 1 ? n.path.slice(0, -1) : [];
      const summaryStr = (n && n.summary) || (dashNode && dashNode.summary) || "";
      const subText = pathArr.length
        ? (pathArr.join(" › ") + (summaryStr ? " / " + summaryStr : ""))
        : (summaryStr || ("노드 " + String(r.node_id).slice(0, 8)));

      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rchip" + (i === 0 ? " active" : "");
      b.dataset.nodeId = r.node_id;
      b.dataset.index = String(i);
      b.style.setProperty("--i", i);

      const head = document.createElement("span");
      head.className = "rchip-head";
      const badges = document.createElement("span");
      badges.className = "rchip-badges";
      const rank = document.createElement("b");
      rank.textContent = "#" + String(i + 1);
      const kind = document.createElement("span");
      kind.className = "rchip-kind";
      kind.textContent = kindLabel;
      const hop = document.createElement("span");
      hop.className = "rchip-hop";
      hop.textContent = hopLabel;
      badges.append(rank, kind, hop);

      const score = document.createElement("i");
      score.textContent = r.score.toFixed(2);
      head.append(badges, score);

      const title = document.createElement("span");
      title.className = "rchip-title";
      title.textContent = r.title;

      const sub = document.createElement("span");
      sub.className = "rchip-sub";
      sub.textContent = subText;

      b.append(head, title, sub);
      b.setAttribute("aria-label", `${i + 1}번 ${r.title}, ${kindLabel}, ${hopLabel}, 점수 ${r.score.toFixed(2)}`);
      listen(b, "click", (e) => {
        if (dockDragMoved) { e.preventDefault(); return; }
        syncDockActive(i, true);
        if (player.applied < player.events.length) skip();
        const targetNode = [...model.nodes.values()].find((x) => x.nodeId === r.node_id);
        if (targetNode) openSheet(targetNode.ref, b);
      });
      li.append(b);
      tray.append(li);
    });
    if (d.results.length === 0) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = "선정된 카드가 없습니다";
      tray.append(li);
      syncDockActive(0, false);
    } else {
      tray.scrollLeft = 0;
      syncDockActive(0, false);
    }
    const term = { status: d.status, code: d.error ? d.error.code : null, stop: d.stop_reason };
    $("status").textContent = `검색 끝. ${stopLabel(term)}. 카드 ${d.results.length}장 선정.`;
    $("more").hidden = d.stop_reason !== "sufficient";
    tickSummary();
    model = oldModel;
  }
  let summaryTimer = 0;
  function tickSummary() {
    clearTimeout(summaryTimer);
    const run = player.events[0]; if (!run) { $("sum-time").textContent = ""; $("sum-jev").textContent = ""; return; }
    const jev = player.events.filter((e) => e.event === "step_started" && JEV.has(e.data.stage)).length;
    if (player.serverDone) { const done = player.events[player.events.length - 1].data; $("sum-time").textContent = `${((Date.parse(done.completed_at) - Date.parse(run.data.started_at)) / 1000).toFixed(1)}초`; $("sum-jev").textContent = `, Jev ${jev}회`; return; }
    $("sum-time").textContent = `${((performance.now() - player.liveStart) / 1000).toFixed(1)}초`; $("sum-jev").textContent = "";
    summaryTimer = setTimeout(tickSummary, 100);
  }
  function chrome() {
    callbacks.onSummary?.(`홉 ${model.maxHop} · ${$("sum-jev").textContent.replace(/^, /, "")} · ${$("sum-time").textContent}`);
    const f = frameOf(player.applied); const total = player.total;
    $("count").textContent = total ? `${f}/${total}` : String(f);
    $("narr").textContent = narrate(model);
    const scrub = $("scrub"); scrub.max = String(player.frameEnds.length); scrub.value = String(f); scrub.setAttribute("aria-valuetext", `${f}단계 ${narrate(model)}`);
    const pl = $("t-play"); pl.setAttribute("aria-label", player.playing ? "일시정지" : "재생"); pl.title = player.playing ? "일시정지" : "재생";
    $("play-icon").setAttribute("d", player.playing ? "M4 3h3v10H4zM9 3h3v10H9z" : "M5 3l8 5-8 5z");
    $("t-first").disabled = $("t-prev").disabled = f === 0; $("t-next").disabled = $("t-last").disabled = player.applied >= player.received && player.serverDone;
    $("t-skip").disabled = !player.playing; $("t-skip").checked = player.fast;
    $("t-follow").hidden = ui.follow || !player.playing;
    invalidate();
  }

  // 가리킨 후보의 근거. Jev에 실제로 보낸 글은 그 후보를 판정한 호출(call.request.questions)에서 꺼낸다
  function sentText(n, full) {
    if (!n.asked) return null;
    const call = model.calls.get(n.asked.step); const q = call && call.request && call.request.questions && call.request.questions[n.asked.key];
    if (!q) return null;
    const lines = String(q.instructions).split("\n");
    return { text: lines.join("\n"), criteria: full ? q.criteria : null };
  }
  function verdictOf(n) {
    const th = (model.policy && model.policy.structure_threshold) ?? 0.5; const sc = n.score != null ? n.score.toFixed(2) : "";
    if (n.type === "root") return { score: "", word: "루트에서 그물을 넓힘", ok: true };
    if (n.selected) return { score: sc, word: `선정 ${n.rank}`, ok: true };
    if (n.byHit) return { score: "", word: "맞은 카드의 윗구조라 묻지 않고 엶", ok: true };
    if (n.byRoot) return { score: "", word: "최상위라 묻지 않고 엶", ok: true };
    if (n.verdict === "open") return { score: sc, word: `열림 (${th.toFixed(2)} 이상)`, ok: true };
    if (n.verdict === "closed") return { score: sc, word: `닫힘 (${th.toFixed(2)} 미만)`, ok: false };
    if (n.verdict === "hit") return { score: sc, word: model.selThreshold != null ? `맞음, 선정 기준 ${model.selThreshold.toFixed(2)} 미만` : "맞음", ok: true };
    if (n.verdict === "low") return { score: sc, word: model.selThreshold != null && n.score >= 0.3 ? `선정 기준 ${model.selThreshold.toFixed(2)} 미만` : "낮음", ok: false };
    if (n.verdict === "nobody") return { score: "", word: "본문이 없어 묻지 않음", ok: false };
    return { score: "", word: n.judging ? "묻는 중" : "아직 묻지 않음", ok: false };
  }
  function verdictEl(n) {
    const v = verdictOf(n); const p = document.createElement("p"); p.className = "pop-verdict " + (v.ok ? "ok" : "no");
    if (v.score) { const b = document.createElement("b"); b.textContent = v.score; p.append(b); }
    const s = document.createElement("span"); s.textContent = v.word; p.append(s); return p;
  }
  function sentEl(sent, label = true) {
    const pre = document.createElement("div"); pre.className = "sent";
    if (label) { const l = document.createElement("span"); l.className = "sent-label"; l.textContent = "Jev에 보낸 글"; pre.append(l); }
    pre.append(document.createTextNode(sent.text)); return pre;
  }
  const pop = $("pop"); let popTimer = 0;
  function hidePop() { clearTimeout(popTimer); pop.classList.remove("on"); pop.hidden = true; }
  function showPop(key) {
    pop.replaceChildren();
    let box;
    if (key[0] === "#") {
      const hop = Number(key.slice(1)); const sf = model.suff.get(hop); const c = view.L.cols.find((cc) => cc.hop === hop); if (!sf || !c) return hidePop();
      const el = document.createElement("p"); el.className = "pop-verdict " + (sf.ok ? "ok" : "no"); const b = document.createElement("b"); b.textContent = sf.score.toFixed(2); const sp = document.createElement("span"); sp.textContent = sf.ok ? `찾는 것이 있다 (${sf.threshold.toFixed(2)} 이상)` : `아직 없다 (${sf.threshold.toFixed(2)} 미만)`; el.append(b, sp); pop.append(el);
      const call = model.calls.get(sf.step); const q = call && call.request && call.request.questions && call.request.questions.sufficiency_0;
      if (q) pop.append(sentEl({ text: String(q.instructions).split("\n").slice(1).join("\n") }));
      pop.hidden = false;
      const gx = gaugeX(c, cam.z, -cam.x * cam.z); const pw = pop.offsetWidth; const ph = pop.offsetHeight;
      pop.style.left = clamp(gx - 40, 8, Math.max(8, W - pw - 8)) + "px"; pop.style.top = clamp(M.headerH - 6, 6, Math.max(6, H - ph - 6)) + "px";
      requestAnimationFrame(() => pop.classList.add("on")); return;
    }
    if (key[0] === "@") {
      const p = view.piles.get(key.slice(1)); if (!p) return hidePop(); box = { x: p.x, y: p.y, h: p.info.h };
      const el = document.createElement("p"); el.className = "pop-verdict no"; const s = document.createElement("span"); s.textContent = p.info.expanded ? "눌러서 접기" : `접어 둔 후보 ${p.info.count}개, 눌러서 펼치기`; el.append(s); pop.append(el);
    } else {
      const n = model.nodes.get(key); const v = view.nodes.get(key); if (!n || !v) return hidePop(); box = { x: v.x, y: v.y, h: M.rowH };
      pop.append(verdictEl(n));
      if (n.snippet && n.type !== "root") { const m = document.createElement("p"); m.className = "pop-match"; m.textContent = "낱말이 걸린 곳: " + n.snippet; pop.append(m); }
      if (n.again.length) { const m = document.createElement("p"); m.className = "pop-match"; m.textContent = `${hopName(n.again[0])}에서 다시 만남`; pop.append(m); }
      if (view.L.dorm.get(key)) { const m = document.createElement("p"); m.className = "pop-match"; m.textContent = `자식 ${view.L.dorm.get(key)}개는 미뤄 둠. 열 곳이 떨어지면 훑는다`; pop.append(m); }
      const sent = sentText(n, false); if (sent) pop.append(sentEl(sent));
      else if (n.type !== "root") { const t = document.createElement("p"); t.className = "pop-match"; t.textContent = n.path.join(" › "); pop.append(t); }
    }
    pop.hidden = false;
    const z = cam.z; const sx = (box.x - cam.x) * z; const sy = M.headerH + (box.y - cam.y) * z; const pw = pop.offsetWidth; const ph = pop.offsetHeight;
    let left = sx + M.colW * z + 10; if (left + pw > W - 8) left = sx - pw - 10; if (left < 8) left = clamp(sx, 8, Math.max(8, W - pw - 8));
    let top = left > sx - pw - 11 && left < sx + M.colW * z ? sy + box.h * z + 8 : sy - 4; top = clamp(top, 6, Math.max(6, H - ph - 6));
    pop.style.left = left + "px"; pop.style.top = top + "px";
    requestAnimationFrame(() => pop.classList.add("on"));
  }
  function updateHoverKeys() {
    view.hoverKeys.clear(); const key = view.hover || (document.activeElement === plot ? view.focus : null);
    let cur = key && key[0] !== "@" && key[0] !== "#" ? model.nodes.get(key) : null; let guard = 0;
    while (cur && guard < 24) { guard += 1; const up = cur.origin === "hit_parent" ? cur.climbFrom[0] : cur.parent; if (!up) break; view.hoverKeys.add(up + ">" + cur.ref); cur = model.nodes.get(up); }
  }
  function setHover(key) { if (view.hover === key) return; view.hover = key; plot.classList.toggle("pointing", !!key); updateHoverKeys(); clearTimeout(popTimer); if (key) popTimer = setTimeout(() => showPop(key), 90); else if (document.activeElement !== plot || !view.focus) hidePop(); invalidate(); }
  function hit(px, py) {
    if (py < M.headerH - 6) {
      const ox = -cam.x * cam.z;
      for (const c of view.L.cols) { if (!model.suff.has(c.hop)) continue; const gx = gaugeX(c, cam.z, ox); if (px > gx - 62 && px < ox + (c.x + c.w) * cam.z + 8 && py > 4) return "#" + c.hop; }
      return null;
    }
    const wx = px / cam.z + cam.x; const wy = (py - M.headerH) / cam.z + cam.y;
    for (const p of view.piles.values()) if (wx >= p.x && wx <= p.x + M.colW && wy >= p.y - 3 && wy <= p.y + p.info.h + 3) return "@" + p.key;
    for (const v of view.nodes.values()) if (v.a > 0.4 && wx >= v.x && wx <= v.x + M.colW + 6 && wy >= v.y - 4 && wy <= v.y + M.rowH + 4) return v.ref;
    return null;
  }
  function activate(key, opener) {
    if (!key) return;
    if (key[0] === "#") { clearTimeout(popTimer); showPop(key); return; }
    if (key[0] === "@") { const k = key.slice(1); if (ui.expanded.has(k)) ui.expanded.delete(k); else ui.expanded.add(k); hidePop(); setFollow(false); sync(performance.now(), true, null); return; }
    openSheet(key, opener);
  }

  // 원문 자리. 시안에서는 본문 대신 자리만 보여 준다
  const sheet = $("sheet"); let sheetOpener = null; let sheetRef = null;
  const sheetInset = () => (sheet.classList.contains("open") && W >= 720 ? sheet.offsetWidth : 0);
  function openSheet(ref, opener) {
    const n = model.nodes.get(ref); if (!n || n.type === "root") return;
    const chips = [...$("tray").querySelectorAll(".rchip")];
    const index = chips.findIndex(c => c.dataset.nodeId === n.nodeId);
    if (index >= 0) syncDockActive(index, true);
    dashboard.selectFromSearch(n, verdictOf(n).word, sentText(n, true));
    view.focus = ref; setFollow(false); ensureVisible(ref); invalidate();
  }
  function closeSheet(restore = true) {
    if (sheet.hidden) return; sheet.classList.remove("open"); sheetRef = null;
    setTimeout(() => { if (!sheet.classList.contains("open")) sheet.hidden = true; }, reduced() ? 140 : 400);
    if (restore && sheetOpener && sheetOpener.isConnected) sheetOpener.focus({ preventScroll: true });
  }
  function ensureVisible(key) {
    const v = key[0] === "@" ? view.piles.get(key.slice(1)) : view.nodes.get(key); if (!v) return;
    const t = v.t || { x: v.tx, y: v.ty }; const z = cam.tz; const vw = (W - sheetInset()) / z; const vh = (H - M.headerH) / z; let x = cam.tx; let y = cam.ty;
    if (t.x + M.colW + 16 > x + vw) x = t.x + M.colW + 16 - vw; if (t.x - 16 < x) x = t.x - 16;
    if (t.y + M.rowH + 30 > y + vh) y = t.y + M.rowH + 30 - vh; if (t.y - 10 < y) y = t.y - 10;
    if (x !== cam.tx || y !== cam.ty) { const b = bounds(z); cam.tx = clamp(x, b.minX, b.maxX + sheetInset() / z); cam.ty = clamp(y, b.minY, b.maxY); if (reduced()) { cam.x = cam.tx; cam.y = cam.ty; } else cam.mode = "spring"; invalidate(); }
  }

  // 포인터: 끌어서 옮기기(손을 1:1로 따라가고, 놓으면 속도를 이어받아 미끄러진다), 두 손가락 확대
  const pointers = new Map(); let drag = null; let pinch = null;
  const local = (e) => { const r = plot.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  listen(plot, "pointerdown", (e) => {
    if (e.target !== cv && e.target !== plot) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    plot.setPointerCapture(e.pointerId); const p = local(e); pointers.set(e.pointerId, p);
    if (pointers.size === 1) { drag = { id: e.pointerId, sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false, hist: [{ t: e.timeStamp, x: p.x, y: p.y }] }; }
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z }; drag = null; }
  });
  listen(plot, "pointermove", (e) => {
    const p = local(e);
    if (e.target !== cv && e.target !== plot && !drag && !pinch) { setHover(null); return; }
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]; const z = clamp(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), 0.4, 1.6); const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      const wx = mx / cam.z + cam.x; const wy = (my - M.headerH) / cam.z + cam.y; cam.z = cam.tz = z; cam.x = cam.tx = wx - mx / z; cam.y = cam.ty = wy - (my - M.headerH) / z; cam.mode = "idle"; setFollow(false); updateZoomLabel(); invalidate(); return;
    }
    if (drag && drag.id === e.pointerId) {
      const dx = p.x - drag.sx; const dy = p.y - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; plot.classList.add("dragging"); setFollow(false); setHover(null); hidePop(); cam.mode = "drag"; }
      if (drag.moved) {
        const b = bounds(); let x = drag.cx - dx / cam.z; let y = drag.cy - dy / cam.z;
        if (x < b.minX) x = b.minX - rubber(b.minX - x, b.vw); else if (x > b.maxX) x = b.maxX + rubber(x - b.maxX, b.vw);
        if (y < b.minY) y = b.minY - rubber(b.minY - y, b.vh); else if (y > b.maxY) y = b.maxY + rubber(y - b.maxY, b.vh);
        cam.x = cam.tx = x; cam.y = cam.ty = y; drag.hist.push({ t: e.timeStamp, x: p.x, y: p.y }); while (drag.hist.length > 2 && e.timeStamp - drag.hist[0].t > 90) drag.hist.shift(); invalidate();
      }
      return;
    }
    if (e.pointerType === "mouse") setHover(hit(p.x, p.y));
  });
  const endPointer = (e) => {
    const p = local(e); pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; plot.classList.remove("dragging");
    if (!d.moved) { if (e.type === "pointerup") { const key = hit(p.x, p.y); if (key) activate(key, plot); else { hidePop(); } } return; }
    const h = d.hist; const first = h[0]; const last = h[h.length - 1]; const dt = Math.max(1, last.t - first.t) / 1000;
    cam.vx = reduced() ? 0 : -(last.x - first.x) / dt / cam.z; cam.vy = reduced() ? 0 : -(last.y - first.y) / dt / cam.z; cam.mode = "glide"; invalidate();
  };
  listen(plot, "pointerup", endPointer); listen(plot, "pointercancel", endPointer);
  listen(plot, "pointerleave", (e) => { if (e.pointerType === "mouse" && !drag) setHover(null); });
  listen(plot, "wheel", (e) => {
    if (e.target !== cv && e.target !== plot) return;
    const p = local(e);
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const z = clamp(cam.z * Math.exp(-e.deltaY * 0.012), 0.4, 1.6); const wx = p.x / cam.z + cam.x; const wy = (p.y - M.headerH) / cam.z + cam.y; cam.z = cam.tz = z; cam.x = cam.tx = wx - p.x / z; cam.y = cam.ty = wy - (p.y - M.headerH) / z; cam.mode = "idle"; setFollow(false); updateZoomLabel(); invalidate(); return; }
    const b = bounds(); const nx = clamp(cam.x + e.deltaX / cam.z, b.minX, b.maxX); const ny = clamp(cam.y + e.deltaY / cam.z, b.minY, b.maxY);
    if (Math.abs(nx - cam.x) < 0.5 && Math.abs(ny - cam.y) < 0.5) return;
    e.preventDefault(); cam.x = cam.tx = nx; cam.y = cam.ty = ny; cam.mode = "idle"; setFollow(false); hidePop(); invalidate();
  }, { passive: false });

  // 키보드: 화살표로 후보 사이를 옮긴다
  function columnItems(hop) {
    const out = [];
    for (const n of model.nodes.values()) if (n.hop === hop && !view.L.hidden.has(n.ref)) { const p = view.L.pos.get(n.ref); if (p) out.push({ key: n.ref, y: p.y }); }
    for (const p of view.L.piles.values()) if (p.hop === hop) out.push({ key: "@" + p.key, y: p.y });
    if (model.suff.has(hop)) out.push({ key: "#" + hop, y: -100 });
    return out.sort((a, b) => a.y - b.y);
  }
  function focusKey(key) {
    if (!key) return; view.focus = key; if (key[0] !== "#") ensureVisible(key); updateHoverKeys(); clearTimeout(popTimer); popTimer = setTimeout(() => showPop(key), 200);
    let say;
    if (key[0] === "#") { const sf = model.suff.get(Number(key.slice(1))); say = sf ? `${hopName(Number(key.slice(1)))}까지 찾은 정도 ${sf.score.toFixed(2)}, ${sf.ok ? "찾는 것이 있다" : "아직 없다"}` : ""; }
    else if (key[0] === "@") { const p = view.L.piles.get(key.slice(1)); say = p ? `접어 둔 후보 ${p.count}개` : ""; }
    else { const n = model.nodes.get(key); const v = verdictOf(n); say = `${n.title}, ${n.type === "structure" ? "구조" : n.type === "root" ? "루트" : "지식"}, ${hopName(n.hop)}, ${v.score} ${v.word}`; }
    $("graph-live").textContent = say; invalidate();
  }
  listen(plot, "keydown", (e) => {
    if (e.target !== plot) return;
    const k = e.key;
    if (k === "+" || k === "=") { zoomTo(cam.tz * 1.25); e.preventDefault(); return; }
    if (k === "-") { zoomTo(cam.tz / 1.25); e.preventDefault(); return; }
    if (k === "0") { fitAll(); e.preventDefault(); return; }
    if (k === "Escape") { hidePop(); return; }
    if ((k === "Enter" || k === " ") && view.focus) { e.preventDefault(); activate(view.focus, plot); return; }
    if (!k.startsWith("Arrow")) return;
    e.preventDefault(); setFollow(false);
    const cur = view.focus && (view.focus[0] === "#" ? { hop: Number(view.focus.slice(1)), ref: view.focus, parent: null, climbFrom: [] } : view.focus[0] === "@" ? view.L.piles.get(view.focus.slice(1)) : model.nodes.get(view.focus));
    if (!cur) { const first = columnItems(0)[0]; return focusKey(first && first.key); }
    const hop = cur.hop; const items = columnItems(hop); const i = items.findIndex((it) => it.key === view.focus);
    if (k === "ArrowDown") return focusKey((items[i + 1] || items[i]).key);
    if (k === "ArrowUp") return focusKey((items[i - 1] || items[i]).key);
    const y = items[i] ? items[i].y : 0; let target = null;
    if (k === "ArrowLeft") { const up = cur.origin === "hit_parent" ? cur.climbFrom && cur.climbFrom[0] : cur.parent; if (up && !view.L.hidden.has(up) && model.nodes.has(up)) target = up; }
    else if (view.focus[0] !== "@" && view.focus[0] !== "#") { const kids = [...model.nodes.values()].filter((n) => (n.parent === cur.ref || n.climbFrom.includes(cur.ref)) && view.L.pos.has(n.ref)).sort((a, b) => view.L.pos.get(a.ref).y - view.L.pos.get(b.ref).y); if (kids.length) target = kids[0].ref; }
    if (!target) { const near = columnItems(hop + (k === "ArrowLeft" ? -1 : 1)).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0]; target = near && near.key; }
    focusKey(target);
  });
  listen(plot, "focus", () => { if (plot.matches(":focus-visible") && !view.focus) { const first = columnItems(0)[0]; if (first) focusKey(first.key); } updateHoverKeys(); invalidate(); });
  listen(plot, "blur", () => { hidePop(); updateHoverKeys(); invalidate(); });
  listen(document, "keydown", (e) => { if (e.key === "Escape" && !sheet.hidden && sheet.classList.contains("open")) closeSheet(); });

  // 단추
  listen($("t-play"), "click", play);
  listen($("t-first"), "click", () => seek(0));
  listen($("t-prev"), "click", () => seek(frameOf(player.applied) - (player.frameEnds[frameOf(player.applied) - 1] === player.applied ? 1 : 0)));
  listen($("t-next"), "click", () => seek(frameOf(player.applied) + 1));
  listen($("t-last"), "click", () => { if (player.serverDone) seek(player.frameEnds.length, false); else skip(); });
  listen($("t-skip"), "change", e => { if (e.target.checked) skip(); else { player.fast = false; pump(); } });
  listen($("scrub"), "input", (e) => seek(Number(e.target.value)));
  listen($("t-low"), "change", (e) => { ui.showLow = e.target.checked; sync(performance.now(), true, null); });
  listen($("t-zin"), "click", () => zoomTo(cam.tz * 1.25));
  listen($("t-zout"), "click", () => zoomTo(cam.tz / 1.25));
  listen($("t-fit"), "click", fitAll);
  listen($("t-follow"), "click", () => { setFollow(true); if (model.last) followHop(model.last.hop); });
  listen($("sheet-close"), "click", () => closeSheet());
  listen($("more"), "click", () => callbacks.onMore(lastQuery || samples[current][0].data.query));

  // ------------------------------------------------------------------ 8. 시안의 표본
  let current = null;
  function choose(name, autoplay = true) {
    callbacks.onCancel(); live = false; current = name; callbacks.onResults([]);
    for (const b of root.querySelectorAll(".seg button")) { const on = b.dataset.run === name; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
    $("query-title").textContent = "“" + samples[name][0].data.query + "”";
    startLive(samples[name], true);
    if (autoplay && !reduced()) {
      player.ts = player.ts.map((_, i) => i * 120);
      seek(0, false); play();
    }
  }
  const seg = root.querySelector(".seg");
  listen(seg, "click", (e) => { const b = e.target.closest("button"); if (b) choose(b.dataset.run); });
  listen(seg, "keydown", (e) => {
    if (!e.key.startsWith("Arrow")) return; e.preventDefault();
    const list = [...seg.querySelectorAll("button")]; const i = list.findIndex((b) => b.dataset.run === current); const next = list[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
    next.focus(); choose(next.dataset.run);
  });
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(plot); cleanup.push(() => resizeObserver.disconnect());
  const themeObserver = new MutationObserver(() => { readTokens(); invalidate(); }); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); cleanup.push(() => themeObserver.disconnect());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readTokens(); invalidate(); });
  readTokens(); resize();
  const refit = () => { for (const v of view.nodes.values()) v.fit = null; invalidate(); };
  if (document.fonts) { listen(document.fonts, "loadingdone", refit); const all = Object.values(samples).flat().flatMap((e) => (e.event === "step_completed" ? e.data.candidates.map((c) => c.title) : [])).join("") + "입구홉충분성루트윗구조접기더열곳없음호출시간후보상한0123456789.+"; Promise.all([document.fonts.load(font(650, 14), all), document.fonts.load(font(500, 14), all)]).then(refit, () => {}); }

  const first = "atom";
  const auto = params.get("auto") !== "0" && !reduced();
  choose(first, auto);
  if (params.has("event")) seekEvent(Number(params.get("event")));
  else if (params.has("frame")) seek(Number(params.get("frame")), false);
  return {
    begin(query) {
      live = true; lastQuery = query;
      clearTimeout(player.timer); clearTimeout(player.arrive); clearTimeout(summaryTimer);
      Object.assign(player, { events: [], ts: [], received: 0, applied: 0, frameEnds: [], total: null, playing: true, serverDone: false, fast: false, source: null, liveStart: performance.now(), lastApply: 0 });
      player.clock0 = player.liveStart; resetView(); shownAt.clear(); callbacks.onResults([]);
      $("tray").replaceChildren(); syncDockActive(0, false); $("more").hidden = true;
      $("query-title").textContent = "“" + query + "”";
      root.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-checked', 'false'));
      setFollow(true); sync(performance.now(), false, null); tickSummary(); chrome();
    },
    receive,
    error(message) { player.playing = false; clearTimeout(player.timer); clearTimeout(summaryTimer); $("status").textContent = message; chrome(); },
    dispose() { disposed = true; cleanup.forEach(fn => fn()); timers.forEach(id => window.clearTimeout(id)); animationFrames.forEach(id => window.cancelAnimationFrame(id)); }
  };
}
