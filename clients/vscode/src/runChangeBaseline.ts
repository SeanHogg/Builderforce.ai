/**
 * The run-start half of run-linked change sets (G19): what was dirty before the run,
 * fingerprinted, and the attribution rule that keeps a run from claiming the user's
 * pre-existing edits. Split out of `runChangeSets.ts`.
 *
 * ONE FINGERPRINT (PRD 41 §C1 step 1). Every file, of any size, is fingerprinted as
 * `sha256:<memory contentHash>` — the EOL-normalized digest the knowledge store keys
 * facts by (`nodeContentHash`, the native twin) — through the same function at start
 * and at finalization. Each file is read at most once: a file above
 * {@link STAT_HINT_MIN_BYTES} whose stat matches its knowledge stat row reuses that
 * row's hash without a read ({@link StatHashHint}). At most
 * {@link FINGERPRINT_CONCURRENCY} files are read or stat'ed at once.
 *
 * PRE-IMAGES (PRD 41 §C1.3). At baseline the BYTES of every dirty file (untracked
 * included) are kept within the run's caps (`runDelta/preimageBudget.ts`) and handed to
 * the {@link PreimageSink}, so the delta can read a file's before side after the run
 * wrote it. A file over a cap is listed in `preimageTooLarge`.
 *
 * WHOLE WORKSPACE. With `folders`, a clean git repository is recorded too (its base
 * commit is what the delta's `git show` reads), and a non-git folder's whole working set
 * is fingerprinted and pre-imaged (`kind: "folder"`), so a run there still has a delta.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { detectPendingChanges, refreshPendingChanges, type PendingChangeRepo } from "./gitChanges";
import { normalizePath, repoName } from "./gitChangeModel";
import { runGit } from "./gitApi";
import { mapLimit } from "./gitBranchFacts";
import { nodeContentHash } from "./knowledge/nodeSha256";
import { listWorkingSet } from "./runDelta/folderWorkingSet";
import { PreimageBudget } from "./runDelta/preimageBudget";

/** Files above this size first ask the knowledge stat rows for their hash; smaller ones are simply read. */
export const STAT_HINT_MIN_BYTES = 256 * 1024;
/** At most this many files are read or stat'ed at once. */
export const FINGERPRINT_CONCURRENCY = 8;

/** The content fingerprint of one file at a moment in time: `sha256:<contentHash>`, or undefined when absent. */
export type FileFingerprint = string | undefined;

/** A file's stat as the knowledge stat manifest compares it. */
export interface FileStatFacts {
  size: number;
  mtimeNs: bigint;
  fileId?: bigint;
}

/** The stored content hash a file may reuse without being read (the knowledge stat rows), else undefined. Never throws. */
export type StatHashHint = (absPath: string, stat: FileStatFacts) => Promise<string | undefined>;

/** Receives a repository's pre-images (bare content hash → bytes). Failures are the caller's to report; the baseline stands. */
export type PreimageSink = (repoRoot: string, items: Array<{ hash: string; bytes: Uint8Array }>) => Promise<void>;

export interface ChangeSetRepoBaseline {
  root: string;
  name: string;
  /** Remote URL when the repository has one — its durable identity across machines. */
  repository: string;
  branch?: string;
  baseCommit?: string;
  /** `folder`: a non-git workspace folder whose whole working set is the baseline. Absent: a git repository. */
  kind?: "folder";
  /** Repo-relative POSIX path → fingerprint, for every file dirty at baseline (every file of a `folder`). */
  files: Record<string, FileFingerprint>;
  /** Files dirty at baseline whose bytes were over a pre-image cap (sorted). */
  preimageTooLarge?: string[];
  /** A `folder` whose listing hit its cap: a capped listing cannot tell deleted from unlisted, so it is not attributed. */
  truncated?: true;
  /**
   * A `folder` whose `files` were left out of the SYNCED lifecycle record (`changeSetLifecycle.ts`): the count it had. A
   * baseline read back from that record cannot attribute the folder; the in-process baseline can.
   */
  omittedFiles?: number;
}

export interface RunChangeBaseline {
  capturedAt: string;
  repos: ChangeSetRepoBaseline[];
}

export type ChangeAttribution =
  /** Clean before the run; the run introduced this file's pending state. */
  | "run-authored"
  /** Dirty before the run; the run changed it further (beforeHash is the pre-run edit). */
  | "run-modified-existing";

export interface AttributedChange {
  relativePath: string;
  status: string;
  beforeHash?: string;
  afterHash?: string;
  attribution: ChangeAttribution;
}

