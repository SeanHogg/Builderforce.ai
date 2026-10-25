import { describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { ConnectionsPanel } from './ConnectionsPanel';
import type { ComposerConnections, ProviderConnection, ProviderConnectionsPort } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(ui: ReactElement): Promise<{ el: HTMLDivElement; unmount: () => void }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  await act(async () => {
    root = createRoot(el);
    root.render(ui);
  });
  return {
    el,
    unmount: () => {
      act(() => { root.unmount(); });
      el.remove();
    },
  };
}

const grok: ProviderConnection = { provider: 'xai', label: 'xAI (Grok)', authType: 'oauth', health: 'rejected', reconnectable: true };
const gemini: ProviderConnection = { provider: 'google', label: 'Google (Gemini)', authType: 'api_key', health: 'ok', reconnectable: false };

function port(overrides: Partial<ProviderConnectionsPort> = {}): ProviderConnectionsPort {
  return {
    list: vi.fn(async () => [grok, gemini]),
    test: vi.fn(async () => ({ ok: true, health: 'ok' as const, message: null })),
    start: vi.fn(async () => ({ grant: 'paste' as const, authorizeUrl: 'https://auth.x.ai/oauth/authorize?s=1', state: 's1', userCode: null, intervalMs: 5000 })),
    completePaste: vi.fn(async () => undefined),
    awaitDevice: vi.fn(async () => undefined),
    ...overrides,
  };
}

const buttonNamed = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;

describe('<ConnectionsPanel>', () => {
  it('lists each account with its health, and offers Reconnect only for a subscription', async () => {
    const connections: ComposerConnections = { client: port(), openUrl: vi.fn() };
    const { el, unmount } = await mount(<ConnectionsPanel connections={connections} />);
    expect(el.textContent).toContain('Connected accounts');
    expect(el.textContent).toContain('xAI (Grok)');
    expect(el.textContent).toContain('Sign-in expired — reconnect');
    expect(el.textContent).toContain('Google (Gemini)');
    expect(el.textContent).toContain('Working');
    expect([...el.querySelectorAll('button')].filter((b) => b.textContent === 'Reconnect')).toHaveLength(1);
    unmount();
  });

  it('says the section is unavailable when the gateway refuses the list, rather than vanishing', async () => {
    const connections: ComposerConnections = { client: port({ list: vi.fn(async () => null) }), openUrl: vi.fn() };
    const { el, unmount } = await mount(<ConnectionsPanel connections={connections} />);
    expect(el.textContent).toContain('Connected accounts are not available from here.');
    expect(el.querySelectorAll('button')).toHaveLength(0);
    unmount();
  });

  it('a reconnect survives the menu closing: remounting shows the same paste step', async () => {
    const client = port();
    const first = await mount(<ConnectionsPanel connections={{ client, openUrl: vi.fn() }} />);
    await act(async () => { buttonNamed(first.el, 'Reconnect').click(); });
    expect(first.el.querySelector('input')).toBeTruthy();
    first.unmount();

    const again = await mount(<ConnectionsPanel connections={{ client, openUrl: vi.fn() }} />);
    expect(again.el.querySelector('input')).toBeTruthy();
    await act(async () => { buttonNamed(again.el, 'Cancel').click(); });
    expect(again.el.querySelector('input')).toBeNull();
    again.unmount();
  });

  it('a device approval that lands after the menu closed is still redeemed', async () => {
    let approve!: () => void;
    const client = port({
      start: vi.fn(async () => ({ grant: 'device' as const, authorizeUrl: 'https://auth.kimi.com/d', state: 's', userCode: 'AB-CD', intervalMs: 1000 })),
      awaitDevice: vi.fn(() => new Promise<void>((resolve) => { approve = resolve; })),
    });
    const view = await mount(<ConnectionsPanel connections={{ client, openUrl: vi.fn() }} />);
    await act(async () => { buttonNamed(view.el, 'Reconnect').click(); });
    expect(view.el.textContent).toContain('AB-CD');
    const signal = (client.awaitDevice as ReturnType<typeof vi.fn>).mock.calls[0]![2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(false);
    await act(async () => { approve(); });
    const after = await mount(<ConnectionsPanel connections={{ client, openUrl: vi.fn() }} />);
    expect(after.el.textContent).not.toContain('AB-CD');
    expect(buttonNamed(after.el, 'Reconnect')).toBeTruthy();
    after.unmount();
  });

  it('reconnects in place: opens the sign-in page, takes the pasted code, re-reads the list', async () => {
    const client = port();
    const openUrl = vi.fn();
    const { el, unmount } = await mount(<ConnectionsPanel connections={{ client, openUrl }} />);

    await act(async () => { buttonNamed(el, 'Reconnect').click(); });
    expect(openUrl).toHaveBeenCalledWith('https://auth.x.ai/oauth/authorize?s=1');
    const input = el.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'CODE#s1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { buttonNamed(el, 'Finish').click(); });

    expect(client.completePaste).toHaveBeenCalledWith('xai', 'CODE#s1', 's1');
    expect(client.list).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('a spent code sends the row back to Reconnect and says to start again', async () => {
    const client = port({
      completePaste: vi.fn(async () => { throw Object.assign(new Error('expired'), { reason: 'expired', detail: 'spent' }); }),
    });
    const { el, unmount } = await mount(<ConnectionsPanel connections={{ client, openUrl: vi.fn() }} />);
    await act(async () => { buttonNamed(el, 'Reconnect').click(); });
    const input = el.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'OLD');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { buttonNamed(el, 'Finish').click(); });
    expect(el.querySelector('input')).toBeNull();
    expect(el.textContent).toContain('That code expired — reconnect again.');
    unmount();
  });

  it('Test repaints the row from the probe verdict', async () => {
    const client = port({ test: vi.fn(async () => ({ ok: false, health: 'capacity' as const, message: 'xAI: allowance depleted' })) });
    const { el, unmount } = await mount(<ConnectionsPanel connections={{ client, openUrl: vi.fn() }} />);
    await act(async () => { buttonNamed(el, 'Test').click(); });
    expect(el.textContent).toContain('Usage limit reached');
    expect(el.textContent).toContain('xAI: allowance depleted');
    unmount();
  });
});
