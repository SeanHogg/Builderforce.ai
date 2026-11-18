/**
 * W2: Blueprint sources — WHICH files detection reads, and reading them from a repo.
 *
 * The file list is DERIVED from the detector registry: every detector declares its
 * `reads`, so the set of paths fetched is exactly the set some detector will look at.
 * A new detector needs no second edit here, and a hand-kept list cannot drift from
 * what the detectors expect (the copies this replaced had already missed several
 * `reads` entries, so those detectors never saw their files).
 *
 * Every provider call is a subrequest spent inside a webhook `waitUntil`, so detection
 * makes at most `MAX_PROVIDER_CALLS` of them — counted at the fetch every call goes
 * through (`ctx.fetch`: tree pages of GitLab/Bitbucket, reads, Bitbucket Server `/browse`
 * pages, at most `BLUEPRINT_BROWSE_PAGES` per file). ONE tree listing, then reads in this order:
 * 1. the exact `reads` paths the tree holds (all of them when the tree is unknown);
 * 2. glob matches (`*.csproj`), filtered from the one tree in memory — none when the
 *    listing FAILED, so a failed listing means no `.sln`/`.csproj`, hence no .NET detection — leaving
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
import { makeRepoFetch, type FetchLike } from '../repos/sources/RepoSource';
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

/** Every provider call of one detection: tree pages, reads and `/browse` pages, all passes together. */
export const MAX_PROVIDER_CALLS = 160;

/** Bitbucket Server `/browse` pages per file during detection (a manifest fits in one or two). */
export const BLUEPRINT_BROWSE_PAGES = 2;

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

/** The repo tree as detection sees it. */
interface RepoTree {
  /** Tree paths (all of them, or what a truncated listing returned). */
  paths: ReadonlySet<string>;
  /** lower-case path → the tree's spelling (the first, for case twins). */
  byLowerCase: ReadonlyMap<string, string>;
  /** Whether `paths` is the whole tree, so absence from it means absent (false: failed or truncated listing). */
  complete: boolean;
}

function repoTree(paths: readonly string[], complete: boolean): RepoTree {
  const byLowerCase = new Map<string, string>();
  for (const path of paths) if (!byLowerCase.has(path.toLowerCase())) byLowerCase.set(path.toLowerCase(), path);
  return { paths: new Set(paths), byLowerCase, complete };
}

/**
 * The read for `key`: the exact path when the tree has it (`Dockerfile` beside `dockerfile`),
 * else the tree's case-insensitive spelling; unlisted, read blind unless the tree is complete.
 */
function readFor(tree: RepoTree, key: string): SourceRead | null {
  if (tree.paths.has(key)) return { key, path: key };
  const spelled = tree.byLowerCase.get(key.toLowerCase());
  if (spelled !== undefined) return { key, path: spelled };
  return tree.complete ? null : { key, path: key };
}

/** Take at most `room` of `reads`, logging what is cut. */
function within(reads: SourceRead[], room: number, what: string): SourceRead[] {
  const kept = reads.slice(0, Math.max(0, room));
  if (kept.length < reads.length) console.warn(`[blueprint] ${reads.length} ${what}; reading ${kept.length} (provider call budget ${MAX_PROVIDER_CALLS})`);
  return kept;
}

/**
 * A fetch that lets at most `limit` calls through; past that it answers 429 without a
 * call, so a read or a page beyond the budget is a miss — never a subrequest.
 */
function providerCallBudget(base: FetchLike, limit: number): { fetch: FetchLike; used: () => number } {
  let used = 0;
  return {
    fetch: (input, init) => {
      if (used >= limit) return Promise.resolve(new Response(null, { status: 429, statusText: 'blueprint call budget spent' }));
      used += 1;
      return base(input, init);
    },
    used: () => used,
  };
}

/** Whether a cut-off read of `path` is still usable: its file name matches a detector's `prefixSafe` glob. */
function isPrefixSafe(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return DETECTORS.some((d) => d.prefixSafe?.some((glob) => pathGlobRegExp(glob).test(name)));
}

