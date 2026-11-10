/**
 * Naturalness at run end on this device (PRD 41 §D6): after the WHOLE run delta has settled (`atRunEnd.ts`, never inside
 * the delta's budget), each repository's changed lines are scored against the repository's own unchanged code
 * (`@builderforce/run-delta/predict` `naturalnessCollector`) and the result is stored as the run's device-only prediction row
 * (`runDeltaPredictions.ts`), which the card's Predicted line reads as "≈ N unusual lines".
 *
 * Best-effort and advisory (§D0): it never fails, delays or holds the run, and it feeds no verdict. A failure is logged.
 *
 * Order, cheapest first (nothing CPU-heavy before its gate):
 *   1. the kill switch (`builderforce.runDelta.predict.naturalness`) → `model-disabled`, nothing read;
 *   2. the run's changed files, PROVEN (`runTexts.ts`: pre-image or base blob before, hash-checked after; an oversized or
 *      binary side skips the file) → none scorable ⇒ `not-applicable`, no baseline read;
 *   3. the baseline, budgeted from `git ls-tree -r -l` alone before any byte is read: tracked code files of the changed
 *      languages, ≤ {@link MAX_FILE_BYTES}, outside the workspace walk's skipped folders (agent-tools `isSkippedDirName`:
 *      dependencies, build output, vendored trees), not touched by the run; an even stride of at most
 *      {@link MAX_BASELINE_FILES}, cut at {@link MAX_BASELINE_BYTES}; read in ONE `cat-file --batch`, then fed one file at a
 *      time, yielding to the event loop between files (the collector, told the picks first, takes each file's equal share of its
 *      language's line budget) and stopping on abort.
 * A folder root (no base commit) has no baseline: its changed files alone make it `not-applicable` or `insufficient-data`.
 */

import { isSkippedDirName } from "@builderforce/agent-tools/knowledge";
import { runGit } from "@builderforce/agent-tools/node-git-history";
import { strideSample } from "@builderforce/agent-tools/sampling";
import type { LocalFirstStore } from "@builderforce/local-first";
import {
  naturalnessCollector, naturalnessLanguageOf, type NaturalnessCollector, type NaturalnessResult,
} from "@builderforce/run-delta/predict";
import { isBinaryBytes } from "@seanhogg/builderforce-memory/knowledge";
import { yieldToEventLoop } from "../localFirstJournalIo";
import type { LocalChangeSetValue } from "../runChangeSets";
import { GIT_TIMEOUT_MS, isCommitId, repoGit } from "./gitSide";
import type { StoredRunDelta } from "./runDeltaRecords";
import { predictedOf, storeRunPrediction, type RunPredictionValue } from "./runDeltaPredictions";
import { provenRunTexts } from "./runTexts";
import type { PreimageReader } from "./sideTexts";

/** Baseline files read, at most. */
export const MAX_BASELINE_FILES = 150;
/** A file larger than this (either side, or a baseline blob) is not read. */
export const MAX_FILE_BYTES = 256 * 1024;
/** §D6: baseline text read per repository, at most. */
export const MAX_BASELINE_BYTES = 4 * 1024 * 1024;

export interface NaturalnessDeps {
  store: LocalFirstStore;
  deviceId(): string;
  onError(error: unknown): void;
  /** The kill switch for the repository's folder (default on). */
  enabled(root: string): boolean;
  /** The run's pre-images in the repository's knowledge file (files dirty at baseline). */
  preimages?(root: string): PreimageReader | undefined;
  /** Extension shutdown: the walk stops and nothing is stored. */
  signal?: AbortSignal;
  now?: () => Date;
}

/** One `git ls-tree -r -l -z` row. */
interface TreeEntry { path: string; size: number }

/** `git ls-tree -r -l -z` output → blobs with their sizes (submodules and other non-blobs dropped). */
export function parseLsTreeSizes(out: string): TreeEntry[] {
  return out.split("\0").flatMap((row) => {
    const m = /^\d+ blob [0-9a-f]+ +(\d+)\t(.+)$/s.exec(row);
    return m ? [{ path: m[2]!, size: Number(m[1]) }] : [];
  });
}

const insideSkippedDir = (p: string): boolean => p.split("/").slice(0, -1).some((seg) => isSkippedDirName(seg));

/**
 * The baseline files to read, decided from the tree listing alone: code files of `languages`, ≤ {@link MAX_FILE_BYTES},
 * outside skipped folders, not the run's; an even stride of at most {@link MAX_BASELINE_FILES}, cut at {@link MAX_BASELINE_BYTES}.
 */
