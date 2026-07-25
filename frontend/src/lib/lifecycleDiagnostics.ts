/**
 * lifecycleDiagnostics — turn a ticket's lifecycle ledger into ONE pasteable report.
 *
 * The panel already shows the verdict and the chain of custody, but a screenshot is not
 * a diagnosis: reproducing a stalled ticket needs the exact lane keys, execution ids,
 * gate reasons, source tables and the build that produced them. This builds that text so
 * a user can hand over everything an engineer (or an agent) needs in a single paste.
 *
 * ── WHAT THE FIRST VERSION GOT WRONG (measured on a real stalled ticket) ─────────────
 * Ticket 467 produced a 752-event report of which 268 rows were byte-identical run
 * failures. Three consequences, all fixed here:
 *
 *  1. IT DID NOT FIT. Pasted into anything with a size limit, the report was cut in the
 *     middle of the event list — losing the RECENT events, the environment block and the
 *     JSON. The reader got the ticket's infancy and nothing about its current state.
 *  2. IT BURIED THE FINDING. "268 runs died of the same cause, every 5 minutes, all
 *     dispatched by the same subsystem" is the diagnosis; it was recoverable only by
 *     reading 268 timestamps by hand.
 *  3. IT NAMED A GATE WITHOUT ITS EVIDENCE. `stallReason: human_gate` and nothing about
 *     the lane's gate setting, its staffing, the candidate agent, or the failure streak
 *     — all of which the server had already computed and the wire had already carried.
 *
 * So the report now leads with the ANSWER (environment → verdict → live gate → failure
 * rollup → dispatchers) and treats the raw event list as the appendix it is: collapsed,
 * windowed, and always explicit about what it dropped.
 *
 * Two properties kept from the first version:
 *
 *  • VERSIONS ARE INCLUDED. A dump taken just before a deploy is otherwise
 *    indistinguishable from one taken just after, which makes "it's fixed" unfalsifiable.
 *  • THE RAW JSON IS APPENDED. The human-readable section is for reading; the JSON block
 *    is so the payload can be re-parsed without anyone re-deriving it from prose.
 *
 * PURE — no clipboard, no DOM, no i18n. That keeps it unit-testable and keeps the report
 * itself locale-independent: it is a technical artefact for diagnosis, so the ONE thing
 * that must not vary by viewer locale is the report body (the button around it IS
 * localized). Field labels are stable English keys for the same reason.
 */
import type {
  LifecycleDispatcher,
  LifecycleEvent,
  LifecycleFailureGroup,
  LifecycleGateSnapshot,
  TicketLifecycle,
} from './builderforceApi';
import {
  capText,
  collapseRuns,
  environmentLines,
  jsonAppendix,
  line,
  windowRows,
  REPORT_BUDGET_CHARS,
  type DiagnosticsContext,
} from './diagnosticsReport';
import { formatDuration } from './duration';

/**
 * How many event rows the chain of custody prints, as a head + tail window.
 *
 * A window rather than a plain truncation because BOTH ends are load-bearing: the head
 * says how the ticket started, the tail says where it is now — and a tail-truncated
 * report is the specific failure this module exists to fix. Everything between them is
 * summarised by the failure rollup, so the window drops repetition, not information.
 */
export const EVENT_WINDOW_HEAD = 30;
export const EVENT_WINDOW_TAIL = 50;

/** One timeline row, dense but complete — every field the panel renders plus the ids. */
function formatEvent(e: LifecycleEvent, index: number): string {
  const parts: string[] = [`${String(index + 1).padStart(3, ' ')}. ${e.at}  ${e.kind}`];
  if (e.actorKind) parts.push(`actor=${e.actorKind}${e.actorName ? `(${e.actorName})` : ''}`);
  if (e.fromStatus || e.toStatus) parts.push(`lane=${e.fromStatus ?? '—'}→${e.toStatus ?? '—'}`);
  if (e.isBackward) parts.push('BACKWARD');
  if (e.reason) parts.push(`reason=${e.reason}`);
  if (e.executionId != null) parts.push(`exec=#${e.executionId}`);
  if (e.agentRef) parts.push(`agent=${e.agentRef}`);
  // WHO dispatched it. On a stalled ticket this is usually the answer.
  if (e.dispatchedBy) parts.push(`by=${e.dispatchedBy}`);
  parts.push(`src=${e.source}`);
  const head = parts.join('  ');
  // Server `detail` can be long (an error message, a skip explanation) — keep it, on its
  // own indented line, because it is frequently the single most useful field in the dump.
  // Capped, and the overflow is stated: an unannounced truncation of an error message is
  // exactly the kind of quiet loss this report exists to avoid.
  if (!e.detail) return head;
  return `${head}\n     detail: ${capText(e.detail)}`;
}

