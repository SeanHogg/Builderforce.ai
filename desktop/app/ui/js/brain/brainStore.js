// ONE picture of the brain, shared by the sidebar brain and the Evermind page: the store's
// experience overview and facts (polled here), what the tools asked the index (the
// service poll) and what the agents are doing now (the agents poll). Fast while
// something is learning, slow otherwise.
import { invoke } from "../bridge.js";
import { subscribe as subscribeService } from "../store.js";
import { subscribeAgents } from "../agentStore.js";

const LIVE_MS = 2000;
const IDLE_MS = 8000;

const state = {
  loaded: false,
  experience: null,
  experienceError: null,
  facts: { count: 0, top: [] },
  activity: [],
  recording: null,
  run: null,
  training: false,
  now: Date.now(),
};
const subscribers = new Set();
let timer = null;

const notify = () => {
  state.now = Date.now();
  for (const fn of subscribers) fn(state);
};

export function subscribeBrain(fn) {
  subscribers.add(fn);
  if (state.loaded) fn(state);
  return () => subscribers.delete(fn);
}

async function poll() {
  clearTimeout(timer);
  try {
    const r = await invoke("evermind_overview", { days: 30 });
    state.experience = r.experience;
    state.experienceError = r.experienceError;
    state.facts = r.facts;
    state.loaded = true;
    notify();
  } catch {
    // The window never breaks for a brain it cannot read yet; the next poll retries.
  }
  const live = state.training || state.recording || state.run;
  timer = setTimeout(poll, live ? LIVE_MS : IDLE_MS);
}

/** Re-read now — after learning, forgetting or teaching something. */
export const refreshBrain = poll;

/** Training runs in a command that takes minutes; the view that starts it says so here. */
export function setTraining(on) {
  state.training = on;
  notify();
  if (!on) poll();
}

subscribeService((s) => {
  state.activity = s.activity;
  if (state.loaded) notify();
});
subscribeAgents((a) => {
  const changed = !!a.recording !== !!state.recording || !!a.run !== !!state.run;
  state.recording = a.recording;
  state.run = a.run;
  // Finishing a recording or a run is new experience: read it now, not on the next tick.
  if (changed) poll();
  else if (state.loaded) notify();
});
poll();
