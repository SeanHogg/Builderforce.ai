import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@builderforce/agent-run';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { AGENT_RUN_STATES, agentRunKey, agentStateFromEvents, agentStateFromSnapshot, traceRunEvents, type AgentRunSnapshot } from './agentRunState';

/**
 * An agent's state is a fold over its run's typed trace (the mapping is documented at
 * the top of `agentRunState.ts`). One scripted stream walks it through all six states.
 */
const SCRIPT: ReadonlyArray<{ event: RunEvent | null; state: string }> = [
  { event: null, state: 'idle' },
  { event: { kind: 'run.started', step: 0 }, state: 'thinking' },
  { event: { kind: 'turn.started', step: 1 }, state: 'thinking' },
  { event: { kind: 'context.tools', step: 1, advertised: 3, catalog: 9, toolsTokens: 400, loaded: [] }, state: 'thinking' },
  { event: { kind: 'tool.dispatched', step: 1, tool: 'env.fs.read', ok: true }, state: 'executing' },
  { event: { kind: 'finish.blocked', step: 2, reason: 'sign-off owed', block: 'approval' }, state: 'waiting' },
  { event: { kind: 'run.finished', step: 2, outcome: 'failed' }, state: 'failed' },
  { event: { kind: 'run.recovered', step: 3, fromStep: 2, agentId: 'reviewer' }, state: 'recovering' },
  { event: { kind: 'tool.dispatched', step: 3, tool: 'env.run', ok: true }, state: 'executing' },
  { event: { kind: 'run.finished', step: 4, outcome: 'finished' }, state: 'idle' },
];

describe('agentStateFromEvents', () => {
  it('walks a scripted stream through idle, thinking, executing, waiting, failed and recovering', () => {
    const seen: string[] = [];
    const events: RunEvent[] = [];
    for (const { event, state } of SCRIPT) {
      if (event) events.push(event);
      const now = agentStateFromEvents(events);
      expect(now).toBe(state);
      seen.push(now);
    }
    expect(new Set(seen)).toEqual(new Set(AGENT_RUN_STATES));
  });

  it('reads a paused run as waiting and a yielded one as idle', () => {
    expect(agentStateFromEvents([{ kind: 'run.started', step: 0 }, { kind: 'run.finished', step: 1, outcome: 'paused' }])).toBe('waiting');
    expect(agentStateFromEvents([{ kind: 'run.started', step: 0 }, { kind: 'run.finished', step: 1, outcome: 'yielded' }])).toBe('idle');
  });
});

const base: AgentRunSnapshot = { running: false, error: '', pendingConfirm: null, activity: null, trace: [] };
const row = (category: BrainTraceEvent['category'], label: string, args?: Record<string, unknown>): BrainTraceEvent => ({ ts: '2026-11-24T00:00:00.000Z', category, label, args });

describe('agentStateFromSnapshot', () => {
  it('is idle with no run, and failed once a run ended on an error', () => {
    expect(agentStateFromSnapshot(base)).toBe('idle');
    expect(agentStateFromSnapshot({ ...base, error: 'boom' })).toBe('failed');
  });

  it('lets the step in flight speak for the present', () => {
    expect(agentStateFromSnapshot({ ...base, running: true, activity: { phase: 'thinking', startedAt: 0, step: 1 } })).toBe('thinking');
    expect(agentStateFromSnapshot({ ...base, running: true, activity: { phase: 'tool', label: 'env.run', startedAt: 0, step: 1 } })).toBe('executing');
    expect(agentStateFromSnapshot({ ...base, running: true, pendingConfirm: { name: 'publish', args: {} } })).toBe('waiting');
  });

  it('reads a recovery nothing has settled after as recovering, and moves on once a step settles', () => {
    const recovered = [row('llm', 'llm.complete'), row('message', 'run.recovered', { step: 3, fromStep: 2 })];
    expect(agentStateFromSnapshot({ ...base, running: true, trace: recovered })).toBe('recovering');
    expect(agentStateFromSnapshot({ ...base, running: true, trace: [...recovered, row('tool', 'env.run')], activity: { phase: 'tool', startedAt: 0, step: 4 } })).toBe('executing');
  });

  it('folds the settled trace back into the events it records', () => {
    expect(traceRunEvents([row('tool', 'env.fs.read'), row('recall', 'memory'), row('message', 'run.recovered', { step: 3, fromStep: 2 })])).toEqual([
      { kind: 'tool.dispatched', step: 0, tool: 'env.fs.read', ok: true },
      { kind: 'run.recovered', step: 3, fromStep: 2 },
    ]);
  });
});

describe('agentRunKey', () => {
  it('keys one run cell per agent per session', () => {
    expect(agentRunKey('s1', 'reviewer')).toBe('agent:s1:reviewer');
  });
});
