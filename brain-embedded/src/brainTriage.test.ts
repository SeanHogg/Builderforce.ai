import { describe, it, expect } from 'vitest';
import { buildBrainTriageReport, isFailedToolResult, type BrainTraceEvent } from './brainTriage';

describe('isFailedToolResult', () => {
  it('flags { ok: false } and error fields', () => {
    expect(isFailedToolResult({ ok: false, error: 'no repo bound' })).toBe(true);
    expect(isFailedToolResult({ error: 'boom' })).toBe(true);
    expect(isFailedToolResult('{"ok":false,"error":"x"}')).toBe(true);
  });
  it('does not flag successful results', () => {
    expect(isFailedToolResult({ ok: true, paths: [] })).toBe(false);
    expect(isFailedToolResult(null)).toBe(false);
    expect(isFailedToolResult('done')).toBe(false);
  });
});

describe('buildBrainTriageReport', () => {
  const events: BrainTraceEvent[] = [
    { ts: '2026-06-13T00:00:00.000Z', category: 'llm', label: 'llm.complete', durationMs: 1200, args: { model: 'x', step: 0, toolCalls: 1 }, result: '1 tool call(s)' },
    { ts: '2026-06-13T00:00:01.000Z', category: 'tool', label: 'write_file', durationMs: 5, args: { path: 'a.md' }, result: { ok: false, error: 'no repo bound' }, isError: true },
    { ts: '2026-06-13T00:00:02.000Z', category: 'tool', label: 'finish', durationMs: 1, args: {}, result: { ok: true } },
  ];

  it('captures the full tool chain, errors-first, with derived logs', () => {
    const report = buildBrainTriageReport({
      capturedAt: '2026-06-13T00:00:03.000Z',
      events,
      messages: [{ id: 1, role: 'user', content: 'hi', metadata: null, seq: 1, createdAt: '2026-06-13T00:00:00.000Z' }],
      chatId: 42,
      agentLabel: 'Brain (default)',
    });
    expect(report).toContain('=== BuilderForce Brain Triage ===');
    expect(report).toContain('Chat:      #42');
    // The failed write_file is counted and surfaced in the Errors section.
    expect(report).toContain('Steps: 3 · Errors: 1 · Messages: 1');
    expect(report).toContain('--- Errors (1) ---');
    expect(report).toContain('no repo bound');
    // Full trace + derived logs + transcript are all present.
    expect(report).toContain('--- Execution trace (3) ---');
    expect(report).toContain('write_file (tool) · 5ms · ERROR');
    expect(report).toContain('--- Logs (3) ---');
    expect(report).toContain('--- Conversation (1) ---');
    expect(report).toContain('USER: hi');
  });

  it('reports an empty run without throwing', () => {
    const report = buildBrainTriageReport({ capturedAt: '2026-06-13T00:00:03.000Z', events: [] });
    expect(report).toContain('Steps: 0 · Errors: 0 · Messages: 0');
  });
});
