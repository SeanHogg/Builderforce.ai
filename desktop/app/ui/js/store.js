// ONE poll of the service's state — health, workspaces and recent activity — shared by
// every view, so switching views never re-fetches and no two views disagree.
import { call, showError } from "./bridge.js";

const POLL_BUSY_MS = 1500;
const POLL_IDLE_MS = 4000;

const state = { health: null, workspaces: [], activity: [], loaded: false };
const subscribers = new Set();
let timer = null;

export function subscribe(fn) {
  subscribers.add(fn);
  if (state.loaded) fn(state);
  return () => subscribers.delete(fn);
}

export const getState = () => state;

export const isBusy = (ws) => ws.phase.state !== "ready";

async function poll() {
  clearTimeout(timer);
  try {
    const [health, ws, activity] = await Promise.all([call("health"), call("workspaces"), call("activity")]);
    state.health = health;
    state.workspaces = ws.workspaces;
    state.activity = activity.entries;
    state.loaded = true;
    showError(null);
    for (const fn of subscribers) fn(state);
  } catch (e) {
    showError(e);
  }
  const busy = state.health?.embeddings === "loading" || state.workspaces.some(isBusy);
  timer = setTimeout(poll, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
}

/** Re-read now — after an action, rather than waiting for the next tick. */
export const refresh = poll;
