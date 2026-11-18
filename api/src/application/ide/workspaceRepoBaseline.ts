/**
 * The repo BASELINE of a project's workspace, per linked repository: the repo paths the
 * workspace holds a real copy of — what an import wrote, and what the last push left in
 * that repo. A push deletes a repo file only when the baseline held it and the workspace
 * has since lost it.
 *
 * Without it, "delete every base-tree path the workspace lacks" deletes what was never
 * imported: a file read only in part (skipped so its fragment is never pushed back), the
 * files past an import cap, a file that failed to read. The baseline makes those
 * not-imported files invisible to the push instead of deleted by it.
 *
 * Keyed by REPOSITORY (`ide/repo-baselines/<projectId>/<repoId>.json`), so a project with
 * several repos never deletes repo B's files because of repo A's import; dropped when the
 * repo is unlinked or re-pointed. Stored next to the workspace, never under its prefix, so
 * it never lists, opens or pushes as a workspace file.
 *
 * Reads say WHY there is no baseline (`missing` vs `unreadable`): an unreadable one must
 * stop deletions without being overwritten, so pending deletes survive. Writes are
 * best-effort: a failed write is reported, never failing a push or import that landed.
 */
import { IDE_PREFIX } from '../project/projectTemplate';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The bucket operations the baseline needs (an R2 bucket satisfies it). */
export interface BaselineBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export type RepoBaseline =
  | { state: 'missing' }
  | { state: 'ok'; paths: Set<string> }
  | { state: 'unreadable'; reason: string };

const SOURCE = 'application/ide/workspaceRepoBaseline.ts';

/** `ide/repo-baselines/12/<repoId>.json` — beside the `ide/projects/12/` workspace, never inside it. */
export function baselineKey(projectId: number, repoId: string): string {
  return `${IDE_PREFIX}repo-baselines/${projectId}/${encodeURIComponent(repoId)}.json`;
}

export async function readRepoBaseline(bucket: BaselineBucket, projectId: number, repoId: string): Promise<RepoBaseline> {
  let text: string;
  try {
    const object = await bucket.get(baselineKey(projectId, repoId));
    if (!object) return { state: 'missing' };
    text = await object.text();
  } catch (error) {
    return { state: 'unreadable', reason: `read failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const paths = (JSON.parse(text) as { paths?: unknown })?.paths;
    if (!Array.isArray(paths)) return { state: 'unreadable', reason: 'corrupt: no paths array' };
    return { state: 'ok', paths: new Set(paths.filter((p): p is string => typeof p === 'string')) };
  } catch (error) {
    return { state: 'unreadable', reason: `corrupt: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Best-effort write: a failure is reported (the push / import already landed), never thrown. */
export async function writeRepoBaseline(bucket: BaselineBucket, projectId: number, repoId: string, paths: Iterable<string>): Promise<boolean> {
  try {
    await bucket.put(baselineKey(projectId, repoId), JSON.stringify({ paths: [...new Set(paths)].sort() }));
    return true;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'writeRepoBaseline', level: 'warning', context: { projectId, repoId } });
    return false;
  }
}

/** Unlinked or re-pointed repo: its baseline describes a repo the workspace no longer pushes to. Best-effort. */
export async function dropRepoBaseline(bucket: BaselineBucket, projectId: number, repoId: string): Promise<void> {
  try {
    await bucket.delete(baselineKey(projectId, repoId));
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'dropRepoBaseline', level: 'warning', context: { projectId, repoId } });
  }
}

/**
 * After an import: the baseline gains the paths it wrote (a re-import adds to what earlier
 * ones wrote). An UNREADABLE prior baseline is left alone — overwriting it would forget
 * the files it held — and reported.
 */
export async function recordImportBaseline(bucket: BaselineBucket, projectId: number, repoId: string, importedPaths: Iterable<string>): Promise<boolean> {
  const prior = await readRepoBaseline(bucket, projectId, repoId);
  if (prior.state === 'unreadable') {
    reportCaughtError(new Error(`repo baseline unreadable (${prior.reason}); import leaves it as is`), {
      source: SOURCE, operation: 'recordImportBaseline', level: 'warning', context: { projectId, repoId },
    });
    return false;
  }
  return writeRepoBaseline(bucket, projectId, repoId, [...(prior.state === 'ok' ? prior.paths : []), ...importedPaths]);
}

/**
 * The repo paths a push may delete: those the baseline held that the workspace no longer
 * has. No readable baseline → nothing (a push never deletes what it cannot prove was imported).
 */
export function pathsGoneFromWorkspace(baseline: RepoBaseline, workspacePaths: ReadonlySet<string>): string[] {
  if (baseline.state !== 'ok') return [];
  return [...baseline.paths].filter((path) => !workspacePaths.has(path));
}
