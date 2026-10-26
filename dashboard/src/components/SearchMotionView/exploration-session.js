import { createModel, applyEvent } from './model.js';
import { createExplorationModel, applyExplorationEvent, projectExploration } from './exploration-model.js';
import { buildExplorationTimeline, groupExplorationChapters } from './exploration-timeline.js';

const hopLabel = hop => hop === 0 ? '입구' : `홉 ${hop}`;
const blankNode = () => ({ parent: null, climbFrom: [], reading: 0, climbing: false, byHit: false, again: [], dormant: false });

function initialCards(scene, label) {
  return [...scene.nodes.values()].filter(n => n.cardId).map(n => {
    const call = n.asked && scene.calls.get(n.asked.step);
    const content = call?.stage === 'content_noul';
    return {
      card_id: n.cardId, node_id: n.nodeId, card_type: n.type,
      title: n.title, path: n.path, score: n.score, selected: n.selected, rank: n.rank,
      display_column_id: `initial:${n.hop}`, column_label: label ?? hopLabel(n.hop),
      renderNode: { ...n, climbFrom: [...n.climbFrom] },
      ...(content && n.score != null ? { initial_evaluation: { score: n.score, call_id: call.call_id, question_key: n.asked.key } } : {}),
    };
  });
}

function mergeSearch(exploration, segment, id, label, scene) {
  let column = exploration.columns.find(c => c.id === id);
  if (!column) { column = { id, label, cardIds: [], referenceIds: [] }; exploration.columns.push(column); }
  for (const input of initialCards(segment, label)) {
    const existing = exploration.cards.get(input.card_id);
    if (existing && existing.displayColumnId !== id) continue;
    const card = { ...input, cardId: input.card_id, nodeId: input.node_id, cardType: input.card_type,
      displayColumnId: id, columnLabel: label, discoveryOrder: existing?.discoveryOrder ?? exploration.nextDiscoveryOrder++, initialScore: input.score };
    // Continuations have their own namespace. Their original topology stays in the segment trace.
    card.renderNode = { ...input.renderNode, ref: `${id}:${input.renderNode.ref}`, parent: null, climbFrom: [], hop: scene.maxHop + 1,
      asked: input.renderNode.asked ? { ...input.renderNode.asked, step: `${id}:${input.renderNode.asked.step}` } : null };
    exploration.cards.set(card.cardId, card);
    if (!existing) { exploration.cardOrder.push(card.cardId); column.cardIds.push(card.cardId); }
    if (input.initial_evaluation) exploration.evaluationCache.set(card.cardId, {
      score: input.initial_evaluation.score, callId: input.initial_evaluation.call_id,
      questionKey: input.initial_evaluation.question_key, origin: 'initial_content', operationId: null,
    });
  }
  const results = [...segment.nodes.values()].filter(n => n.selected).sort((a, b) => a.rank - b.rank);
  for (const n of results) if (exploration.cards.get(n.cardId)?.displayColumnId === id && n.score >= exploration.selectionThreshold && !exploration.resultOrder.includes(n.cardId)) exploration.resultOrder.push(n.cardId);
  for (const [step, call] of segment.calls) scene.calls.set(`${id}:${step}`, call);
}

