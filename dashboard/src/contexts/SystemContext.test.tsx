// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { SystemProvider } from './SystemContext';
import { useSystem, type SystemState } from './systemContext';

const api = vi.hoisted(() => ({ getHealth: vi.fn(), restart: vi.fn(), getStatus: vi.fn() }));
vi.mock('../api/client', () => ({ systemApi: api }));
let state: SystemState;
let root: Root;
let host: HTMLDivElement;
const reload = vi.fn();
function Probe() { state = useSystem(); return null; }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', { location: { reload } });
  api.getStatus.mockResolvedValue({ pendingRestart: true });
  api.getHealth.mockResolvedValue({ status: 'ok', bootId: 'old' });
  api.restart.mockResolvedValue({ ok: true });
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root.render(<SystemProvider><Probe /></SystemProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('only reloads after a different boot answers health', async () => {
  await act(async () => state.triggerRestart());
  expect(api.getHealth).toHaveBeenCalledBefore(api.restart);
  await tick(2000);
  expect(reload).not.toHaveBeenCalled();
  api.getHealth.mockRejectedValueOnce(new Error('offline'));
  await tick(1000);
  expect(reload).not.toHaveBeenCalled();
  api.getHealth.mockResolvedValue({ status: 'ok', bootId: 'new' });
  await tick(1000);
  expect(reload).toHaveBeenCalledTimes(1);
});

test('restores the existing restart prompt on timeout even while the old server is healthy', async () => {
  await act(async () => state.triggerRestart());
  await tick(31_000);
  expect(reload).not.toHaveBeenCalled();
  expect(state.reconnecting).toBe(false);
  expect(state.pendingRestart).toBe(true);
});

test('restores the existing restart prompt when the request fails', async () => {
  api.restart.mockRejectedValue(new Error('forbidden'));
  await act(async () => state.triggerRestart());
  await tick(1000);
  expect(state.reconnecting).toBe(false);
  expect(state.pendingRestart).toBe(true);
  expect(reload).not.toHaveBeenCalled();
});