/** The bare content hash of a fingerprint (`sha256:<hex>` → `<hex>`), as the run delta and the knowledge store key it. */
export function fingerprintHash(fingerprint: FileFingerprint): string | undefined {
  return fingerprint?.startsWith("sha256:") ? fingerprint.slice("sha256:".length) : undefined;
}

async function statOf(file: string): Promise<FileStatFacts | undefined> {
  try {
    const st = await fs.stat(file, { bigint: true });
    if (!st.isFile()) return undefined;
    return { size: Number(st.size), mtimeNs: st.mtimeNs, fileId: st.ino };
  } catch {
    return undefined; // a file that vanished or cannot be stat'ed has no fingerprint
  }
}

interface FileReading {
  fingerprint: FileFingerprint;
  bytes?: Uint8Array;
}

/** THE fingerprint read: the stat hint for a big file whose bytes are not wanted, else one read. */
async function readFile(file: string, st: FileStatFacts | undefined, keepBytes: boolean, hint?: StatHashHint): Promise<FileReading> {
  if (!st) return { fingerprint: undefined };
  if (!keepBytes && hint && st.size > STAT_HINT_MIN_BYTES) {
    const reused = await hint(file, st).catch(() => undefined);
    if (reused) return { fingerprint: `sha256:${reused}` };
  }
  try {
    const bytes = await fs.readFile(file);
    const fingerprint = `sha256:${nodeContentHash(bytes)}`;
    return keepBytes ? { fingerprint, bytes } : { fingerprint };
  } catch {
    return { fingerprint: undefined };
  }
}

/** Fingerprint one file (absent or unreadable → undefined). */
export async function fingerprintFile(file: string, hint?: StatHashHint): Promise<FileFingerprint> {
  return (await readFile(file, await statOf(file), false, hint)).fingerprint;
}

/** Fingerprint many files, at most {@link FINGERPRINT_CONCURRENCY} at a time, in input order. */
export function fingerprintFiles(paths: readonly string[], hint?: StatHashHint): Promise<FileFingerprint[]> {
  return mapLimit(paths, FINGERPRINT_CONCURRENCY, (file) => fingerprintFile(file, hint));
}

/**
 * The baseline reading of one repository's files: each fingerprinted once, and the bytes of those the run's
 * {@link PreimageBudget} admits kept for the sink. Sizes are read first so the budget is spent in input order.
 */
async function readBaselineFiles(
  files: ReadonlyArray<{ path: string; relativePath: string }>,
  budget: PreimageBudget,
  hint?: StatHashHint,
): Promise<{ fingerprints: Record<string, FileFingerprint>; preimages: Array<{ hash: string; bytes: Uint8Array }>; tooLarge: string[] }> {
  const stats = await mapLimit(files, FINGERPRINT_CONCURRENCY, (f) => statOf(f.path));
  const decisions = stats.map((st) => budget.decide(st?.size));
  const indices = files.map((_, index) => index);
  const readings = await mapLimit(indices, FINGERPRINT_CONCURRENCY, (index) =>
    readFile(files[index]!.path, stats[index], decisions[index] === "capture", hint));
  const fingerprints: Record<string, FileFingerprint> = {};
  const preimages: Array<{ hash: string; bytes: Uint8Array }> = [];
  const tooLarge: string[] = [];
  files.forEach((f, index) => {
    const reading = readings[index]!;
    fingerprints[f.relativePath] = reading.fingerprint;
    const hash = fingerprintHash(reading.fingerprint);
    if (reading.bytes && hash) preimages.push({ hash, bytes: reading.bytes });
    if (decisions[index] === "too-large") tooLarge.push(f.relativePath);
  });
  return { fingerprints, preimages, tooLarge: tooLarge.sort() };
}

/**
 * The attribution diff, host-free: given what was dirty at baseline and what is dirty
 * now (with content hashes both times), which changes does the run truthfully own?
 * Files whose hash did not move are the user's pre-existing edits and are excluded.
 */
