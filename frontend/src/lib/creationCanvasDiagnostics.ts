import {
  capText, environmentLines, jsonAppendix, line, windowRows,
  type DiagnosticsContext,
} from './diagnosticsReport';
import { journalGaps, summarizeTimings, type CanvasAction } from './canvasActionJournal';

/**
 * The Creation Canvas handover report.
 *
 * ── WHAT THIS REPORT MISSED, AND WHY IT NOW REPORTS OBJECTS ─────────────────
 * A user reported that a canvas workflow showed four configured stages, that Run
 * did nothing twice, and that the inspector listed two DELIVERED outputs. Every
 * one of those facts was knowable from canvas state. The report said:
 *
 *     objects: 2
 *     objectKinds: chat:1, workflow:1
 *
 * — which is true, useless, and consistent with a working canvas. The three
 * things that actually explained the failure (the workflow had ZERO authored
 * steps, it was linked to no runnable definition, and both "delivered" outputs
 * came from provider `browser-draft` — a local simulation, not an execution)
 * were all absent, so the report agreed with the UI's false picture instead of
 * contradicting it.
 *
 * A diagnostics report earns its place only by being able to DISAGREE with the
 * screen. So objects are now reported individually with the fields that decide
 * whether they can act, deliverables are reported with the provider that
 * produced them, and the Brain tool trace is included.
 *
 * PURE — see ./diagnosticsReport. Bodies are deliberately locale-independent.
 */

/** One canvas object, as the report receives it. Summarizing lives HERE so every
 *  caller reports the same fields rather than each deciding what matters. */
export interface CreationCanvasDiagnosticsObject {
  id: string;
  data: Record<string, unknown>;
}

/** One Brain tool call, already flattened by the caller. */
export interface CreationCanvasDiagnosticsTraceEvent {
  ts: string;
  category: string;
  label: string;
  ok?: boolean | null;
  detail?: string | null;
}

export type CreationCanvasDiagnosticsInput = {
  sessionId: string;
  title: string;
  persistence: 'local' | 'server';
  role: string;
  revision: number;
  realtimeState: string;
  objects: CreationCanvasDiagnosticsObject[];
  connectionCount: number;
  selectedObjectIds: string[];
  hiddenObjectCount: number;
  lockedObjectCount: number;
  redactedObjectCount: number;
  canonicalResourceCount: number;
  memberCount: number;
  pendingInvitationCount: number;
  /** Whether the in-memory graph differs from what was last persisted. A canvas
   *  that never saved explains a whole class of "my change vanished" reports. */
  unsavedChanges?: boolean | null;
  saveInFlight?: boolean | null;
  undoDepth?: number | null;
  timeline: Array<{ role: string; body: string; createdAt: string }>;
  brain: { scope: string; thinking: boolean; proposedChangeCount: number; actionCount: number };
  trace?: CreationCanvasDiagnosticsTraceEvent[];
  /**
   * What the person and the agent actually DID, with durations. The report could
   * previously only describe the end state, so it agreed with whatever the
   * screen was already showing — see `canvasActionJournal`.
   */
  actions?: CanvasAction[];
  /** How many objects the last Brain turn could actually see. A turn scoped to a
   *  selection answering a question about "the canvas" is the failure mode this
   *  number exists to expose. */
  scopedObjectCount?: number;
};

const TIMELINE_HEAD = 4;
const TIMELINE_TAIL = 16;
const TRACE_HEAD = 4;
const ACTION_HEAD = 6;
const ACTION_TAIL = 40;
const TRACE_TAIL = 20;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** What one authored workflow step CALLS — the field whose absence made an empty
 *  workflow indistinguishable from a configured one. */
function stepSummary(step: unknown, index: number): string {
  const record = typeof step === 'string' ? { title: step } : asRecord(step);
  const title = str(record.title) || str(record.name) || `step ${index + 1}`;
  const connector = str(record.connector);
  const call = connector
    ? `${connector}.${str(record.action) || str(record.actionKey) || '(no action)'}`
    : str(record.prompt) || str(record.model) ? `llm:${str(record.model) || str(record.provider) || 'default'}`
    : str(record.role) ? `agent:${str(record.role)}`
    : '(no action)';
  const status = str(record.status);
  return `${index + 1}. ${title} → ${call}${status ? ` [${status}]` : ''}`;
}

