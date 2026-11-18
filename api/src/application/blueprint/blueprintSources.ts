/**
 * W2: Blueprint sources — WHICH files detection reads, and reading them from a repo.
 *
 * The file list is DERIVED from the detector registry: every detector declares its
 * `reads`, so the set of paths fetched is exactly the set some detector will look at.
 * A new detector needs no second edit here, and a hand-kept list cannot drift from
 * what the detectors expect (the copies this replaced had already missed several
 * `reads` entries, so those detectors never saw their files).
 *
 * Every read is a provider subrequest spent inside a webhook `waitUntil`, so detection
 * makes ONE tree listing and at most `MAX_SOURCE_READS` reads, in this order:
 * 1. the exact `reads` paths the tree holds (all of them when the tree is unknown);
 * 2. glob matches (`*.csproj`), filtered from the one tree in memory — leaving
 *    `FOLLOW_READ_RESERVE` reads for:
 * 3. the files the read ones NAME (`followReads`: the projects a `.sln` lists), sanitised
 *    to repo paths, never a path already tried, in the order they are named.
 * A cut at any step is logged. Paths are matched to the tree case-insensitively and read
 * by the tree's own spelling, keyed by the spelling detection asked for.
 *
 * Reading goes through the provider-agnostic `readRepoContents` primitives — the same
 * ones the cloud agent's `read_file`/`list_files` use — so GitHub, GitLab and Bitbucket
 * all work, content is decoded UTF-8-safely, and nothing here touches a filesystem
 * (the API is a Worker; there is none).
 */

import { listRepoTree, readRepoFile, type RepoReadContext } from '../repos/readRepoContents';
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

/** Every read of one detection, all passes together (plus the one tree listing). */
export const MAX_SOURCE_READS = 160;

/** Reads glob matches may not take, so the files a solution names still fit. */
export const FOLLOW_READ_RESERVE = 32;

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
  listRepoTree: typeof listRepoTree;
}

/** The directory part of a repo path (`''` at the root). */
function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function matchesGlob(glob: BlueprintDirGlob, path: string): boolean {
  const dir = dirOf(path);
  const dirMatches = glob.dir.includes('*') ? pathGlobRegExp(glob.dir).test(dir) : dir === glob.dir;
  return dirMatches && glob.test(path.slice(dir ? dir.length + 1 : 0));
}

/** One read: the key detection asks for, and the path the provider is asked for (the tree's spelling). */
interface SourceRead {
  key: string;
  path: string;
}

/** The repo tree as detection sees it: what it holds (case-insensitively), when that is known. */
interface RepoTree {
  /** Tree paths (all of them, or what a truncated listing returned). */
  paths: readonly string[];
  /** lower-case path → the tree's spelling; null when the listing failed or was truncated (absence unknown). */
  spelling: Map<string, string> | null;
}

/** The read for `key`: the tree's spelling when listed; null when the full tree shows it is absent. */
function readFor(tree: RepoTree, key: string, partial: Map<string, string>): SourceRead | null {
  const spelled = (tree.spelling ?? partial).get(key.toLowerCase());
  if (spelled !== undefined) return { key, path: spelled };
  return tree.spelling ? null : { key, path: key };
}

/** Take at most `room` of `reads`, logging what is cut. */
function within(reads: SourceRead[], room: number, what: string): SourceRead[] {
  const kept = reads.slice(0, Math.max(0, room));
  if (kept.length < reads.length) console.warn(`[blueprint] ${reads.length} ${what}; reading ${kept.length} (read budget ${MAX_SOURCE_READS})`);
  return kept;
}

/** Read each `reads` entry into `files` under its key; a miss or a failed read is skipped. */
async function readInto(ctx: RepoReadContext, io: BlueprintSourceIo, reads: readonly SourceRead[], files: Map<string, string>): Promise<void> {
  const results = await mapWithConcurrency([...reads], READ_CONCURRENCY, (read) => io.readRepoFile(ctx, read.path));
  results.forEach((result, i) => {
    const read = reads[i];
    if (result.ok && read !== undefined) files.set(read.key, result.content);
  });
}

/**
 * Read every source file detection needs from the repo at `ctx.ref`, keyed by repo
 * path. Missing files and failed reads are skipped — absence is information to the
 * detectors, not an error. Never throws for a miss (the primitives never throw).
 */
export async function readBlueprintSources(
  ctx: RepoReadContext,
  io: BlueprintSourceIo = { readRepoFile, listRepoTree },
): Promise<Map<string, string>> {
  const { exact, dirGlobs } = blueprintSourcePaths();
  const listing = await io.listRepoTree(ctx);
  const paths = listing.ok ? listing.paths : [];
  const byLowerCase = new Map(paths.map((p) => [p.toLowerCase(), p] as const));
  const tree: RepoTree = { paths, spelling: listing.ok && !listing.truncated ? byLowerCase : null };

  const tried = new Set<string>();
  const take = (reads: Array<SourceRead | null>): SourceRead[] => {
    const fresh = reads.filter((r): r is SourceRead => r !== null && !tried.has(r.key.toLowerCase()));
    return [...new Map(fresh.map((r) => [r.key.toLowerCase(), r])).values()];
  };
  const mark = (reads: SourceRead[]) => reads.forEach((r) => tried.add(r.key.toLowerCase()));

  const exactReads = within(take(exact.map((p) => readFor(tree, p, byLowerCase))), MAX_SOURCE_READS, 'exact source paths');
  mark(exactReads);
  const globReads = within(
    // In `reads` order (a detector lists what matters most first: solutions before projects), then tree order.
    take(dirGlobs.flatMap((g) => paths.filter((p) => matchesGlob(g, p))).map((p) => ({ key: p, path: p }))),
    MAX_SOURCE_READS - FOLLOW_READ_RESERVE - exactReads.length,
    'files match the source globs',
  );
  mark(globReads);
  const files = new Map<string, string>();
  await readInto(ctx, io, [...exactReads, ...globReads], files);

  // What the read files name: only safe repo paths, never one already tried, only what the tree holds (when known).
  const named = DETECTORS.flatMap((d) => d.followReads?.(files) ?? [])
    .map((raw) => {
      const key = repoRelativePath(raw);
      return key === null ? null : readFor(tree, key, byLowerCase);
    });
  // A named file already read under another spelling (`WEB/Web.csproj` vs the tree's `web/Web.csproj`) is aliased, not re-read.
  const readKeys = new Map([...files.keys()].map((key) => [key.toLowerCase(), key] as const));
  for (const read of named) {
    const known = read && !files.has(read.key) ? readKeys.get(read.key.toLowerCase()) : undefined;
    if (read && known !== undefined) files.set(read.key, files.get(known)!);
  }
  const followReads = within(take(named), MAX_SOURCE_READS - exactReads.length - globReads.length, 'files are named by the read ones');
  if (followReads.length > 0) await readInto(ctx, io, followReads, files);
  return files;
}
