const INITIAL_COLUMN_ID = 'initial';

export function createExplorationModel({ query, selectionThreshold, initialCards }) {
  const cards = new Map();
  const cardOrder = [];
  const evaluationCache = new Map();
  const resultOrder = [];
  const columns = [{ id: INITIAL_COLUMN_ID, label: '입구', cardIds: [], referenceIds: [] }];

  for (const input of initialCards) {
    const cardId = input.card_id ?? input.cardId;
    if (typeof cardId !== 'string' || cards.has(cardId)) continue;
    const card = {
      ...input,
      cardId,
      nodeId: input.node_id ?? input.nodeId ?? null,
      cardType: input.card_type ?? input.cardType ?? null,
      displayColumnId: input.display_column_id ?? input.displayColumnId ?? INITIAL_COLUMN_ID,
      columnLabel: input.column_label ?? input.columnLabel ?? '입구',
      similarity: input.similarity ?? null,
      selectedInitially: Boolean(input.selected),
      initialRank: Number.isInteger(input.rank) && input.rank > 0 ? input.rank : null,
      initialScore: typeof input.score === 'number' ? input.score : null,
      discoveryOrder: cardOrder.length,
    };
    cards.set(cardId, card);
    cardOrder.push(cardId);
    columns[0].cardIds.push(cardId);
    if (input.initial_evaluation && typeof input.initial_evaluation.score === 'number') {
      evaluationCache.set(cardId, {
        score: input.initial_evaluation.score,
        origin: 'initial_content',
        operationId: null,
        callId: input.initial_evaluation.call_id ?? '',
        questionKey: input.initial_evaluation.question_key ?? '',
        cardVersion: input.version ?? input.card_version,
      });
    }
  }

  const initiallySelected = cardOrder
    .filter(cardId => cards.get(cardId).selectedInitially)
    .sort((left, right) => (cards.get(left).initialRank ?? Number.MAX_SAFE_INTEGER) - (cards.get(right).initialRank ?? Number.MAX_SAFE_INTEGER));
  resultOrder.push(...initiallySelected);

  return {
    query,
    selectionThreshold: typeof selectionThreshold === 'number' ? selectionThreshold : 0.5,
    cards,
    cardOrder,
    columns,
    references: [],
    edges: new Map(),
    operations: [],
    evaluationCache,
    resultOrder,
    nextDiscoveryOrder: cardOrder.length,
  };
}

function cloneModel(model) {
  return {
    ...model,
    cards: new Map(model.cards),
    cardOrder: [...model.cardOrder],
    columns: model.columns.map(column => ({ ...column, cardIds: [...column.cardIds], referenceIds: [...column.referenceIds] })),
    references: model.references.map(reference => ({ ...reference })),
    edges: new Map([...model.edges].map(([key, edge]) => [key, { ...edge, observations: [...edge.observations] }])),
    operations: model.operations.map(operation => ({ ...operation, requestedCardIds: [...operation.requestedCardIds], resultCardIds: [...operation.resultCardIds], auditCalls: [...operation.auditCalls], pendingAccepted: [...operation.pendingAccepted] })),
    evaluationCache: new Map(model.evaluationCache),
    resultOrder: [...model.resultOrder],
  };
}

function operationIndex(model, id) {
  return model.operations.findIndex(operation => operation.id === id);
}

function getOperation(model, id) {
  const index = operationIndex(model, id);
  return index < 0 ? null : model.operations[index];
}

function addAccepted(model, operation, cardId) {
  if (!model.cards.has(cardId) || model.resultOrder.includes(cardId)) return;
  if (operation.kind === 'evaluate') {
    if (operation.fromCardId === null || !model.edges.has(`${operation.fromCardId}\u0000${cardId}`)) return;
  } else if (operation.fromCardId !== null || !operation.resultCardIds.includes(cardId)) {
    return;
  }
  const cached = model.evaluationCache.get(cardId);
  if (!cached || cached.score < model.selectionThreshold) return;
  if (!operation.pendingAccepted.includes(cardId)) operation.pendingAccepted.push(cardId);
}

function finishOperation(model, operation) {
  const accepted = [...operation.pendingAccepted].sort((left, right) => {
    const leftScore = model.evaluationCache.get(left)?.score ?? -Infinity;
    const rightScore = model.evaluationCache.get(right)?.score ?? -Infinity;
    return rightScore - leftScore || model.cards.get(left).discoveryOrder - model.cards.get(right).discoveryOrder;
  });
  for (const cardId of accepted) {
    if (!model.resultOrder.includes(cardId)) model.resultOrder.push(cardId);
  }
  operation.status = 'succeeded';
}

