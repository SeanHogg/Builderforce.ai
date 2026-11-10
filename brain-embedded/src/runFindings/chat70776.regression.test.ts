/**
 * Chat #70776 (PRD 46 §1), read back the way the VS Code host reads a journal: the persisted step rows through
 * `traceWithPersistedSteps(messages, [])`, then `detectRunFindings`. The diagnostics report called the run
 * "Inconclusive"; every one of its faults is named here.
 */
import { describe, expect, it } from 'vitest';
import { traceWithPersistedSteps } from '../persistedSteps';
import { detectRunFindings } from './detectRunFindings';
import { buildChat70776 } from './fixtures/chat70776';

const MODEL = 'local/kimi-code/kimi-for-coding';

function reportOf70776() {
  const messages = buildChat70776().messages();
  return detectRunFindings(traceWithPersistedSteps(messages, []), messages, { id: '70776' });
}

describe('chat #70776', () => {
  it('regression: chat #70776 yields analysis_overrun, serial_single_writes, unverified_writes, bracket_break, filed_then_inline, same_model_roles, oversized_args, slow_turns, stopped_unverified', () => {
    const r = reportOf70776();
    const kinds = new Set(r.findings.map((f) => f.kind));
    for (const kind of [
      'analysis_overrun', 'serial_single_writes', 'unverified_writes', 'bracket_break', 'filed_then_inline',
      'same_model_roles', 'oversized_args', 'slow_turns', 'stopped_unverified',
    ] as const) expect(kinds, kind).toContain(kind);
    expect(r.findings.length).toBeGreaterThanOrEqual(9);

    const one = (kind: string) => r.findings.find((f) => f.kind === kind)!;
    expect(one('analysis_overrun')).toMatchObject({ severity: 'error', params: { readTurns: 21, firstWriteTurn: 23 } });
    expect(one('serial_single_writes').params).toMatchObject({ turns: 13 });
    expect(one('unverified_writes')).toMatchObject({ severity: 'error', params: { files: 10, writes: 13 } });
    expect(r.findings.filter((f) => f.kind === 'bracket_break').map((f) => f.params))
      .toEqual([{ path: 'packages/knowledge-graph-view/src/labels.ts', delta: 'curly -1' }]);
    expect(one('filed_then_inline').params).toEqual({ tickets: 4 });
    expect(one('same_model_roles').params).toEqual({ model: MODEL });
    expect(r.findings.filter((f) => f.kind === 'oversized_args').map((f) => [f.params.tool, f.params.calls]))
      .toEqual([['hand_off', 1], ['ticket-create', 4]]);
    expect(one('slow_turns').params).toEqual({ turns: 2, slowestMs: 123_123 });
    expect(one('stopped_unverified').params).toEqual({ files: 10 });
  });

  it('reads the turn strip: 20 reads, the forced hand-off, then code turns on one model', () => {
    const r = reportOf70776();
    expect(r.summary).toMatchObject({ id: '70776', turns: 42, models: [MODEL] });
    expect(r.summary.title).toMatch(/^Review the Visualizer/);
    expect(r.turns[20]).toMatchObject({ index: 21, role: 'plan', kind: 'forced', toolCalls: 1, completionTokens: 4887, durationMs: 123_123 });
    expect(r.turns.filter((t) => t.kind === 'write')).toHaveLength(13);
    expect(r.turns.slice(0, 20).every((t) => t.kind === 'read' && t.role === 'plan')).toBe(true);
    expect(r.files.every((f) => !f.checked)).toBe(true);
    expect(r.files.find((f) => f.path.endsWith('styleModel.ts'))?.writes).toBe(3);
  });

  it('is deterministic: the same journal yields the same report', () => {
    expect(reportOf70776()).toEqual(reportOf70776());
  });
});
