import { describe, it, expect } from 'vitest';
import { buildLifecycleDiagnosticsReport } from './lifecycleDiagnostics';
import type { TicketLifecycle } from './builderforceApi';

/**
 * This report is what a user pastes when something is stuck, so the failure mode that
 * matters is a SILENTLY MISSING FIELD — a dump that looks complete but omits the run id
 * or the gate reason sends the reader back for another round trip.
 */
const lifecycle: TicketLifecycle = {
  taskId: 169,
  projectId: 2,
  key: '1-UNTITLED-100',
  title: 'Learning Store — Institutional Memory',
  createdAt: '2026-06-29T12:52:00.000Z',
  events: [
    {
      at: '2026-06-30T06:32:00.000Z', kind: 'run_dispatched', actorKind: 'system',
      actorName: '623a8d4a', executionId: 90, agentRef: '623a8d4a',
      detail: 'Run #90 (completed)', source: 'executions',
    },
    {
      at: '2026-06-30T06:32:10.000Z', kind: 'lane_moved', actorKind: 'system', actorName: null,
      fromStatus: 'backlog', toStatus: 'in_progress', isBackward: false,
      source: 'task_status_transitions',
    },
    {
      at: '2026-07-11T17:01:00.000Z', kind: 'autorun_skipped', actorKind: 'system', actorName: null,
      toStatus: 'in_review', reason: 'human_gate',
      detail: "Auto-run skipped (human_gate) for task 169 on lane 'in_review'.",
      source: 'tool_audit_events',
    },
  ],
  verdict: {
    origin: 'unknown', currentStatus: 'in_review', isTerminal: false,
    autonomousHops: 2, humanHops: 0, backwardHops: 0,
    runsDispatched: 2, runsCompleted: 1, runsFailed: 1, hasLiveRun: false,
    reachedTerminal: false, fullyAutonomous: false, progressedAutonomously: true,
    stalled: true, stallReason: 'human_gate', stallText: 'Waiting for approval',
  },
};

const ctx = { capturedAt: '2026-07-25T10:00:00.000Z', uiVersion: '2026.7.105', apiVersion: '2026.7.135', sourceUrl: 'https://builderforce.ai/projects' };

describe('buildLifecycleDiagnosticsReport', () => {
  const report = buildLifecycleDiagnosticsReport(lifecycle, ctx);

  it('identifies the ticket unambiguously', () => {
    expect(report).toContain('key: 1-UNTITLED-100');
    expect(report).toContain('taskId: 169');
    expect(report).toContain('projectId: 2');
  });

  it('states the verdict including the stall reason AND its human text', () => {
    expect(report).toContain('stalled: yes');
    expect(report).toContain('stallReason: human_gate');
    expect(report).toContain('stallText: Waiting for approval');
    expect(report).toContain('fullyAutonomous: no');
  });

  it('carries every counter, including the zeros', () => {
    // A zero is a finding ("no human ever touched it"), so it must not be omitted as falsy.
    expect(report).toContain('humanHops: 0');
    expect(report).toContain('backwardHops (redo): 0');
    expect(report).toContain('autonomousHops: 2');
    expect(report).toContain('runsFailed: 1');
  });

  it('includes every event with its execution id, gate reason and SOURCE TABLE', () => {
    expect(report).toContain('exec=#90');
    expect(report).toContain('reason=human_gate');
    expect(report).toContain('src=executions');
    expect(report).toContain('src=task_status_transitions');
    expect(report).toContain('src=tool_audit_events');
    expect(report).toContain('lane=backlog→in_progress');
  });

  it('preserves the server detail text — usually the most useful line in the dump', () => {
    expect(report).toContain("Auto-run skipped (human_gate) for task 169 on lane 'in_review'.");
  });

  it('records the build versions so a pre/post-deploy capture is distinguishable', () => {
    expect(report).toContain('uiVersion: 2026.7.105');
    expect(report).toContain('apiVersion: 2026.7.135');
    expect(report).toContain('capturedAt: 2026-07-25T10:00:00.000Z');
  });

  it('writes absent values explicitly rather than dropping the line', () => {
    const noVersions = buildLifecycleDiagnosticsReport(lifecycle, { capturedAt: ctx.capturedAt });
    expect(noVersions).toContain('apiVersion: (none)');
    expect(noVersions).toContain('sourceUrl: (none)');
  });

  it('appends re-parseable raw JSON', () => {
    const start = report.indexOf('{');
    expect(JSON.parse(report.slice(start))).toMatchObject({ taskId: 169 });
  });

  it('says so explicitly when a ticket has NO recorded events', () => {
    // The empty case is itself a diagnosis (nothing was ever instrumented for this
    // ticket); an empty section would read as a truncated report instead.
    const empty = buildLifecycleDiagnosticsReport({ ...lifecycle, events: [] }, ctx);
    expect(empty).toContain('no events recorded');
    expect(empty).toContain('Chain of custody (0 events)');
  });

  it('numbers events so a reader can refer to one by position', () => {
    expect(report).toMatch(/1\. 2026-06-30T06:32:00\.000Z\s+run_dispatched/);
    expect(report).toContain('Chain of custody (3 events)');
  });
});
