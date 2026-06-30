/**
 * The webview ⇄ extension-host messaging bridge.
 *
 * The React Brain app runs inside a VS Code webview (a Chromium context). It can
 * reach the gateway/API directly over HTTPS (CORS now permits the
 * `vscode-webview://` origin), so streaming + `/api/brain` persistence work with
 * no proxy. The ONLY things it can't do itself are touch the local filesystem and
 * mint a tenant token — those cross this typed postMessage bridge to the host:
 *
 *   webview → host : 'ready', 'tool.call'{id,name,args}, 'token.refresh'{id}, 'signin'
 *   host → webview : 'init'{…}, 'token'{token}, 'response'{id,ok,result|error}
 */

export interface ToolSpecMsg {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutating: boolean;
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
  const m = e.data as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string; token?: string | null } & Partial<InitData>;
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
