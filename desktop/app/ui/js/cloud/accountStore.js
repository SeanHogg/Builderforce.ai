// ONE poll of the builderforce.ai account — signed in or not, a browser sign-in waiting
// for approval, the workspace in use and the workspaces to switch to — shared by the
// sidebar and the Chat page. Fast while a sign-in waits, slow otherwise.
import { invoke } from "../bridge.js";

const WAITING_MS = 1500;
const IDLE_MS = 15000;

const state = { loaded: false, signedIn: false, signIn: { state: "Idle" }, expired: false, workspaceId: null, reachable: true, error: null, web: "", workspaces: [] };
const subscribers = new Set();
let timer = null;
let listedFor = null;

export function subscribeAccount(fn) {
  subscribers.add(fn);
  if (state.loaded) fn(state);
  return () => subscribers.delete(fn);
}

export const accountState = () => state;

async function poll() {
  clearTimeout(timer);
  try {
    Object.assign(state, { workspaceId: null, error: null, reachable: true }, await invoke("account_state"), { loaded: true });
    // The workspace list changes rarely: read it once per sign-in.
    if (state.signedIn && state.reachable && listedFor !== state.workspaceId) {
      const r = await invoke("account_workspaces").catch(() => null);
      if (r) {
        state.workspaces = r.workspaces ?? [];
        listedFor = state.workspaceId;
      }
    }
    if (!state.signedIn) {
      state.workspaces = [];
      listedFor = null;
    }
    for (const fn of subscribers) fn(state);
  } catch {
    // The account never breaks the window; the next poll retries.
  }
  timer = setTimeout(poll, state.signIn?.state === "Waiting" ? WAITING_MS : IDLE_MS);
}

/** Re-read now — after signing in or out, or switching workspace. */
export const refreshAccount = poll;

export async function signIn() {
  await invoke("account_sign_in");
  await poll();
}
export async function cancelSignIn() {
  await invoke("account_sign_in_cancel");
  await poll();
}
export async function signOut() {
  await invoke("account_sign_out");
  listedFor = null;
  await poll();
}
export async function selectWorkspace(id) {
  await invoke("account_select_workspace", { id });
  listedFor = null;
  await poll();
}
export const openWeb = (path) => invoke("account_open_web", { path });

/** The current workspace's name, when the list has it. */
export function workspaceName(s = state) {
  return s.workspaces.find((w) => w.id === s.workspaceId)?.name ?? "";
}

poll();
