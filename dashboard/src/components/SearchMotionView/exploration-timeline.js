function operationRecord(events) {
  const started = events.find(event => event.type === 'started');
  if (!started) return null;
  const terminal = [...events].reverse().find(event => event.type === 'completed' || event.type === 'failed');
  return {
    id: started.id,
    kind: started.kind,
    fromCardId: started.fromCardId ?? null,
    query: started.query ?? null,
    viaOperationId: started.viaOperationId ?? null,
    status: terminal?.type === 'failed' ? 'failed' : terminal?.type === 'completed' ? 'succeeded' : 'running',
    errorCode: terminal?.type === 'failed' ? terminal.errorCode : null,
  };
}

function makeFrame(id, operation, events, eventEndIndex) {
  return {
    id,
    segmentId: operation.id,
    operationId: operation.id,
    kind: operation.kind,
    sourceCardId: operation.fromCardId,
    query: operation.query,
    events,
    eventEndIndex,
  };
}

export function buildExplorationTimeline(initialFrames, operationEvents) {
  const events = operationEvents.filter(event => event.type !== 'index_loading');
  const frames = initialFrames.map(frame => ({ ...frame, eventEndIndex: 0 }));
  const operations = [];
  let index = 0;

  while (index < events.length) {
    const start = index;
    while (index < events.length && events[index].type !== 'started') index += 1;
    if (index >= events.length) break;
    const operationId = events[index].id;
    const operationEventsForId = [];
    while (index < events.length && (events[index].type !== 'started' || events[index].id === operationId)) {
      if (events[index].type === 'started' && events[index].id !== operationId) break;
      operationEventsForId.push(events[index]);
      index += 1;
    }
    if (index === start) index += 1;
    const operation = operationRecord(operationEventsForId);
    if (!operation) continue;
    operations.push(operation);
    const opStartIndex = start;
    const opEndIndex = start + operationEventsForId.length;
    const expansionAt = operationEventsForId.findIndex(event => event.type === 'expansion_succeeded' || (event.type === 'failed' && operation.kind === 'expand'));

    if (operation.kind === 'expand' && operation.fromCardId === null) {
      const split = expansionAt >= 0 ? expansionAt + 1 : Math.min(1, operationEventsForId.length);
      frames.push(makeFrame(`${operation.id}:expand`, operation, operationEventsForId.slice(0, split), opStartIndex + split));
      const evaluationEvents = operationEventsForId.slice(split);
      if (evaluationEvents.length > 0 || expansionAt >= 0) {
        frames.push(makeFrame(`${operation.id}:evaluate`, operation, evaluationEvents, opEndIndex));
      }
    } else if (operation.kind === 'evaluate') {
      const startEvents = operationEventsForId.slice(0, 1);
      frames.push(makeFrame(`${operation.id}:start`, operation, startEvents, opStartIndex + startEvents.length));
      const endEvents = operationEventsForId.slice(1);
      if (endEvents.length > 0) frames.push(makeFrame(`${operation.id}:end`, operation, endEvents, opEndIndex));
    } else {
      frames.push(makeFrame(`${operation.id}:expand`, operation, operationEventsForId, opEndIndex));
    }
  }

  return { frames, operationEvents: events, operations };
}

export function projectAt(timeline, cursor, initialState, reducer) {
  const boundary = Math.max(0, Math.min(timeline.frames.length, Math.trunc(cursor)));
  let state = initialState;
  for (const frame of timeline.frames.slice(0, boundary)) {
    for (const event of frame.events ?? []) state = reducer(state, event);
  }
  return state;
}

export function truncateTimeline(timeline, cursor) {
  const boundary = Math.max(0, Math.min(timeline.frames.length, Math.trunc(cursor)));
  const frames = timeline.frames.slice(0, boundary);
  const operationEnd = frames.reduce((last, frame) => Math.max(last, frame.eventEndIndex ?? 0), 0);
  const operationEvents = timeline.operationEvents.slice(0, operationEnd);
  const visibleIds = new Set(operationEvents.filter(event => event.type === 'started').map(event => event.id));
  const operations = timeline.operations.filter(operation => visibleIds.has(operation.id));
  return { frames, operationEvents, operations };
}

export function groupExplorationChapters(timeline) {
  const chapters = [];
  const initialGroups = new Map();
  for (const frame of timeline.frames) {
    if (frame.operationId) continue;
    const id = frame.segmentId ?? 'initial';
    const group = initialGroups.get(id) ?? { id, label: initialGroups.size === 0 ? '0 검색' : '추가 검색', operationIds: [], frameIds: [] };
    group.frameIds.push(frame.id);
    initialGroups.set(id, group);
  }
  chapters.push(...initialGroups.values());

  let expansionCount = 0;
  let queryExpansionCount = 0;
  let evaluationCount = 0;
  let previousManualExpansion = null;
  for (const operation of timeline.operations) {
    const opFrames = timeline.frames.filter(frame => frame.operationId === operation.id).map(frame => frame.id);
    if (operation.kind === 'expand' && operation.fromCardId === null) {
      queryExpansionCount += 1;
      chapters.push({ id: operation.id, label: `질의 확장 ${queryExpansionCount}`, operationIds: [operation.id], frameIds: opFrames });
      previousManualExpansion = null;
    } else if (operation.kind === 'expand') {
      expansionCount += 1;
      const chapter = { id: operation.id, label: `확장 ${expansionCount}`, operationIds: [operation.id], frameIds: opFrames };
      chapters.push(chapter);
      previousManualExpansion = { chapter, fromCardId: operation.fromCardId };
    } else {
      if (previousManualExpansion && previousManualExpansion.fromCardId === operation.fromCardId) {
        previousManualExpansion.chapter.operationIds.push(operation.id);
        previousManualExpansion.chapter.frameIds.push(...opFrames);
      } else {
        evaluationCount += 1;
        chapters.push({ id: operation.id, label: `평가 ${evaluationCount}`, operationIds: [operation.id], frameIds: opFrames });
      }
      previousManualExpansion = null;
    }
  }
  return chapters;
}
