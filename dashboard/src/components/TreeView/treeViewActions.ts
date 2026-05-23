import type { TreeNodeData } from '../../api/client';
import type { CreateCardVars, EditCardVars } from './treeMutationPayloads';

type CardType = TreeNodeData['card']['card_type'];

export type TreeModalState =
  | { type: 'none' }
  | { type: 'create-root'; cardType: CardType }
  | { type: 'create-child'; cardType: CardType; parentNode: TreeNodeData }
  | { type: 'edit'; node: TreeNodeData }
  | { type: 'delete'; node: TreeNodeData }
  | { type: 'move'; node: TreeNodeData };

export type TreeContextMenuAction =
  | { type: 'create-child'; cardType: CardType; parentNode: TreeNodeData }
  | { type: 'move'; node: TreeNodeData }
  | { type: 'edit'; node: TreeNodeData }
  | { type: 'delete'; node: TreeNodeData };

export interface TreeContextMenuActionDescriptor {
  labelKey: string;
  action: TreeContextMenuAction;
  danger?: boolean;
}

export type TreeModalConfirmAction =
  | { type: 'create-card'; vars: CreateCardVars }
  | { type: 'edit-card'; vars: EditCardVars }
  | { type: 'noop' };

export function buildContextMenuActionDescriptors(
  node: TreeNodeData
): TreeContextMenuActionDescriptor[] {
  const items: TreeContextMenuActionDescriptor[] = [];

  if (node.card.card_type === 'structure') {
    items.push({
      labelKey: 'tree.context_create_child_structure',
      action: { type: 'create-child', cardType: 'structure', parentNode: node },
    });
    items.push({
      labelKey: 'tree.context_create_child_knowledge',
      action: { type: 'create-child', cardType: 'knowledge', parentNode: node },
    });
  }

  items.push({ labelKey: 'tree.context_move', action: { type: 'move', node } });
  items.push({ labelKey: 'tree.context_rename', action: { type: 'edit', node } });
  items.push({
    labelKey: 'tree.context_delete',
    action: { type: 'delete', node },
    danger: true,
  });

  return items;
}

export function buildModalConfirmAction(
  modal: TreeModalState,
  title: string,
  content: string
): TreeModalConfirmAction {
  if (modal.type === 'create-root') {
    return {
      type: 'create-card',
      vars: { cardType: modal.cardType, title, content, parentNodeId: null },
    };
  }

  if (modal.type === 'create-child') {
    return {
      type: 'create-card',
      vars: { cardType: modal.cardType, title, content, parentNodeId: modal.parentNode.id },
    };
  }

  if (modal.type === 'edit') {
    return {
      type: 'edit-card',
      vars: { cardId: modal.node.card.id, title, content },
    };
  }

  return { type: 'noop' };
}
