/**
 * prSecurityScan — the SAST + secret + SCA scan of an agent's pull request (PRD 08 §10).
 *
 * WHERE IT RUNS. Wherever the platform can read the branch: the changed files are listed and read
 * through the provider API (`listBranchDiff` / `readRepoFile`, the same read path the agent's own
 * repo tools use, with the repo's own credential). The rules are the pure
 * `domain/security/diffScanRules`. SCA looks the changed dependency manifests up on OSV.dev
 * (`osvScaScan`). NOTE ON CREDENTIAL SCOPE: the repo credential model holds ONE token per repository
 * (`integration_credentials`); there is no separate read-only credential to prefer, so the scan reads
 * with the same token the repo is connected with.
 *
 * READ AT THE VERIFIED COMMIT. Every read - the diff and each file - is made at the head COMMIT SHA the
 * scan rows are keyed on, not at the branch name: a push between the head lookup and the reads would
 * otherwise put one commit's results on another commit's key.
 *
 * NOTHING HERE MAY LOOK CLEAN WHEN IT IS NOT. A file that could not be read (an API error, rate limit,
 * a file over the read cap) makes the scan `truncated` with the reason - or `failed` when NOTHING could
 * be read. A scan that saw only part of the change is recorded `truncated`; one that could not run is
 * `skipped` / `failed` with its reason. The merge gate (`securityMergeGate.evaluateSecurityGate`) treats
 * every one of those as a block. A truncated or failed scan also NEVER retires the previous open
 * findings (`replaceOpen` runs only on a complete scan): not having seen a finding is not the same as
 * it being fixed.
 *
 * It records one `vulnerability_scans` row per type and head commit (prScanStore) and writes findings
 * through the ONE findings writer (`vulnerabilityFindings.ingestScanFindings`, `replaceOpen`).
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  scanFileContent, isExcludedExecutablePath, isSecretScannablePath, type DiffScanKind,
} from '../../domain/security/diffScanRules';
import type { ActorIdentity } from '../activity/activityLog';
import { listBranchDiff, listRepoFiles, readRepoFile, type RepoReadContext } from '../repos/readRepoContents';
import { ingestScanFindings } from './vulnerabilityFindings';
import { endPrScan, ensurePrScan, type PrScanScope } from './prScanStore';
import { isScaManifestPath, OSV_MAX_PACKAGES, parseManifests, queryOsv } from './osvScaScan';
import type { NormalizedFinding } from '../../domain/security/scanReportParsers';

/** Bounds: one finalize must not read an unbounded branch inside a Worker invocation. */
export const MAX_FILES = 60;
const READ_CONCURRENCY = 6;
const MAX_MANIFESTS = 40;

export type ChangedFiles =
  | {
    ok: true; changedPaths: string[]; files: Array<{ path: string; content: string }>;
    /** The scan did not see everything: a file cap, a truncated list, or a file that could not be read in full. */
    truncated: boolean;
    /** Source files that could not be read (or were cut at the read cap), with the reason. */
    readFailures: string[];
    /** How many source files a read was attempted for. */
    sourceAttempted: number;
    /**
     * Changed files that are EXECUTABLE but that the SAST rules and the reviewer do not read (minified
     * bundles, scripts under dist / build / vendor, WebAssembly). The SECRET scan reads them; SAST and
     * REVIEW cannot, so they are recorded truncated with the reason "excluded executable path".
     */
    excludedExecutables: string[];
    /** The dependency manifests / lockfiles among the changed paths (the SCA input; lockfiles are
     *  not in `files` because the source rules skip them). */
    manifests: Array<{ path: string; content: string }>;
    manifestReadFailures: string[];
    manifestsAttempted: number;
    /** The BASE branch's content of each changed lockfile, so a lockfile-only change scans just its delta. */
    baseLockfiles: Map<string, string>;
    /** More manifests changed than were read: SCA did not see them all. */
    manifestsTruncated: boolean;
  }
  | { ok: false; reason: string };

