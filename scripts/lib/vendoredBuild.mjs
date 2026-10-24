/**
 * What every VENDORED engine build shares (PRD 34 §4: `packages/bfi-web`, the wasm, and
 * `packages/bfi-node`, the native addon): bytes copied from the sibling
 * `builderforce-inference` checkout must trace to a commit, so each vendor script hashes
 * what it copied, records the commit (and whether ANY input of the build was dirty), and
 * stamps every build it runs so a `--no-build` re-vendor can prove what it copies.
 *
 * Extracted from `vendor-bfi-web.mjs` when the second vendored build arrived; each
 * script keeps only what is its own (which files, which build command, which inputs).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Written into each build output: what the bytes were built from. */
export const BUILD_STAMP = '.bfi-build-stamp.json';

/** Binary outputs, hashed byte for byte; everything else is text. */
const BINARY = /\.(wasm|node)$/;

/**
 * sha256 of a file, with CRLF folded to LF for the text files — the builds emit LF, and a
 * Windows checkout under `core.autocrlf` must not read as drift (each vendored package's
 * `.gitattributes` already pins the bytes; this is the belt to that brace).
 */
export function hashFile(file) {
  const bytes = readFileSync(file);
  const content = BINARY.test(file) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

/** Problems with the files `names` in `dir` against `expected` (name → sha256). */
export function diffAgainst(dir, expected, names) {
  const problems = [];
  for (const name of names) {
    const file = join(dir, ...name.split('/'));
    if (!existsSync(file)) {
      problems.push(`${name}: missing`);
      continue;
    }
    if (!expected[name]) {
      problems.push(`${name}: not recorded in SOURCE.json`);
      continue;
    }
    const actual = hashFile(file);
    if (actual !== expected[name]) problems.push(`${name}: sha256 ${actual.slice(0, 12)}… ≠ recorded ${expected[name].slice(0, 12)}…`);
  }
  return problems;
}

/** The sibling inference checkout: git queries against it. */
export function sourceRepository(sourceRepo) {
  const git = (args) => {
    const run = spawnSync('git', ['-C', sourceRepo, ...args], { encoding: 'utf8' });
    return run.status === 0 ? run.stdout.trim() : '';
  };
  return {
    git,
    /** HEAD, and whether any of `inputs` (paths in the checkout) differs from it. */
    state: (inputs) => ({ commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', ...inputs]) !== '' }),
  };
}

/** Record in `dir` what its build was made from. */
export function writeBuildStamp(dir, state) {
  writeFileSync(join(dir, BUILD_STAMP), `${JSON.stringify({ commit: state.commit || 'unknown', dirty: state.dirty }, null, 2)}\n`);
}

/** `--no-build`: refuse unless the tree is clean and `dir` was built from HEAD by a vendor script. */
export function requireStampedBuild(dir, state, { sourceRepo, fail }) {
  if (!state.commit) fail(`cannot read HEAD of ${sourceRepo} — --no-build needs a git checkout to record.`);
  if (state.dirty) fail('--no-build refuses to record HEAD: the inference tree has uncommitted changes to the build inputs — commit them, or rebuild without --no-build.');
  const stampFile = join(dir, BUILD_STAMP);
  if (!existsSync(stampFile)) fail(`--no-build: ${relative(sourceRepo, dir)} has no ${BUILD_STAMP} — it was not built by a vendor script; rebuild without --no-build.`);
  const stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
  if (stamp.dirty !== false || stamp.commit !== state.commit) {
    fail(
      `--no-build: ${relative(sourceRepo, dir)} was built from ${String(stamp.commit).slice(0, 7)}${stamp.dirty === false ? '' : ' (dirty)'}, not the clean HEAD ${state.commit.slice(0, 7)} — rebuild without --no-build.`,
    );
  }
}
