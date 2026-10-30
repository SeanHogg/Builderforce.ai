/**
 * A cursor written BEFORE the cut-over (OpenAI-shaped messages, counters at the top level) must resume the
 * same conversation on the one agent — a deploy mid-run cannot restart a ticket's run.
 */
import { describe, expect, it } from 'vitest';
import { toRunState, type CloudLoopState } from './cloudRunState';

const LEGACY = {
  step: 4,
  writtenPaths: ['src/a.ts'],
  messages: [
    { role: 'system', content: 'You are the agent.' },
    { role: 'user', content: 'Fix the bug.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
  ],
  noDeliverableBlocked: true,
  placeholderBlocks: 1,
  ciPendingBlocks: 2,
  policyAskedGates: ['g1|run_command|deadbeef'],
  taskState: { goal: 'fix it', nextStep: 'write' },
  loadedTools: ['deploy_site'],
  modelPolicy: { policy: { phase: 'code', model: 'm-1', locked: true } as never, stallRecoveries: 2 },
} as unknown as CloudLoopState;

describe('toRunState — legacy cursors', () => {
  it('reads a cursor that already carries the agent state as it is', () => {
    const run = { messages: [], step: 9 } as never;
    expect(toRunState({ run } as CloudLoopState)).toBe(run);
  });

  it('has nothing to resume from on a fresh run', () => {
    expect(toRunState(undefined)).toBeUndefined();
    expect(toRunState({} as CloudLoopState)).toBeUndefined();
  });

  it('converts the transcript, the counters, the gates, the task state and the loaded tools', () => {
    const run = toRunState(LEGACY)!;
    expect(run.step).toBe(4);
    expect(run.writtenPaths).toEqual(['src/a.ts']);
    expect(run.messages[2]).toEqual({ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"src/a.ts"}' }] });
    expect(run.messages[3]).toEqual({ role: 'tool', content: '{"ok":true}', toolCallId: 'c1' });
    expect(run.finish).toMatchObject({ noDeliverableBlocked: true, placeholderBlocks: 1, ciPendingBlocks: 2 });
    // A key recorded at ASK time is not an approval: with no confirmation from the approval record nothing resumes pre-approved.
    expect(run.approvedCalls).toEqual([]);
    expect(toRunState(LEGACY, ['g1|run_command|deadbeef'])!.approvedCalls).toEqual(['g1|run_command|deadbeef']);
    expect(run.askedGates).toEqual([]);
    expect(run.taskState).toEqual({ goal: 'fix it', nextStep: 'write' });
    expect(run.loadedTools).toEqual(['deploy_site']);
    expect(run.stall).toEqual({ model: 'm-1', recoveriesUsed: 2 });
  });

  it('a cursor older than the model policy resumes on its locked model with the run-start defaults', () => {
    const run = toRunState({ step: 1, messages: [{ role: 'user', content: 'x' }], pinnedModel: 'locked-model' } as unknown as CloudLoopState)!;
    expect(run.model.model).toBe('locked-model');
    expect(run.model.pin).toBe('locked-model');
  });
});
