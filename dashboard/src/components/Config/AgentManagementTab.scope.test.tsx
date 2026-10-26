// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigTabPanel } from './ConfigTabPanel';

const request = vi.hoisted(() => vi.fn());

vi.mock('../../api/request', () => ({ request }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => ({
      'agents.scope_label': 'Scope',
      'agents.scope_read': 'Read',
      'agents.scope_write': 'Write',
      'agents.generate_btn': 'Generate',
    }[key] ?? key),
    i18n: { language: 'en' },
  }),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const host = document.createElement('div');
document.body.append(host);
let root: Root;
let agents: Array<{
  id: string;
  agent_id: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  scope: 'read' | 'write';
}>;

function newAgents() {
  return [
    {
      id: 'agent-read', agent_id: 'read-agent', display_name: null,
      is_active: true, created_at: '2026-10-26T00:00:00.000Z', scope: 'read' as const,
    },
    {
      id: 'agent-write', agent_id: 'write-agent', display_name: 'Writer',
      is_active: false, created_at: '2026-10-26T00:00:00.000Z', scope: 'write' as const,
    },
  ];
}

async function render(role: 'admin' | 'editor') {
  await act(async () => root.render(
    <ConfigTabPanel
      tab="agents"
      currentUserRole={role}
      currentUserEmail={`${role}@example.test`}
    />
  ));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  agents = newAgents();
  request.mockImplementation(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : {};

    if (path === '/api/config/agents' && method === 'GET') return [...agents];
    if (path === '/api/config/agents' && method === 'POST') {
      const created = {
        id: 'agent-new',
        agent_id: String(body.agent_id),
        display_name: typeof body.display_name === 'string' ? body.display_name : null,
        is_active: true,
        created_at: '2026-10-26T00:00:00.000Z',
        scope: body.scope === 'write' ? 'write' as const : 'read' as const,
      };
      agents = [...agents, created];
      return { ...created, secret: 'one-time-secret' };
    }
    const agentId = path.match(/^\/api\/config\/agents\/([^/]+)$/)?.[1];
    if (agentId && method === 'PATCH') {
      const agent = agents.find(item => item.id === agentId);
      if (!agent) throw new Error('Agent not found');
      const updated = { ...agent, ...body };
      agents = agents.map(item => item.id === agentId ? updated : item);
      return updated;
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.replaceChildren();
  vi.clearAllMocks();
});

describe('Agent API key scopes', () => {
  test('admin creates a read-scoped key by default and sends scope in the request body', async () => {
    await render('admin');

    const createScope = host.querySelector('select[aria-label="Scope"]') as HTMLSelectElement | null;
    expect(createScope?.value).toBe('read');

    const inputs = host.querySelectorAll('input');
    setInput(inputs[0] as HTMLInputElement, 'new-agent');
    setInput(inputs[1] as HTMLInputElement, 'New Agent');
    const generate = [...host.querySelectorAll('button')].find(button => button.textContent === 'Generate');
    expect(generate).toBeDefined();
    await act(async () => {
      click(generate!);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(request).toHaveBeenCalledWith('/api/config/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ agent_id: 'new-agent', display_name: 'New Agent', scope: 'read' }),
    }));
  });

  test('admin updates one row scope with a PATCH and applies the returned row without reloading the list', async () => {
    await render('admin');

    const scope = host.querySelector('#agent-scope-agent-read') as HTMLSelectElement | null;
    expect(scope).not.toBeNull();
    setSelect(scope!, 'write');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(request).toHaveBeenCalledWith('/api/config/agents/agent-read', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ scope: 'write' }),
    }));
    expect(request.mock.calls.filter(([path, options]) =>
      path === '/api/config/agents' && (options as RequestInit | undefined)?.method !== 'POST'
    )).toHaveLength(1);
    expect((host.querySelector('#agent-scope-agent-read') as HTMLSelectElement).value).toBe('write');
  });

  test('editor sees scope text without key creation or management controls', async () => {
    await render('editor');

    expect(host.textContent).not.toContain('agents.create_section');
    expect(host.textContent).toContain('Read');
    expect(host.textContent).toContain('Write');
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });
});
