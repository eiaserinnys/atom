import type { MoveNodePayload } from '../../api/client';
import { toApiMovePayload, type TreeMovePayload } from '../../utils/treeMoveIntent';

export type CardType = 'structure' | 'knowledge';

export interface CreateCardVars {
  cardType: CardType;
  title: string;
  content: string;
  parentNodeId?: string | null;
}

export interface EditCardVars {
  cardId: string;
  title: string;
  content: string;
}

export interface CreateCardPayload {
  card_type: CardType;
  title: string;
  content?: string;
  parent_node_id?: string | null;
  position?: number;
}

export interface EditCardPayload {
  title?: string;
  content?: string;
}

export function buildCreateCardPayload(vars: CreateCardVars): CreateCardPayload {
  return {
    card_type: vars.cardType,
    title: vars.title,
    content: vars.content || undefined,
    parent_node_id: vars.parentNodeId ?? null,
  };
}

export function buildEditCardPayload(vars: EditCardVars): EditCardPayload {
  return {
    title: vars.title,
    content: vars.content || undefined,
  };
}

export function buildMoveNodePayload(vars: TreeMovePayload): MoveNodePayload {
  return toApiMovePayload(vars);
}
