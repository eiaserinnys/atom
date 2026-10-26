// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { ContextMenu } from './ContextMenu';

test('exposes radio semantics only for checked menu items', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(
      <ContextMenu
        x={20}
        y={20}
        items={[
          { label: 'Selected', checked: true, onClick: () => {} },
          { label: 'Action', onClick: () => {} },
        ]}
        onClose={() => {}}
      />
    ));

    const menu = document.body.querySelector('[role="menu"]');
    const items = [...document.body.querySelectorAll('[data-testid="context-menu-item"]')];
    expect(menu).not.toBeNull();
    expect(items[0]?.getAttribute('role')).toBe('menuitemradio');
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    expect(items[0]?.className).toContain('text-brand font-semibold');
    expect(items[1]?.getAttribute('role')).toBe('menuitem');
    expect(items[1]?.hasAttribute('aria-checked')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
