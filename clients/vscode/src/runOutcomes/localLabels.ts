/**
 * The git-history labels on this device (PRD 41 §D1): `followup-fix` (SZZ) and `reverted` need the repository's history,
 * which only the device holds for a VS Code run, so they are computed here by the pure labellers
 * (`@builderforce/run-delta/predict`) and written to the run's `run-outcome` record, which syncs them to the server's
 * `run_outcome_labels`. CI and review labels are the server's label sweep (it holds the pull requests).
 *
 * COST. A pass reads, per repository, ONE shared history (`laterHistory`: one path-limited `git log -p` from the oldest
 * pending run end to the newest window end, over the union of the pending runs' attributed paths), and labels every pending
 * run from it in the label WORKER (`labelBatch.ts`) — never per-run git sweeps, never the masking on the extension host's
 * thread. The first pass waits {@link FIRST_PASS_DELAY_MS} after activation. A run with no attributed commit is left alone
 * (nothing can blame to it); censored labels are re-read on later passes and become final once their window ended.
 */

import type { LocalFirstStore } from "@builderforce/local-first";
import { LABEL_WINDOW_DAYS, windowEnd, type RunOutcomeRecordValue } from "@builderforce/run-delta/predict";
import { repositoryIdentityOf } from "../runChangeBaseline";
import { syncedRepository } from "../runDelta/runDeltaRecords";
import { labelBatchOffThread } from "./labelBatch";
import { laterHistory } from "./outcomeGit";
import { readRunOutcomes, updateRunOutcome } from "./runOutcomeRecords";

/** Labels re-read every this often. */
export const LABEL_PASS_MS = 6 * 60 * 60 * 1000;
/** The first pass waits this long after activation (never on the startup path). */
export const FIRST_PASS_DELAY_MS = 5 * 60 * 1000;
/** Runs labelled per repository per pass. */
export const MAX_RUNS_PER_PASS = 50;

const GIT_KINDS = ["followup-fix", "reverted"] as const;
const WINDOW_DAYS = Math.max(LABEL_WINDOW_DAYS["followup-fix"], LABEL_WINDOW_DAYS.reverted);

/** Whether a run still needs its git labels: it has attributed commits and one of the two is not final. */
export const needsGitLabels = (value: RunOutcomeRecordValue): boolean =>
  value.attribution.length > 0 && GIT_KINDS.some((kind) => value.labels.find((l) => l.kind === kind)?.status !== "final");

/**
 * Where each repository's next batch starts among its pending runs. A batch whose git read or labelling FAILED advances
 * it past that batch, so the same runs never fail every pass while the rest wait; a successful batch leaves it (its runs
 * either became final and dropped out, or are re-read next time).
 */
export const batchOffsets = new Map<string, number>();

/** The batch of `pending` starting at `offset` (wrapping), at most {@link MAX_RUNS_PER_PASS}. */
export function batchAt<T>(pending: readonly T[], offset: number): T[] {
  if (pending.length <= MAX_RUNS_PER_PASS) return [...pending];
  const start = offset % pending.length;
  return [...pending.slice(start), ...pending.slice(0, start)].slice(0, MAX_RUNS_PER_PASS);
}

/**
 * One pass over one repository root. Returns how many records changed. When the history is INCOMPLETE (the blame cap was
 * reached) only observed events are recorded: a "no event" read from a partial history must never become a final `false`.
 */
export async function labelRepository(
  deps: { store: LocalFirstStore; deviceId(): string; now?: () => Date; offsets?: Map<string, number> },
  root: string,
): Promise<number> {
  const offsets = deps.offsets ?? batchOffsets;
  const now = (deps.now?.() ?? new Date()).toISOString();
  const repository = syncedRepository(await repositoryIdentityOf(root));
  const all = (await readRunOutcomes(deps.store, repository)).filter((o) => needsGitLabels(o.value));
  const pending = batchAt(all, offsets.get(root) ?? 0);
  if (pending.length === 0) return 0;
  const skip = (): number => { offsets.set(root, (offsets.get(root) ?? 0) + pending.length); return 0; };
  const since = pending.map((o) => o.value.features.finalizedAt).sort()[0]!;
  const until = pending.map((o) => windowEnd(o.value.features.finalizedAt, WINDOW_DAYS)).sort().pop()!;
  const paths = new Set(pending.flatMap((o) => o.value.attribution.map((a) => a.path)));
  const read = await laterHistory(root, since, until, paths).catch(() => undefined);
  if (!read) return skip();
  const labelled = await labelBatchOffThread({
    runs: pending.map(({ id, value }) => ({ id, run: { runId: value.runId, finalizedAt: value.features.finalizedAt, attribution: value.attribution } })),
    history: read.history,
    now,
  }).catch(() => undefined);
  if (!labelled) return skip();
  // A capped (incomplete) read still moves the batch on, so the same runs never hit the cap every pass.
  if (!read.complete) offsets.set(root, (offsets.get(root) ?? 0) + pending.length);
  const finalizedAtOf = new Map(pending.map((o) => [o.id, o.value.features.finalizedAt] as const));
  let changed = 0;
  for (const { id, labels } of labelled) {
    // Complete for this run when its whole window lies inside the covered history; else only observed events count.
    const covered = read.complete || Date.parse(windowEnd(finalizedAtOf.get(id)!, WINDOW_DAYS)) <= Date.parse(read.coveredUntil);
    const kept = covered ? labels : labels.filter((l) => l.value === true);
    if (kept.length > 0 && await updateRunOutcome(deps.store, id, { labels: kept, deviceId: deps.deviceId(), at: now })) changed++;
  }
  return changed;
}

/** Runs a pass over `roots()` (repository ROOTS: blame resolves paths against them) after a delay, then every {@link LABEL_PASS_MS}. */
export function scheduleLocalLabels(
  deps: { store: LocalFirstStore; deviceId(): string; roots(): Promise<readonly string[]>; onError(error: unknown): void },
): () => void {
  let busy = false;
  const pass = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      for (const root of await deps.roots().catch(() => [])) await labelRepository(deps, root).catch(deps.onError);
    } finally {
      busy = false;
    }
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void pass();
    interval = setInterval(() => void pass(), LABEL_PASS_MS);
  }, FIRST_PASS_DELAY_MS);
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
