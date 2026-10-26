// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { TreeNodeData } from '../../api/client';
import { MobileTabBar } from '../Layout/MobileTabBar';
import { TreeNode } from './TreeNode';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ initialData }: { initialData?: TreeNodeData[] }) => ({
    data: initialData,
    isFetched: true,
    isFetching: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null }),
  useDroppable: () => ({ setNodeRef: () => {} }),
}));
vi.mock('./TreeDndContext', () => ({ useTreeDnd: () => ({ activeId: null, overId: null, dropZone: null }) }));

function node(id: string, cardType: 'structure' | 'knowledge', children?: TreeNodeData[]): TreeNodeData {
  return {
    id,
    card_id: `card-${id}`,
    parent_node_id: null,
    position: 0,
    is_symlink: false,
    journal_limit: null,
    children,
    created_at: '2026-05-24T00:00:00.000Z',
    card: {
      id: `card-${id}`,
      card_type: cardType,
      title: `${id} title`,
      content: `${id} content`,
      references: [],
      tags: [],
      card_timestamp: '2026-05-24T00:00:00.000Z',
      content_timestamp: null,
      source_type: null,
      source_ref: null,
      version: 1,
      updated_at: '2026-05-24T00:00:00.000Z',
      created_by: null,
      updated_by: null,
    },
  };
}

function parseMarkup(markup: string) {
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
}

test('tree structure, knowledge, and expand controls render monochrome SVG icons', () => {
  const knowledge = node('knowledge', 'knowledge');
  const structure = node('structure', 'structure', [knowledge]);
  const markup = renderToStaticMarkup(
    <TreeNode
      node={structure}
      selectedNodeId={null}
      onSelect={() => {}}
      isExpanded
      expandedNodes={new Set(['structure'])}
      onToggle={() => {}}
    />
  );
  const icons = [...parseMarkup(markup).querySelectorAll('svg')];

  expect(icons).toHaveLength(3);
  expect(icons.every(icon => icon.getAttribute('stroke-width') === '1.75')).toBe(true);
  expect(icons[0].parentElement?.className).toContain('text-muted-foreground');
  expect(icons[1].getAttribute('class')).toContain('text-[var(--blue)]');
  expect(icons[2].getAttribute('class')).toContain('text-brand');
});

test('tree rows expose mobile touch targets for rows and expand controls', () => {
  const structure = node('structure', 'structure', [node('knowledge', 'knowledge')]);
  const markup = renderToStaticMarkup(
    <TreeNode
      node={structure}
      selectedNodeId={null}
      onSelect={() => {}}
      isExpanded
      expandedNodes={new Set(['structure'])}
      onToggle={() => {}}
    />
  );
  const container = parseMarkup(markup);
  const row = container.querySelector('[data-testid="tree-node-structure"] > div');
  const toggle = row?.querySelector('span');

  expect(row?.className).toContain('max-md:min-h-[42px]');
  expect(row?.className).toContain('touch-pan-y');
  expect(toggle?.className).toContain('max-md:w-9');
  expect(toggle?.className).toContain('max-md:h-9');
});

test('mobile navigation renders five monochrome SVG icons with the theme color classes', () => {
  const markup = renderToStaticMarkup(
    <MobileTabBar activeTab="tree" onTabChange={() => {}} showSettings />
  );
  const container = parseMarkup(markup);
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  const icons = [...container.querySelectorAll('svg')];

  expect(tabs).toHaveLength(5);
  expect(icons).toHaveLength(5);
  expect(icons.every(icon => icon.getAttribute('stroke-width') === '1.75')).toBe(true);
  expect(icons.every(icon => ['w-4', 'h-4', 'shrink-0'].every(className => icon.classList.contains(className)))).toBe(true);
  expect(tabs[0].className).toContain('text-brand');
  expect(tabs[1].className).toContain('text-muted-foreground');
});
