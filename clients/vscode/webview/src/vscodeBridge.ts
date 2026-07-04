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
 *   host → webview : 'init'{…}, 'token'{token}, 'response'{id,ok,result|error}, 'intent'{intent},
 *                    'editorContext'{editorContext}
 */

import type { EditorContext } from '../../src/idePersona';

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
  kind: 'new' | 'focus' | 'task' | 'seed' | 'revalidate';
  /** For 'focus': the server chat id to load. */
  chatId?: number;
  /** For 'seed': open a fresh chat with this prompt pre-filled in the composer, so an
   *  editor entry point (review PRs / fix errors / open a PR) hands the unified Brain a
   *  job to do with its shared platform + git tools. */
  text?: string;
  /** For 'task': the BuilderForce task to scope a new chat to. `dispatched` marks a
   *  task that was just handed to the platform runtime, so the seed nudges the Brain
   *  to monitor the run (via the `executions.*` platform tools) rather than start work. */
  task?: { id: number; key?: string; title: string; projectId?: number; dispatched?: boolean };
}

export interface InitData {
  baseUrl: string;
  token: string | null;
  model?: string;
  grounding?: string;
  signedIn: boolean;
  hasWorkspace: boolean;
  /** The live editor context (active file / selection / open tabs) at init time.
   *  Kept fresh afterwards via `editorContext` messages (see {@link onEditorContext}). */
  editorContext?: EditorContext;
  /** Which screen this webview should render. The bundled React app is multi-screen:
   *  the host decides via `init` which surface this panel is — the Brain chat (default),
   *  Project 360, or a list-shaped project page (Backlog / PRDs) — same bundle, same
   *  transport, one code path. */
  view?: 'brain' | 'project360' | 'backlog' | 'prd' | 'roadmap' | 'retros' | 'poker';
  /** The sidebar's active BuilderForce project — injected into the system prompt so
   *  the Brain scopes platform tools to it, and used to scope new chats. */
  project?: { id: number; name: string };
  /** `projectId → name` for every known project, so the header can name the project
   *  an EXISTING chat belongs to (not just the sidebar's active one). Keys are
   *  stringified ids (JSON). Best-effort — an unknown id falls back to "No project". */
  projectNames?: Record<string, string>;
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

// The latest editor context (active file / selection / open tabs), pushed live by the
// host so the ambient system channel always reflects what the user is looking at.
let editorContext: EditorContext | undefined;
const editorContextWaiters: Array<(c: EditorContext | undefined) => void> = [];
export type { EditorContext };
export const getEditorContext = (): EditorContext | undefined => editorContext;

/** Subscribe to live editor-context updates (active file / selection / open tabs). */
export function onEditorContext(cb: (c: EditorContext | undefined) => void): () => void {
  editorContextWaiters.push(cb);
  return () => {
    const i = editorContextWaiters.indexOf(cb);
    if (i >= 0) editorContextWaiters.splice(i, 1);
  };
}
// Buffer intents that arrive before a subscriber mounts (the host posts `intent`
// right after `init`, but React's onIntent effect registers a tick later). Drained
// on first subscribe so a first-open focus/task intent is never lost.
const pendingIntents: BrainIntent[] = [];

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();
let seq = 0;

/** A never-answered request (the host dropped its response, or the panel was torn
 *  down mid-flight) would otherwise leak its promise + Map entry for the life of the
 *  webview. Reject + evict after this long so nothing accumulates. Generous, so a
 *  legitimately slow round-trip (a file picker the user leaves open, a slow tool)
 *  still resolves normally. */
const REQUEST_TIMEOUT_MS = 300_000;

/** Reject + evict a pending entry (timeout / teardown), clearing its timer. */
function settlePending(id: string, error: Error): void {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  p.reject(error);
}

/** Fire-and-forget message to the host. */
export function post(type: string, payload?: Record<string, unknown>): void {
  api.postMessage({ type, ...(payload ?? {}) });
}

/** Request/response round-trip to the host (resolved by a matching `response`). */
export function request<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
  const id = `r${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => settlePending(id, new Error(`Request "${type}" timed out`)), REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    api.postMessage({ type, id, ...(payload ?? {}) });
  });
}

// Reject every in-flight request when the webview is torn down (the panel was
// disposed / navigated away), so no promise is left dangling.
window.addEventListener('pagehide', () => {
  for (const id of [...pending.keys()]) settlePending(id, new Error('webview closed'));
});

/** Resolve once the host has sent the initial config (token, baseUrl, tools…). */
/**
 * Subscribe to the host's init frame. The host re-posts `init` on every project /
 * model / auth change (BrainWebview.refresh → sendInit), so this stays SUBSCRIBED
 * (it does not fire-once) — otherwise the running panel would keep the stale
 * project after a sidebar project switch, and the header + chat dropdown would
 * scope to the wrong project. Delivers the current frame immediately if one has
 * already arrived. Returns an unsubscribe.
 */
export function onInit(cb: (d: InitData) => void): () => void {
  initWaiters.push(cb);
  if (initData) cb(initData);
  return () => {
    const i = initWaiters.indexOf(cb);
    if (i >= 0) initWaiters.splice(i, 1);
  };
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
  const m = e.data as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string; token?: string | null; intent?: BrainIntent; editorContext?: EditorContext } & Partial<InitData>;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init') {
    token = m.token ?? null;
    initData = m as InitData;
    editorContext = initData.editorContext;
    // Notify without draining — the host re-posts `init` on project/model/auth
    // changes, and subscribers (App's setInit) must keep receiving those updates.
    for (const w of initWaiters.slice()) w(initData);
    for (const w of tokenWaiters) w();
    return;
  }
  if (m.type === 'editorContext') {
    editorContext = m.editorContext;
    for (const w of editorContextWaiters) w(editorContext);
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
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error || 'host error'));
    }
  }
});

// Announce readiness so the host sends `init`. Done at module load — before React
// mounts — so no init frame is missed.
post('ready');
