import { describe, it, expect } from 'vitest';
import { buildSettledTimeline } from './timelineModel';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';

const msg = (id: number, role: string, content = '', metadata: string | null = null): BrainMessage => ({
  id,
  role,
  content,
  metadata,
  seq: id,
  createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});

const stepMeta = (category: string, label: string, extra: Record<string, unknown> = {}, ts = '2026-01-01T00:00:00.000Z') =>
  JSON.stringify({ kind: 'step', category, label, ts, ...extra });

describe('buildSettledTimeline — durable tool/memory step reconstruction', () => {
  it('reconstructs a persisted role:tool step into a tool node (NOT an assistant bubble)', () => {
    const messages = [
      msg(1, 'user', 'do it'),
      msg(2, 'tool', '', stepMeta('tool', 'tasks.create', { args: { title: 'x' }, result: { id: 7 } })),
      msg(3, 'assistant', 'done'),
    ];
    const nodes = buildSettledTimeline(messages, []);
    const tool = nodes.find((n) => n.kind === 'tool');
    expect(tool).toBeTruthy();
    expect((tool as { label: string }).label).toBe('tasks.create');
    // The tool row must NOT have leaked in as an assistant node.
    expect(nodes.filter((n) => n.kind === 'assistant')).toHaveLength(1);
  });

  it('reconstructs recall / learn / reconcile step messages', () => {
    const messages = [
      msg(1, 'user', 'q'),
      msg(2, 'tool', '', stepMeta('recall', 'evermind.recall', { result: { count: 2, version: 3, items: [] } })),
      msg(3, 'assistant', 'answer'),
      msg(4, 'tool', '', stepMeta('learn', 'evermind.learn', { result: { version: 3 } })),
      msg(5, 'tool', '', stepMeta('reconcile', 'evermind.reconcile', { result: { count: 1, version: 3 } })),
    ];
    const kinds = buildSettledTimeline(messages, []).map((n) => n.kind);
    expect(kinds).toContain('recall');
    expect(kinds).toContain('learn');
    expect(kinds).toContain('reconcile');
  });

  it('dedups a step present in BOTH the live trace and the persisted message', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const messages = [
      msg(1, 'user', 'q'),
      msg(2, 'tool', '', stepMeta('tool', 'tasks.create', { result: { id: 1 } }, ts)),
    ];
    const trace: BrainTraceEvent[] = [
      { ts, category: 'tool', label: 'tasks.create', args: {}, result: { id: 1 } },
    ];
    const toolNodes = buildSettledTimeline(messages, trace).filter((n) => n.kind === 'tool');
    expect(toolNodes).toHaveLength(1); // rendered once, not duplicated
  });

  it('shows a prior-run step (only in messages) alongside a live-run step (only in trace)', () => {
    const messages = [
      msg(1, 'user', 'first'),
      msg(2, 'tool', '', stepMeta('tool', 'run1.tool', { result: {} }, '2026-01-01T00:00:00.000Z')),
      msg(3, 'assistant', 'a1'),
      msg(4, 'user', 'second'),
    ];
    const trace: BrainTraceEvent[] = [
      { ts: '2026-01-02T00:00:00.000Z', category: 'tool', label: 'run2.tool', args: {}, result: {} },
    ];
    const labels = buildSettledTimeline(messages, trace)
      .filter((n) => n.kind === 'tool')
      .map((n) => (n as { label: string }).label);
    expect(labels).toContain('run1.tool');
    expect(labels).toContain('run2.tool');
  });

  it('ignores a role:tool message whose metadata is missing or not a step', () => {
    const messages = [
      msg(1, 'user', 'q'),
      msg(2, 'tool', 'orphan', null),
      msg(3, 'tool', 'x', JSON.stringify({ kind: 'other' })),
    ];
    const nodes = buildSettledTimeline(messages, []);
    // Only the user node — no assistant bubble, no tool node from bad metadata.
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('user');
  });
});
