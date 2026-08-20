/**
 * Detects the ONE cause of this suite's long-standing "a different file fails each run"
 * flake: the working tree being EDITED while the tests read it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The flake was recorded as unbisectable ("not reproducible on demand — the failing file
 * is different each time, so there is no single case to bisect"). It reproduces reliably
 * once you know the trigger. Measured 2026-08-19:
 *
 *   • With another agent session editing this checkout, `npm run check` — 24 pure-reader
 *     guards, NO test framework, NO worker pool, NO module globals — failed a DIFFERENT
 *     guard on each of three consecutive runs. That rules out the pool-contention and
 *     module-global theories the entry had been pursuing, because none of those things
 *     exist in that suite.
 *   • In a pristine `git worktree` of the same commit, four guard runs produced the
 *     IDENTICAL result and the full vitest suite ran 6,830/6,830 green.
 *
 * Many tests here read SOURCE off disk (`orderByNullPlacement` scans the schema modules,
 * the manager tests build fixtures from source). A file rewritten mid-run is read
 * half-written by whichever test happens to reach it first — which is exactly why the
 * casualty moves every time and why the same assertion passes seconds later.
 *
 * CI was never affected: it always runs on a clean checkout.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────────
 * Snapshots `git status --porcelain` before and after the run. A difference means the
 * tree moved underneath the tests, so any failure above is suspect.
 *
 * It deliberately NEVER fails the run. A false alarm that blocked a legitimate red build
 * would be worse than the flake it explains, and the honest signal here is "do not trust
 * this result", not "this result is wrong". Silent when the tree is stable, and a no-op
 * outside a git checkout.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function treeState(): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['status', '--porcelain'], {
      cwd: process.cwd(),
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    // Not a git checkout, or git is unavailable — nothing to compare against.
    return null;
  }
}

/** Porcelain lines are `XY <path>`; we only care about the path set. */
function paths(porcelain: string): Set<string> {
  return new Set(
    porcelain
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter(Boolean),
  );
}

/**
 * The baseline is taken in `vitest.config.ts` (the first module evaluated) and handed
 * over in an env var. Taking it here instead would be too late to be meaningful — see
 * the note on `BF_TREE_BEFORE` in that file.
 */
export async function setup(): Promise<void> {
  // Nothing to do: the snapshot already happened at config load.
}

export async function teardown(): Promise<void> {
  const before = process.env.BF_TREE_BEFORE;
  if (before == null) return;
  const after = await treeState();
  if (after == null || after === before) return;

  const seen = paths(before);
  const changed = [...paths(after)].filter((path) => !seen.has(path));
  const listed = changed.slice(0, 12).map((path) => `     ${path}`);
  if (changed.length > 12) listed.push(`     …and ${changed.length - 12} more`);
  const detail = listed.length
    ? listed.join('\n')
    : '     (files changed content without changing the tracked set)';

  process.stderr.write(
    [
      '',
      '  ⚠️  THE WORKING TREE CHANGED WHILE THESE TESTS RAN.',
      '',
      '  Treat any failure above as UNTRUSTWORTHY — this is the known cause of the',
      '  "a different file fails every run" flake. Tests here read source off disk, so a',
      '  file rewritten mid-run is read half-written by whichever test reaches it first.',
      '  That is why the casualty moves and why the same assertion passes on a re-run.',
      '',
      '  Paths that changed during the run:',
      detail,
      '',
      '  Re-run in an isolated checkout before believing the result:',
      '      git worktree add ../verify-run HEAD && cd ../verify-run/api && npx vitest run',
      '',
      '',
    ].join('\n'),
  );
}
