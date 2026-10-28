import { describe, expect, it, vi } from 'vitest';
import { emptyCalibration } from './calibrate';
import { defineRegistry } from './registry';
import { belowAnswerThreshold, runGate } from './runGate';
import type { PrefetchPort, PrefetchResult } from './types';

/** One answer row whose rule matches everything, returning `result`. */
function port(result: PrefetchResult, calibration = emptyCalibration()): PrefetchPort {
  return {
    registry: defineRegistry([
      { id: 'knowledge.ask', kind: 'answer', sideEffect: 'read', surfaces: ['vscode'], patterns: [/\S/], examples: [], budgetMs: 1_000, labelKey: 'prefetch.action.knowledge.ask' },
    ]),
    executors: { 'knowledge.ask': { run: async () => result } },
    ports: { surface: 'vscode', calibration },
  };
}

describe('runGate — an answer whose own evidence is short of its threshold', () => {
  it('settles when the confidence clears the learned answer threshold', async () => {
    const adopt = vi.fn(async () => true);
    const pass = await runGate('where is billing handled', port({ actionId: 'knowledge.ask', text: 'ANSWER', context: 'CONTEXT', confidence: 1 }), { adopt });
    expect(pass?.settled).toBe('answer');
    expect(adopt).toHaveBeenCalledOnce();
  });

  it('rides the tail as PREFETCH context below it, never offered for adoption', async () => {
    const adopt = vi.fn(async () => true);
    const pass = await runGate('where is billing handled', port({ actionId: 'knowledge.ask', text: 'ANSWER', context: 'CONTEXT', confidence: 0.4 }), { adopt });
    expect(adopt).not.toHaveBeenCalled();
    expect(pass?.settled).toBe('prefetch');
    expect(pass?.tail).toEqual(['CONTEXT']);
    expect(pass?.lead?.action.id).toBe('knowledge.ask');
  });

  it('follows the LEARNED threshold, not the cold one', async () => {
    const calibration = { ...emptyCalibration(), thresholds: { 'knowledge.ask': { answer: 0.3, prefetch: 0.6, n: 40 } } };
    const result: PrefetchResult = { actionId: 'knowledge.ask', text: 'A', confidence: 0.4 };
    expect(belowAnswerThreshold(port(result), port(result).registry[0]!, result)).toBe(true);
    expect(belowAnswerThreshold(port(result, calibration), port(result).registry[0]!, result)).toBe(false);
  });

  it('a result with no confidence is an answer as before', async () => {
    const adopt = vi.fn(async () => true);
    const pass = await runGate('x', port({ actionId: 'knowledge.ask', text: 'ANSWER' }), { adopt });
    expect(pass?.settled).toBe('answer');
  });
});
