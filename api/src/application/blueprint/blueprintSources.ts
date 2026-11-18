/**
 * W2: Blueprint sources — WHICH files detection reads, and reading them from a repo.
 *
 * The file list is DERIVED from the detector registry: every detector declares its
 * `reads`, so the set of paths fetched is exactly the set some detector will look at.
 * A new detector needs no second edit here, and a hand-kept list cannot drift from
 * what the detectors expect (the copies this replaced had already missed several
 * `reads` entries, so those detectors never saw their files).
 *
 * Reading goes through the provider-agnostic `readRepoContents` primitives — the same
 * ones the cloud agent's `read_file`/`list_files` use — so GitHub, GitLab and Bitbucket
 * all work, content is decoded UTF-8-safely, and nothing here touches a filesystem
 * (the API is a Worker; there is none).
 */

import { listRepoFiles, readRepoFile, type RepoReadContext } from '../repos/readRepoContents';
import { mapWithConcurrency } from '../runtime/boundedPool';
import { DETECTORS } from './detectors';

/** A `reads` entry with a wildcard: list `dir`, keep its direct children whose name passes `test`. */
export interface BlueprintDirGlob {
  dir: string;
  test: (name: string) => boolean;
}

export interface BlueprintSourcePaths {
  exact: string[];
  dirGlobs: BlueprintDirGlob[];
}

/** Parallel reads per detection — enough to be quick, few enough to be a polite API client. */
const READ_CONCURRENCY = 6;

/** At most this many files per glob: a repo of many projects (`*` folders of `.csproj`) must not cost a read each. */
export const MAX_FILES_PER_GLOB = 40;

function escapeRegExp(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** `.github/workflows/*.yml` → `{ dir: '.github/workflows', test: /^[^/]*\.yml$/ }`. */
function toDirGlob(entry: string): BlueprintDirGlob {
  const slash = entry.lastIndexOf('/');
  const dir = slash === -1 ? '' : entry.slice(0, slash);
  const pattern = new RegExp(`^${entry.slice(slash + 1).split('*').map(escapeRegExp).join('[^/]*')}$`);
  return { dir, test: (name) => pattern.test(name) };
}

/** Every path the registered detectors read, de-duplicated, split into exact paths and dir-globs. */
export function blueprintSourcePaths(): BlueprintSourcePaths {
  const entries = [...new Set(DETECTORS.flatMap((d) => d.reads))];
  return {
    exact: entries.filter((e) => !e.includes('*')),
    dirGlobs: entries.filter((e) => e.includes('*')).map(toDirGlob),
  };
}

export interface BlueprintSourceIo {
  readRepoFile: typeof readRepoFile;
  listRepoFiles: typeof listRepoFiles;
}

/** The directory part of a repo path (`''` at the root). */
function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

// A glob's dir may hold wildcards (`api/*/*.csproj`): a whole-segment `*` is one folder name.
function dirMatches(globDir: string, dir: string): boolean {
  if (!globDir.includes('*')) return dir === globDir;
  const segments = globDir.split('/').map((segment) => (segment === '*' ? '[^/]+' : segment.split('*').map(escapeRegExp).join('[^/]*')));
  return new RegExp(`^${segments.join('/')}$`).test(dir);
}

/** The folder to list for a glob when there is no whole-tree listing: its dir up to the first wildcard segment. */
function listingDirOf(globDir: string): string {
  const star = globDir.indexOf('*');
  return star === -1 ? globDir : dirOf(globDir.slice(0, star));
}

function matchesGlob(glob: BlueprintDirGlob, path: string): boolean {
  const dir = dirOf(path);
  return dirMatches(glob.dir, dir) && glob.test(path.slice(dir ? dir.length + 1 : 0));
}

/** The paths a glob matches, at most `MAX_FILES_PER_GLOB` (in listing order). */
function globMatches(glob: BlueprintDirGlob, paths: readonly string[]): string[] {
  return paths.filter((p) => matchesGlob(glob, p)).slice(0, MAX_FILES_PER_GLOB);
}

/**
 * Which source paths to read. Normally ONE recursive tree listing, intersected with
 * the wanted paths, so only files that exist are fetched. When the listing fails
 * (a provider without it) or is truncated (a big monorepo past the listing cap,
 * which could hide a root file), fall back to every exact path plus one listing per
 * distinct glob folder (up to its first wildcard) — slower, but never blind.
 */
async function sourcePathsToRead(ctx: RepoReadContext, io: BlueprintSourceIo): Promise<string[]> {
  const { exact, dirGlobs } = blueprintSourcePaths();
  const tree = await io.listRepoFiles(ctx);
  if (tree.ok && !tree.truncated) {
    const present = new Set(tree.paths);
    return [
      ...exact.filter((p) => present.has(p)),
      ...dirGlobs.flatMap((g) => globMatches(g, tree.paths)),
    ];
  }
  // One listing per distinct folder, shared by every glob under it; the root's is the tree listing above.
  const listings = new Map<string, Promise<string[]>>([['', Promise.resolve(tree.ok ? tree.paths : [])]]);
  const listingOf = (dir: string): Promise<string[]> => {
    let listing = listings.get(dir);
    if (!listing) {
      listing = io.listRepoFiles(ctx, dir).then((listed) => (listed.ok ? listed.paths : []));
      listings.set(dir, listing);
    }
    return listing;
  };
  const globbed: string[] = [];
  for (const glob of dirGlobs) globbed.push(...globMatches(glob, await listingOf(listingDirOf(glob.dir))));
  return [...new Set([...exact, ...globbed])];
}

/**
 * Read every source file detection needs from the repo at `ctx.ref`, keyed by repo
 * path. Only files the tree listing shows are read, because each read is a provider
 * subrequest spent inside a webhook `waitUntil`. Missing files and failed reads are
 * skipped — absence is information to the detectors, not an error. Never throws for
 * a miss (the primitives never throw).
 */
export async function readBlueprintSources(
  ctx: RepoReadContext,
  io: BlueprintSourceIo = { readRepoFile, listRepoFiles },
): Promise<Map<string, string>> {
  const paths = [...new Set(await sourcePathsToRead(ctx, io))];
  const reads = await mapWithConcurrency(paths, READ_CONCURRENCY, (path) => io.readRepoFile(ctx, path));
  const files = new Map<string, string>();
  reads.forEach((read, i) => {
    const path = paths[i];
    if (read.ok && path !== undefined) files.set(path, read.content);
  });
  return files;
}
