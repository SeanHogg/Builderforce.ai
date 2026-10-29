/**
 * check:tests-unchanged — PRD 35 §5.1, report mode.
 *
 * §5.1 forbids editing a test to fit new code: the only allowed change to a test file is
 * an import that moved from a deleted module to its replacement, plus the `vi.mock` path
 * that follows it. Everything else — changed inputs, changed fixtures, changed expected
 * values, a deleted test, a new `.skip`/`.only`/`.todo`/`it.fails`, a loosened matcher —
 * invalidates the oracle.
 *
 * Two kinds of test file are checked:
 *
 *   1. EDITED — a test that exists on BASE and differs in the working tree (committed on
 *      this branch or not). Its body is compared with BASE's after both have their import
 *      statements and `vi.mock` paths normalised away; any other difference is reported.
 *   2. BROUGHT ALONG — a test under `packages/agent-run/test/` that names its source test
 *      (a backticked `*.test.ts` path in its header, e.g. "brought along from
 *      `api/.../compactMessages.test.ts`"). §5.1 says such a file runs its source's cases
 *      UNCHANGED, so its body is compared with the source's the same way, and the number
 *      of `it(` / `test(` cases must not drop.
 *
 * REPORT MODE (WS1): it prints a per-file verdict and exits 0. WS7 flips it to enforced
 * mode; pass `--enforce` to preview that verdict (exit 1 on any REVIEW). A repository
 * where BASE cannot be read (a shallow clone, no `main`) reports that and exits 0 — a
 * report-mode guard never fails a build on its own plumbing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { collectSourceFiles, toPosix } from './lib/moduleImports.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AGENT_RUN_BASE ?? 'main';
const ENFORCE = process.argv.includes('--enforce');
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const BROUGHT_ALONG_DIR = 'packages/agent-run/test';

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/** The file's content on BASE, or null when it is not there. */
function onBase(file) {
  try {
    return git(['show', `${BASE}:${file}`]);
  } catch {
    return null;
  }
}

/**
 * A test file's body with everything §5.1 lets change normalised away: comments, import /
 * re-export statements (single- or multi-line), `vi.mock` / `vi.doMock` path arguments,
 * quote style and blank lines. What is left is the oracle — inputs, fixtures, expectations.
 */
