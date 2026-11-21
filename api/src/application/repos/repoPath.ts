/**
 * THE repo-relative path normalizer. Every caller that compares or joins paths inside a
 * repository uses this one, so `./src\a.ts`, `src//a.ts` and `src/x/../a.ts` all mean the
 * same file everywhere.
 *
 * Backslashes become `/`, empty and `.` segments drop (which also strips a leading `./`
 * or `/` and collapses repeated slashes), and `..` pops the previous segment. A path that
 * climbs above the root keeps its leading `..` segments rather than pretending to be
 * inside the repo. PURE.
 */
export function normalizeRepoPath(path: string): string {
  const out: string[] = [];
  for (const part of path.trim().replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
