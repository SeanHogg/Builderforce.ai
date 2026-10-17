import { describe, expect, it } from 'vitest';
import type { ExecutionTrace } from '@/lib/builderforceApi';
import { mergeTraceTail } from './useExecutionTrace';

const event = (id: number) => ({ id, ts: `2026-10-17T00:00:${String(id).padStart(2, '0')}.000Z`, toolName: `tool_${id}` });
const usage = (id: number) => ({ id, ts: '2026-10-17T00:00:00.000Z', inputTokens: id, outputTokens: 0, contextTokens: 0 });

function trace(over: Partial<ExecutionTrace['trace']>, status = 'running'): ExecutionTrace {
  return {
    execution: { id: 1, status } as ExecutionTrace['execution'],
    trace: { source: 'cloud-telemetry', usageSnapshots: [], toolEvents: [], ...over },
  };
}

/** A live run's re-read carries only the rows past the held ids; they fold in on top. */
describe('mergeTraceTail', () => {
  it('puts new rows first (newest-first lists) and skips any already held', () => {
    const held = trace({ toolEvents: [event(2), event(1)], usageSnapshots: [usage(1)], messages: [] });
    const tail = trace({ toolEvents: [event(4), event(3), event(2)], usageSnapshots: [usage(2)], messages: [{ role: 'user', text: 'go', ts: 'x' }], incremental: true }, 'completed');
    const merged = mergeTraceTail(held, tail);
    expect(merged.trace.toolEvents.map((e) => e.id)).toEqual([4, 3, 2, 1]);
    expect(merged.trace.usageSnapshots.map((u) => u.id)).toEqual([2, 1]);
    // The in-place parts (thread, status) come from the newer read.
    expect(merged.trace.messages).toHaveLength(1);
    expect(merged.execution.status).toBe('completed');
    expect(merged.trace.incremental).toBe(false);
  });

  it('replaces the held trace with a whole read', () => {
    const held = trace({ toolEvents: [event(1)] });
    const whole = trace({ toolEvents: [event(9)] });
    expect(mergeTraceTail(held, whole)).toBe(whole);
  });
});