/**
 * The chain of custody as printable rows: strictly-consecutive identical events are
 * collapsed to one row carrying `× N`, then a head + tail window bounds the rest.
 *
 * Both reductions are REPORTED, never silent — an elision line states exactly how many
 * rows it stands for. A report that quietly drops evidence is worse than a long one,
 * because it reads as complete.
 */
export function formatEventSection(events: readonly LifecycleEvent[]): string[] {
  if (events.length === 0) {
    return ['(no events recorded — nothing in activity_log, task_status_transitions, executions or tool_audit_events)'];
  }

  // Collapse runs of the same event. The signature deliberately ignores the timestamp
  // and the execution id — those are what VARY between two occurrences of one repeated
  // fact, so including them would defeat the collapse entirely.
  const collapsed = collapseRuns(
    events,
    (e) => [e.kind, e.actorKind, e.actorName, e.fromStatus, e.toStatus, e.reason, e.dispatchedBy, e.source, e.detail].join('|'),
    (e) => e.at,
  );

  // Rendered BEFORE windowing so each row's number is its true position in the full list.
  const rendered = collapsed.map((row, index) => {
    const base = formatEvent(row.item, index);
    if (row.repeats === 1) return base;
    // The repeat marker goes on the head line, before any `detail:` continuation.
    const [head, ...rest] = base.split('\n');
    return [`${head}  ×${row.repeats} (through ${row.lastStamp})`, ...rest].join('\n');
  });

  return windowRows(rendered, {
    head: EVENT_WINDOW_HEAD,
    tail: EVENT_WINDOW_TAIL,
    note: (elided) => [
      `     … ${elided} row${elided === 1 ? '' : 's'} elided from the MIDDLE of the timeline (the head and the most recent`,
      '       events are both kept). Repeated failures are summarised in "Failure analysis" above;',
      '       for the untrimmed list re-fetch GET /api/tasks/<id>/lifecycle.',
    ],
  });
}

/** The live gate block: the reason WITH the facts that produced it. */
function formatGate(gate: LifecycleGateSnapshot): string[] {
  const out: string[] = [];
  out.push(line('canRunNow', gate.canRunNow));
  out.push(line('reason', gate.reason));
  out.push(line('reasonText', gate.reasonText));
  out.push(line('laneGate', gate.laneGate));
  out.push(line('laneResolved', gate.laneResolved));
  out.push(line('isTerminalLane', gate.isTerminalLane));
  out.push(line('assignedAgentRef (ticket owner)', gate.assignedAgentRef));
  out.push(line('staffedAgentRefs (on the lane)', gate.staffedAgentRefs.length ? gate.staffedAgentRefs.join(', ') : null));
  out.push(line('candidateAgentRef (what "Run now" would dispatch)', gate.candidateAgentRef));
  out.push(line('liveExecution', gate.liveExecution ? `#${gate.liveExecution.id} (${gate.liveExecution.status})` : null));
  for (const m of gate.capabilityMismatches) {
    out.push(line('capabilityMismatch', `${m.agentRef} is missing: ${m.missing.join(', ')}`));
  }
  out.push(line(
    'consecutiveFailures',
    `${gate.consecutiveFailures} (autonomy halts at ${gate.failureBreakerAt})`,
  ));
  out.push(line('cooldownRemaining', gate.cooldownRemainingMs > 0 ? formatDuration(gate.cooldownRemainingMs) : 'none'));
  return out;
}

