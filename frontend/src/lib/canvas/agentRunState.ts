import type { RunEvent } from '@builderforce/agent-run';
import type { BrainRunActivity, BrainRunSnapshot, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';

/**
 * WHAT AN AGENT IN THE ROOM IS DOING — one of six states, read off its run, never off
 * an animation.
 *
 * The vocabulary is W12's `AgentRunState` (`@seanhogg/builderforce-webcontainers-core`
 * `agents/contract.ts`). The frontend does not depend on the core package (it takes the
 * published runtime only), so the union is restated here ONCE, word for word; a station,
 * its face and its panel all read it from this module.
 *
 * ── THE MAPPING (one table, {@link EVENT_STATE}) ─────────────────────────────────
 * A run's typed trace is folded left to right; the LAST event the table names decides:
 *  • `run.started`, `turn.started`, `model.*`, `steer.applied`, `turn.finished`  → thinking
 *    (a model call is open, or the next one is about to be);
 *  • `tool.dispatched`                                                         → executing;
 *  • `finish.blocked`, `policy.blocked`                                        → waiting
 *    (the run cannot go on until someone signs off or changes the rules);
 *  • `run.recovered`, `stall.recovered`                                        → recovering
 *    (a resumed run picking up, or a stalled turn sent back);
 *  • `run.finished` by outcome: `failed` → failed, `paused` → waiting,
 *    `finished` / `yielded` → idle;
 *  • no events at all                                                          → idle.
 * Every other event (context, budget, routing notes) says nothing about the state and
 * leaves it where it was.
 *
 * ── FROM THE LIVE SNAPSHOT ───────────────────────────────────────────────────────
 * A mounted station reads `useRunSnapshot`, whose `trace` is the settled past and whose
 * `activity` is the step in flight. {@link agentStateFromSnapshot} folds the trace back
 * into the events it records ({@link traceRunEvents}) and lets the in-flight step,
 * when there is one, speak for the present ({@link ACTIVITY_STATE}).
 *
 * Pure: no React, no I/O.
 */
export type AgentRunState = 'idle' | 'thinking' | 'executing' | 'waiting' | 'failed' | 'recovering';

/** Every state, in the order a legend lists them. */
export const AGENT_RUN_STATES: readonly AgentRunState[] = ['idle', 'thinking', 'executing', 'waiting', 'failed', 'recovering'];

type EventState = AgentRunState | ((event: RunEvent) => AgentRunState);

const OUTCOME_STATE: Readonly<Record<Extract<RunEvent, { kind: 'run.finished' }>['outcome'], AgentRunState>> = {
  finished: 'idle',
  yielded: 'idle',
  paused: 'waiting',
  failed: 'failed',
};

/** The one table: what each state-bearing event says the agent is doing. */
const EVENT_STATE: Readonly<Partial<Record<RunEvent['kind'], EventState>>> = {
  'run.started': 'thinking',
  'turn.started': 'thinking',
  'model.completed': 'thinking',
  'model.cascade': 'thinking',
  'model.coder_reask': 'thinking',
  'steer.applied': 'thinking',
  'turn.finished': 'thinking',
  'tool.dispatched': 'executing',
  'finish.blocked': 'waiting',
  'policy.blocked': 'waiting',
  'run.recovered': 'recovering',
  'stall.recovered': 'recovering',
  'run.finished': (event) => OUTCOME_STATE[(event as Extract<RunEvent, { kind: 'run.finished' }>).outcome] ?? 'idle',
};

/** The agent's state after `events`, in order. */
export function agentStateFromEvents(events: readonly RunEvent[]): AgentRunState {
  return events.reduce<AgentRunState>((state, event) => {
    const mapped = EVENT_STATE[event.kind];
    if (mapped === undefined) return state;
    return typeof mapped === 'function' ? mapped(event) : mapped;
  }, 'idle');
}

/** The in-flight step's state, while one is open. */
const ACTIVITY_STATE: Readonly<Record<BrainRunActivity['phase'], AgentRunState>> = {
  starting: 'thinking',
  thinking: 'thinking',
  writing: 'thinking',
  composing: 'thinking',
  finishing: 'thinking',
  tool: 'executing',
  awaiting: 'waiting',
};

/** Every category a settled trace step has — the history's labels. A Record, so a new category fails to compile until it is listed. */
const TRACE_CATEGORY_SET: Readonly<Record<BrainTraceEvent['category'], true>> = {
  llm: true, tool: true, message: true, error: true, recall: true, learn: true, reconcile: true,
};
export const TRACE_CATEGORIES = Object.keys(TRACE_CATEGORY_SET) as ReadonlyArray<BrainTraceEvent['category']>;

/** The trace's category for each settled step that stands for a RunEvent. */
const TRACE_CATEGORY_EVENT: Readonly<Partial<Record<BrainTraceEvent['category'], (row: BrainTraceEvent) => RunEvent>>> = {
  llm: () => ({ kind: 'model.completed', step: 0 }),
  tool: (row) => ({ kind: 'tool.dispatched', step: 0, tool: row.label, ok: !row.isError }),
};

/** Trace rows the event sink labels with the RunEvent's own kind (`traceStepFor`). */
const TRACE_LABEL_EVENT: Readonly<Record<string, (row: BrainTraceEvent) => RunEvent>> = {
  'run.recovered': (row) => ({ kind: 'run.recovered', step: stepOf(row), fromStep: numberArg(row, 'fromStep') }),
  'steer.applied': (row) => ({ kind: 'steer.applied', step: stepOf(row) }),
};

function numberArg(row: BrainTraceEvent, key: string): number {
  const value = (row.args as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'number' ? value : 0;
}

function stepOf(row: BrainTraceEvent): number {
  return numberArg(row, 'step');
}

/** The RunEvents a settled trace records, in order. Rows that stand for none are skipped. */
export function traceRunEvents(trace: readonly BrainTraceEvent[]): RunEvent[] {
  return trace.flatMap((row) => {
    const make = TRACE_LABEL_EVENT[row.label] ?? TRACE_CATEGORY_EVENT[row.category];
    return make ? [make(row)] : [];
  });
}

export type AgentRunSnapshot = Pick<BrainRunSnapshot, 'running' | 'error' | 'pendingConfirm' | 'activity' | 'trace'>;

/**
 * The agent's state from its live run snapshot. Precedence, highest first: a confirm
 * the run is held on (waiting); a recovery nothing has settled after yet (recovering);
 * the step in flight; and, once the run is over, failed when it ended on an error,
 * otherwise idle.
 */
export function agentStateFromSnapshot(snapshot: AgentRunSnapshot): AgentRunState {
  const settled = agentStateFromEvents(traceRunEvents(snapshot.trace));
  if (!snapshot.running) return snapshot.error || settled === 'failed' ? 'failed' : 'idle';
  if (snapshot.pendingConfirm) return 'waiting';
  if (settled === 'recovering') return 'recovering';
  return ACTIVITY_STATE[snapshot.activity?.phase ?? 'starting'];
}

/** The run-store key an agent's run lives under — one cell per agent per session. */
export function agentRunKey(sessionId: string, agentId: string): string {
  return `agent:${sessionId}:${agentId}`;
}

/** States a station shows as needing someone's attention. */
export const ATTENTION_STATES: ReadonlySet<AgentRunState> = new Set<AgentRunState>(['waiting', 'failed']);
