#!/usr/bin/env node
/**
 * PostToolUse hook — run the fast frontend ratchets after a write under `frontend/src`.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * The frontend ratchets were caught by CI and nowhere else, and CI is the worst
 * place to learn: the change is already pushed, the deploy is already red, and
 * the person who has to read the failure is usually not the person who wrote the
 * line. Three deploys in a row failed this way on four seconds of local work —
 * an empty catch, a raw `localStorage`, a literal hex, an off-scale radius.
 *
 * The rules themselves were never missing. They were written down as advice, and
 * advice is something you can be holding and still not apply. A guard that RUNS
 * is the difference: this hook makes the ratchets a property of editing a file
 * rather than something to remember about editing a file.
 *
 * ── WHY IT DOES NOT BLOCK THE EDIT ────────────────────────────────────────────
 * The set costs about 4.5 seconds, dominated by the silent-catch sweep. Paid on
 * every write that would be a tax on editing, and a tax on editing is a reason
 * to turn the hook off. It is declared `asyncRewake` instead: the write returns
 * immediately, the guards run behind it, and a REGRESSION wakes the session with
 * the failure. Nothing is paid when nothing is wrong, and the report still
 * arrives while the change is in hand rather than after a push.
 *
 * ── CONTRACT ──────────────────────────────────────────────────────────────────
 * Reads the hook payload on stdin, exits 0 and silent unless a ratchet moved.
 * Exit 2 is the blocking-feedback code: stderr goes back to the model. A file
 * outside `frontend/src`, an unreadable payload, or a runner that cannot start
 * all exit 0 — a hook that fails open is a hook that stays installed, and every
 * one of these guards still runs in `npm test` and in CI.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontendDir = resolve(repoRoot, 'frontend');
/** Only a source file can move these ratchets — they scan `src`. */
const WATCHED = resolve(frontendDir, 'src') + sep;

function readStdin() {
  try {
    // fd 0 straight through: the payload is small and already complete by the
    // time a PostToolUse hook runs, so there is nothing to stream.
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Windows hands the same file two spellings. The drive letter's case is not
 * stable — this session has been told its own working directory as both
 * `c:\code\...` and `C:\code\...` — so a plain `startsWith` against a path this
 * file derived from its own location silently never matches, and the hook
 * reports success on every edit while checking nothing. Case-fold the
 * comparison where the filesystem is case-insensitive; compare exactly where it
 * is not.
 */
function withinWatched(candidate) {
  const [path, prefix] = process.platform === 'win32' || process.platform === 'darwin'
    ? [candidate.toLowerCase(), WATCHED.toLowerCase()]
    : [candidate, WATCHED];
  return path.startsWith(prefix);
}

const payload = readStdin();
const filePath = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
if (typeof filePath !== 'string' || !withinWatched(resolve(filePath))) process.exit(0);

const result = spawnSync(
  process.execPath,
  [resolve(repoRoot, 'scripts', 'run-checks.mjs'), 'scripts/edit-ratchets.manifest.mjs'],
  { cwd: frontendDir, encoding: 'utf8' },
);

// The runner could not start at all (missing node_modules on a fresh checkout,
// a manifest mid-edit). That is not a ratchet regression and must not read like
// one — say nothing and let `npm test` be the gate.
if (result.error || result.status === null) process.exit(0);
if (result.status === 0) process.exit(0);

const report = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
process.stderr.write(
  'A frontend ratchet regressed on the file just written.\n\n'
  + `${report}\n\n`
  + 'Fix it now, in this file, rather than leaving it for CI: these are the guards\n'
  + 'that fail the deploy. Re-run with `cd frontend && node ../scripts/run-checks.mjs\n'
  + 'scripts/edit-ratchets.manifest.mjs`.\n',
);
process.exit(2);