export function applyExplorationEvent(model, event) {
  const next = cloneModel(model);
  if (event.type === 'started') {
    const index = operationIndex(next, event.id);
    if (index >= 0) {
      next.operations[index].status = 'running'; next.operations[index].errorCode = null;
      return next;
    }
    const operation = {
      id: event.id,
      kind: event.kind,
      fromCardId: event.fromCardId,
      query: event.query,
      viaOperationId: event.viaOperationId,
      requestedCardIds: [...(event.requestedCardIds ?? [])],
      resultCardIds: [],
      status: 'running',
      errorCode: null,
      auditCalls: [],
      pendingAccepted: [],
      columnId: event.kind === 'expand' ? event.id : null,
    };
    if (index >= 0) next.operations[index] = operation;
    else next.operations.push(operation);
    return next;
  }

  const operation = getOperation(next, event.operationId);
  if (!operation) return next;
  const operationPosition = operationIndex(next, event.operationId);
  if (event.type === 'index_loading') {
    operation.loadingIndex = true;
  } else if (event.type === 'expansion_succeeded') {
    const queryExpansion = operation.fromCardId === null;
    const count = next.operations.slice(0, operationPosition + 1)
      .filter(item => item.kind === 'expand' && (item.fromCardId === null) === queryExpansion).length;
    const label = queryExpansion ? `질의 확장 ${count}` : `확장 ${count}`;
    const column = { id: operation.id, label, cardIds: [], referenceIds: [] };
    next.columns.push(column);
    operation.loadingIndex = false;
    const neighbors = event.response?.neighbors ?? [];
    neighbors.forEach((neighbor, index) => {
      const cardId = neighbor.card_id;
      const existing = next.cards.get(cardId);
      if (existing) {
        const referenceId = `${operation.id}:ref:${index}`;
        column.referenceIds.push(referenceId);
        const reference = {
          id: referenceId,
          operationId: operation.id,
          columnId: column.id,
          label,
          fromCardId: operation.fromCardId,
          toCardId: cardId,
          similarity: neighbor.similarity,
          targetNodeId: existing.nodeId,
          tree_relation: neighbor.tree_relation,
        };
        next.references.push(reference);
        if (operation.fromCardId !== null) {
          const key = `${operation.fromCardId}\u0000${cardId}`;
          const edge = next.edges.get(key) ?? { fromCardId: operation.fromCardId, toCardId: cardId, observations: [] };
          edge.observations.push({ operationId: operation.id, similarity: neighbor.similarity });
          next.edges.set(key, edge);
        }
        if (!operation.resultCardIds.includes(cardId)) operation.resultCardIds.push(cardId);
        return;
      }

      const card = {
        ...neighbor,
        cardId,
        nodeId: neighbor.node_id,
        cardType: neighbor.card_type,
        displayColumnId: column.id,
        columnLabel: label,
        similarity: neighbor.similarity,
        selectedInitially: false,
        initialRank: null,
        initialScore: null,
        discoveryOrder: next.nextDiscoveryOrder++,
      };
      next.cards.set(cardId, card);
      next.cardOrder.push(cardId);
      column.cardIds.push(cardId);
      if (operation.fromCardId !== null) {
        const key = `${operation.fromCardId}\u0000${cardId}`;
        next.edges.set(key, {
          fromCardId: operation.fromCardId,
          toCardId: cardId,
          observations: [{ operationId: operation.id, similarity: neighbor.similarity }],
        });
      }
      operation.resultCardIds.push(cardId);
    });
  } else if (event.type === 'evaluations_reused') {
    for (const cardId of event.cardIds) addAccepted(next, operation, cardId);
  } else if (event.type === 'evaluation_batch_succeeded') {
    const response = event.response;
    for (const result of response.results ?? []) {
      next.evaluationCache.set(result.card_id, {
        score: result.score,
        origin: 'manual_content',
        operationId: operation.id,
        callId: result.call_id,
        questionKey: result.question_key,
        cardVersion: result.card_version,
      });
    }
    operation.auditCalls.push(...(response.audit?.calls ?? []));
    for (const result of response.results ?? []) addAccepted(next, operation, result.card_id);
  } else if (event.type === 'failed') {
    finishOperation(next, operation);
    operation.status = 'failed';
    operation.errorCode = event.errorCode;
    operation.auditCalls.push(...(event.auditCalls ?? []));
  } else if (event.type === 'completed') {
    finishOperation(next, operation);
  }
  return next;
}

export function projectExploration(model) {
  const rankByCardId = new Map(model.resultOrder.map((cardId, index) => [cardId, index + 1]));
  const cards = model.cardOrder.map(cardId => {
    const card = model.cards.get(cardId);
    const evaluation = model.evaluationCache.get(cardId);
    return {
      ...card,
      cardId,
      nodeId: card.nodeId,
      cardType: card.cardType,
      displayColumnId: card.displayColumnId,
      columnLabel: card.columnLabel,
      sourceLabel: card.columnLabel,
      similarity: card.similarity,
      selected: rankByCardId.has(cardId),
      rank: rankByCardId.get(cardId) ?? card.initialRank,
      score: evaluation?.score ?? card.initialScore,
      evaluation: evaluation ?? null,
    };
  });
  const results = model.resultOrder.map((cardId, index) => {
    const card = model.cards.get(cardId);
    const evaluation = model.evaluationCache.get(cardId);
    return {
      cardId,
      rank: index + 1,
      score: evaluation?.score ?? card.initialScore,
      sourceLabel: card.columnLabel,
    };
  });
  return {
    query: model.query,
    selectionThreshold: model.selectionThreshold,
    cards,
    columns: model.columns.map(column => ({ ...column, cardIds: [...column.cardIds], referenceIds: [...column.referenceIds] })),
    references: model.references.map(reference => ({ ...reference })),
    resultOrder: [...model.resultOrder],
    results,
    operations: model.operations.map(operation => ({ ...operation, requestedCardIds: [...operation.requestedCardIds], resultCardIds: [...operation.resultCardIds], auditCalls: [...operation.auditCalls], pendingAccepted: [...operation.pendingAccepted] })),
    evaluations: new Map(model.evaluationCache),
  };
}
