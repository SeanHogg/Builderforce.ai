import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webview's fetch and WebSocket are not the host's. These tests call the installed
 * globals, so deleting the gate (the fetch patch or the WebSocket subclass) makes them fail.
 */

type Listener = (event: { data: unknown }) => void;

let listeners: Listener[];
let nativeFetch: ReturnType<typeof vi.fn>;

class NativeSocket {
  static instances: NativeSocket[] = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    NativeSocket.instances.push(this);
  }
}

beforeEach(() => {
  vi.resetModules();
  listeners = [];
  NativeSocket.instances = [];
  nativeFetch = vi.fn(async () => new Response('ok', { status: 200 }));
  const stub = {
    addEventListener: (type: string, cb: Listener) => {
      if (type === 'message') listeners.push(cb);
    },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).addEventListener = stub.addEventListener;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  });
  globalThis.fetch = nativeFetch as unknown as typeof fetch;
  (globalThis as Record<string, unknown>).WebSocket = NativeSocket;
});

function fromHost(frame: Record<string, unknown>): void {
  for (const listener of listeners) listener({ data: frame });
}

/** The class identity differs across the reset module graph; the denial itself does not. */
async function expectDenied(pending: Promise<unknown>, capability: string): Promise<void> {
  await expect(pending).rejects.toMatchObject({
    name: 'PlatformAccessDenied',
    code: 'PLATFORM_ACCESS_DENIED',
    message: `platform_${capability.replaceAll('-', '_')}_disabled`,
  });
}

async function install(): Promise<void> {
  const mod = await import('./platformPolicy');
  mod.installWebviewPlatformPolicy();
}

describe('webview platform gate', () => {
  const HYBRID = { gatewayInference: true, connectedFeatures: true, synchronize: false };

  it('before the host names a mode (Local only): refuses inference and content, lets ordinary data through', async () => {
    await install();

    await expectDenied(fetch('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' }), 'gateway-inference');
    await expectDenied(fetch('https://api.builderforce.ai/api/brain/chats/3/messages'), 'connected-feature');
    expect(() => new WebSocket('wss://api.builderforce.ai/api/meetings/rooms/room/ws')).toThrow(/platform_connected_feature_disabled/);
    expect(NativeSocket.instances).toHaveLength(0);
    expect(nativeFetch).not.toHaveBeenCalled();

    const ordinary = await fetch('https://api.builderforce.ai/api/brain/chats');
    expect(ordinary.status).toBe(200);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it("signed-in Hybrid with sync off: a run's writes, transcript and stream go — the web's answer for the same URL", async () => {
    await install();
    fromHost({
      type: 'platform.policy',
      platformPolicy: HYBRID,
      inferenceMode: 'hybrid',
      baseUrl: 'https://corp.example/gateway',
      webUrl: 'https://web.corp.example',
    });

    // 2026.10.57 refused this write as `synchronize` (a strict per-capability check).
    await fetch('https://corp.example/api/brain/chats', { method: 'POST' });
    await fetch('https://api.builderforce.ai/api/projects/11/tickets', { method: 'POST' });
    await fetch('https://api.builderforce.ai/api/brain/chats/3/messages', { method: 'POST' });
    await fetch('https://api.builderforce.ai/api/brain/stream', { method: 'POST' });
    expect(nativeFetch).toHaveBeenCalledTimes(4);
    expect(() => new WebSocket('wss://api.builderforce.ai/api/meetings/rooms/room/ws')).not.toThrow();
    expect(NativeSocket.instances).toHaveLength(1);

    // The named sync transport still answers to the sync switch.
    await expectDenied(fetch('https://api.builderforce.ai/api/sync/v1/push', { method: 'POST' }), 'synchronize');
    expect(nativeFetch).toHaveBeenCalledTimes(4);
  });

  it('applies the snapshot and mode carried on init', async () => {
    await install();
    fromHost({
      type: 'init',
      platformPolicy: HYBRID,
      inferenceMode: 'hybrid',
      baseUrl: 'https://builderforce.ai/gateway',
      token: null,
    });
    await fetch('https://builderforce.ai/api/brain/chats/3/messages', { method: 'POST' });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('does not let a connected-feature grant open the gateway', async () => {
    await install();
    fromHost({
      type: 'platform.policy',
      platformPolicy: { connectedFeatures: true, gatewayInference: false },
      inferenceMode: 'hybrid',
      baseUrl: 'https://builderforce.ai',
    });
    await expectDenied(fetch('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' }), 'gateway-inference');
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('leaves a non-platform call alone while the platform is denied', async () => {
    await install();
    await fetch('http://127.0.0.1:11434/api/tags');
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(() => new WebSocket('ws://127.0.0.1:9')).not.toThrow();
    expect(NativeSocket.instances).toHaveLength(1);
  });
});