/** The failure rollup: N runs, one cause, at what cadence, dispatched by whom. */
function formatFailures(failures: readonly LifecycleFailureGroup[]): string[] {
  if (failures.length === 0) return ['(no failed runs recorded)'];
  const out: string[] = [];
  for (const [i, f] of failures.entries()) {
    const cadence = f.medianIntervalMs == null
      ? 'single occurrence'
      : `every ~${formatDuration(f.medianIntervalMs)} (median gap)`;
    out.push(`${i + 1}. ${f.runs} run${f.runs === 1 ? '' : 's'} failed the same way · ${cadence}`);
    out.push(`   first: ${f.firstAt}   last: ${f.lastAt}`);
    out.push(`   dispatchedBy: ${f.dispatchers.length ? f.dispatchers.join(', ') : '(not recorded)'}`);
    out.push(`   execIds (newest first): ${f.exampleExecutionIds.map((id) => `#${id}`).join(', ')}${f.runs > f.exampleExecutionIds.length ? ', …' : ''}`);
    out.push(`   message: ${f.sample}`);
  }
  return out;
}

/** Who dispatched the runs — the subsystem to go and stop. */
function formatDispatchers(dispatchers: readonly LifecycleDispatcher[]): string[] {
  if (dispatchers.length === 0) return ['(no runs dispatched)'];
  return dispatchers.map((d) =>
    `${d.submittedBy}: ${d.runs} run${d.runs === 1 ? '' : 's'} (${d.completed} completed, ${d.failed} failed)`
    + `  first: ${d.firstAt}  last: ${d.lastAt}`);
}

/**
 * Build the full diagnostics report for a ticket lifecycle.
 *
 * Order: environment → identity → verdict → live gate → failure analysis → dispatchers →
 * counters → chain of custody → raw JSON. Answer first, evidence second, appendix last —
 * so a report that IS truncated by whatever it is pasted into loses the appendix rather
 * than the diagnosis.
 */
export function buildLifecycleDiagnosticsReport(
  data: TicketLifecycle,
  ctx: DiagnosticsContext,
): string {
  const v = data.verdict;
  const out: string[] = [];

  out.push('=== BUILDERFORCE TICKET LIFECYCLE DIAGNOSTICS ===');
  out.push('');
  // Environment FIRST: a report is worthless if you cannot tell which build produced
  // it, and it is the block most likely to be lost when a long report is cut short.
  out.push(...environmentLines(ctx));
  out.push('');

  out.push('-- Ticket --');
  out.push(line('key', data.key));
  out.push(line('taskId', data.taskId));
  out.push(line('projectId', data.projectId));
  out.push(line('title', data.title));
  out.push(line('createdAt', data.createdAt));
  out.push('');

  out.push('-- Verdict --');
  out.push(line('origin', v.origin));
  out.push(line('currentStatus', v.currentStatus));
  out.push(line('isTerminal', v.isTerminal));
  out.push(line('reachedTerminal', v.reachedTerminal));
  out.push(line('fullyAutonomous', v.fullyAutonomous));
  out.push(line('progressedAutonomously', v.progressedAutonomously));
  out.push(line('stalled', v.stalled));
  out.push(line('stallReason', v.stallReason));
  out.push(line('stallText', v.stallText));
  out.push(line('hasLiveRun', v.hasLiveRun));
  out.push('');

  // The live re-evaluation, with its inputs. `stallReason` alone says WHICH gate; this
  // says why that gate answered the way it did, which is what a fix has to change.
  //
  // The heading follows the answer rather than presuming it: a report that says "why it
  // is not running" above `canRunNow: yes` has already contradicted itself in its own
  // section title, and a reader reasonably trusts headings over the fields beneath them.
  out.push(data.gate?.canRunNow
    ? '-- Gate says it CAN run — nothing here is blocking it (live gate evaluation) --'
    : '-- Why it is not running right now (live gate evaluation) --');
  if (data.gate) out.push(...formatGate(data.gate));
  else out.push('(the server could not evaluate the gate for this ticket — see stallReason above, which then falls back to the last RECORDED auto-run refusal and may be stale)');
  out.push('');

  // The finding, not the 268 rows it was derived from.
  out.push(`-- Failure analysis (${data.failures.length} distinct cause${data.failures.length === 1 ? '' : 's'} across ${v.runsFailed} failed run${v.runsFailed === 1 ? '' : 's'}) --`);
  out.push('Failed runs collapsed by cause. One cause with a high run count and a regular');
  out.push('interval is a retry loop, not a series of unrelated failures.');
  out.push(...formatFailures(data.failures));
  out.push('');

  out.push('-- Dispatchers (executions.submitted_by) --');
  out.push('Which subsystem started the runs. Anything other than system:lane-auto reached the');
  out.push('dispatcher WITHOUT going through the lane trigger, so the trigger\'s consecutive-');
  out.push('failure breaker and re-run cooldown never applied to those runs.');
  out.push(...formatDispatchers(data.dispatchers));
  out.push('');

  out.push('-- Counters --');
  out.push(line('autonomousHops', v.autonomousHops));
  out.push(line('humanHops', v.humanHops));
  out.push(line('backwardHops (redo)', v.backwardHops));
  out.push(line('runsDispatched', v.runsDispatched));
  out.push(line('runsCompleted', v.runsCompleted));
  out.push(line('runsFailed', v.runsFailed));
  out.push('');

  const rows = formatEventSection(data.events);
  out.push(`-- Chain of custody (${data.events.length} event${data.events.length === 1 ? '' : 's'}) --`);
  out.push('Each row names the table it was read from (src=…), so this is evidence, not narration.');
  out.push('Consecutive identical rows are collapsed and marked ×N.');
  out.push(...rows);
  out.push('');

  // The appendix. `events` is the only unbounded part of the payload, so it is dropped
  // whenever keeping it would push the WHOLE report past the budget — the size that
  // matters is the total, not the prose, since it is the total that gets truncated.
  const body = out.join('\n');
  out.push(...jsonAppendix(body.length, data, {
    note: `(events elided: the full report would exceed ${REPORT_BUDGET_CHARS} characters. Every computed block above is intact.)`,
    compact: () => ({
      ...data,
      events: `<elided: ${data.events.length} events — see the chain of custody above, or re-fetch GET /api/tasks/${data.taskId}/lifecycle>`,
    }),
  }));

  return out.join('\n');
}
