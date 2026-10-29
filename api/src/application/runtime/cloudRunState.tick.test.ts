/**
 * A cursor written BEFORE the cut-over, taken through `toRunState` into a REAL next tick of the one agent (PRD 35 WS3).
 * A deploy mid-run must resume the same conversation — the converted transcript is what the model is asked, the converted
 * counters are what the gates read, and the migrated task state and loaded tools are what the policy carries on.
 */
import { describe, expect, it } from 'vitest';
import { runAgent, type ModelRequest, type RunPolicy, type RunPorts, type RunState } from '@builderforce/agent-run';
import { toRunState, type CloudLoopState } from './cloudRunState';

const LEGACY = {
  step: 2,
  writtenPaths: ['src/a.ts'],
  messages: [
    { role: 'system', content: 'You are the agent.' },
    { role: 'user', content: 'Fix the bug.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'tool_search', arguments: '{"query":"deploy"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
  ],
  noDeliverableBlocked: true,
  placeholderBlocks: 1,
  taskState: { goal: 'fix it', nextStep: 'write' },
  loadedTools: ['deploy_site'],
  modelPolicy: { policy: { phase: 'code', model: 'm-1', locked: true, pin: 'm-1', strictPin: false, broken: [], proven: [], tried: [], failovers: 0, turnRetries: 0, planTurns: 0, handOffForced: false, codeTurns: 0, changeForced: false, outcome: { kind: 'none' }, options: {} } as never, stallRecoveries: 1, forceToolChoice: 'required' as const },
} as unknown as CloudLoopState;

const POLICY: RunPolicy = {
  entryPoint: 'cloud', toolScope: 'ticket', role: 'code', levers: ['c3_task_state'], budgets: {}, inference: 'hybrid', verify: 'none',
  approvalGates: [], delegation: { requested: false, readsBeforeNudge: 6 },
};

describe('a legacy cursor through a real next tick', () => {
  it('asks the model the SAME conversation, with its task state, loaded tool and forced tool choice carried on, then finishes', async () => {
    const resume = toRunState(LEGACY)!;
    const requests: ModelRequest[] = [];
    let saved: RunState | undefined;
    const ports: RunPorts = {
      model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return { content: 'All done.' }; } },
      capabilities: { capabilities: new Set() },
      store: { load: () => resume, save: (s) => { saved = s; } },
      events: { emit: () => undefined },
      human: { ask: async () => ({ kind: 'paused' }) },
      context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    };
    const outcome = await runAgent({ task: { prompt: 'Fix the bug.', dispatch: { source: 'chat' } }, policy: POLICY, ports, resume, maxSteps: 1 });
    expect(outcome.kind).toBe('finished');
    const sent = requests[0]!;
    // The converted transcript, in the agent's own row shape.
    expect(sent.messages.slice(0, 4)).toEqual([
      { role: 'system', content: 'You are the agent.' },
      { role: 'user', content: 'Fix the bug.' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'tool_search', arguments: '{"query":"deploy"}' }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1' },
    ]);
    // The migrated task state rides this turn's tail; the loaded tool stays advertised; the forced tool choice is spent on it.
    expect(sent.messages[sent.messages.length - 1]!.content).toContain('Goal: fix it');
    expect(saved?.loadedTools).toEqual(['deploy_site']);
    expect(sent.toolChoice).toBe('required');
    expect(saved?.writtenPaths).toEqual(['src/a.ts']);
    expect(saved?.finish).toMatchObject({ noDeliverableBlocked: true, placeholderBlocks: 1 });
    expect(saved?.forceToolChoice).toBeUndefined();
  });
});