function materialize(scene, exploration) {
  const projection = projectExploration(exploration);
  const refs = new Map(projection.cards.map(c => [c.cardId, c.renderNode?.ref ?? `card:${c.cardId}`]));
  const columns = new Map();
  let nextHop = scene.maxHop + 1;
  for (const column of projection.columns.slice(1)) {
    if (column.cardIds.length + column.referenceIds.length === 0) continue;
    const operation = projection.operations.find(op => op.id === column.id);
    const source = projection.cards.find(card => card.cardId === operation?.fromCardId);
    const sourceHop = source && columns.get(source.displayColumnId);
    const hop = operation?.fromCardId ? (sourceHop == null ? scene.maxHop + 1 : sourceHop + 1) : nextHop;
    columns.set(column.id, hop);
    nextHop = Math.max(nextHop, hop + 1);
  }
  scene.columnLabels = new Map();
  for (const card of projection.cards) {
    const original = card.renderNode;
    const ref = refs.get(card.cardId);
    const operation = projection.operations.find(op => op.id === card.displayColumnId);
    const hop = columns.get(card.displayColumnId) ?? original?.hop ?? 0;
    const node = { ...blankNode(), ...original, ref, cardId: card.cardId, nodeId: card.nodeId, type: card.cardType,
      title: card.title, summary: original?.summary ?? card.excerpt ?? null,
      path: original?.path ?? [...(card.path ?? []).map(p => typeof p === 'string' ? p : p.title), card.title],
      hop, origin: original?.origin ?? 'expansion', order: card.discoveryOrder,
      displayColumn: card.displayColumnId, columnLabel: card.columnLabel,
      similarity: card.similarity, sameBranch: card.tree_relation?.same_top_level_branch ?? false,
      fromRef: operation?.fromCardId ? refs.get(operation.fromCardId) : null,
      selected: card.selected, rank: card.rank ?? 0, score: card.score,
      verdict: original?.verdict ?? (card.score == null ? 'pending' : card.score >= exploration.selectionThreshold ? 'hit' : 'low'),
      evaluation: card.evaluation,
      layoutScore: original?.score,
    };
    const active = !projection.evaluations.has(card.cardId) && projection.operations.find(op => op.status === 'running' && (op.requestedCardIds.includes(card.cardId) || (op.fromCardId === null && op.resultCardIds.includes(card.cardId))));
    node.judging = active?.id ?? original?.judging ?? null;
    if (card.evaluation?.operationId) {
      const op = projection.operations.find(op => op.id === card.evaluation.operationId);
      const call = op?.auditCalls.find(call => call.call_id === card.evaluation.callId);
      if (call) { scene.calls.set(call.call_id, call); node.asked = { step: call.call_id, key: card.evaluation.questionKey }; }
    }
    scene.nodes.set(ref, node);
    if (!scene.order.includes(ref)) scene.order.push(ref);
    if (columns.has(card.displayColumnId)) scene.columnLabels.set(hop, card.columnLabel);
  }
  for (const row of projection.references) {
    const targetRef = refs.get(row.toCardId); const target = scene.nodes.get(targetRef);
    if (!target) continue;
    const hop = columns.get(row.columnId);
    const ref = row.id;
    scene.nodes.set(ref, { ...target, ...blankNode(), ref, cardId: null, origin: 'reference',
      referenceTarget: targetRef, hop, fromRef: refs.get(row.fromCardId), similarity: row.similarity,
      displayColumn: row.columnId, sameBranch: row.tree_relation?.same_top_level_branch ?? false,
      arrivalOperationId: row.operationId,
      selected: false, rank: target.rank, columnLabel: row.label, order: scene.order.length });
    scene.order.push(ref); scene.columnLabels.set(hop, row.label);
  }
  scene.maxHop = Math.max(scene.maxHop, nextHop - 1);
  scene.exploration = projection;
  return { scene, projection };
}