/** Per-kind lines that decide whether THIS object can do what its card implies. */
function objectDetailLines(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (data.kind === 'workflow') {
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const resourceId = str(data.resourceId);
    const linked = resourceId.startsWith('workflow:');
    out.push(`    authoredSteps: ${steps.length}`);
    // The decisive line: a workflow with no linked definition CANNOT run,
    // whatever its status chip says.
    out.push(`    runnable: ${linked && data.workflowExecutable !== false ? 'yes' : 'no'} (definition ${linked ? resourceId.slice('workflow:'.length) : 'not linked'})`);
    for (const [i, step] of steps.slice(0, 12).entries()) out.push(`      ${stepSummary(step, i)}`);
    if (steps.length > 12) out.push(`      … +${steps.length - 12} more steps`);
    const issues = Array.isArray(data.workflowIssues) ? data.workflowIssues : [];
    for (const issue of issues.slice(0, 6)) {
      const record = asRecord(issue);
      out.push(`    issue: ${str(record.title) || `step ${String(record.step ?? '?')}`} — ${capText(str(record.message), 200)}`);
    }
    if (str(data.workflowRunId)) out.push(`    lastRun: ${str(data.workflowRunId)} (${str(data.workflowRunStatus) || 'unknown'})`);
  }
  return out;
}

/**
 * Every deliverable on the board, flattened with the PROVIDER that produced it.
 *
 * Provider is the field that separates "an execution reported success" from "the
 * browser wrote the word delivered". Reporting the status without it is how two
 * `workflow-run · delivered` rows could describe a workflow that never ran.
 */
function deliverableLines(objects: CreationCanvasDiagnosticsObject[]): string[] {
  const rows: string[] = [];
  for (const object of objects) {
    const deliverables = Array.isArray(object.data.deliverables) ? object.data.deliverables : [];
    for (const raw of deliverables.slice(0, 10)) {
      const d = asRecord(raw);
      const validation = asRecord(d.validation);
      rows.push([
        `[${str(d.createdAt) || '(no stamp)'}] ${object.id}`,
        `${str(d.artifactKind) || '(kind?)'} · ${str(d.status) || '(status?)'}`,
        `provider=${str(d.provider) || '(none)'}`,
        str(d.resourceRef) ? `ref=${str(d.resourceRef)}` : 'ref=(none)',
        str(validation.status) ? `validation=${str(validation.status)}` : 'validation=(none)',
        str(d.error) ? `error=${capText(str(d.error), 200)}` : '',
      ].filter(Boolean).join(' | '));
    }
  }
  return rows;
}