export interface PrScanOutcome {
  /** Every scan row this step wrote or reused, by type. */
  scans: Array<{ scanId: string; scanType: string; status: 'completed' | 'skipped' | 'failed' }>;
  filesRead: number;
  truncated: boolean;
  /** Present when the branch could not be read at all (all scans skipped). */
  unreadable?: string;
  /** The segment the scan rows resolved to (the DB fills it when the repo carried none). */
  segmentId: string | null;
}

interface ReadAllResult { files: Array<{ path: string; content: string }>; failures: string[] }

/**
 * Read every path; a read that fails, or that the reader cut at its size cap, is a FAILURE with its
 * reason, not a silent omission - the caller marks the scan incomplete.
 */
async function readAll(read: RepoReadContext, paths: string[]): Promise<ReadAllResult> {
  const files: ReadAllResult['files'] = [];
  const failures: string[] = [];
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const batch = paths.slice(i, i + READ_CONCURRENCY);
    const results = await Promise.all(batch.map((p) => readRepoFile(read, p)));
    results.forEach((r, j) => {
      const path = batch[j]!;
      if (!r.ok) failures.push(`${path}: ${r.reason}`);
      else {
        files.push({ path: r.path, content: r.content });
        if (r.truncated) failures.push(`${path}: file exceeds the read limit and was only partly read`);
      }
    });
  }
  return { files, failures };
}

const isLockfile = (p: string): boolean => /(^|\/)(package-lock\.json|pnpm-lock\.yaml)$/.test(p);

const summariseFailures = (failures: readonly string[]): string =>
  `${failures.length} file(s) could not be read in full: ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? '; …' : ''}`;

/** Run one rule-kind over the files and ingest the findings into its scan row. */
async function runKind(
  env: Env, db: Db, actor: ActorIdentity, scope: PrScanScope, kind: DiffScanKind,
  collected: Extract<ChangedFiles, { ok: true }>,
): Promise<PrScanOutcome['scans'][number] & { segmentId: string | null }> {
  const scanType = kind === 'secret' ? 'SECRET' : 'SAST';
  const scan = await ensurePrScan(env, db, actor, scope, scanType);
  const segmentId = scan.segmentId ?? scope.segmentId;
  if (!segmentId) {
    await endPrScan(db, scope.tenantId, scan.id, 'failed', 'Scan row has no segment to scope its findings to.');
    return { scanId: scan.id, scanType, status: 'failed', segmentId: null };
  }
  // Nothing could be read although something was attempted: this scan saw NOTHING.
  if (collected.sourceAttempted > 0 && collected.files.length === 0) {
    await endPrScan(db, scope.tenantId, scan.id, 'failed', `No changed file could be read, so nothing was scanned. ${summariseFailures(collected.readFailures)}`);
    return { scanId: scan.id, scanType, status: 'failed', segmentId };
  }
  const findings: NormalizedFinding[] = collected.files.flatMap((f) => scanFileContent(f.path, f.content, [kind]));
  // SAST cannot read an excluded EXECUTABLE (a minified bundle, vendored / built script, WebAssembly): the
  // change touched code that can run and that this scan did not look at, so it is incomplete.
  const excluded = kind === 'sast' ? collected.excludedExecutables : [];
  const truncated = collected.truncated || excluded.length > 0;
  const notes = [
    collected.readFailures.length > 0 ? summariseFailures(collected.readFailures) : null,
    collected.truncated && collected.readFailures.length === 0 ? `Only the first ${MAX_FILES} changed files were read; the scan is incomplete.` : null,
    excluded.length > 0 ? `Excluded executable path: ${excluded.slice(0, 5).join(', ')}${excluded.length > 5 ? ', …' : ''} - the static rules do not read it.` : null,
  ].filter(Boolean).join(' ') || null;
  await ingestScanFindings(db, env, { tenantId: scope.tenantId, segmentId, scanId: scan.id }, {
    format: 'normalized', report: findings,
    // Only a COMPLETE scan may retire earlier open findings.
    replaceOpen: !truncated, truncated, notes,
  });
  return { scanId: scan.id, scanType, status: 'completed', segmentId };
}