/**
 * Read each `reads` entry into `files` under its key; a miss or a failed read is skipped.
 * A TRUNCATED read (too large, or a paged read the provider stopped) is decided per file
 * kind, as detector data (`prefixSafe`): a line-oriented file (`.sln`, `schema.prisma`,
 * `Dockerfile`) keeps its first part; a whole-file format (`package.json`, `*.csproj`)
 * must not be taken for the whole file, so it is treated as unread — and logged.
 */
async function readInto(ctx: RepoReadContext, io: BlueprintSourceIo, reads: readonly SourceRead[], files: Map<string, string>): Promise<void> {
  const results = await mapWithConcurrency([...reads], READ_CONCURRENCY, (read) => io.readRepoFile(ctx, read.path));
  results.forEach((result, i) => {
    const read = reads[i];
    if (!result.ok || read === undefined) return;
    if (result.truncated && !isPrefixSafe(read.path)) {
      console.warn(`[blueprint] ${read.path} was read only in part (${result.truncatedReason ?? 'incomplete'}); detection skips it`);
      return;
    }
    files.set(read.key, result.content);
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
  // Every provider call — tree pages, reads, /browse pages — goes through one counted fetch.
  const budget = providerCallBudget(ctx.fetch ?? makeRepoFetch(), MAX_PROVIDER_CALLS);
  ctx = { ...ctx, fetch: budget.fetch, browsePageLimit: BLUEPRINT_BROWSE_PAGES };
  let issued = 0;
  /** Calls spent so far: the counted ones, or at least one per listing and read issued (an io that bypasses `ctx.fetch`). */
  const spent = () => Math.max(budget.used(), issued);
  const listing = await io.listRepoTree(ctx);
  issued += 1;
  const paths = listing.ok ? listing.paths : [];
  const tree = repoTree(paths, listing.ok && !listing.truncated);

  /** The provider paths already asked for: a later pass never asks again. */
  const askedFor = new Set<string>();
  /** Fresh reads, de-duplicated by the provider path (case twins in the tree are two files). */
  const take = (reads: Array<SourceRead | null>): SourceRead[] => {
    const fresh = reads.filter((r): r is SourceRead => r !== null && !askedFor.has(r.path));
    return [...new Map(fresh.map((r) => [r.path, r])).values()];
  };
  const mark = (reads: SourceRead[]) => reads.forEach((r) => askedFor.add(r.path));

  // Room is planned at one call per read; the counted fetch is the hard stop when a read costs more (/browse pages).
  const exactReads = within(take(exact.map((p) => readFor(tree, p))), MAX_PROVIDER_CALLS - spent(), 'exact source paths');
  mark(exactReads);
  const globReads = within(
    // In `reads` order (a detector lists what matters most first: solutions before projects), then tree order.
    take(dirGlobs.flatMap((g) => paths.filter((p) => matchesGlob(g, p))).map((p) => ({ key: p, path: p }))),
    MAX_PROVIDER_CALLS - FOLLOW_READ_RESERVE - spent() - exactReads.length,
    'files match the source globs',
  );
  mark(globReads);
  const files = new Map<string, string>();
  await readInto(ctx, io, [...exactReads, ...globReads], files);
  issued += exactReads.length + globReads.length;

  // What the read files name: only safe repo paths, never one already tried, only what the tree holds (when known).
  const named = DETECTORS.flatMap((d) => d.followReads?.(files) ?? [])
    .map((raw) => {
      const key = repoRelativePath(raw);
      return key === null ? null : readFor(tree, key);
    });
  const followReads = within(take(named), MAX_PROVIDER_CALLS - spent(), 'files are named by the read ones');
  if (followReads.length > 0) await readInto(ctx, io, followReads, files);

  // ALIASED KEYS: every named key gets the content of its provider path, whichever key read
  // it — a glob's `web/Web.csproj` for a solution's `WEB/Web.csproj`, or one follow read for
  // two solutions spelling the same project differently. So `files` may hold one file under
  // several keys, each the spelling some detector asked for. Nothing is read twice.
  const contentByPath = new Map(
    [...exactReads, ...globReads, ...followReads].filter((r) => files.has(r.key)).map((r) => [r.path, files.get(r.key)!] as const),
  );
  for (const read of named) {
    const known = read && !files.has(read.key) ? contentByPath.get(read.path) : undefined;
    if (read && known !== undefined) files.set(read.key, known);
  }
  return files;
}
