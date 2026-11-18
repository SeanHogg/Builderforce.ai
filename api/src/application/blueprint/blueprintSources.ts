/**
 * W2: Blueprint sources — WHICH files detection reads, and reading them from a repo.
 *
 * The file list is DERIVED from the detector registry: every detector declares its
 * `reads`, so the set of paths fetched is exactly the set some detector will look at.
 * A new detector needs no second edit here, and a hand-kept list cannot drift from
 * what the detectors expect (the copies this replaced had already missed several
 * `reads` entries, so those detectors never saw their files).
 *
 * Two passes. The first reads every `reads` path; a glob is speculative, so it reads at
 * most `MAX_FILES_PER_GLOB` files. The second reads what the first pass's files NAME
 * (`followReads`: the projects a `.sln` lists) past that cap — sanitised to repo paths,
 * never a path already tried, at most `MAX_FOLLOW_READS` in the order they are named.
 *
 * Reading goes through the provider-agnostic `readRepoContents` primitives — the same
 * ones the cloud agent's `read_file`/`list_files` use — so GitHub, GitLab and Bitbucket
 * all work, content is decoded UTF-8-safely, and nothing here touches a filesystem
 * (the API is a Worker; there is none).
 */

import { listRepoFiles, readRepoFile, type RepoReadContext } from '../repos/readRepoContents';
import { mapWithConcurrency } from '../runtime/boundedPool';
import { DETECTORS } from './detectors';
import { pathGlobRegExp, repoRelativePath } from './pathGlob';

/** A `reads` entry with a wildcard: `dir` (itself a glob, `api/*`) and the name test of its files. */
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

/** At most this many second-pass reads, in the order they are named: one solution may name thousands of projects. */
export const MAX_FOLLOW_READS = 48;

/** `.github/workflows/*.yml` → `{ dir: '.github/workflows', test: (name) => /^[^/]*\.yml$/ }`. */
function toDirGlob(entry: string): BlueprintDirGlob {
  const slash = entry.lastIndexOf('/');
  const dir = slash === -1 ? '' : entry.slice(0, slash);
  const pattern = pathGlobRegExp(entry.slice(slash + 1));
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

/** The folder to list for a glob when there is no whole-tree listing: its dir up to the first wildcard segment. */
function listingDirOf(globDir: string): string {
  const star = globDir.indexOf('*');
  return star === -1 ? globDir : dirOf(globDir.slice(0, star));
}

function matchesGlob(glob: BlueprintDirGlob, path: string): boolean {
  const dir = dirOf(path);
  const dirMatches = glob.dir.includes('*') ? pathGlobRegExp(glob.dir).test(dir) : dir === glob.dir;
  return dirMatches && glob.test(path.slice(dir ? dir.length + 1 : 0));
}

/** The paths a glob matches, at most `MAX_FILES_PER_GLOB` (in listing order); a cut is logged. */
function globMatches(glob: BlueprintDirGlob, paths: readonly string[]): string[] {
  const matched = paths.filter((p) => matchesGlob(glob, p));
  if (matched.length > MAX_FILES_PER_GLOB) {
    console.warn(`[blueprint] glob ${glob.dir}/… matched ${matched.length} files; reading the first ${MAX_FILES_PER_GLOB}`);
  }
  return matched.slice(0, MAX_FILES_PER_GLOB);
}

interface FirstPass {
  paths: string[];
  /** The repo's paths when the whole tree was listed; null when it was not (reads then go blind). */
  present: Set<string> | null;
}

/**
 * Which source paths to read first. Normally ONE recursive tree listing, intersected with
 * the wanted paths, so only files that exist are fetched. When the listing fails
 * (a provider without it) or is truncated (a big monorepo past the listing cap,
 * which could hide a root file), fall back to every exact path plus one listing per
 * distinct glob folder (up to its first wildcard) — slower, but never blind.
 */
async function firstPass(ctx: RepoReadContext, io: BlueprintSourceIo): Promise<FirstPass> {
  const { exact, dirGlobs } = blueprintSourcePaths();
  const tree = await io.listRepoFiles(ctx);
  if (tree.ok && !tree.truncated) {
    const present = new Set(tree.paths);
    return { paths: [...exact.filter((p) => present.has(p)), ...dirGlobs.flatMap((g) => globMatches(g, tree.paths))], present };
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
  return { paths: [...exact, ...globbed], present: null };
}

/** Read `paths` into `files`; a miss or a failed read is skipped. */
async function readInto(ctx: RepoReadContext, io: BlueprintSourceIo, paths: readonly string[], files: Map<string, string>): Promise<void> {
  const reads = await mapWithConcurrency([...paths], READ_CONCURRENCY, (path) => io.readRepoFile(ctx, path));
  reads.forEach((read, i) => {
    const path = paths[i];
    if (read.ok && path !== undefined) files.set(path, read.content);
  });
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
  const first = await firstPass(ctx, io);
  const files = new Map<string, string>();
  const tried = [...new Set(first.paths)];
  await readInto(ctx, io, tried, files);
  // The files the first pass's files name (a solution's projects), in the order they are named:
  // only safe repo paths, never one already tried, only what the tree holds (when listed), at most MAX_FOLLOW_READS.
  const attempted = new Set(tried);
  const named = [...new Set(DETECTORS.flatMap((d) => d.followReads?.(files) ?? []).map(repoRelativePath))]
    .filter((path): path is string => path !== null && !attempted.has(path) && (first.present?.has(path) ?? true));
  if (named.length > MAX_FOLLOW_READS) {
    console.warn(`[blueprint] files name ${named.length} more files; reading the first ${MAX_FOLLOW_READS}`);
  }
  const follow = named.slice(0, MAX_FOLLOW_READS);
  if (follow.length > 0) await readInto(ctx, io, follow, files);
  return files;
}