/**
 * Read the PR's changed files ONCE - the scan and the review share the same reading - AT `headSha`
 * (falling back to `read.ref` only for a hand-started scan that has no commit to pin to).
 */
export async function collectChangedFiles(read: RepoReadContext, base: string, headSha: string | null = null): Promise<ChangedFiles> {
  const at = headSha ?? read.ref;
  const pinned: RepoReadContext = { ...read, ref: at };
  const diff = await listBranchDiff(pinned, base, at);
  if (!diff.ok) return { ok: false, reason: diff.reason };
  const changed = diff.files.filter((f) => f.status !== 'removed');
  // The SECRET scan reads EVERY changed file (minified / vendored included); SAST and the reviewer
  // narrow it themselves, and exclusion of an executable file is reported, not silent.
  const readable = changed.map((f) => f.path).filter(isSecretScannablePath);
  const source = await readAll(pinned, readable.slice(0, MAX_FILES));
  const excludedExecutables = changed.map((f) => f.path).filter(isExcludedExecutablePath);
  const allManifestPaths = changed.map((f) => f.path).filter(isScaManifestPath);
  const manifestPaths = allManifestPaths.slice(0, MAX_MANIFESTS);
  const manifests = await readAll(pinned, manifestPaths);
  const baseRead = await readAll({ ...read, ref: base }, manifestPaths.filter(isLockfile));
  return {
    ok: true,
    changedPaths: changed.map((f) => f.path),
    files: source.files,
    readFailures: source.failures,
    sourceAttempted: Math.min(readable.length, MAX_FILES),
    excludedExecutables,
    manifests: manifests.files,
    // A lockfile we could not read at the BASE only makes the delta larger (everything counts as new),
    // so it is not an incompleteness; a manifest we could not read at the head is.
    manifestReadFailures: manifests.failures,
    manifestsAttempted: manifestPaths.length,
    baseLockfiles: new Map(baseRead.files.map((f) => [f.path, f.content])),
    manifestsTruncated: allManifestPaths.length > MAX_MANIFESTS,
    truncated: diff.truncated || readable.length > MAX_FILES || source.failures.length > 0,
  };
}

/** Read a whole branch (no base to diff against): the hand-started scan of a repo's default branch. */
export async function collectBranchFiles(read: RepoReadContext, headSha: string | null = null): Promise<ChangedFiles> {
  const pinned: RepoReadContext = { ...read, ref: headSha ?? read.ref };
  const listed = await listRepoFiles(pinned);
  if (!listed.ok) return { ok: false, reason: listed.reason };
  const readable = listed.paths.filter(isSecretScannablePath);
  const source = await readAll(pinned, readable.slice(0, MAX_FILES));
  const excludedExecutables = listed.paths.filter(isExcludedExecutablePath);
  const manifestPaths = listed.paths.filter(isScaManifestPath);
  const manifests = await readAll(pinned, manifestPaths.slice(0, MAX_MANIFESTS));
  return {
    ok: true, changedPaths: listed.paths, files: source.files, readFailures: source.failures,
    sourceAttempted: Math.min(readable.length, MAX_FILES), excludedExecutables,
    manifests: manifests.files, manifestReadFailures: manifests.failures, manifestsAttempted: Math.min(manifestPaths.length, MAX_MANIFESTS),
    baseLockfiles: new Map(),
    manifestsTruncated: manifestPaths.length > MAX_MANIFESTS,
    truncated: listed.truncated || readable.length > MAX_FILES || source.failures.length > 0,
  };
}

