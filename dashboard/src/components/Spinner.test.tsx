// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { Spinner } from './Spinner';

test('renders the requested Loader2 size as a decorative icon', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Spinner size="sm" />));
    let icon = host.querySelector('svg');
    expect(icon?.classList.contains('w-3.5')).toBe(true);
    expect(icon?.classList.contains('h-3.5')).toBe(true);
    expect(icon?.classList.contains('animate-spin')).toBe(true);
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[role="status"]')).toBeNull();

    await act(async () => root.render(<Spinner size="md" />));
    icon = host.querySelector('svg');
    expect(icon?.classList.contains('w-5')).toBe(true);
    expect(icon?.classList.contains('h-5')).toBe(true);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

test('announces an accessible label only when one is supplied', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Spinner label="Loading" />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.sr-only')?.textContent).toBe('Loading');
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
