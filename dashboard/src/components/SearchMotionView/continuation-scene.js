import { applyEvent } from './model.js';

// Project the segment's current step onto the existing display identities. The
// exhaustive run has its own refs; repeated cards keep their original positions.
export function presentContinuation(scene, segment, frame, active) {
  const completed = frame.events.findLast(event => event.event === 'step_completed');
  if (!completed) return;
  const step = completed.data.step;
  scene.last = { stage: step.stage, hop: step.hop };
  scene.terminal = segment.terminal;
  scene.inflight = new Map();
  scene.asking = null;
  if (!active || step.stage === 'run_terminal') return;
  if (step.stage === 'selection') {
    scene.continuationStep = { stage: step.stage, hop: Math.min(step.hop, scene.maxHop), refs: [] };
    return;
  }
  const byCard = new Map(); const byNode = new Map();
  for (const node of scene.nodes.values()) {
    if (node.cardId) byCard.set(node.cardId, node.ref);
    if (node.nodeId) byNode.set(node.nodeId, node.ref);
  }
  const displayRef = ref => {
    const node = segment.nodes.get(ref);
    return (node?.cardId && byCard.get(node.cardId)) || (node?.nodeId && byNode.get(node.nodeId))
      || (ref === '__root__' && scene.nodes.has(ref) ? ref : null);
  };
  const started = frame.events.find(event => event.event === 'step_started' && event.data.id === step.id);
  let refs = (started?.data.candidate_refs ?? step.candidate_refs).map(displayRef).filter(Boolean);
  if (step.stage === 'atom_outline' || step.stage === 'deferred_scan') {
    const parent = displayRef(step.parent_ref ?? '__root__') || byNode.get(step.canonical_node_id);
    refs = parent ? [parent] : refs;
  }
  const hop = Math.min(step.hop, scene.maxHop);
  for (const ref of refs) scene.nodes.set(ref, { ...scene.nodes.get(ref) });
  applyEvent(scene, { event: 'step_started', data: { id: `${frame.segmentId}:${step.id}`, seq: step.seq,
    stage: step.stage, hop, candidate_refs: refs } });
  if (['structure_noul', 'content_noul', 'sufficiency_noul'].includes(step.stage)) {
    for (const ref of refs) {
      scene.nodes.get(ref).judging = `${frame.segmentId}:${step.id}`;
    }
    const call = scene.inflight.get(`${frame.segmentId}:${step.id}`);
    for (const targetHop of new Set(refs.map(ref => scene.nodes.get(ref).hop))) {
      scene.inflight.set(`${call.id}:${targetHop}`, { ...call, hop: targetHop });
    }
    if (refs.length) scene.inflight.delete(call.id);
  }
  // The narration and newly found cards stay on their actual search hops.
  scene.last = { stage: step.stage, hop: step.hop };
  scene.continuationStep = { stage: step.stage, hop, refs };
}
