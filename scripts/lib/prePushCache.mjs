/**
 * Remembers what already passed, so re-pushing (or amending only a message) costs nothing.
 *
 * Only a FULL verification is stamped (the caller decides: no timeout, missing tool, stale install, crash or truncation).
 * The key hashes: the checked commit's TREE (message and parents do not matter), the merge base the areas were chosen
 * from, the CONTENT of every dirty tracked and untracked file (the checks read the working tree), the run's shape (areas,
 * tests, lint, perf), and the check's own source (a changed check re-verifies). Cost: ONE `git rev-parse`; the rest is
 * file reads, so a cache hit stays near a second. Stamps live in `.git/bf-prepush-pass` (resolved with `--git-path`, so
 * linked worktrees work), one key per line, newest last.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git } from './git.mjs';

const KEEP = 20;
const MAX_HASHED_BYTES = 4 * 1024 * 1024;

const contentOf = (file) => {
  try {
    const { size, mtimeMs } = statSync(file);
    return size > MAX_HASHED_BYTES ? `big:${size}:${mtimeMs}` : readFileSync(file);
  } catch { return 'gone'; }
};

/** The check's own source: a change to it must not be answered by an older pass. */
function toolingFiles(root) {
  const lib = join(root, 'scripts', 'lib');
  return [join(root, 'scripts', 'pre-push-check.mjs'), ...readdirSync(lib).filter((f) => f.startsWith('prePush')).sort().map((f) => join(lib, f))];
}

/** Where the durations live; `--git-path` keeps linked worktrees right. */
export const timesFileFor = (root) => resolve(root, git(['rev-parse', '--git-path', 'bf-prepush-times.json'], { cwd: root, trim: true }));

/** Task name -> milliseconds of its last completed run (`.git/bf-prepush-times.json`): orders typechecks smallest first. */
export function loadTimes(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

/** Merge new durations into the file; best effort. */
export function saveTimes(file, durations) {
  try { writeFileSync(file, JSON.stringify({ ...loadTimes(file), ...durations })); } catch { /* ordering is only a hint */ }
}

/**
 * @param {{ shape: object, mergeBase: string, state: { tracked: string[], untracked: string[] } }} input
 * @returns {{ key: string, has: () => boolean, record: () => void }}
 */
export function prepareCache(root, { shape, mergeBase, state }) {
  const [tree, stampPath] = git(['rev-parse', 'HEAD^{tree}', '--git-path', 'bf-prepush-pass'], { cwd: root, trim: true }).split('\n');
  const hash = createHash('sha1').update(`${tree}\n${mergeBase}\n${JSON.stringify(shape)}\n`);
  for (const file of toolingFiles(root)) hash.update(contentOf(file));
  for (const file of [...state.tracked, ...state.untracked].sort()) hash.update(`\n${file}\n`).update(contentOf(join(root, file)));
  const key = hash.digest('hex');
  const stamp = resolve(root, stampPath);
  return {
    key,
    has: () => { try { return existsSync(stamp) && readFileSync(stamp, 'utf8').split('\n').includes(key); } catch { return false; } },
    /** Best effort: a stamp that cannot be written costs only a re-run. */
    record: () => {
      try {
        const keys = existsSync(stamp) ? readFileSync(stamp, 'utf8').split('\n').filter(Boolean) : [];
        mkdirSync(dirname(stamp), { recursive: true });
        writeFileSync(stamp, `${[...keys.filter((k) => k !== key), key].slice(-KEEP).join('\n')}\n`);
      } catch { /* see above */ }
    },
  };
}
