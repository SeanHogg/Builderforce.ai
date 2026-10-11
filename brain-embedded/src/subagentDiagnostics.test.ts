import { describe, expect, it } from 'vitest';
import { formatSubagentDiagnostics, type SubagentDiagnosticsInput } from './subagentDiagnostics';
import type { BrainTraceEvent } from './brainTriage';

/** A report names every sub-agent from its OWN run — the owner's trace only shows a wait. */

const ev = (over: Partial<BrainTraceEvent>): BrainTraceEvent => ({ ts: '2026-10-11T18:00:00.000Z', category: 'tool', label: 'read_file', ...over }) as BrainTraceEvent;

const qa: SubagentDiagnosticsInput = {
  handle: 'a4',
  name: 'QA Tester',
  label: 'run the posting-agent tests',
  owner: 'Verify Frontend Implementation',
  depth: 2,
  ticket: '2826',
  running: false,
  events: [
    ev({ category: 'llm', label: 'llm', args: { model: 'direct/minimax/MiniMax-M1' } }),
    ev({ ts: '2026-10-11T18:01:30.000Z', label: 'write_file', args: { path: 'src/a.test.ts' }, result: { ok: true } }),
    ev({ ts: '2026-10-11T18:02:00.000Z', label: 'read_file', isError: true, result: { ok: false, error: 'file not found' } }),
  ],
  lastMessage: 'The run_command tool is not available in my tool list.',
};

describe('formatSubagentDiagnostics', () => {
  it('adds nothing for a chat that spawned no sub-agents', () => {
    expect(formatSubagentDiagnostics([], 0)).toEqual([]);
  });

  it('names each child, its owner, what it did, where it failed and what it reported', () => {
    const text = formatSubagentDiagnostics([qa], Date.parse('2026-10-11T18:03:00.000Z')).join('\n');
    expect(text).toContain('Sub-agents (1)');
    expect(text).toContain('a4 QA Tester');
    expect(text).toContain('sub-agent of Verify Frontend Implementation (depth 2)');
    expect(text).toContain('ticket 2826');
    expect(text).toMatch(/State: done · Turns: 1 · Tool calls: 2 · Failed: 1 · 2m 0s/);
    expect(text).toContain('Models: direct/minimax/MiniMax-M1');
    expect(text).toContain('Changed: src/a.test.ts');
    expect(text).toContain('Failed step: read_file');
    expect(text).toContain('Report: The run_command tool is not available');
  });

  it('says a child is still running and calls its text a message, not a report', () => {
    const text = formatSubagentDiagnostics([{ ...qa, running: true }], 0).join('\n');
    expect(text).toContain('1 running');
    expect(text).toContain('State: running');
    expect(text).toContain('Last message:');
  });
});
