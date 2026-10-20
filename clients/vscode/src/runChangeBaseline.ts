/**
 * The run-start half of run-linked change sets (G19): what was dirty before the run,
 * fingerprinted, and the attribution rule that keeps a run from claiming the user's
 * pre-existing edits. Split out of `runChangeSets.ts`.
 *
 * FINGERPRINTS ARE BOUNDED. A baseline is captured before EVERY run start, so it must
 * not read a dirty tree's every file whole: files are fingerprinted at most
 * {@link FINGERPRINT_CONCURRENCY} at a time, and a file larger than
 * {@link FINGERPRINT_HASH_MAX_BYTES} is fingerprinted by size + mtime instead of its
 * content. Both readings of a run (start and finalize) use the same function, so a
 * change in either size or mtime still shows as a change.
 */

import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { detectPendingChanges, refreshPendingChanges, type PendingChangeRepo } from "./gitChanges";
import { runGit } from "./gitApi";
import { mapLimit } from "./gitBranchFacts";

/** Files up to this size are content-hashed; larger ones get a size + mtime fingerprint. */
export const FINGERPRINT_HASH_MAX_BYTES = 256 * 1024;
/** At most this many files are read or stat'ed at once. */
export const FINGERPRINT_CONCURRENCY = 8;

/** The content fingerprint of one file at a moment in time. */
export type FileFingerprint = string | undefined;

export interface ChangeSetRepoBaseline {
  root: string;
  name: string;
  /** Remote URL when the repository has one — its durable identity across machines. */
  repository: string;
  branch?: string;
  baseCommit?: string;
  /** Repo-relative POSIX path → fingerprint, for every file dirty at baseline. */
  files: Record<string, FileFingerprint>;
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

/**
 * Fingerprint one file. Absent/unreadable → undefined; up to
 * {@link FINGERPRINT_HASH_MAX_BYTES} → a sha256 of the content; larger → its size and
 * mtime (hashing is evidence, not backup).
 */
export async function fingerprintFile(path: string): Promise<FileFingerprint> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) return undefined;
    if (stat.size > FINGERPRINT_HASH_MAX_BYTES) return `stat:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    return `sha256:${createHash("sha256").update(await fs.readFile(path)).digest("hex")}`;
  } catch {
    // A file that vanished or cannot be read has no fingerprint; the diff records it as such.
    return undefined;
  }
}

/** Fingerprint many files, at most {@link FINGERPRINT_CONCURRENCY} at a time, in input order. */
export function fingerprintFiles(paths: readonly string[]): Promise<FileFingerprint[]> {
  return mapLimit(paths, FINGERPRINT_CONCURRENCY, fingerprintFile);
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

async function fingerprintRepoChanges(repo: PendingChangeRepo): Promise<Record<string, FileFingerprint>> {
  const fingerprints = await fingerprintFiles(repo.changes.map((change) => change.path));
  return Object.fromEntries(repo.changes.map((change, index) => [change.relativePath, fingerprints[index]] as const));
}

export async function baseCommitOf(root: string): Promise<string | undefined> {
  return (await runGit(root, "rev-parse HEAD")) || undefined;
}

export async function repositoryIdentityOf(root: string): Promise<string> {
  const remote = (await runGit(root, "config --get remote.origin.url"))?.trim();
  return remote || root;
}

/**
 * Snapshot every workspace repository's pending work with content hashes. Called at run
 * start; the run's own edits are excluded later by the attribution diff, so this can
 * safely run on an already-dirty tree.
 */
export async function captureRunChangeBaseline(now: Date = new Date()): Promise<RunChangeBaseline> {
  // The pending-change cache can be 15s stale. A stale "clean" snapshot would later
  // attribute the user's pre-existing dirty files to this run.
  refreshPendingChanges();
  const pending = await detectPendingChanges();
  const repos: ChangeSetRepoBaseline[] = [];
  for (const repo of pending.repos) {
    const baseCommit = await baseCommitOf(repo.root);
    repos.push({
      root: repo.root,
      name: repo.name,
      repository: await repositoryIdentityOf(repo.root),
      ...(repo.branch ? { branch: repo.branch } : {}),
      ...(baseCommit ? { baseCommit } : {}),
      files: await fingerprintRepoChanges(repo),
    });
  }
  return { capturedAt: now.toISOString(), repos };
}