// This log is the sole source for both the scene and operation snapshots. No requests or timers.
export function createExplorationSession() {
  let entries = []; let query = ''; let revision = 0; let serial = 0;
  let selections = [];
  // Keep one folded prefix. Forward playback only reduces the newly visible frames;
  // rewinds and edits rebuild from the event log, which remains the source of truth.
  let folded = null;
  function timeline() {
    const frames = []; const operations = [];
    for (const entry of entries) {
      if (entry.type === 'search') {
        let start = 0;
        entry.events.forEach((event, index) => {
          if (event.event === 'step_completed') {
            frames.push({ id: `${entry.id}:${index}`, segmentId: entry.id, events: entry.events.slice(start, index + 1), entry });
            start = index + 1;
          } else if (event.event === 'done') {
            const last = frames.at(-1);
            if (last?.segmentId === entry.id) last.events.push(...entry.events.slice(start, index + 1));
            else frames.push({ id: `${entry.id}:done`, segmentId: entry.id, events: entry.events.slice(start, index + 1), entry });
          }
        });
      } else {
        const opTimeline = buildExplorationTimeline([], entry.events);
        frames.push(...opTimeline.frames.map(frame => ({ ...frame, entry })));
        operations.push(...opTimeline.operations);
      }
    }
    return { frames, operations, operationEvents: entries.flatMap(e => e.type === 'operation' ? e.events : []) };
  }
  function project(cursor, evaluating = false) {
    const frames = timeline().frames.slice(0, cursor);
    const previous = folded && frames[folded.cursor - 1];
    if (!folded || evaluating || folded.evaluating || frames.length < folded.cursor
      || (folded.cursor && (previous?.id !== folded.frameId || previous.events.length !== folded.eventCount))) {
      folded = { scene: createModel(), exploration: null, searchModels: new Map(), cursor: 0 };
    }
    let { scene, exploration, searchModels } = folded;
    for (const frame of frames.slice(folded.cursor)) {
      if (frame.entry.type === 'search') {
        const segment = searchModels.get(frame.segmentId) ?? createModel();
        for (const event of frame.events) applyEvent(segment, event);
        searchModels.set(frame.segmentId, segment);
        if (frame.entry === entries[0]) {
          scene = segment;
          exploration = createExplorationModel({ query, selectionThreshold: scene.selThreshold ?? scene.done?.summary?.selection_threshold, initialCards: initialCards(scene) });
        } else {
          mergeSearch(exploration, segment, frame.segmentId, '추가 검색', scene);
        }
      } else {
        const enteringQueryEvaluation = evaluating && frame === frames.at(-1) && frame.id.endsWith(':evaluate');
        for (const event of frame.events) {
          if (enteringQueryEvaluation && ['evaluation_batch_succeeded', 'evaluations_reused', 'completed', 'failed'].includes(event.type)) continue;
          exploration = applyExplorationEvent(exploration, event);
        }
      }
    }
    if (!exploration) exploration = createExplorationModel({ query, selectionThreshold: null, initialCards: [] });
    folded = { scene, exploration, searchModels, cursor: frames.length, frameId: frames.at(-1)?.id,
      eventCount: frames.at(-1)?.events.length, evaluating };
    // Materialization adds display columns and resolves display paths. Never put those
    // mutations back into the search reducer's scene.
    const result = materialize({ ...scene, nodes: new Map(scene.nodes), order: [...scene.order], calls: new Map(scene.calls) }, exploration);
    result.scene.searchDurationMs = [...searchModels.values()].reduce((sum, segment) => sum + (segment.done && segment.run
      ? Math.max(0, Date.parse(segment.done.completed_at) - Date.parse(segment.run.started_at)) : 0), 0);
    const selectionFrame = frames.findLast(frame => selections.some(selection => selection.frameId === frame.id));
    const selected = selections.find(selection => selection.frameId === selectionFrame?.id);
    result.selectionCardId = selected && exploration.cards.has(selected.cardId) ? selected.cardId : null;
    return result;
  }
  function truncate(cursor) {
    folded = null;
    const frames = timeline().frames.slice(0, cursor);
    selections = selections.filter(selection => frames.some(frame => frame.id === selection.frameId));
    entries = entries.flatMap(entry => {
      const kept = frames.filter(frame => frame.entry === entry);
      if (!kept.length) return [];
      return [{ ...entry, events: kept.flatMap(frame => frame.events) }];
    });
    revision += 1;
  }
  return {
    begin(text, { resume = false } = {}) {
      if (!resume) { entries = []; selections = []; query = text; revision += 1; folded = null; }
      const id = `search-${++serial}`;
      entries.push({ type: 'search', id, events: [] });
    },
    receive(event) { entries.at(-1).events.push(event); },
    apply(event) {
      if (event.type === 'started' && !entries.some(entry => entry.id === event.id)) entries.push({ type: 'operation', id: event.id, events: [] });
      entries.find(entry => entry.id === (event.operationId ?? event.id))?.events.push(event);
    },
    select(cardId, cursor) {
      const frameId = timeline().frames[cursor - 1]?.id;
      selections = selections.filter(selection => selection.frameId !== frameId);
      if (frameId) selections.push({ frameId, cardId });
    },
    timeline, project, truncate,
    exportLog() { return structuredClone({ entries, query, revision, serial, selections }); },
    restoreLog(log) { ({ entries, query, revision, serial, selections } = structuredClone(log)); folded = null; },
    chapters() { return groupExplorationChapters(timeline()); },
    get revision() { return revision; },
  };
}
