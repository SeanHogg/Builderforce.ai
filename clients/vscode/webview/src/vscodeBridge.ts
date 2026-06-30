/**
 * The webview ⇄ extension-host messaging bridge.
 *
 * The React Brain app runs inside a VS Code webview (a Chromium context). It can
 * reach the gateway/API directly over HTTPS (CORS now permits the
 * `vscode-webview://` origin), so streaming + `/api/brain` persistence work with
 * no proxy. The ONLY things it can't do itself are touch the local filesystem and
 * mint a tenant token — those cross this typed postMessage bridge to the host:
 *
 *   webview → host : 'ready', 'tool.call'{id,name,args}, 'token.refresh'{id}, 'signin',
 *                    'chats.changed', 'platform.write'{name}
 *   host → webview : 'init'{…}, 'token'{token}, 'response'{id,ok,result|error}, 'intent'{intent}
 */

export interface ToolSpecMsg {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutating: boolean;
}

/**
 * A localized string bundle the host builds from its `vscode.l10n` catalog and
 * passes through `init`, so the bundled React UI renders in the editor's display
 * language without shipping its own i18n stack (next-intl is web-only).
 */
export type LabelBundle = Record<string, string>;

/**
 * A request from the host (Sessions sidebar / task command) to drive the singleton
 * Brain panel: open a fresh chat, focus an existing one, or seed a task-scoped chat.
 */
export interface BrainIntent {
  kind: 'new' | 'focus' | 'task';
  /** For 'focus': the server chat id to load. */
  chatId?: number;
  /** For 'task': the BuilderForce task to scope a new chat to. */
  task?: { id: number; key?: string; title: string; projectId?: number };
}

export interface InitData {
  baseUrl: string;
  token: string | null;
  model?: string;
  grounding?: string;
  signedIn: boolean;
  hasWorkspace: boolean;
  /** The host's local file tools, forwarded so the model can call them over the bridge. */
  tools: ToolSpecMsg[];
  /** Localized UI strings (see {@link LabelBundle}). */
  labels: LabelBundle;
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

let token: string | null = null;
/** The latest tenant token (refreshed by the host). transport.getToken reads this. */
export const getToken = (): string | null => token;

let initData: InitData | null = null;
const initWaiters: Array<(d: InitData) => void> = [];
const tokenWaiters: Array<() => void> = [];
const intentWaiters: Array<(i: BrainIntent) => void> = [];
// Buffer intents that arrive before a subscriber mounts (the host posts `intent`
// right after `init`, but React's onIntent effect registers a tick later). Drained
// on first subscribe so a first-open focus/task intent is never lost.
const pendingIntents: BrainIntent[] = [];

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const pending = new Map<string, Pending>();
let seq = 0;

/** Fire-and-forget message to the host. */
export function post(type: string, payload?: Record<string, unknown>): void {
  api.postMessage({ type, ...(payload ?? {}) });
}

/** Request/response round-trip to the host (resolved by a matching `response`). */
export function request<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
  const id = `r${++seq}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    api.postMessage({ type, id, ...(payload ?? {}) });
  });
}

/** Resolve once the host has sent the initial config (token, baseUrl, tools…). */
export function onInit(cb: (d: InitData) => void): void {
  if (initData) cb(initData);
  else initWaiters.push(cb);
}

/** Subscribe to host-driven intents (open new chat / focus a chat / seed a task). */
export function onIntent(cb: (i: BrainIntent) => void): () => void {
  intentWaiters.push(cb);
  // Deliver any intents that arrived before this subscriber mounted.
  if (pendingIntents.length) {
    for (const i of pendingIntents.splice(0)) cb(i);
  }
  return () => {
    const i = intentWaiters.indexOf(cb);
    if (i >= 0) intentWaiters.splice(i, 1);
  };
}

/** Subscribe to token changes (re-issued on refresh / re-auth). */
export function onTokenChange(cb: () => void): () => void {
  tokenWaiters.push(cb);
  return () => {
    const i = tokenWaiters.indexOf(cb);
    if (i >= 0) tokenWaiters.splice(i, 1);
  };
}

/** Ask the host to re-exchange the tenant token (on a 401). */
export async function refreshToken(): Promise<void> {
  try {
    const r = await request<{ token: string | null }>('token.refresh');
    token = r?.token ?? token;
    for (const w of tokenWaiters) w();
  } catch {
    /* host offline / not signed in — leave the stale token */
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string; token?: string | null; intent?: BrainIntent } & Partial<InitData>;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init') {
    token = m.token ?? null;
    initData = m as InitData;
    for (const w of initWaiters.splice(0)) w(initData);
    for (const w of tokenWaiters) w();
    return;
  }
  if (m.type === 'token') {
    token = m.token ?? null;
    for (const w of tokenWaiters) w();
    return;
  }
  if (m.type === 'intent' && m.intent) {
    if (intentWaiters.length) for (const w of intentWaiters) w(m.intent);
    else pendingIntents.push(m.intent);
    return;
  }
  if (m.type === 'response' && m.id) {
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error || 'host error'));
    }
  }
});

// Announce readiness so the host sends `init`. Done at module load — before React
// mounts — so no init frame is missed.
post('ready');
