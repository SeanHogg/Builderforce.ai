import { describe, expect, it } from 'vitest';
import { routingQueryForTurn, turnOptimizationDirective } from './turnOptimization';

describe('routingQueryForTurn', () => {
  it('keeps prior user intent when a correction is too terse to route alone', () => {
    expect(routingQueryForTurn([
      { role: 'user', content: 'Create three scheduled project reports' },
      { role: 'assistant', content: 'I can do that.' },
      { role: 'user', content: 'Actually, make those weekly' },
    ])).toBe('Create three scheduled project reports\nActually, make those weekly');
  });

  it('ignores assistant/tool text and bounds the routing context', () => {
    const query = routingQueryForTurn([
      { role: 'assistant', content: 'scheduler noise' },
      { role: 'tool', content: 'x'.repeat(10_000), tool_call_id: '1' },
      { role: 'user', content: `prefix-${'y'.repeat(5_000)}` },
    ]);
    expect(query).toHaveLength(4_000);
    expect(query).not.toContain('scheduler noise');
  });
});

describe('turnOptimizationDirective', () => {
  it('makes clarification, patching, batching and attachment handling platform duties', () => {
    const directive = turnOptimizationDirective();
    expect(directive).toContain('Ask one grouped set of questions only when');
    expect(directive).toContain('change the smallest requested scope');
    expect(directive).toContain('Batch independent reads/actions');
    expect(directive).toContain('never ask the user to convert');
    expect(directive).toContain('not a reason to make the user restart the chat');
  });
});
