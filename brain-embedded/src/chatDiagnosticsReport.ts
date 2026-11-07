/**
 * chatDiagnosticsReport — the diagnostics capture as DATA, not prose.
 *
 * Every "Copy diagnostics" surface has, until now, produced exactly one artefact: a wall
 * of Markdown on the user's clipboard. That is the right thing for a bug report and the
 * wrong thing for everything else. Nobody can ask "how many work-mode runs filed tickets
 * and staffed nobody last week?", the report is gone the moment the user closes the chat,
 * and an agent asked to look into its own failure has to re-derive the facts from a
 * transcript it cannot read reliably.
 *
 * So the same facts are ALSO assembled here as one versioned JSON object, persisted with
 * the chat (`POST /api/brain/chats/:id/diagnostics`) and appended to the copied report so
 * the paste carries both halves. There is no second derivation: this composes the exact
 * values the Markdown renders — {@link ChatDiagnosticsData}, {@link BrainDiagnostics},
 * the shared provenance readers and {@link StaffingSummary} — so the prose and the JSON
 * can never disagree about the run they describe.
 *
 * Pure of clock and I/O (`now` is injected) so a test pins a capture time and a host can
 * build the report anywhere it already holds the events.
 */

import { accountUsedInTrace, computeBrainDiagnostics, modelsUsedInTrace, type BrainDiagnostics, type BrainTraceEvent } from './brainTriage';
import type { ChatDiagnosticsData } from './chatDiagnostics';
import { staffingSummaryInTrace, type StaffingSummary } from './staffingSummary';
import type { BrainMessage } from './types';

/**
 * Schema version of the persisted report.
 *
 * Bumped whenever a field CHANGES MEANING or disappears — a reader that stored a v1 row
 * must be able to tell it apart from a later shape without guessing from which keys are
 * present. Purely additive fields do not bump it.
 */
export const CHAT_DIAGNOSTICS_SCHEMA_VERSION = 1;

/** Model/account provenance for the run, as data rather than the rendered header lines. */
export interface ChatDiagnosticsProvenance {
  /** What the surface was CONFIGURED with — null when the gateway auto-selects. */
  configuredModel: string | null;
  /** What actually answered, first-seen order (a mid-run failover stays visible). */
  modelsUsed: string[];
  /** Which purse served it: 'own' | 'shared' | 'shared_byo_unused'. */
  account: string | null;
}

/** One persisted diagnostics capture. The wire shape of `POST /api/brain/chats/:id/diagnostics`. */
export interface ChatDiagnosticsReport {
  schemaVersion: 1;
  /** ISO capture time. */
  capturedAt: string;
  /** Where the capture was taken ('VS Code (VSIX)' | 'Web' | …). */
  surface: string;
  /** The run verdict, or null when there were no events to judge. */
  likelyCause: BrainDiagnostics['likelyCause'] | null;
  /** True when the run was STILL EXECUTING at capture time — every "and then nothing
   *  happened" field below describes an UNFINISHED run, not a failed one. */
  running: boolean;
  /** Chat identity + wiring state: project, tenant, Evermind head, agents, tickets, plan. */
  chat: ChatDiagnosticsData;
  /** The run's own numbers. Null when the capture holds no trace events at all — an
   *  empty diagnostics object would claim measurements nobody took. */
  run: BrainDiagnostics | null;
  provenance: ChatDiagnosticsProvenance;
  /** Filed vs staffed. Null alongside a null `run`, for the same reason. */
  staffing: StaffingSummary | null;
}

export interface BuildChatDiagnosticsReportInput {
  /** The gathered chat state — exactly what the Markdown block renders. */
  diagnostics: ChatDiagnosticsData;
  /** The MERGED trace (live steps + steps recovered from durable history). */
  events: BrainTraceEvent[];
  /** The visible conversation — needed for the verdicts that read prose against the trace. */
  messages: BrainMessage[];
  /** The model this surface was configured with. */
  model?: string | null;
  /** True when the run was still executing when the capture was taken. */
  running?: boolean;
  surface: string;
  /** Injected clock, so a capture time can be pinned in a test. */
  now?: () => Date;
}

