#!/usr/bin/env node
/**
 * Point this checkout's git at the repo's ONE hooks dir (`.githooks/`).
 *
 * Run by api's `prepare` script, so any `pnpm install` in api/ wires it. A relative
 * `core.hooksPath` resolves against the working-tree root, where `.githooks/` lives.
 *
 * A no-op in CI, outside a git checkout (Docker build contexts, tarball installs) and
 * when git is not on PATH. A hooksPath the developer pointed somewhere else on purpose
 * is left alone; only an unset one, or agent-runtime's retired `git-hooks`, is replaced.
 * NEVER fails the install: a git error is printed as a warning and the install goes on.
 */
const HOOKS_PATH = '.githooks';
const REPLACEABLE = new Set(['', 'git-hooks', HOOKS_PATH]);

// Loaded inside main's try: a context that copies only this file must not break `pnpm install` (see main).
let runGit;
const git = (args) => runGit(args, { trim: true });

function warn(what, error) {
  console.warn(`[install-git-hooks] warning: ${what} — ${error instanceof Error ? error.message.split('\n')[0] : String(error)}. Hooks not wired; the install continues.`);
}

async function main() {
  if (process.env.CI) return;
  try {
    ({ git: runGit } = await import('./lib/git.mjs'));
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') return;
  } catch {
    return; // not a git checkout, or no git binary: nothing to wire, nothing to warn about
  }
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath']);
  } catch (error) {
    // `git config --get` exits 1 when the key is unset — the expected case. Any other
    // exit is a real failure worth surfacing.
    if (error?.status !== 1) { warn('could not read core.hooksPath', error); return; }
    current = '';
  }
  if (!REPLACEABLE.has(current)) {
    console.log(`[install-git-hooks] core.hooksPath is "${current}" — left as set.`);
    return;
  }
  if (current === HOOKS_PATH) return;
  try {
    git(['config', 'core.hooksPath', HOOKS_PATH]);
  } catch (error) {
    warn('could not set core.hooksPath', error);
    return;
  }
  console.log(`[install-git-hooks] core.hooksPath → ${HOOKS_PATH}`);
  if (current === '') {
    console.log('[install-git-hooks] note: hooks in .git/hooks/* are no longer run; move any you rely on into .githooks/.');
  }
}

main().catch((error) => warn('unexpected error', error));
