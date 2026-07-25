import { describe, it, expect } from 'vitest';
import {
  buildLifecycleDiagnosticsReport,
  formatEventSection,
  EVENT_WINDOW_HEAD,
  EVENT_WINDOW_TAIL,
} from './lifecycleDiagnostics';
import type { LifecycleEvent, TicketLifecycle } from './builderforceApi';

/**
 * This report is what a user pastes when something is stuck, so the failure mode that
 * matters is a SILENTLY MISSING FIELD — a dump that looks complete but omits the run id
 * or the gate reason sends the reader back for another round trip.
 *
 * The second failure mode, found on a real ticket, is a report that does not FIT: 752
 * events, 268 of them identical, cut off by the paste target exactly where the recent
 * events were. So the size behaviour is tested as hard as the content.
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
      dispatchedBy: 'system:lane-auto',
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
  failures: [{
    signature: 'Monthly cloud-run allowance reached (<n>/<n> on the free plan).',
    sample: 'Monthly cloud-run allowance reached (30/25 on the free plan).',
    runs: 134,
    firstAt: '2026-07-11T14:12:00.918Z',
    lastAt: '2026-07-11T19:47:14.230Z',
    exampleExecutionIds: [1878, 1853, 1828],
    dispatchers: ['system:coordinator'],
    medianIntervalMs: 300_000,
  }],
  dispatchers: [
    { submittedBy: 'system:coordinator', runs: 134, completed: 0, failed: 134, firstAt: '2026-07-11T14:11:57.864Z', lastAt: '2026-07-11T19:47:11.529Z' },
    { submittedBy: 'system:lane-auto', runs: 2, completed: 2, failed: 0, firstAt: '2026-06-30T06:32:00.000Z', lastAt: '2026-06-30T07:00:00.000Z' },
  ],
  gate: {
    canRunNow: false,
    reason: 'human_gate',
    reasonText: 'No run: this lane is human-gated — a person must approve it or use Run now.',
    laneGate: 'human',
    laneResolved: true,
    isTerminalLane: false,
    assignedAgentRef: 'fdbbd9af',
    staffedAgentRefs: [],
    candidateAgentRef: 'fdbbd9af',
    liveExecution: null,
    capabilityMismatches: [{ agentRef: 'a11ce', missing: ['coding-agent'] }],
    consecutiveFailures: 134,
    failureBreakerAt: 3,
    cooldownRemainingMs: 3_600_000,
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

  it('puts the environment ABOVE the event list so a truncated paste keeps the build', () => {
    // The regression this ordering fixes: a long report was cut mid-timeline and the
    // version block, which sat at the bottom, never arrived.
    expect(report.indexOf('uiVersion:')).toBeLessThan(report.indexOf('Chain of custody'));
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

  // ── The three blocks the first version made the reader derive by hand ──────

  it('names the DISPATCHER of every run, on the event row and in its own section', () => {
    // Without submitted_by the reader cannot tell which subsystem to stop.
    expect(report).toContain('by=system:lane-auto');
    expect(report).toContain('-- Dispatchers (executions.submitted_by) --');
    expect(report).toContain('system:coordinator: 134 runs (0 completed, 134 failed)');
  });

  it('collapses repeated failures into ONE cause with its cadence and example ids', () => {
    expect(report).toContain('134 runs failed the same way · every ~5m 00s (median gap)');
    expect(report).toContain('Monthly cloud-run allowance reached (30/25 on the free plan).');
    expect(report).toContain('#1878, #1853, #1828, …');
    expect(report).toContain('dispatchedBy: system:coordinator');
  });

  it('gives the live gate its EVIDENCE, not just the one-word reason', () => {
    expect(report).toContain('-- Why it is not running right now (live gate evaluation) --');
    expect(report).toContain('laneGate: human');
    expect(report).toContain('staffedAgentRefs (on the lane): (none)');
    expect(report).toContain('candidateAgentRef (what "Run now" would dispatch): fdbbd9af');
    // The streak vs the threshold is the fact that turns "stalled" into "retry storm".
    expect(report).toContain('consecutiveFailures: 134 (autonomy halts at 3)');
    expect(report).toContain('cooldownRemaining: 1h 00m');
    expect(report).toContain('capabilityMismatch: a11ce is missing: coding-agent');
  });

  it('says the gate is unavailable rather than implying the recorded reason is live', () => {
    const noGate = buildLifecycleDiagnosticsReport({ ...lifecycle, gate: null }, ctx);
    expect(noGate).toContain('could not evaluate the gate');
    expect(noGate).toContain('may be stale');
  });

  it('reports "no failed runs" explicitly instead of leaving the section blank', () => {
    const clean = buildLifecycleDiagnosticsReport({ ...lifecycle, failures: [], dispatchers: [] }, ctx);
    expect(clean).toContain('(no failed runs recorded)');
    expect(clean).toContain('(no runs dispatched)');
  });
});

describe('formatEventSection', () => {
  const evt = (i: number, over: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
    at: new Date(Date.UTC(2026, 6, 11, 14, i)).toISOString(),
    kind: 'run_failed', actorKind: 'system', actorName: 'agent-1',
    detail: 'Monthly cloud-run allowance reached.', source: 'executions', ...over,
  });

  it('collapses strictly-consecutive identical rows and states the repeat count', () => {
    const rows = formatEventSection([evt(0), evt(1), evt(2), evt(3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('×4');
    expect(rows[0]).toContain('through 2026-07-11T14:03:00.000Z');
  });

  it('does NOT merge rows that differ — a collapse must never hide a distinct fact', () => {
    const rows = formatEventSection([evt(0), evt(1, { kind: 'run_completed' }), evt(2)]);
    expect(rows).toHaveLength(3);
  });

  it('keeps BOTH the head and the most recent events when the list is too long', () => {
    // Each event distinct (varying agent) so nothing collapses and the window is what bounds it.
    const many = Array.from({ length: 400 }, (_, i) => evt(i, { actorName: `agent-${i}` }));
    const rows = formatEventSection(many);
    // The tail is the part a naive truncation loses — it is the ticket's current state.
    expect(rows.join('\n')).toContain('agent-399');
    expect(rows.join('\n')).toContain('agent-0');
    expect(rows.join('\n')).toContain('rows elided from the MIDDLE');
    expect(rows.length).toBeLessThan(EVENT_WINDOW_HEAD + EVENT_WINDOW_TAIL + 10);
  });

  it('never elides silently — the count of dropped rows is always stated', () => {
    const many = Array.from({ length: 200 }, (_, i) => evt(i, { actorName: `agent-${i}` }));
    const elided = 200 - EVENT_WINDOW_HEAD - EVENT_WINDOW_TAIL;
    expect(formatEventSection(many).join('\n')).toContain(`… ${elided} rows elided`);
  });
});
