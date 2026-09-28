// WHICH Evermind the brain shows: the private one on this machine, or one of the signed-in
// workspace's Evermind models (the same models the web Studio and the VS Code extension
// show). ONE choice, shared by the sidebar brain and the Evermind page, remembered per
// machine. While a workspace model is chosen its payload is read here — slowly on its own,
// and on every read the console makes — so the brain moves when the console does.
import { accountState, subscribeAccount } from "./accountStore.js";
import { cloudRequest, consoleBundle } from "./cloudApi.js";

const KEY = "synapse.evermindSource";
const POLL_MS = 60_000;

const remembered = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v == null ? null : v === "local" ? "local" : Number(v);
  } catch {
    return null;
  }
};
const remember = (v) => {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // Private storage off: the choice lasts this session.
  }
};

const state = {
  /** "local", or the storage project id of a workspace model. */
  selected: "local",
  /** The workspace's Evermind models; null until read (or when signed out). */
  builds: null,
  buildsError: null,
  /** The chosen workspace model's payload, and when it was read. */
  data: null,
  dataError: null,
  canManage: false,
};
const subscribers = new Set();
let listedFor;
let timer = null;
let readAt = 0;

const notify = () => {
  for (const fn of subscribers) fn(state);
};

export function subscribeSource(fn) {
  subscribers.add(fn);
  fn(state);
  return () => subscribers.delete(fn);
}

export const sourceState = () => state;
export const selectedBuild = (s = state) => (s.selected === "local" ? null : (s.builds ?? []).find((b) => b.storageProjectId === s.selected) ?? null);

export function selectSource(value) {
  state.selected = value;
  state.data = null;
  state.dataError = null;
  remember(value);
  notify();
  poll();
}

/** A payload the console just read — the brain shows it at once. */
export function acceptData(projectId, data) {
  if (state.selected !== projectId) return;
  state.data = data;
  state.dataError = null;
  readAt = Date.now();
  notify();
}

async function poll() {
  clearTimeout(timer);
  const id = state.selected;
  if (id !== "local" && accountState().signedIn) {
    try {
      if (Date.now() - readAt > POLL_MS / 2 || !state.data) acceptData(id, await cloudRequest(`/api/projects/${id}/evermind/contributions`));
    } catch (e) {
      if (state.selected === id) {
        state.dataError = String(e);
        notify();
      }
    }
  }
  timer = setTimeout(poll, POLL_MS);
}

async function listBuilds(s) {
  try {
    const { loadEvermindBuilds, preferredEvermindBuild, isManagerRole } = await consoleBundle();
    const builds = await loadEvermindBuilds(cloudRequest);
    state.builds = builds;
    state.buildsError = null;
    state.canManage = isManagerRole(s.workspaces.find((w) => w.id === s.workspaceId)?.role);
    // A remembered choice that still exists wins; "local" stays local; a first sign-in
    // opens on the workspace's model, since that is what signing in was for.
    const want = remembered();
    state.selected = want === "local" ? "local" : (preferredEvermindBuild(builds, { current: typeof want === "number" ? want : null }) ?? "local");
  } catch (e) {
    state.builds = [];
    state.buildsError = String(e);
    state.selected = "local";
  }
  state.data = null;
  notify();
  poll();
}

subscribeAccount((s) => {
  const key = s.signedIn ? `${s.workspaceId}:${s.workspaces.length}` : null;
  if (key === listedFor) return;
  listedFor = key;
  if (!key) {
    Object.assign(state, { selected: "local", builds: null, buildsError: null, data: null, dataError: null, canManage: false });
    notify();
    return;
  }
  listBuilds(s);
});
