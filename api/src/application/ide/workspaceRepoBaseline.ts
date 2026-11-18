/**
 * The repo BASELINE of a project's workspace: the repo paths the workspace holds a real
 * copy of — what an import wrote, and what the last push left in the repo. A push deletes
 * a repo file only when the baseline held it and the workspace has since lost it.
 *
 * Without it, "delete every base-tree path the workspace lacks" deletes what was never
 * imported: a file read only in part (skipped so its fragment is never pushed back), the
 * files past an import cap, a file that failed to read. The baseline makes those
 * not-imported files invisible to the push instead of deleted by it.
 *
 * Stored as one small JSON object NEXT TO the workspace — a sibling key, not under the
 * workspace prefix — so it never lists, opens or pushes as a workspace file.
 */
import { IDE_PREFIX } from '../project/projectTemplate';

/** The bucket operations the baseline needs (an R2 bucket satisfies it). */
export interface BaselineBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
}

/** `ide/repo-baselines/12.json` — beside the `ide/projects/12/` workspace, never inside it. */
export function baselineKey(projectId: number): string {
  return `${IDE_PREFIX}repo-baselines/${projectId}.json`;
}

/** The baseline paths, or null when none was ever recorded (a workspace from before baselines). */
export async function readRepoBaseline(bucket: BaselineBucket, projectId: number): Promise<Set<string> | null> {
  const object = await bucket.get(baselineKey(projectId)).catch(() => null);
  if (!object) return null;
  try {
    const parsed: unknown = JSON.parse(await object.text());
    const paths = (parsed as { paths?: unknown })?.paths;
    return Array.isArray(paths) ? new Set(paths.filter((p): p is string => typeof p === 'string')) : null;
  } catch {
    return null;
  }
}

export async function writeRepoBaseline(bucket: BaselineBucket, projectId: number, paths: Iterable<string>): Promise<void> {
  await bucket.put(baselineKey(projectId), JSON.stringify({ paths: [...new Set(paths)].sort() }));
}

/** After an import: the baseline gains the paths it wrote (a re-import adds to what earlier ones wrote). */
export async function recordImportBaseline(bucket: BaselineBucket, projectId: number, importedPaths: Iterable<string>): Promise<void> {
  const prior = (await readRepoBaseline(bucket, projectId)) ?? new Set<string>();
  await writeRepoBaseline(bucket, projectId, [...prior, ...importedPaths]);
}

/**
 * The repo paths a push deletes: those the baseline held that the workspace no longer
 * has. No baseline → nothing (a push never deletes what it cannot prove was imported).
 */
export function pathsGoneFromWorkspace(baseline: ReadonlySet<string> | null, workspacePaths: ReadonlySet<string>): string[] {
  if (!baseline) return [];
  return [...baseline].filter((path) => !workspacePaths.has(path));
}
