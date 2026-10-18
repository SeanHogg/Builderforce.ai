/**
 * The host-pushed STATE the bridge keeps: the tenant token, the `init` frame, the live
 * editor context and pending changes, host intents and refresh requests — each with
 * its getter and subscription. Every frame lands through the transport's ONE message
 * listener ({@link handleFrame}).
 *
 * Import from `./vscodeBridge`, which re-exports everything here.
 */

import type { EditorContext } from '../../src/idePersona';
import type { PendingChangeSet } from '../../src/gitChangeModel';
import type { BrainIntent, InitData } from './bridgeTypes';
import { handleFrame, request, subscribe } from './bridgeTransport';

let token: string | null = null;
/** The latest tenant token (refreshed by the host). transport.getToken reads this. */
export const getToken = (): string | null => token;

let initData: InitData | null = null;
const initWaiters: Array<(d: InitData) => void> = [];
const tokenWaiters: Array<() => void> = [];
const intentWaiters: Array<(i: BrainIntent) => void> = [];
const refreshWaiters: Array<() => void> = [];

// The latest editor context (active file / selection / open tabs), pushed live by the
// host so the ambient system channel always reflects what the user is looking at.
let editorContext: EditorContext | undefined;
const editorContextWaiters: Array<(c: EditorContext | undefined) => void> = [];
export const getEditorContext = (): EditorContext | undefined => editorContext;

/** Subscribe to live editor-context updates (active file / selection / open tabs). */
export function onEditorContext(cb: (c: EditorContext | undefined) => void): () => void {
  return subscribe(editorContextWaiters, cb);
}

// The workspace's uncommitted work, pushed live by the host: a stage, a commit, a
// checkout, or one of this panel's own mutating tools all move it, and the chat is
// where the user is looking when they do.
let pendingChanges: PendingChangeSet | undefined;
const pendingChangesWaiters: Array<(c: PendingChangeSet | undefined) => void> = [];
export const getPendingChanges = (): PendingChangeSet | undefined => pendingChanges;

/** Subscribe to live pending-change updates (what is edited but not committed). */
export function onPendingChanges(cb: (c: PendingChangeSet | undefined) => void): () => void {
  return subscribe(pendingChangesWaiters, cb);
}

// Buffer intents that arrive before a subscriber mounts (the host posts `intent`
// right after `init`, but React's onIntent effect registers a tick later). Drained
// on first subscribe so a first-open focus/task intent is never lost.
const pendingIntents: BrainIntent[] = [];

/**
 * Subscribe to the host's init frame. The host re-posts `init` on every project /
 * model / auth change (BrainWebview.refresh → sendInit), so this stays SUBSCRIBED
 * (it does not fire-once) — otherwise the running panel would keep the stale
 * project after a sidebar project switch, and the header + chat dropdown would
 * scope to the wrong project. Delivers the current frame immediately if one has
 * already arrived. Returns an unsubscribe.
 */
export function onInit(cb: (d: InitData) => void): () => void {
  const off = subscribe(initWaiters, cb);
  if (initData) cb(initData);
  return off;
}

/** Subscribe to host-driven intents (open new chat / focus a chat / seed a task). */
export function onIntent(cb: (i: BrainIntent) => void): () => void {
  const off = subscribe(intentWaiters, cb);
  // Deliver any intents that arrived before this subscriber mounted.
  if (pendingIntents.length) {
    for (const i of pendingIntents.splice(0)) cb(i);
  }
  return off;
}

/** Subscribe to host-driven refresh requests (e.g. a sidebar view's title-bar
 *  refresh action), so a screen can reload its data in place. Returns an unsubscribe. */
export function onRefresh(cb: () => void): () => void {
  return subscribe(refreshWaiters, cb);
}

/** Subscribe to token changes (re-issued on refresh / re-auth). */
export function onTokenChange(cb: () => void): () => void {
  return subscribe(tokenWaiters, cb);
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

handleFrame('init', (m) => {
  token = (m.token as string | null | undefined) ?? null;
  initData = m as unknown as InitData;
  editorContext = initData.editorContext;
  pendingChanges = initData.pendingChanges;
  // Notify without draining — the host re-posts `init` on project/model/auth
  // changes, and subscribers (App's setInit) must keep receiving those updates.
  for (const w of initWaiters.slice()) w(initData);
  for (const w of tokenWaiters) w();
});

handleFrame('editorContext', (m) => {
  editorContext = m.editorContext as EditorContext | undefined;
  for (const w of editorContextWaiters) w(editorContext);
});

handleFrame('pendingChanges', (m) => {
  pendingChanges = m.pendingChanges as PendingChangeSet | undefined;
  for (const w of pendingChangesWaiters) w(pendingChanges);
});

handleFrame('token', (m) => {
  token = (m.token as string | null | undefined) ?? null;
  for (const w of tokenWaiters) w();
});

handleFrame('intent', (m) => {
  const intent = m.intent as BrainIntent | undefined;
  if (!intent) return false;
  if (intentWaiters.length) for (const w of intentWaiters) w(intent);
  else pendingIntents.push(intent);
});

handleFrame('refresh', () => {
  for (const w of refreshWaiters.slice()) w();
});
