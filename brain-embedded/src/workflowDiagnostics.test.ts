import { describe, expect, it } from 'vitest';
import { computeBrainDiagnostics, formatBrainDiagnostics, type BrainTraceEvent } from './brainTriage';
import { buildChatDiagnosticsReport } from './chatDiagnosticsReport';
import { workflowDiagnostics } from './workflowDiagnostics';
import type { ChatDiagnosticsData } from './chatDiagnostics';
import { brainEventSink } from './run/eventSink';
import { makeCell } from './runStore/runCell';
import { traceWithPersistedSteps, stepSig } from './persistedSteps';
import type { BrainMessage } from './types';

const event = (status: 'running' | 'completed', id = '1'): BrainTraceEvent => ({
  ts: '2026-11-24T00:00:00Z', category: 'message', label: 'workflow.stage',
  args: { schemaVersion: 1, id, runId: 'r1', entryPoint: 'vscode', step: 0, stage: 'route', status, startedAt: 100, ...(status === 'completed' ? { endedAt: 110, durationMs: 10 } : {}) },
});

describe('workflow diagnostics', () => {
  it('keeps zero-ms spans distinct through persistence, reload and live/durable merging', () => {
    const c = makeCell();
    const sink = brainEventSink(c);
    for (const id of ['span-a', 'span-b']) {
      const base = { schemaVersion: 1 as const, id, runId: 'r1', entryPoint: 'vscode', step: 0, stage: 'opening' as const, startedAt: 100 };
      sink.workflow!({ ...base, status: 'running' });
      sink.workflow!({ ...base, status: 'completed', endedAt: 100, durationMs: 0 });
    }
    expect(new Set(c.trace.map((e) => stepSig(e.category, e.label, e.ts))).size).toBe(4);
    const messages: BrainMessage[] = c.trace.map((e, i) => ({ id: i + 1, seq: i + 1, role: 'tool', content: '', createdAt: e.ts, metadata: JSON.stringify({ ...e, kind: 'step' }) }));
    for (const live of [[], c.trace]) {
      const summary = workflowDiagnostics(traceWithPersistedSteps(messages, live));
      expect(summary.stages.find((s) => s.stage === 'opening')).toMatchObject({ attempts: 2, completed: 2, running: 0, totalMs: 0 });
    }
  });

  it('exposes the same measured stages in Markdown and persisted JSON', () => {
    const events = [event('running'), event('completed')];
    const d = computeBrainDiagnostics(events);
    const text = formatBrainDiagnostics(d).join('\n');
    expect(text).toContain('workflow.metrics');
    expect(text).toContain('| route | completed | 1 | 1 | 0 | 0 | 0 | 0 | 10 | 10 |');
    expect(text).toContain('| surface | not_observed |');
    const report = buildChatDiagnosticsReport({ diagnostics: {} as ChatDiagnosticsData, events, messages: [], surface: 'VS Code (VSIX)' });
    expect(report.run?.workflow).toEqual(d.workflow);
    expect(JSON.parse(JSON.stringify(report)).run.workflow.observedStages).toBe(1);
  });

  it('does not fabricate measurements for legacy, malformed or missing trace data', () => {
    const events: BrainTraceEvent[] = [{ ts: '2026-11-24T00:00:00Z', category: 'tool', label: 'read_file', durationMs: 500 }];
    const summary = workflowDiagnostics([...events, { ...event('completed'), args: { invalid: true } }]);
    expect(summary.observedStages).toBe(0);
    expect(summary.stages.every((s) => s.totalMs === null)).toBe(true);
    expect(workflowDiagnostics([event('running')]).stages.find((s) => s.stage === 'route')?.status).toBe('incomplete');
  });
});
