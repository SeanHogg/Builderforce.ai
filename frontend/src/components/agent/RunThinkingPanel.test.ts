import { describe, expect, it } from 'vitest';
import type { ExecutionTraceToolEvent } from '@/lib/builderforceApi';
import { thinkingEventsOf } from './RunThinkingPanel';

const event = (over: Partial<ExecutionTraceToolEvent>): ExecutionTraceToolEvent => ({
  id: 1, ts: '2026-09-10T10:00:00Z', toolName: 'agent.thinking', category: 'thinking', ...over,
});

describe('thinkingEventsOf', () => {
  it('reads the FULL reasoning from args.content, not the 280-char preview', () => {
    const long = 'x'.repeat(600);
    const [thought] = thinkingEventsOf([event({ args: JSON.stringify({ step: 2, model: 'm1', content: long }), result: long.slice(0, 280) })]);
    expect(thought).toMatchObject({ text: long, step: 2, model: 'm1' });
  });

  it('falls back to the preview for rows with no detail', () => {
    expect(thinkingEventsOf([event({ result: ' preview only ' })])[0]?.text).toBe('preview only');
  });

  it('keeps only thinking rows, oldest first, and drops empty ones', () => {
    const thoughts = thinkingEventsOf([
      event({ id: 3, ts: '2026-09-10T10:00:03Z', result: 'third' }),
      event({ id: 4, toolName: 'agent.message', category: 'message', result: 'not a thought' }),
      event({ id: 1, ts: '2026-09-10T10:00:01Z', result: 'first' }),
      event({ id: 5, result: '   ' }),
      event({ id: 6, ts: '2026-09-10T10:00:02Z', args: '{broken', result: 'second' }),
    ]);
    expect(thoughts.map((thought) => thought.text)).toEqual(['first', 'second', 'third']);
  });
});