function oracleLines(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*import\s+[\s\S]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*import\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/\bvi\.(do)?mock\(\s*['"][^'"]+['"]/g, 'vi.$1mock(<path>')
    .replace(/'/g, '"')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** How many test cases a file declares (`it(`, `test(`, and their `.each` forms). */
function caseCount(text) {
  return (text.match(/^\s*(?:it|test)(?:\.each\([\s\S]*?\))?\s*\(/gm) ?? []).length;
}

/** Skip / only / todo / it.fails markers. */
function skipMarkers(text) {
  return (text.match(/\b(?:it|test|describe)\.(?:skip|only|todo|fails)\b/g) ?? []).length;
}

/** Lines in `after` that are not in `before` (and vice versa), as a multiset difference. */
function lineDiff(before, after) {
  const count = new Map();
  for (const line of before) count.set(line, (count.get(line) ?? 0) + 1);
  const added = [];
  for (const line of after) {
    const n = count.get(line) ?? 0;
    if (n > 0) count.set(line, n - 1);
    else added.push(line);
  }
  const removed = [...count.entries()].flatMap(([line, n]) => Array(n).fill(line));
  return { added, removed };
}

/** Compare one test against its oracle; returns the verdict line and whether it needs review. */
function verdict(label, oracleText, currentText) {
  const { added, removed } = lineDiff(oracleLines(oracleText), oracleLines(currentText));
  const before = caseCount(oracleText);
  const after = caseCount(currentText);
  const newSkips = Math.max(0, skipMarkers(currentText) - skipMarkers(oracleText));
  const problems = [];
  // Added lines alone are new cases or new fixtures — allowed. A REMOVED oracle line is an
  // input, a fixture or an expectation that no longer runs as written.
  if (removed.length > 0) problems.push(`${removed.length} oracle line(s) changed/removed (${added.length} added)`);
  if (after < before) problems.push(`cases ${before} → ${after}`);
  if (newSkips > 0) problems.push(`${newSkips} new skip marker(s)`);
  const review = problems.length > 0;
  console.log(`  ${label}: ${review ? `REVIEW (${problems.join('; ')})` : 'import-only'}`);
  if (review) for (const line of removed.slice(0, 3)) console.log(`      - ${line.slice(0, 140)}`);
  return review;
}

/** Pre-existing test files that differ from BASE — committed on this branch or still in the tree. */
function editedTests() {
  const changed = new Set();
  for (const range of [[`${BASE}...HEAD`], []]) {
    for (const file of git(['diff', '--name-only', '--diff-filter=MR', ...range]).split('\n')) {
      const f = file.trim();
      if (f && TEST_FILE.test(f)) changed.add(f);
    }
  }
  return [...changed].filter((f) => existsSync(resolve(repoRoot, f)) && onBase(f) !== null).sort();
}

/** Tests the branch DELETED that exist on BASE — a deleted oracle is never import-only. */
function deletedTests() {
  return git(['diff', '--name-only', '--diff-filter=D', `${BASE}...HEAD`])
    .split('\n')
    .concat(git(['diff', '--name-only', '--diff-filter=D']).split('\n'))
    .map((f) => f.trim())
    .filter((f) => f && TEST_FILE.test(f));
}

/** agent-run tests that name the source test they were brought along from. */
function broughtAlong() {
  const pairs = [];
  for (const file of collectSourceFiles(resolve(repoRoot, BROUGHT_ALONG_DIR))) {
    if (!TEST_FILE.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const header = text.slice(0, 1500);
    const sources = [...header.matchAll(/`([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)`/g)]
      .map(([, path]) => path)
      .filter((path) => !path.startsWith('packages/agent-run/') && existsSync(resolve(repoRoot, path)));
    if (sources.length === 1) pairs.push({ file: toPosix(file).replace(toPosix(repoRoot) + '/', ''), source: sources[0], text });
  }
  return pairs;
}

console.log(`check:tests-unchanged (${ENFORCE ? 'enforce preview' : 'report mode'}, base=${BASE})`);

let review = 0;
try {
  git(['rev-parse', '--verify', BASE]);
} catch {
  console.log(`  Base '${BASE}' is not readable here (shallow clone?) — nothing compared.`);
  process.exit(0);
}

let edited = [];
let deleted = [];
try {
  edited = editedTests();
  deleted = deletedTests();
} catch {
  // No merge base with BASE (a shallow clone): the edited-file half cannot be read here.
  console.log(`  No merge base with '${BASE}' — edited-test comparison skipped.`);
}
if (edited.length === 0 && deleted.length === 0) console.log(`  No pre-existing test file differs from ${BASE}.`);
for (const file of edited) {
  if (verdict(file, onBase(file) ?? '', readFileSync(resolve(repoRoot, file), 'utf8'))) review += 1;
}
for (const file of deleted) {
  console.log(`  ${file}: REVIEW (deleted)`);
  review += 1;
}

const pairs = broughtAlong();
if (pairs.length > 0) console.log(`  Brought-along tests in ${BROUGHT_ALONG_DIR}, against the source they name:`);
for (const { file, source, text } of pairs) {
  if (verdict(`${file} ← ${source}`, readFileSync(resolve(repoRoot, source), 'utf8'), text)) review += 1;
}

console.log('  §5.1: only import / vi.mock path changes are allowed in a test file.');
if (ENFORCE && review > 0) {
  console.log(`  ✗ ${review} test file(s) need review.`);
  process.exit(1);
}
if (!ENFORCE) console.log(`  Report only (${review} to review) — WS7 enforces.`);
process.exit(0);
