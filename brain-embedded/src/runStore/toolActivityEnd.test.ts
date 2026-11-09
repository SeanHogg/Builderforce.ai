import { describe, expect, it } from 'vitest';
import { getRunSnapshot, startRun, subscribeRun } from '../brainRunStore';
import { BETWEEN_TURNS_LABEL, describeLiveStep } from '../runActivity';

describe('a tool step ENDS when its result returns', () => {
  const persistence = { sendMessages: async () => [] };

  it('regression: chat #60338 - remember_fact read "running 3m53s, loop step 2" while the next turn was being prepared', async () => {
    const phases: string[] = [];
    let betweenLine = '';
    const unsubscribe = subscribeRun(4501, () => {
      const a = getRunSnapshot(4501).activity;
      const key = a ? `${a.phase}:${a.label ?? ''}` : 'idle';
      if (a?.label === BETWEEN_TURNS_LABEL && !betweenLine) betweenLine = describeLiveStep(a, a.startedAt + 1000);
      if (phases[phases.length - 1] !== key) phases.push(key);
    });
    let turn = 0;
    await startRun(4501, {
      resolvedSystemPrompt: 'sys',
      tools: [{ type: 'function', function: { name: 'remember_fact', description: 'r', parameters: {} } }],
      runTool: async () => ({ ok: true }),
      stream: async (opts) => {
        turn += 1;
        if (opts.tools === undefined || turn > 1) return { text: 'Remembered.', toolCalls: [], finishReason: 'stop' };
        return { text: '', toolCalls: [{ id: 'c1', name: 'remember_fact', args: JSON.stringify({ key: 'k', fact: 'f' }) }], finishReason: 'tool_calls' };
      },
      persistence,
      userTurn: 'remember that',
    });
    unsubscribe();

    const toolAt = phases.indexOf('tool:remember_fact');
    expect(toolAt).toBeGreaterThanOrEqual(0);
    // The very next live step is NOT the tool any more: it is the run preparing its next turn.
    expect(phases[toolAt + 1]).toBe(`thinking:${BETWEEN_TURNS_LABEL}`);
    expect(betweenLine).toContain('preparing the next model turn');
    expect(betweenLine).not.toContain('remember_fact');
    expect(getRunSnapshot(4501).activity).toBeNull();
  });
});
