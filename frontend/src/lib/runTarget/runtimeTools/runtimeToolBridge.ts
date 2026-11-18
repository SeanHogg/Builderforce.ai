/**
 * The bridge between TABS for the browser executor of the `runtime.*` tools.
 *
 * A browser run lives in the tab whose preview started it, while the browser agent may
 * run in another tab (the Agent Worker). Same origin, so a `BroadcastChannel` reaches
 * every tab: the agent's tab asks "who holds a browser run of project N?" (with a
 * request id and a short discovery timeout), the first tab that does answers, and the
 * call goes to that tab alone. No answer in time → the caller goes to the server.
 *
 * Only a tab that holds the run answers, from its own `activeRun` — a call never
 * reaches a run another tab merely heard about.
 */
import type { RuntimeToolId } from '@builderforce/creation-canvas-contract';
import { activeRunFor, type ActiveRun } from '../activeRun';

export const RUNTIME_TOOL_CHANNEL = 'builderforce:runtime-tools';

/** How long the asking tab waits for a holder to say "here". */
export const DISCOVER_MS = 300;
/** How long it waits for the holder's answer (a verify or a capture takes a while). */
export const CALL_MS = 5 * 60_000;

type Json = Record<string, unknown>;

type BridgeMessage =
  | { type: 'discover'; requestId: string; projectId: string }
  | { type: 'here'; requestId: string; tabId: string }
  | { type: 'call'; requestId: string; tabId: string; tool: RuntimeToolId; args: Json }
  | { type: 'result'; requestId: string; result: unknown };

/** The slice of BroadcastChannel the bridge uses. */
export interface BridgeChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export type ChannelFactory = (name: string) => BridgeChannel;

const defaultChannel: ChannelFactory = (name) => new BroadcastChannel(name) as unknown as BridgeChannel;

const newId = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const isMessage = (data: unknown): data is BridgeMessage =>
  !!data && typeof data === 'object' && typeof (data as { type?: unknown }).type === 'string' && typeof (data as { requestId?: unknown }).requestId === 'string';

export interface ServeOptions {
  channel?: ChannelFactory;
  runFor?: (projectId: string) => ActiveRun | undefined;
  execute: (run: ActiveRun, tool: RuntimeToolId, args: Json) => Promise<unknown>;
}

/** Answer other tabs' calls for the browser runs THIS tab holds. Returns the stop. */
export function serveRuntimeTools(options: ServeOptions): () => void {
  const channel = (options.channel ?? defaultChannel)(RUNTIME_TOOL_CHANNEL);
  const runFor = options.runFor ?? activeRunFor;
  const tabId = newId();
  const browserRun = (projectId: string) => {
    const run = runFor(projectId);
    return run && run.session.targetId === 'browser' ? run : undefined;
  };
  const onMessage = (event: { data: unknown }) => {
    const message = event.data;
    if (!isMessage(message)) return;
    if (message.type === 'discover' && browserRun(message.projectId)) {
      channel.postMessage({ type: 'here', requestId: message.requestId, tabId });
    }
    if (message.type === 'call' && message.tabId === tabId) {
      const run = browserRun(String(message.args.projectId ?? ''));
      const reply = (result: unknown) => channel.postMessage({ type: 'result', requestId: message.requestId, result });
      if (!run) { reply({ ok: false, target: 'browser', reason: 'The browser run in that tab has stopped.' }); return; }
      options.execute(run, message.tool, message.args).then(reply, (error: unknown) => reply({
        ok: false, target: 'browser', error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  channel.addEventListener('message', onMessage);
  return () => {
    channel.removeEventListener('message', onMessage);
    channel.close();
  };
}

export type BridgeAnswer = { answered: true; result: unknown } | { answered: false };

/** Ask the tab holding project N's browser run to answer `tool`; `answered: false` when no tab does. */
export function askRuntimeTools(
  tool: RuntimeToolId, args: Json,
  options: { channel?: ChannelFactory; discoverMs?: number; callMs?: number } = {},
): Promise<BridgeAnswer> {
  if (typeof BroadcastChannel === 'undefined' && !options.channel) return Promise.resolve({ answered: false });
  const channel = (options.channel ?? defaultChannel)(RUNTIME_TOOL_CHANNEL);
  const requestId = newId();
  return new Promise<BridgeAnswer>((resolve) => {
    let holder: string | null = null;
    let timer = setTimeout(() => finish({ answered: false }), options.discoverMs ?? DISCOVER_MS);
    function finish(answer: BridgeAnswer) {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      channel.close();
      resolve(answer);
    }
    function onMessage(event: { data: unknown }) {
      const message = event.data;
      if (!isMessage(message) || message.requestId !== requestId) return;
      if (message.type === 'here' && holder === null) {
        holder = message.tabId;
        clearTimeout(timer);
        timer = setTimeout(() => finish({
          answered: true,
          result: { ok: false, target: 'browser', reason: 'The tab holding the browser run did not answer in time.' },
        }), options.callMs ?? CALL_MS);
        channel.postMessage({ type: 'call', requestId, tabId: holder, tool, args });
      }
      if (message.type === 'result') finish({ answered: true, result: message.result });
    }
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'discover', requestId, projectId: String(args.projectId ?? '') });
  });
}