/** Assemble the persisted report. Pure; never throws. */
export function buildChatDiagnosticsReport(input: BuildChatDiagnosticsReportInput): ChatDiagnosticsReport {
  const { diagnostics, events, messages, model, running = false, surface, now } = input;
  const configuredModel = model && model !== 'default' ? model : null;
  // No events ⇒ no run to describe. Reporting a zeroed BrainDiagnostics here would be a
  // measurement nobody took: "0 turns, 0 errors, healthy" reads as a clean run rather
  // than as a chat that has not run yet.
  const run = events.length
    ? computeBrainDiagnostics(events, configuredModel ?? undefined, messages, { running })
    : null;
  return {
    schemaVersion: CHAT_DIAGNOSTICS_SCHEMA_VERSION,
    capturedAt: (now ? now() : new Date()).toISOString(),
    surface,
    likelyCause: run?.likelyCause ?? null,
    running,
    chat: diagnostics,
    run,
    provenance: {
      configuredModel,
      modelsUsed: modelsUsedInTrace(events),
      account: accountUsedInTrace(events) ?? null,
    },
    // Read off the trace directly rather than through `run`, so the field is populated
    // identically whether or not a run block was built.
    staffing: events.length ? staffingSummaryInTrace(events) : null,
  };
}

/**
 * Ceiling for the pasted JSON line. Past it, whole bulky fields are dropped (never the
 * text trimmed) in {@link JSON_ELISION_ORDER}, so the block always parses.
 */
export const REPORT_JSON_MAX_CHARS = 12_000;

/**
 * Fields dropped, in this order, until the compact JSON fits. Lowest value first: the
 * per-turn model log and per-model scorecard are rendered in the human-readable
 * Diagnostics block, the linked-ticket and run-history arrays in the Chat diagnostics
 * block. Dotted paths address `report.<a>.<b>`. The persisted report is never elided.
 */
export const JSON_ELISION_ORDER = [
  'run.modelTurns',
  'run.modelScores',
  'chat.tickets',
  'chat.runs',
  'run.memoryAnswers',
  'run.streamRetries',
] as const;

/** A copy of `report` with the dotted path removed, or null when the path is absent. */
function withoutPath(report: ChatDiagnosticsReport, path: string): ChatDiagnosticsReport | null {
  const [outer, inner] = path.split('.') as [keyof ChatDiagnosticsReport, string];
  const parent = report[outer];
  if (!parent || typeof parent !== 'object' || !(inner in parent)) return null;
  const copy = { ...(parent as unknown as Record<string, unknown>) };
  delete copy[inner];
  return { ...report, [outer]: copy } as unknown as ChatDiagnosticsReport;
}

/**
 * Compact one-line JSON of the report; when it exceeds `maxChars`, drops fields in
 * {@link JSON_ELISION_ORDER} and names them in a top-level `_elided` array. If the
 * report is STILL over after every listed field is gone, only a minimal skeleton
 * (identity, capture time, verdict) is emitted with `_elided: ["*"]`.
 *
 * The output may therefore carry an extra top-level `_elided` key that is not on
 * {@link ChatDiagnosticsReport}; consumers of the pasted block must tolerate it, and
 * must not assume `run`, `chat.tickets` etc. are present when it is.
 */
export function compactReportJson(report: ChatDiagnosticsReport, maxChars = REPORT_JSON_MAX_CHARS): string {
  let json = JSON.stringify(report);
  if (json.length <= maxChars) return json;
  let current = report;
  const elided: string[] = [];
  for (const path of JSON_ELISION_ORDER) {
    const next = withoutPath(current, path);
    if (!next) continue;
    current = next;
    elided.push(path);
    json = JSON.stringify({ ...current, _elided: elided });
    if (json.length <= maxChars) return json;
  }
  const { schemaVersion, capturedAt, surface, likelyCause, running } = report;
  return JSON.stringify({ schemaVersion, capturedAt, surface, likelyCause, running, _elided: ['*'] });
}

/**
 * The report as a fenced JSON block for the copied Markdown.
 *
 * Appended at the very END of the transcript. Compact (one line) and, if still over
 * {@link REPORT_JSON_MAX_CHARS}, stripped of its bulkiest duplicated arrays rather than
 * trimmed: a half-elided JSON object is not valid JSON — useless to the only reader it
 * exists for. The prose above it is what a human reads, and the full report persisted with
 * the chat is unaffected.
 */
export function formatChatDiagnosticsReportJson(report: ChatDiagnosticsReport): string[] {
  return ['## Diagnostics (JSON)', '```json', compactReportJson(report), '```'];
}
