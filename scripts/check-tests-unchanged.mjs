/**
 * check:tests-unchanged — PRD 35 §5.1, report mode.
 *
 * §5.1 forbids editing a test to fit new code: the only allowed change to a test file
 * on a `feat/agent-run-ws*` branch is an import line that moved from a deleted module
 * to its replacement, plus the `vi.mock` path that follows it. Everything else —
 * changed inputs, changed fixtures, changed expected values, a deleted test, a new
 * `.skip`/`.only`/`.todo`, a loosened matcher — invalidates the oracle and fails the
 * workstream.
 *
 * This guard diffs every test file the current branch touches against `main` and
 * reports which lines changed and whether each hunk is an import-only change.
 *
 * REPORT MODE (WS1): it prints a per-file report. WS7 flips it to enforced mode —
 * failing on any non-import hunk and any new skip marker. Until then the program
 * works against this baseline.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The base branch the feature branches cut from. */
const BASE = process.env.AGENT_RUN_BASE ?? 'main';

/** True when a changed line is an allowed import-related edit (an `import`/`export ... from`,
 *  a `vi.mock`/`vi.doMock` path argument, or the closing of a multi-line import). */
function isImportLine(line) {
  const t = line.trim();
  return (
    /\bimport\b/.test(t) ||
    /\bfrom\s+['"][^'"]+['"]/.test(t) ||
    /\bexport\b[^'"]*\bfrom\s+['"][^'"]+['"]/.test(t) ||
    /\bvi\.(do)?mock\s*\(/.test(t) ||
    /^[)\]}]+\s*;?\s*$/.test(t) || // the closing paren/brace of a multi-line import or mock
    /^from\s+['"][^'"]+['"]/.test(t) // the `from` tail of a multi-line import
  );
}

/** True when `file` exists on BASE — §5.1 governs edits to pre-existing tests; a brand-new
 *  test file (e.g. a new package's suite) is not an edit of the oracle. */
function existsOnBase(file) {
  try {
    execFileSync('git', ['cat-file', '-e', `${BASE}:${file}`], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Every pre-existing test file this branch changed relative to BASE. */
function changedTestFiles() {
  const out = execFileSync('git', ['diff', '--name-only', `${BASE}...HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(s))
    .filter(existsOnBase);
}

/** The diff hunks of one file, split into added (`+`) and removed (`-`) content lines. */
function fileDiff(file) {
  const out = execFileSync('git', ['diff', `${BASE}...HEAD`, '--', file], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const added = [];
  const removed = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

console.log(`check:tests-unchanged (report mode, base=${BASE})`);

const files = changedTestFiles();
if (files.length === 0) {
  console.log('  No test files changed on this branch relative to ' + BASE + '.');
  console.log('  Enforced in WS7 — this guard is report-only until the program reaches delete/close.');
  process.exit(0);
}

let anyNonImport = false;
for (const file of files) {
  const { added, removed } = fileDiff(file);
  const importOnly =
    added.every(isImportLine) &&
    removed.every(isImportLine) &&
    // A pure import move adds and removes the same number of lines; a deleted test
    // removes far more than it adds, which must not read as "import-only".
    added.length > 0 &&
    removed.length > 0;
  const newSkip = added.some((l) => /\.(skip|only|todo)\b/.test(l) || /\bit\.fails\b/.test(l));
  const flag = importOnly && !newSkip ? 'import-only' : 'REVIEW';
  if (!importOnly || newSkip) anyNonImport = true;
  console.log(`  ${file}: ${flag} (+${added.length}/-${removed.length}${newSkip ? ', new skip marker' : ''})`);
}

console.log('  §5.1: only import / vi.mock path changes are allowed in a test file.');
console.log('  Enforced in WS7 — this guard is report-only until the program reaches delete/close.');
process.exit(0);
