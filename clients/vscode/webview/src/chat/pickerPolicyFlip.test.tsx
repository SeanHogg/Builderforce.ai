// @vitest-environment jsdom
/**
 * THE picker test for the @/# typeahead fix (ticket 6641). `platformPolicy.test.ts` proves the
 * `connected` capability flips on a late frame; this test proves the actual composer hook READS
 * that flip by mounting the real `#` ticket picker hook and driving a late `platform.policy`
 * frame through the same host `message` listener the real webview wires. (The `@` picker reads
 * the same reactive `useCapability('connected')`; this covers the mechanism both share.)
 *
 * The `#` picker (`useTicketRail`) lists the chat's LOCAL tickets always and ADDS the server's
 * linked tickets when connected — a union, never a swap — so a late or denied frame can never
 * starve it. The reactive `connected` re-runs the read on every frame.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InferenceMode, PlatformPolicySnapshot } from '@builderforce/local-first';

// React 19 requires the test realm to be flagged before `act(...)` will batch updates.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The webview stubs the real module reads at import time. jsdom provides window/document;
// acquireVsCodeApi is the VS Code webview handle bridgeTransport calls at module load.
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => undefined,
  setState: () => {},
});

type Listener = (event: { data: unknown }) => void;

let listeners: Listener[];

/**
 * The platform tickets the `#` picker unions on top of the local ones live in the rail snapshot
 * above (read via `local.chatRail`); this spy watches the background platform refresh re-read.
 */
const platformRefresh = vi.fn(async (_body: unknown) => ({ ok: true as const }));

/** The host's local tickets — present no matter the policy. */
const localTickets = vi.fn(async () => [{ id: 9, title: 'Local ticket', status: 'open' }]);

/**
 * The ONLY mocked seam: the host bridge round-trip. `useTicketRail`'s `#` read and its rail
 * `listTickets` both reach the host through `../bridgeTransport`'s `request`, so mocking it
 * (and keeping the module's real `handleFrame`/`onHostMessage` registry + `message` listener)
 * lets a host `platform.policy` frame reach the real `useCapability` subscription.
 */
vi.mock('../bridgeTransport', () => {
  const frameHandlers = new Map<string, (m: Record<string, unknown>) => boolean | void>();
  const hostMessageWaiters = new Map<string, Set<(frame: unknown) => void>>();
  const RAIL_SNAPSHOT = {
    chatId: 7,
    tickets: [{
      linkId: 101, kind: 'task', ref: 'SYNC-101', label: 'Server ticket', status: 'open',
      progressPct: 50, done: 0, total: 1, exists: true, linkType: 'linked',
    }],
    runHistory: { runs: [] },
    summary: { total: 1, synced: 1, pending: 0 },
    freshness: { asOf: 0, label: 'now' },
  };
  return {
    request: (name: string, body?: Record<string, unknown>) => {
      // The `#` typeahead reads through `createLocalRailAdapter` → a `local.chatRail` read, NOT
      // the platform REST adapter directly. Answer it from the host's local copy; a `refresh`
      // (background platform re-read) is fire-and-forget and can stay unresolved-ish/no-op here.
      if (name === 'local.chatRail') {
        if (body?.action === 'read') return Promise.resolve(RAIL_SNAPSHOT);
        return platformRefresh(body);
      }
      if (name === 'local.tickets') return localTickets();
      return Promise.reject(new Error(`unexpected bridge request ${name}`));
    },
    post: () => {},
    nextId: (prefix: string) => `${prefix}test`,
    envelope: (payload: Record<string, unknown> | undefined, head: Record<string, unknown>) => ({ ...(payload ?? {}), ...head }),
    subscribe: <T,>(list: T[], cb: T) => { list.push(cb); return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); }; },
    onTeardown: () => {},
    handleFrame: (types: string | string[], handler: (m: Record<string, unknown>) => boolean | void) => {
      for (const t of Array.isArray(types) ? types : [types]) frameHandlers.set(t, handler);
    },
    onHostMessage: (type: string, cb: (frame: unknown) => void) => {
      let set = hostMessageWaiters.get(type);
      if (!set) { set = new Set(); hostMessageWaiters.set(type, set); }
      set.add(cb);
      return () => { set?.delete(cb); };
    },
    // The real webview delivers host frames through ONE `message` listener; replicate it so a
    // `platform.policy` frame reaches the `useCapability` subscription the picker reads.
    // `type?: string` mirrors the real `HostFrame` so a truthiness check narrows it to `string`.
    __deliver: (m: { type?: string } & Record<string, unknown>) => {
      const handler = m.type ? frameHandlers.get(m.type) : undefined;
      if (handler && handler(m) !== false) return;
      const waiters = m.type ? hostMessageWaiters.get(m.type) : undefined;
      if (waiters) for (const w of [...waiters]) (w as (frame: unknown) => void)(m);
    },
  };
});

