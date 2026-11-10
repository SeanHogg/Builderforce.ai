/**
 * The run's CLOSE-OUT shared seam: the input it decides on, the review tool name, the verification
 * read, and the evidence-based review summary the host records. The close-out itself moved to
 * `runStore/deterministicFinish.ts` `deterministicFinish` (fix #6) — the run's ticket bookkeeping as
 * pure host actions, entered from `startRun`'s settle and the finish-hook wrapper. This module keeps
 * the shared helpers that fold lives on.
 */

import { parseSyncId } from '@builderforce/local-first';
import { normalizeEvidencePath, createEvidenceLedger, type EvidenceLedger } from '@builderforce/run-guards';
import { isFailedToolResult, type BrainTraceEvent } from '../brainTriage';
import { nowIso, nowMs } from '../runStore/runCells';
import type { BackstopRun } from '../runStore/runBackstops';
import type { BrainRunRequest } from '../runStore/runTypes';

/** The tool a review is recorded with - the model's and the host's alike. */
export const REVIEW_RECORD_TOOL = 'builtin_reviews_record';

/** What the close-out decides on, read from THIS run as it settled (never later from a cell the next run may use). */
export interface CloseOutInput {
  /** The server chat the run's tickets are linked to (null on an unbound local chat). */
  serverChatId: number | null;
  /** The run's detached settle snapshot (`settleView`). */
  view: BackstopRun;
  req: Pick<BrainRunRequest, 'runTool'> & { projectId?: number | null };
  /** The run changed code and may mint/advance tickets (not stopped, a project, a tool runner). */
  needsTicket: boolean;
  /** The run's change landed on the base branch (`shippedToBaseBranch`). */
  shipped: boolean;
  /** Tickets the run reviewed complete after a passing preview inspection (`ticketsReviewedInPreview`). */
  reviewedInPreview: readonly number[];
  /** Placeholders this run wrote and has not removed (`PlaceholderLedger.outstanding().length`). */
  openPlaceholders: number;
  /** THIS run's trace, for the reviews it recorded itself. */
  trace: readonly BrainTraceEvent[];
  /** THIS run's evidence ledger (`BrainRunContext.evidence`): the checks the host verifier ran. Absent = no evidence. */
  evidence?: Pick<EvidenceLedger, 'snapshot'>;
}

/** Whether the run's evidence verifies its change: the passing checks it holds, or why it does not. */
export type Verification = { verified: true; checks: string[] } | { verified: false; reason: string };

/**
 * The run's verification, read from its evidence ledger: every file it changed has at least one PASSING check against its
 * current bytes, and no check the ledger holds failed. An `unavailable` check is never a pass (PRD 45 OD-3).
 */
export function verificationOf(evidence: CloseOutInput['evidence'], touchedFiles: readonly string[]): Verification {
  const entries = evidence?.snapshot() ?? [];
  if (!entries.length) return { verified: false, reason: 'no verification evidence was recorded for this run' };
  const failed = entries.flatMap((e) => e.checks.filter((c) => c.outcome === 'fail').map((c) => `${e.path} ${c.kind} "${c.name}"`));
  if (failed.length) return { verified: false, reason: `failing checks: ${failed.slice(0, 5).join('; ')}` };
  const passing = entries.filter((e) => e.checks.some((c) => c.outcome === 'pass'));
  if (!passing.length) return { verified: false, reason: 'no check passed (only unavailable checks were recorded)' };
  // A ledger path may be absolute while the run names files repo-relative: matched on the path's tail.
  const covers = (file: string): boolean => {
    const rel = normalizeEvidencePath(file).replace(/^\.\//, '');
    return passing.some((e) => e.path === rel || e.path.endsWith(`/${rel}`));
  };
  const unverified = touchedFiles.filter((f) => !covers(f));
  if (unverified.length) return { verified: false, reason: `no passing check for: ${unverified.slice(0, 10).join(', ')}` };
  return {
    verified: true,
    checks: passing.flatMap((e) => e.checks.filter((c) => c.outcome === 'pass').map((c) => `${e.path} ${c.kind} "${c.name}"`)),
  };
}

/** The tickets THIS run recorded a successful review for itself. */
export function reviewedThisRun(trace: readonly BrainTraceEvent[]): Set<number> {
  const ids = new Set<number>();
  for (const ev of trace) {
    if (ev.category !== 'tool' || ev.label !== REVIEW_RECORD_TOOL || ev.isError || isFailedToolResult(ev.result)) continue;
    const id = parseSyncId((ev.args as { taskId?: unknown } | undefined)?.taskId);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/**
 * Record the host's review on the ticket THIS run created, unless the run recorded one itself. The
 * summary names the files and the PASSING checks the run's evidence ledger holds — nothing it does
 * not (never a rubber stamp).
 */
export async function recordShipReview(input: CloseOutInput, taskId: number, checks: readonly string[]): Promise<void> {
  const { view, req } = input;
  if (!req.runTool || reviewedThisRun(input.trace).has(taskId)) return;
  const shown = view.touchedFiles.slice(0, 10).join(', ');
  const more = view.touchedFiles.length > 10 ? ` (+${view.touchedFiles.length - 10} more)` : '';
  const passed = checks.slice(0, 10).join('; ') + (checks.length > 10 ? ` (+${checks.length - 10} more)` : '');
  const summary = `Closed out by the host: this run's change${view.touchedFiles.length ? ` (${view.touchedFiles.length} file${view.touchedFiles.length === 1 ? '' : 's'}: ${shown}${more})` : ''} was pushed to the base branch and verified landed, with no placeholder outstanding. Passing checks on the shipped bytes: ${passed}.`;
  const args = { taskId, verdict: 'complete', summary };
  const toolStart = nowMs();
  let out: unknown;
  try {
    out = await req.runTool(REVIEW_RECORD_TOOL, args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  view.note?.({
    ts: nowIso(),
    category: 'tool',
    label: REVIEW_RECORD_TOOL,
    durationMs: nowMs() - toolStart,
    args: { ...args, auto: true, reason: 'shipped-and-verified' },
    result: out ?? null,
    isError: isFailedToolResult(out),
  });
}

/** An evidence ledger holding `checks` against `path` (as the host verifier records them). */
export function evidenceLedgerOf(path: string, outcomes: Array<'pass' | 'fail' | 'unavailable'>): EvidenceLedger {
  const ledger = createEvidenceLedger();
  outcomes.forEach((outcome, i) => ledger.record(path, 'h1', { kind: 'test', name: `check-${i}`, outcome, exitCode: outcome === 'pass' ? 0 : 1, findings: [], at: 1 }));
  return ledger;
}