export function baselinePicks(entries: readonly TreeEntry[], languages: ReadonlySet<string>, exclude: ReadonlySet<string>): string[] {
  const eligible = entries
    .filter((e) => e.size <= MAX_FILE_BYTES && !exclude.has(e.path) && !insideSkippedDir(e.path))
    .filter((e) => { const l = naturalnessLanguageOf(e.path); return l !== undefined && languages.has(l); })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const picks: string[] = [];
  let bytes = 0;
  for (const e of strideSample(eligible, MAX_BASELINE_FILES)) {
    if (bytes + e.size > MAX_BASELINE_BYTES) break;
    bytes += e.size;
    picks.push(e.path);
  }
  return picks;
}

/** Feeds the baseline at `commit` to the collector, one file per turn of the event loop. Returns the paths it took. */
async function feedBaseline(root: string, commit: string, c: NaturalnessCollector, exclude: ReadonlySet<string>, signal?: AbortSignal): Promise<string[]> {
  const listing = (await runGit(root, ["ls-tree", "-r", "-l", "-z", commit], { timeoutMs: GIT_TIMEOUT_MS })).stdout;
  if (listing === undefined) return [];
  const picks = baselinePicks(parseLsTreeSizes(listing), c.languages, exclude);
  if (picks.length === 0 || signal?.aborted) return [];
  const blobs = await repoGit(root).blobs(commit, picks);
  c.planBaseline(picks);
  const taken: string[] = [];
  for (const p of picks) {
    await yieldToEventLoop();
    if (signal?.aborted) return taken;
    const bytes = blobs?.get(p);
    if (!bytes || bytes.byteLength > MAX_FILE_BYTES || isBinaryBytes(bytes)) continue;
    taken.push(p);
    c.addBaseline({ path: p, text: new TextDecoder("utf-8").decode(bytes) });
  }
  return taken;
}

/** Scores one stored delta's repository. Undefined when its change set is gone or the walk was aborted. */
export async function naturalnessOf(
  deps: NaturalnessDeps, stored: StoredRunDelta,
): Promise<{ result: NaturalnessResult; baseCommit?: string; baselinePicks: string[]; afterHashes: Record<string, string> } | undefined> {
  const record = await deps.store.read((tx) => tx.get<LocalChangeSetValue>("change-set", stored.value.changeSetId));
  const cs = record?.payload;
  if (!cs) return undefined;
  const root = stored.local.root;
  const baseCommit = isCommitId(cs.baseCommit) ? cs.baseCommit : undefined;
  const c = naturalnessCollector();
  const base = { ...(baseCommit ? { baseCommit } : {}), baselinePicks: [] as string[], afterHashes: {} as Record<string, string> };
  if (!deps.enabled(root)) return { result: c.finish({ disabled: true }), ...base };
  const preimages = deps.preimages?.(root);
  const files = await provenRunTexts({ root, changeSet: cs, maxBytes: MAX_FILE_BYTES, ...(preimages ? { preimages } : {}) });
  for (const f of files) {
    if (f.after.state !== "text" || f.before.state === "unreadable") continue; // deleted, or not provably the run's
    await yieldToEventLoop();
    if (deps.signal?.aborted) return undefined;
    c.addChanged({ path: f.path, after: f.after.text, ...(f.before.state === "text" ? { before: f.before.text } : {}) });
    if (f.afterHash) base.afterHashes[f.path] = f.afterHash;
  }
  if (c.scorableLines > 0 && baseCommit) {
    base.baselinePicks = await feedBaseline(root, baseCommit, c, new Set(files.map((f) => f.path)), deps.signal);
    if (deps.signal?.aborted) return undefined;
  }
  return { result: c.finish(), ...base };
}

/**
 * Scores and stores the run's naturalness for one stored delta; never throws. True when it stored a row a card shows (an `ok`
 * prediction with at least one unusual line).
 */
export async function recordNaturalness(deps: NaturalnessDeps, stored: StoredRunDelta): Promise<boolean> {
  try {
    const scored = await naturalnessOf(deps, stored);
    if (!scored || deps.signal?.aborted) return false;
    const row: RunPredictionValue = {
      kind: "prediction", runId: stored.value.runId, chatId: stored.value.chatId, repository: stored.value.repository,
      changeSetId: stored.value.changeSetId, root: stored.local.root, at: (deps.now?.() ?? new Date()).toISOString(), naturalness: scored.result,
      ...(scored.baseCommit ? { baseCommit: scored.baseCommit } : {}), baselinePicks: scored.baselinePicks, afterHashes: scored.afterHashes,
    };
    return (await storeRunPrediction(deps.store, deps.deviceId(), row)) && predictedOf(row).length > 0;
  } catch (error) {
    deps.onError(error);
    return false;
  }
}