/** A pasteable, bounded handover for Canvas/Brain support tickets. */
export function buildCreationCanvasDiagnosticsReport(
  input: CreationCanvasDiagnosticsInput,
  context: DiagnosticsContext,
): string {
  const objectKinds = input.objects.reduce<Record<string, number>>((acc, object) => {
    const kind = str(object.data.kind) || 'unknown';
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});

  const objectRows = input.objects.flatMap((object) => {
    const data = object.data;
    const resourceId = str(data.resourceId);
    return [
      `  ${object.id} · ${str(data.kind) || 'unknown'} · "${capText(str(data.title) || '(untitled)', 80)}" · status=${str(data.status) || '(none)'}${resourceId ? ` · resource=${resourceId}` : ' · resource=(none)'}`,
      ...objectDetailLines(data),
    ];
  });

  const deliverables = deliverableLines(input.objects);
  const trace = input.trace ?? [];
  const traceRows = trace.map((event) => `[${event.ts}] ${event.category}/${event.label}${event.ok === undefined || event.ok === null ? '' : event.ok ? ' ok' : ' FAILED'}${event.detail ? ` — ${capText(event.detail, 240)}` : ''}`);
  const timelineRows = input.timeline.flatMap((message) => [
    `[${message.createdAt}] ${message.role}`,
    capText(message.body, 1_000),
  ]);

  const actions = input.actions ?? [];
  const scopedObjectCount = input.scopedObjectCount ?? input.objects.length;
  const gaps = journalGaps(actions, {
    objectCount: input.objects.length,
    scope: input.brain.scope,
    scopedObjectCount,
  });
  const timings = summarizeTimings(actions);
  const timingRows = timings.map((row) => `  ${row.label} · n=${row.count}${row.pending ? ` · pending=${row.pending}` : ''}${row.failed ? ` · FAILED=${row.failed}` : ''} · p50=${row.p50Ms == null ? 'n/a' : `${row.p50Ms}ms`} · max=${row.maxMs == null ? 'n/a' : `${row.maxMs}ms`}`);
  const actionRows = actions.map((action) => `[${action.at}] ${action.kind}/${action.label}${action.durationMs == null ? ' (never completed)' : ` ${action.durationMs}ms`}${action.ok === false ? ' FAILED' : ''}${action.detail ? ` — ${capText(action.detail, 200)}` : ''}`);

  const body = [
    `# Creation Canvas diagnostics — ${input.title}`,
    '',
    ...environmentLines(context, [['sessionId', input.sessionId], ['persistence', input.persistence], ['role', input.role]]),
    '',
    // GAPS FIRST. A reader opens a report with a question, and a wall of state
    // they have to interpret is how a report gets skimmed and dismissed. Anything
    // the journal can already prove is stated as a finding, at the top.
    '-- Gaps --',
    ...(gaps.length ? gaps.map((gap) => `  • ${gap}`) : ['  (none detected)']),
    '',
    '-- Session state --',
    line('revision', input.revision),
    line('realtimeState', input.realtimeState),
    line('members', input.memberCount),
    line('pendingInvitations', input.pendingInvitationCount),
    line('objects', input.objects.length),
    line('connections', input.connectionCount),
    line('canonicalResources', input.canonicalResourceCount),
    line('hiddenObjects', input.hiddenObjectCount),
    line('lockedObjects', input.lockedObjectCount),
    line('redactedObjects', input.redactedObjectCount),
    line('unsavedChanges', input.unsavedChanges ?? null),
    line('saveInFlight', input.saveInFlight ?? null),
    line('undoDepth', input.undoDepth ?? null),
    line('selectedObjectIds', input.selectedObjectIds.join(', ') || null),
    line('objectKinds', Object.entries(objectKinds).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `${kind}:${count}`).join(', ') || null),
    '',
    // The block the old report lacked entirely.
    '-- Canvas objects --',
    ...(objectRows.length ? objectRows : ['  (none)']),
    '',
    '-- Delivered outputs (provider-attributed) --',
    ...(deliverables.length ? deliverables : ['(none)']),
    '',
    '-- Timings --',
    ...(timingRows.length ? timingRows : ['  (no timed actions recorded)']),
    '',
    `-- Actions (${actions.length}) --`,
    ...(actionRows.length
      ? windowRows(actionRows, { head: ACTION_HEAD, tail: ACTION_TAIL, note: (elided) => [`… ${elided} earlier actions elided …`] })
      : ['  (none recorded)']),
    '',
    '-- Canvas Brain --',
    line('scope', input.brain.scope),
    // The number whose absence let a scoped turn's answer read as a statement
    // about the whole board.
    line('objectsVisibleToTurn', `${scopedObjectCount} of ${input.objects.length}`),
    line('thinking', input.brain.thinking),
    line('availableCanvasActions', input.brain.actionCount),
    line('proposedChangesAwaitingReview', input.brain.proposedChangeCount),
    line('timelineMessages', input.timeline.length),
    line('traceEvents', trace.length),
    '',
    '-- Brain tool trace --',
    ...(traceRows.length
      ? windowRows(traceRows, { head: TRACE_HEAD, tail: TRACE_TAIL, note: (elided) => [`… ${elided} earlier trace events elided …`] })
      : ['(none)']),
    '',
    `-- Session conversation (${input.timeline.length} messages) --`,
    // Head + tail with an ANNOUNCED elision. The old report silently kept the
    // last 20, so a report from a long session read as a complete transcript.
    ...(timelineRows.length
      ? windowRows(timelineRows, { head: TIMELINE_HEAD * 2, tail: TIMELINE_TAIL * 2, note: (elided) => ['', `… ${elided / 2} earlier messages elided …`, ''] })
      : ['(none)']),
  ];

  const text = body.join('\n');
  return [
    text,
    '',
    // Re-parseable payload; drops the transcript first when the budget is tight,
    // since it is the one block already rendered in full above.
    ...jsonAppendix(text.length, { objects: input.objects, trace, actions, timeline: input.timeline }, {
      compact: () => ({ objects: input.objects, trace, actions }),
      note: '(transcript omitted to stay within the paste budget — it is rendered above)',
    }),
  ].join('\n');
}
