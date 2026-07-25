/**
 * lifecycleDiagnostics — turn a ticket's lifecycle ledger into ONE pasteable report.
 *
 * The panel already shows the verdict and the chain of custody, but a screenshot is not
 * a diagnosis: reproducing a stalled ticket needs the exact lane keys, execution ids,
 * gate reasons, source tables and the build that produced them. This builds that text so
 * a user can hand over everything an engineer (or an agent) needs in a single paste.
 *
 * Two deliberate properties:
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
import type { TicketLifecycle, LifecycleEvent } from './builderforceApi';

export interface LifecycleDiagnosticsContext {
  /** Frontend build that rendered this (APP_VERSION). */
  uiVersion?: string | null;
  /** API build that served the ledger, when the page knows it. */
  apiVersion?: string | null;
  /** ISO timestamp of the capture. Passed in rather than read from the clock so the
   *  builder stays pure and testable. */
  capturedAt: string;
  /** Absolute URL of the surface the capture was taken from, when available. */
  sourceUrl?: string | null;
}

/** `key: value` with absent values written explicitly, never silently dropped. */
function line(label: string, value: unknown): string {
  const v = value === null || value === undefined || value === ''
    ? '(none)'
    : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  return `${label}: ${v}`;
}

/** One timeline row, dense but complete — every field the panel renders plus the ids. */
function formatEvent(e: LifecycleEvent, index: number): string {
  const parts: string[] = [`${String(index + 1).padStart(3, ' ')}. ${e.at}  ${e.kind}`];
  if (e.actorKind) parts.push(`actor=${e.actorKind}${e.actorName ? `(${e.actorName})` : ''}`);
  if (e.fromStatus || e.toStatus) parts.push(`lane=${e.fromStatus ?? '—'}→${e.toStatus ?? '—'}`);
  if (e.isBackward) parts.push('BACKWARD');
  if (e.reason) parts.push(`reason=${e.reason}`);
  if (e.executionId != null) parts.push(`exec=#${e.executionId}`);
  if (e.agentRef) parts.push(`agent=${e.agentRef}`);
  parts.push(`src=${e.source}`);
  const head = parts.join('  ');
  // Server `detail` can be long (an error message, a skip explanation) — keep it, on its
  // own indented line, because it is frequently the single most useful field in the dump.
  return e.detail ? `${head}\n     detail: ${e.detail}` : head;
}

/**
 * Build the full diagnostics report for a ticket lifecycle.
 *
 * Sections: identity → verdict → counters → chain of custody → environment → raw JSON.
 * Ordered so the answer comes first and the evidence follows, matching the panel.
 */
export function buildLifecycleDiagnosticsReport(
  data: TicketLifecycle,
  ctx: LifecycleDiagnosticsContext,
): string {
  const v = data.verdict;
  const out: string[] = [];

  out.push('=== BUILDERFORCE TICKET LIFECYCLE DIAGNOSTICS ===');
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

  out.push('-- Counters --');
  out.push(line('autonomousHops', v.autonomousHops));
  out.push(line('humanHops', v.humanHops));
  out.push(line('backwardHops (redo)', v.backwardHops));
  out.push(line('runsDispatched', v.runsDispatched));
  out.push(line('runsCompleted', v.runsCompleted));
  out.push(line('runsFailed', v.runsFailed));
  out.push('');

  out.push(`-- Chain of custody (${data.events.length} event${data.events.length === 1 ? '' : 's'}) --`);
  out.push('Each row names the table it was read from (src=…), so this is evidence, not narration.');
  if (data.events.length === 0) {
    out.push('(no events recorded — nothing in activity_log, task_status_transitions, executions or tool_audit_events)');
  } else {
    for (const [i, e] of data.events.entries()) out.push(formatEvent(e, i));
  }
  out.push('');

  out.push('-- Environment --');
  out.push(line('capturedAt', ctx.capturedAt));
  out.push(line('uiVersion', ctx.uiVersion));
  out.push(line('apiVersion', ctx.apiVersion));
  out.push(line('sourceUrl', ctx.sourceUrl));
  out.push('');

  out.push('-- Raw payload (JSON) --');
  out.push(JSON.stringify(data, null, 2));

  return out.join('\n');
}
