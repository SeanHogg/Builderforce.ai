/**
 * Finding a program on PATH without being hijacked.
 *
 * NO HIJACK. A program is never launched by a bare name: `which` resolves it from `process.env.PATH` ONLY — skipping
 * `.`, every relative entry and every folder inside a repository the run delta measures ({@link excludeFromPathSearch})
 * — to an absolute file (on Windows a `.exe`/`.com`; a `.cmd` would need a shell). A name carrying a path separator is
 * refused outright.
 */

import { statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Repository roots whose folders are never searched for a program (the run could have written one there). */
const excludedRoots = new Set<string>();
const norm = (p: string): string => {
  const n = path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
};

/** A repository the delta measures: no PATH entry inside it is ever used to find a program. */
export function excludeFromPathSearch(root: string): void {
  excludedRoots.add(norm(root));
}

const inside = (dir: string, root: string): boolean => dir === root || dir.startsWith(`${root}/`);

/** The PATH folders a program may come from: absolute, not `.`, not inside an excluded repository. */
export function searchPath(env: NodeJS.ProcessEnv = process.env, excluded: Iterable<string> = excludedRoots): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  const roots = [...excluded];
  return raw.split(path.delimiter).filter((d) => d && d !== "." && path.isAbsolute(d)).filter((d) => !roots.some((r) => inside(norm(d), r)));
}

async function isFile(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isFile(), () => false);
}

function isFileSync(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The file names `program` may have on this platform; empty when the name is refused (empty, or has a separator). */
function candidateNames(program: string): string[] {
  if (!program || /[\\/]/.test(program)) return [];
  return process.platform === "win32" ? [`${program}.exe`, `${program}.com`] : [program];
}

/** The absolute path of `program` on the search path; undefined when absent. A name with a separator is refused. */
export async function whichOnPath(program: string, dirs: readonly string[] = searchPath()): Promise<string | undefined> {
  const names = candidateNames(program);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * A memoized {@link whichOnPathSync}: keyed on the program plus the current search folders (`dirsOf()` does no IO
 * and already reflects the excluded repository roots, so a later {@link excludeFromPathSearch} changes the key).
 * A hit is kept until {@link CachedWhich.invalidate}; a miss for {@link MISSED_LOOKUP_TTL_MS} only — long enough that
 * a missing program does not re-stat all of PATH (possibly UNC shares) on every launch, short enough that a program
 * installed later is found.
 */
export function createCachedWhich(
  dirsOf: () => readonly string[] = () => searchPath(),
  find: (program: string, dirs: readonly string[]) => string | undefined = whichOnPathSync,
  now: () => number = Date.now,
): CachedWhich {
  const hits = new Map<string, string>();
  const missedUntil = new Map<string, number>();
  const prefixOf = (program: string): string => `${program}\0`;
  const lookup = (program: string): string | undefined => {
    const dirs = dirsOf();
    const key = `${prefixOf(program)}${dirs.join(path.delimiter)}`;
    const hit = hits.get(key);
    if (hit !== undefined) return hit;
    const until = missedUntil.get(key);
    if (until !== undefined && now() < until) return undefined;
    const found = find(program, dirs);
    if (found === undefined) missedUntil.set(key, now() + MISSED_LOOKUP_TTL_MS);
    else {
      missedUntil.delete(key);
      hits.set(key, found);
    }
    return found;
  };
  const invalidate = (program: string): void => {
    for (const map of [hits, missedUntil]) {
      for (const key of [...map.keys()]) if (key.startsWith(prefixOf(program))) map.delete(key);
    }
  };
  return Object.assign(lookup, { invalidate });
}

/** How long a lookup that found nothing is remembered. */
export const MISSED_LOOKUP_TTL_MS = 60_000;

/** A memoized lookup whose remembered answers for one program can be dropped (e.g. the found file vanished). */
export type CachedWhich = ((program: string) => string | undefined) & { invalidate(program: string): void };

/** The process-wide {@link createCachedWhich}. */
export const whichOnPathCached = createCachedWhich();

/** {@link whichOnPath}, synchronously — same rules. */
export function whichOnPathSync(program: string, dirs: readonly string[] = searchPath()): string | undefined {
  const names = candidateNames(program);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFileSync(candidate)) return candidate;
    }
  }
  return undefined;
}