/** The SCA scan row: manifests -> OSV.dev -> findings. Failed (never clean) when OSV cannot be asked. */
async function runSca(
  env: Env, db: Db, actor: ActorIdentity, scope: PrScanScope, collected: Extract<ChangedFiles, { ok: true }>,
): Promise<PrScanOutcome['scans'][number] & { segmentId: string | null }> {
  const scan = await ensurePrScan(env, db, actor, scope, 'SCA');
  const segmentId = scan.segmentId ?? scope.segmentId;
  const done = async (status: 'completed' | 'failed', notes: string | null, truncated = false) => {
    await endPrScan(db, scope.tenantId, scan.id, status, notes, truncated);
    return { scanId: scan.id, scanType: 'SCA', status, segmentId };
  };
  // "No manifest changed" is true ONLY when none was listed; a manifest we listed but could not read
  // is an unchecked dependency set, not a clean one.
  if (collected.manifestsAttempted === 0) return done('completed', 'No dependency manifest changed.');
  if (!segmentId) return done('failed', 'Scan row has no segment to scope its findings to.');
  if (collected.manifests.length === 0) {
    return done('failed', `No dependency manifest could be read, so the dependencies were not checked. ${summariseFailures(collected.manifestReadFailures)}`);
  }

  const parsed = parseManifests(collected.manifests, collected.baseLockfiles);
  const queried = await queryOsv(parsed.packages);
  if (!queried.ok) return done('failed', `Dependency lookup failed, so the dependencies were not checked: ${queried.reason}`);

  const truncated = parsed.capped || queried.truncated || collected.manifestsTruncated || collected.manifestReadFailures.length > 0;
  const notes = [
    `Checked ${parsed.packages.length} package(s) against OSV.dev; ${queried.vulnerablePackages} affected.`,
    parsed.capped ? `Capped at ${OSV_MAX_PACKAGES} packages; the rest were not checked.` : null,
    queried.truncated ? 'More advisories matched than could be read; the unread ones stand at HIGH.' : null,
    collected.manifestReadFailures.length > 0 ? `Some manifests could not be read: ${collected.manifestReadFailures.slice(0, 5).join('; ')}.` : null,
    parsed.unresolved.length > 0
      ? `Not checked (version not resolvable): ${parsed.unresolved.slice(0, 20).join(', ')}${parsed.unresolved.length > 20 ? `, and ${parsed.unresolved.length - 20} more` : ''}.`
      : null,
  ].filter(Boolean).join(' ');
  await ingestScanFindings(db, env, { tenantId: scope.tenantId, segmentId, scanId: scan.id }, {
    format: 'normalized', report: queried.findings, replaceOpen: !truncated, truncated, notes,
  });
  return { scanId: scan.id, scanType: 'SCA', status: 'completed', segmentId };
}

export async function runPullRequestScan(
  env: Env, db: Db, actor: ActorIdentity, scope: PrScanScope, collected: ChangedFiles,
): Promise<PrScanOutcome> {
  if (!collected.ok) {
    const reason = `Branch could not be read, so it was not scanned: ${collected.reason}`;
    const scans: PrScanOutcome['scans'] = [];
    let segmentId = scope.segmentId;
    for (const t of ['SECRET', 'SAST', 'SCA'] as const) {
      const s = await ensurePrScan(env, db, actor, scope, t);
      await endPrScan(db, scope.tenantId, s.id, 'skipped', reason);
      scans.push({ scanId: s.id, scanType: t, status: 'skipped' });
      segmentId = s.segmentId ?? segmentId;
    }
    return { scans, filesRead: 0, truncated: false, unreadable: reason, segmentId };
  }

  const secret = await runKind(env, db, actor, scope, 'secret', collected);
  const sast = await runKind(env, db, actor, scope, 'sast', collected);
  const sca = await runSca(env, db, actor, scope, collected);

  return {
    scans: [
      { scanId: secret.scanId, scanType: 'SECRET', status: secret.status },
      { scanId: sast.scanId, scanType: 'SAST', status: sast.status },
      { scanId: sca.scanId, scanType: 'SCA', status: sca.status },
    ],
    filesRead: collected.files.length,
    truncated: collected.truncated,
    segmentId: secret.segmentId ?? sast.segmentId ?? scope.segmentId,
  };
}
