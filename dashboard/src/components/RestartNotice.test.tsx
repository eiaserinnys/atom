// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RestartBanner } from './RestartBanner';
import { ConfigFooter } from './Config/ConfigFooter';
import { MobileSettingsPage } from './Config/MobileSettingsPage';

const systemState = vi.hoisted(() => ({
  pendingRestart: true,
  manualRestartRequired: false,
  triggerRestart: vi.fn(),
  refreshStatus: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../api/client', () => ({ api: { logout: vi.fn() }, configApi: {} }));
vi.mock('../contexts/systemContext', () => ({ useSystem: () => systemState }));
vi.mock('./Config/ConfigTabPanel', () => ({ ConfigTabPanel: () => null }));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  systemState.pendingRestart = true;
  systemState.manualRestartRequired = false;
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
});

describe('restart notice', () => {
  test('banner explains that the server stays down only when it needs a manual start', async () => {
    await render(<RestartBanner />);
    expect(host.textContent).toContain('system.restart_required');
    expect(host.textContent).not.toContain('system.restart_manual');

    systemState.manualRestartRequired = true;
    await render(<RestartBanner />);
    expect(host.textContent).toContain('system.restart_manual');
    expect(host.querySelector('button')?.textContent).toBe('system.restart_now');
  });

  test('settings footer shows the same notice next to the restart button', async () => {
    const footer = (manualRestartRequired: boolean) => (
      <ConfigFooter activeTab="database" pendingRestart manualRestartRequired={manualRestartRequired}
        triggerRestart={vi.fn()} authFooter={null} />
    );
    await render(footer(false));
    expect(host.textContent).not.toContain('system.restart_manual');

    await render(footer(true));
    expect(host.textContent).toContain('system.restart_manual');
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toContain('system.restart_now');
  });
});

describe('logout button', () => {
  test('mobile settings list shows Logout only when the session can sign out', async () => {
    await render(<MobileSettingsPage currentUserRole="admin" currentUserEmail="admin@example.test" showLogout />);
    expect(host.textContent).toContain('app.logout');

    await render(<MobileSettingsPage currentUserRole="admin" currentUserEmail="bypass@local" showLogout={false} />);
    expect(host.textContent).not.toContain('app.logout');
  });
});
