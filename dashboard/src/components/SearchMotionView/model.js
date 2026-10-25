// Production Jev event reducer, shared with the approved motion view. No DOM/network.
const ROOT = "__root__";
  function createModel() {
    return { run: null, policy: null, hit: 0.5, nodes: new Map(), order: [], inflight: new Map(), calls: new Map(), steps: 0, suff: new Map(), asking: null, widen: null, terminal: null, done: null, maxHop: 0, last: null, selThreshold: null };
  }
  function mkNode(o) {
    return Object.assign({ ref: "", nodeId: null, type: "knowledge", title: "", path: [], summary: null, hop: 0, origin: "outline", parent: null, climbFrom: [], score: null, verdict: "pending", byHit: false, selected: false, rank: 0, judging: null, reading: 0, climbing: false, asked: null, snippet: null, again: [], order: 0, childCount: null, physicalParent: null, cardId: null, deferred: false, dormant: false }, o);
  }
  // 사건 하나를 모델에 반영하고, 연출에 쓸 변화 목록을 돌려준다
  function applyEvent(m, ev) {
    const d = ev.data;
    const delta = { event: ev.event, stage: null, hop: 0, added: [], scored: [], opened: [], again: [], selected: [], suff: null };
    if (ev.event === "run") { m.run = d; m.policy = d.policy || {}; m.hit = m.policy.structure_threshold ?? 0.5; return delta; }
    if (ev.event === "step_started") {
      delta.stage = d.stage; delta.hop = d.hop;
      m.inflight.set(d.id, { id: d.id, seq: d.seq, stage: d.stage, hop: d.hop, refs: d.candidate_refs });
      if (d.stage === "structure_noul" || d.stage === "content_noul") for (const r of d.candidate_refs) { const n = m.nodes.get(r); if (n) n.judging = d.id; }
      else if (d.stage === "atom_outline") { const n = m.nodes.get(d.candidate_refs[0] ?? ROOT); if (n) n.reading += 1; }
      else if (d.stage === "hit_parent") for (const r of d.candidate_refs) { const n = m.nodes.get(r); if (n) n.climbing = true; }
      else if (d.stage === "sufficiency_noul") m.asking = { step: d.id, hop: d.hop, refs: d.candidate_refs };
      else if (d.stage === "deferred_scan") { const n = m.nodes.get(d.candidate_refs[0]); if (n) n.reading += 1; }
      m.last = { stage: d.stage, hop: d.hop };
      return delta;
    }
    if (ev.event === "step_completed") {
      const s = d.step; delta.stage = s.stage; delta.hop = s.hop;
      m.inflight.delete(s.id); m.steps += 1;
      if (s.stage !== "selection" && s.stage !== "run_terminal") m.maxHop = Math.max(m.maxHop, s.hop);
      if (d.call) m.calls.set(s.id, d.call);
      if (s.stage === "atom_outline") { const n = m.nodes.get(s.parent_ref ?? ROOT); if (n) n.reading = Math.max(0, n.reading - 1); }
      if (s.stage === "widen") {
        m.widen = { hop: s.hop, reason: s.widen_reason };
        if (!m.nodes.has(ROOT)) { m.nodes.set(ROOT, mkNode({ ref: ROOT, type: "root", title: "루트", hop: Math.max(0, s.hop - 1), verdict: "open", origin: "root" })); delta.added.push(ROOT); }
      }
      const alias = new Set();
      for (const dec of s.decisions) if (dec.action === "alias") alias.add(dec.ref);
      if (s.stage === "deferred_scan") {
        const parentRef = s.parent_ref; const parent = m.nodes.get(parentRef);
        if (parent) { parent.reading = Math.max(0, parent.reading - 1); parent.deferred = false; }
        delta.scan = parentRef;
      }
      const hits = s.stage === "hit_parent" ? s.candidate_refs.filter((r) => m.nodes.has(r)) : [];
      for (const r of hits) m.nodes.get(r).climbing = false;
      for (const c of d.candidates) {
        if (alias.has(c.ref)) continue;
        const parent = c.origin === "outline" ? (c.traversal_parent_ref ?? (m.nodes.has(ROOT) ? ROOT : null)) : c.origin === "hit_parent" ? (c.hit_ref ?? hits[0] ?? null) : null;
        const n = mkNode({ ref: c.ref, nodeId: c.node_id, type: c.card_type, title: c.title, path: c.path, summary: c.summary, hop: c.hop, origin: c.origin, parent, climbFrom: c.origin === "hit_parent" ? (hits.length ? hits : [c.hit_ref].filter(Boolean)) : [], snippet: c.match_snippet ?? null, order: m.order.length, childCount: c.child_count, physicalParent: c.physical_parent_node_id, cardId: c.card_id });
        m.nodes.set(n.ref, n); m.order.push(n.ref); m.maxHop = Math.max(m.maxHop, n.hop); delta.added.push(n.ref);
      }
      for (const dec of s.decisions) {
        if (dec.action === "alias") { const first = m.nodes.get(dec.reused_from_ref); if (first) { first.again.push(s.hop); delta.again.push(first.ref); } continue; }
        const n = m.nodes.get(dec.ref); if (!n) continue;
        if (dec.action === "no_body") n.verdict = "nobody";
        else if (dec.action === "opened_by_hit" || dec.action === "opened_root") { n.score = null; n.verdict = "open"; n.byHit = dec.action === "opened_by_hit"; n.byRoot = dec.action === "opened_root"; delta.opened.push(n.ref); }
        else if (dec.action === "queued" || dec.action === "pruned" || dec.action === "content_scored") {
          n.score = dec.score; n.judging = null; n.asked = { step: s.id, key: dec.question_key };
          n.verdict = dec.action === "queued" ? "open" : dec.action === "pruned" ? "closed" : dec.score >= m.hit ? "hit" : "low";
          delta.scored.push(n.ref); if (n.verdict === "open") delta.opened.push(n.ref);
        }
      }
      for (const ref of s.deferred_refs || []) { const n = m.nodes.get(ref); if (n) n.deferred = true; }
      for (const n of m.nodes.values()) if (n.byHit) {
        n.climbFrom = [...m.nodes.values()].filter((hit) => hit.type === "knowledge" && hit.score >= m.hit && hit.physicalParent === n.nodeId).map((hit) => hit.ref);
      }
      if (s.stage === "sufficiency_noul") {
        const threshold = s.sufficiency_threshold ?? m.policy.sufficiency_threshold ?? 0.7;
        if (typeof s.sufficiency_score === "number") {
          m.suff.set(s.hop, { score: s.sufficiency_score, threshold, ok: s.sufficiency_score >= threshold, refs: s.candidate_refs, step: s.id });
          delta.suff = s.hop;
        }
        m.asking = null;
      }
      if (s.stage === "selection") {
        m.selThreshold = s.selection_threshold ?? null;
        (s.selected_refs || []).forEach((r, i) => { const n = m.nodes.get(r); if (n) { n.selected = true; n.rank = i + 1; delta.selected.push(r); } });
      }
      if (s.stage === "run_terminal") m.terminal = { status: s.terminal_status, code: s.terminal_code ?? null, stop: s.stop_reason ?? null };
      m.last = { stage: s.stage, hop: s.hop };
      return delta;
    }
    if (ev.event === "done") {
      m.done = d;
      m.terminal = { status: d.status, code: d.error ? d.error.code : null, stop: d.stop_reason ?? null };
      let any = false; for (const n of m.nodes.values()) if (n.selected) { any = true; break; }
      if (!any) (d.results || []).forEach((r, i) => { for (const n of m.nodes.values()) if (n.nodeId === r.node_id) { n.selected = true; n.rank = i + 1; delta.selected.push(n.ref); } });
    }
    return delta;
  }
  // 완성 응답(stream 없이 받은 JSON)을 같은 사건 줄로 바꾼다. 순서는 끝난 시각, 같으면 seq
  function eventsFromResponse(res) {
    const byStep = new Map(); for (const c of res.trace.candidates) { if (!byStep.has(c.discovered_in_step_id)) byStep.set(c.discovered_in_step_id, []); byStep.get(c.discovered_in_step_id).push(c); }
    const calls = new Map(res.trace.calls.map((c) => [c.call_id, c]));
    const out = [{ at: Date.parse(res.started_at), k: 0, seq: 0, event: "run", data: res }];
    for (const s of res.trace.steps) {
      out.push({ at: Date.parse(s.started_at), k: 1, seq: s.seq, event: "step_started", data: { id: s.id, seq: s.seq, hop: s.hop, stage: s.stage, started_at: s.started_at, candidate_refs: s.candidate_refs } });
      out.push({ at: Date.parse(s.completed_at ?? s.started_at), k: 2, seq: s.seq, event: "step_completed", data: { step: s, candidates: byStep.get(s.id) || [], call: calls.get(s.call_id) || null } });
    }
    out.sort((a, b) => a.at - b.at || a.seq - b.seq || a.k - b.k);
    out.push({ event: "done", data: res });
    return out.map(({ event, data }) => ({ event, data }));
  }

export { createModel, applyEvent, eventsFromResponse };