export function attributeRunChanges(
  baseline: Record<string, FileFingerprint>,
  current: Array<{ relativePath: string; status: string; hash: FileFingerprint }>,
): AttributedChange[] {
  const out: AttributedChange[] = [];
  for (const file of current) {
    const beforeHash = baseline[file.relativePath];
    const existedAtBaseline = file.relativePath in baseline;
    if (existedAtBaseline && beforeHash === file.hash) continue; // pre-existing edit, untouched by the run
    out.push({
      relativePath: file.relativePath,
      status: file.status,
      ...(existedAtBaseline && beforeHash !== undefined ? { beforeHash } : {}),
      ...(file.hash !== undefined ? { afterHash: file.hash } : {}),
      attribution: existedAtBaseline ? "run-modified-existing" : "run-authored",
    });
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function baseCommitOf(root: string): Promise<string | undefined> {
  return (await runGit(root, "rev-parse HEAD")) || undefined;
}

export async function repositoryIdentityOf(root: string): Promise<string> {
  const remote = (await runGit(root, "config --get remote.origin.url"))?.trim();
  return remote || root;
}

export interface BaselineCaptureOptions {
  /** Where the dirty files' bytes go (the run's pre-images). Absent: fingerprints only. */
  preimages?: PreimageSink;
  /** The knowledge stat rows, so a big unchanged file is not read. */
  hint?: StatHashHint;
  /** The workspace folders: clean git repositories and non-git folders among them are recorded too. */
  folders?: readonly string[];
  /** A pre-image sink failure (the baseline still stands; those files resolve as `preimage-missing`). */
  onPreimageError?: (error: unknown) => void;
}

async function gitRepoEntry(
  repo: Pick<PendingChangeRepo, "root" | "name" | "branch" | "changes">,
  budget: PreimageBudget,
  opts: BaselineCaptureOptions,
): Promise<ChangeSetRepoBaseline> {
  const baseCommit = await baseCommitOf(repo.root);
  const read = await readBaselineFiles(repo.changes, budget, opts.hint);
  await storePreimages(repo.root, read.preimages, opts);
  return {
    root: repo.root,
    name: repo.name,
    repository: await repositoryIdentityOf(repo.root),
    ...(repo.branch ? { branch: repo.branch } : {}),
    ...(baseCommit ? { baseCommit } : {}),
    files: read.fingerprints,
    ...(read.tooLarge.length ? { preimageTooLarge: read.tooLarge } : {}),
  };
}

async function storePreimages(root: string, items: Array<{ hash: string; bytes: Uint8Array }>, opts: BaselineCaptureOptions): Promise<void> {
  if (!opts.preimages || items.length === 0) return;
  try {
    await opts.preimages(root, items);
  } catch (error) {
    opts.onPreimageError?.(error);
  }
}

/** The folders the pending set does not cover: a clean git repository (by its top level), or a non-git folder. */
async function uncoveredFolders(folders: readonly string[], covered: Set<string>): Promise<Array<{ root: string; git: boolean }>> {
  const out: Array<{ root: string; git: boolean }> = [];
  for (const folder of folders) {
    const top = await runGit(folder, "rev-parse --show-toplevel");
    const root = top ? path.resolve(top) : folder;
    const key = normalizePath(root);
    if (covered.has(key)) continue;
    covered.add(key);
    out.push({ root, git: !!top });
  }
  return out;
}

/**
 * Snapshot every workspace repository's pending work with content hashes (and the dirty
 * files' pre-images). Called at run start; the run's own edits are excluded later by the
 * attribution diff, so this can safely run on an already-dirty tree.
 */
export async function captureRunChangeBaseline(now: Date = new Date(), opts: BaselineCaptureOptions = {}): Promise<RunChangeBaseline> {
  // The pending-change cache can be 15s stale. A stale "clean" snapshot would later
  // attribute the user's pre-existing dirty files to this run.
  refreshPendingChanges();
  const pending = await detectPendingChanges();
  const budget = new PreimageBudget();
  const repos: ChangeSetRepoBaseline[] = [];
  for (const repo of pending.repos) repos.push(await gitRepoEntry(repo, budget, opts));
  const covered = new Set(pending.repos.map((repo) => normalizePath(repo.root)));
  for (const { root, git } of await uncoveredFolders(opts.folders ?? [], covered)) {
    if (git) {
      const branch = await runGit(root, "rev-parse --abbrev-ref HEAD");
      repos.push(await gitRepoEntry({ root, name: repoName(root), changes: [], ...(branch && branch !== "HEAD" ? { branch } : {}) }, budget, opts));
      continue;
    }
    const listed = await listWorkingSet(root);
    if (listed.files.length === 0) continue; // an empty or unreadable folder has nothing a run could change
    const read = await readBaselineFiles(listed.files, budget, opts.hint);
    await storePreimages(root, read.preimages, opts);
    repos.push({
      root,
      name: repoName(root),
      repository: root,
      kind: "folder",
      files: read.fingerprints,
      ...(read.tooLarge.length ? { preimageTooLarge: read.tooLarge } : {}),
      ...(listed.truncated ? { truncated: true as const } : {}),
    });
  }
  return { capturedAt: now.toISOString(), repos };
}
