import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from './brainTriage';
import { contextUsageOf } from './contextUsage';
import type { BrainMessage } from './types';

const llm = (prompt: number | undefined, args: Record<string, unknown> = {}): BrainTraceEvent => ({
  ts: '2026-10-25T10:00:00.000Z', category: 'llm', label: 'llm.complete', args: { model: 'direct/minimax/M3', ...args },
  ...(prompt !== undefined ? { usage: { prompt, completion: 10 } } : {}),
});
const stepRow = (id: number, step: Record<string, unknown>): BrainMessage => ({
  id, seq: id, role: 'tool', content: '', createdAt: '2026-10-25T09:00:00.000Z',
  metadata: JSON.stringify({ kind: 'step', ts: '2026-10-25T09:00:00.000Z', ...step }),
});

describe('contextUsageOf', () => {
  it('reads the LAST live turn that reported usage, with its stamped window', () => {
    const trace = [llm(10_000, { contextWindow: 128_000 }), llm(44_781, { contextWindow: 196_608 }), llm(undefined)];
    expect(contextUsageOf([], trace)).toEqual({ promptTokens: 44_781, contextWindow: 196_608, model: 'direct/minimax/M3' });
  });

  it('falls back to the persisted llm step after a reload', () => {
    const messages = [
      stepRow(1, { category: 'llm', label: 'llm.complete', args: { model: 'm', contextWindow: 64_000 }, usage: { prompt: 30_000 } }),
      stepRow(2, { category: 'tool', label: 'read_file', args: {}, result: 'x' }),
    ];
    expect(contextUsageOf(messages, [])).toEqual({ promptTokens: 30_000, contextWindow: 64_000, model: 'm' });
  });

  it('omits an unknown window and returns null when nothing reported usage', () => {
    expect(contextUsageOf([], [llm(5_000)])).toEqual({ promptTokens: 5_000, model: 'direct/minimax/M3' });
    expect(contextUsageOf([], [llm(undefined)])).toBeNull();
    expect(contextUsageOf([], [])).toBeNull();
  });
});
