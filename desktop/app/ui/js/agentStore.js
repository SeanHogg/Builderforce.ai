// ONE poll of Self-Directed Agents' live state — the opt-in, the recording, the running
// skill and its pending approval — shared by every view and the approval prompt. Fast
// while something is happening, slow otherwise.
import { invoke, showError } from "./bridge.js";

const LIVE_MS = 700;
const IDLE_MS = 4000;

const state = { loaded: false, supported: false, enabled: false, consentedAt: null, modelFile: null, takeoverKey: "Esc", recording: null, run: null };
const subscribers = new Set();
let timer = null;

export function subscribeAgents(fn) {
  subscribers.add(fn);
  if (state.loaded) fn(state);
  return () => subscribers.delete(fn);
}

export const agentState = () => state;

async function poll() {
  clearTimeout(timer);
  try {
    Object.assign(state, await invoke("agents_state"), { loaded: true });
    for (const fn of subscribers) fn(state);
  } catch (e) {
    showError(e);
  }
  timer = setTimeout(poll, state.recording || state.run ? LIVE_MS : IDLE_MS);
}

/** Re-read now — after starting, stopping or deciding something. */
export const refreshAgents = poll;