vi.mock('../chatTicketsAdapter', () => ({
  // The `#` typeahead reads the rail through the `local.chatRail` bridge (mocked above), not this
  // platform adapter — only the adapter's CONSTRUCTION runs here. A benign listTickets suffices.
  createChatTicketsPlatform: () => ({ adapter: { listTickets: async () => [] }, questionsFor: async () => [] }),
}));

vi.mock('../useChatChangedFiles', () => ({ useChatChangedFiles: () => null }));
vi.mock('../usePendingChangesExtension', () => ({ usePendingChangesExtension: () => null }));

import * as bridge from '../bridgeTransport';
import { installWebviewPlatformPolicy } from '../platformPolicy';
import { useCapability } from '../useCapability';
import { useTicketRail } from './useTicketRail';

// Install the platform policy ONCE at import time, before any component subscribes. The module
// guards re-install with a module-level `installed` flag, so calling it per-test would let the
// FIRST test flip `connected` on and have it LEAK into the second (the second install no-ops and
// never re-emits the default-denied state). Installing here means every test starts default-denied
// and drives its own `platform.policy` frame — the genuinely-late-frame condition under test.
installWebviewPlatformPolicy();

function fromHost(frame: Record<string, unknown>): void {
  (bridge as unknown as { __deliver: (m: Record<string, unknown>) => void }).__deliver({ type: 'platform.policy', ...frame });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let root: Root | undefined;
let el: HTMLDivElement | undefined;

function mount(ui: Parameters<Root['render']>[0]): void {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => { root!.render(ui); });
}

beforeEach(() => {
  listeners = [];
  platformRefresh.mockClear();
  localTickets.mockClear();
  const stub = {
    addEventListener: (type: string, cb: Listener) => {
      if (type === 'message') listeners.push(cb);
    },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).addEventListener = stub.addEventListener;
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = undefined; }
  el?.remove();
  el = undefined;
});

const HYBRID: Partial<PlatformPolicySnapshot> = { connectedFeatures: true, gatewayInference: true, synchronize: false };
/** Resets the module-held policy between tests — frames mutate it, and it survives across tests. */
const DENIED: Partial<PlatformPolicySnapshot> = { connectedFeatures: false, gatewayInference: false, synchronize: false };

function resetPolicy(): void {
  fromHost({ platformPolicy: DENIED, inferenceMode: 'local-only' as InferenceMode, baseUrl: 'https://builderforce.ai' });
}

/** Stable across renders — an inline object would break `useTicketRail`'s memoization and loop. */
const INIT = { baseUrl: 'https://builderforce.ai', labels: {}, locale: undefined } as never;
const API_REQ = (async () => ({})) as never;
const PERSISTENCE = {} as never;
const NOOP = () => {};

describe('composer pickers re-derive their roster source on a late platform.policy frame', () => {
  it('the # ticket picker unions local with the server roster, never swaps, and never starves', async () => {
    mount(
      createElement(() => {
        const rail = useTicketRail({
          init: INIT,
          apiReq: API_REQ,
          serverChatId: 7,
          chatClientId: null,
          chats: [],
          persistence: PERSISTENCE,
          reloadChats: NOOP,
          reloadMessages: NOOP,
        });
        return createElement('pre', null, JSON.stringify(rail.typeaheadTickets));
      }),
    );

    // Reset the (module-held, cross-test) policy to denied, then mount re-ran the effect against
    // the denied capability — only the local ticket shows, and no rail read happened yet.
    await act(async () => { resetPolicy(); await flush(); });
    expect(JSON.parse(document.body.textContent ?? '[]')).toEqual([{ id: 9, title: 'Local ticket', status: 'open' }]);

    // The host's late frame flips connected on; the picker ADDS the server's tickets.
    await act(async () => { fromHost({ platformPolicy: HYBRID, inferenceMode: 'hybrid' as InferenceMode, baseUrl: 'https://builderforce.ai' }); await flush(); });
    expect(JSON.parse(document.body.textContent ?? '[]')).toEqual([
      { id: 101, title: 'Server ticket', status: 'open', key: 'SYNC-101' },
      { id: 9, title: 'Local ticket', status: 'open' },
    ]);
  });

  it('useCapability re-renders on the frame (the reactive source both pickers read)', async () => {
    mount(
      createElement(() => {
        const connected = useCapability('connected');
        return createElement('pre', null, String(connected));
      }),
    );

    // Default-denied after the reset frame: the capability renders false.
    await act(async () => { resetPolicy(); await flush(); });
    expect(document.body.textContent).toBe('false');

    await act(async () => { fromHost({ platformPolicy: HYBRID, inferenceMode: 'hybrid' as InferenceMode, baseUrl: 'https://builderforce.ai' }); await flush(); });
    expect(document.body.textContent).toBe('true');
  });
});
