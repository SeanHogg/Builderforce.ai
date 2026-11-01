/**
 * check:tests-unchanged — PRD 35 §5.1, ENFORCED.
 *
 * §5.1 forbids editing a test to fit new code: the only allowed change to a test file is an import that moved from a deleted module
 * to its replacement, plus the `vi.mock` path that follows it. Everything else (a changed input, fixture or expected value, a
 * deleted test, a new `.skip`/`.only`/`.todo`/`it.fails`, a loosened matcher, a lower case count) invalidates the oracle unless the
 * planning model approved it. Each approval is an entry in `tests-unchanged.approved.mjs` (file, what changed, why, who approved).
 *
 * The work is on main, so there is no branch to diff. Three things are checked:
 *
 *   1. EDITED: a pre-existing test file changed by a PROGRAM commit in `BASE..HEAD` (subject names PRD 35 / a WS / agent-run) or by an
 *      uncommitted edit. BASE defaults to `origin/main` (what has not been pushed), or `HEAD` where that is not readable. The body is
 *      compared with BASE's after imports and `vi.mock` paths are normalised away. A deleted test is always a failure.
 *   2. BROUGHT ALONG: a test under `packages/agent-run/test/` that names its source test in its header (a backticked `*.test.ts` path)
 *      is compared with that source AS IT WAS BEFORE THE PROGRAM (`PROGRAM_BASE`), not as it stands now, so a source that was later
 *      trimmed cannot hide a dropped case. Its case count may not fall.
 *   3. SKIP MARKERS: no test file in the repository may hold more `.skip`/`.only`/`.todo`/`it.fails` markers than the baseline.
 *
 * A file that differs is a failure unless it is import-only or approved (an approval may name how many cases the file may lose).
 * Exit 1 on any failure. A repository where BASE cannot be read (a shallow clone) reports that and passes: a guard never fails a
 * build on its own plumbing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { collectSourceFiles, toPosix } from './lib/moduleImports.mjs';
import { APPROVED, PENDING, PROGRAM_BASE } from './tests-unchanged.approved.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const BROUGHT_ALONG_DIR = 'packages/agent-run/test';
/** A commit that belongs to this program: it names PRD 35, a workstream or the agent. */
const PROGRAM_COMMIT = /PRD 35|\bWS\d|agent-run|one agent/i;
/** Skip markers the repository holds today (all outside this program's tests). It may only fall. */
const SKIP_MARKER_BASELINE = 21;

const approvedByFile = new Map(APPROVED.map((entry) => [entry.file, entry]));
const pendingByFile = new Map(PENDING.map((entry) => [entry.file, entry]));
let pendingCount = 0;

/** A difference nobody has approved yet but the planning model has been asked about: shown, not failed. */
function pending(label, file) {
  const entry = pendingByFile.get(file);
  if (!entry) return false;
  pendingCount += 1;
  console.log(`  PENDING ${label}: ${entry.changed}`);
  return true;
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
}

function readable(ref) {
  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

const BASE = process.env.AGENT_RUN_BASE ?? (readable('origin/main') ? 'origin/main' : 'HEAD');

/** The file's content at `ref`, or null when it was not there. */
function at(ref, file) {
  try {
    return git(['show', `${ref}:${file}`]);
  } catch {
    return null;
  }
}

/** A test file's body with everything §5.1 lets change normalised away: comments, imports, `vi.mock` paths, quote style, blank lines. */
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

let failures = 0;
let approvedCount = 0;

/** Compare one test with its oracle and print the verdict. A difference is a failure unless the file is approved within its allowance. */
function verdict(label, file, oracleText, currentText) {
  const { added, removed } = lineDiff(oracleLines(oracleText), oracleLines(currentText));
  const before = caseCount(oracleText);
  const after = caseCount(currentText);
  const newSkips = Math.max(0, skipMarkers(currentText) - skipMarkers(oracleText));
  const approval = approvedByFile.get(file);
  const allowedDrop = approval?.cases ?? 0;
  const problems = [];
  if (removed.length > 0 && !approval) problems.push(`${removed.length} oracle line(s) changed/removed (${added.length} added)`);
  if (after < before - allowedDrop) problems.push(`cases ${before} -> ${after}${allowedDrop ? ` (approved drop is ${allowedDrop})` : ''}`);
  if (newSkips > 0) problems.push(`${newSkips} new skip marker(s)`);
  if (problems.length > 0 && pending(label, file)) return;
  if (problems.length > 0) {
    failures += 1;
    console.log(`  FAIL ${label}: ${problems.join('; ')}`);
    for (const line of removed.slice(0, 3)) console.log(`      - ${line.slice(0, 140)}`);
  } else if (approval && (removed.length > 0 || after < before)) {
    approvedCount += 1;
    console.log(`  approved ${label} (${approval.approvedBy}): ${approval.reason}`);
  } else {
    console.log(`  ok ${label}: import-only`);
  }
}

console.log(`check:tests-unchanged (enforced, base=${BASE}, program base=${PROGRAM_BASE})`);

const baseReadable = readable(BASE);
const programBaseReadable = readable(PROGRAM_BASE);
if (!baseReadable) console.log(`  Base '${BASE}' is not readable here (shallow clone?) - edited-test comparison skipped.`);
if (!programBaseReadable) console.log(`  Program base '${PROGRAM_BASE}' is not readable here (shallow clone?) - brought-along comparison skipped.`);

// 1. EDITED ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function changedTests(filter, range) {
  const out = new Set();
  const names = git(['diff', '--name-only', `--diff-filter=${filter}`, ...range]).split('\n');
  for (const name of names) if (name.trim() && TEST_FILE.test(name.trim())) out.add(name.trim());
  return out;
}

/** Test files touched (not added) by program commits in BASE..HEAD, plus uncommitted ones. */
function programEdited() {
  const files = new Set();
  const subjects = git(['log', '--format=%H%x09%s', `${BASE}..HEAD`]).split('\n').filter(Boolean);
  for (const line of subjects) {
    const [hash, ...rest] = line.split('\t');
    if (!PROGRAM_COMMIT.test(rest.join('\t'))) continue;
    for (const name of git(['show', '--name-only', '--diff-filter=MRD', '--format=', hash]).split('\n')) {
      if (name.trim() && TEST_FILE.test(name.trim())) files.add(name.trim());
    }
  }
  for (const name of changedTests('MRD', [])) files.add(name);
  return files;
}

if (baseReadable) {
  let edited = [];
  try {
    edited = [...programEdited()].sort();
  } catch {
    console.log(`  No merge base with '${BASE}' - edited-test comparison skipped.`);
  }
  let compared = 0;
  for (const file of edited) {
    const original = at(BASE, file);
    if (original === null) continue; // added since BASE: a new test is not an edit of an oracle
    compared += 1;
    if (!existsSync(resolve(repoRoot, file))) {
      if (pending(file, file)) continue;
      failures += 1;
      console.log(`  FAIL ${file}: deleted`);
      continue;
    }
    verdict(file, file, original, readFileSync(resolve(repoRoot, file), 'utf8'));
  }
  if (compared === 0) console.log(`  No pre-existing test file was changed by a program commit since ${BASE}.`);
}

// 2. BROUGHT ALONG ───────────────────────────────────────────────────────────────────────────────────────────────────
if (programBaseReadable) {
  const pairs = [];
  for (const file of collectSourceFiles(resolve(repoRoot, BROUGHT_ALONG_DIR))) {
    if (!TEST_FILE.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const header = text.slice(0, 1500);
    const rel = toPosix(file).replace(toPosix(repoRoot) + '/', '');
    // The source as it was before the program: it may be deleted or trimmed today.
    const sources = [...header.matchAll(/`([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)`/g)]
      .map(([, path]) => path)
      .filter((path) => !path.startsWith('packages/agent-run/') && at(PROGRAM_BASE, path) !== null);
    if (sources.length === 1) pairs.push({ file: rel, source: sources[0], text });
  }
  if (pairs.length > 0) console.log(`  Brought-along tests in ${BROUGHT_ALONG_DIR}, against the source as it was before the program:`);
  for (const { file, source, text } of pairs) verdict(`${file} <- ${source}`, file, at(PROGRAM_BASE, source), text);
}

// 3. SKIP MARKERS ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  let markers = 0;
  const holders = [];
  for (const file of git(['ls-files', '*.test.ts', '*.test.tsx', '*.test.mjs', '*.spec.ts']).split('\n')) {
    const name = file.trim();
    if (!name || !existsSync(resolve(repoRoot, name))) continue;
    const n = skipMarkers(readFileSync(resolve(repoRoot, name), 'utf8'));
    if (n > 0) {
      markers += n;
      holders.push(`${name} (${n})`);
    }
  }
  if (markers > SKIP_MARKER_BASELINE) {
    failures += 1;
    console.log(`  FAIL skip markers: ${markers} in the repository, baseline ${SKIP_MARKER_BASELINE}`);
    for (const holder of holders.slice(0, 8)) console.log(`      ${holder}`);
  } else {
    console.log(`  ok skip markers: ${markers} (baseline ${SKIP_MARKER_BASELINE})`);
  }
}

console.log(`  §5.1: only import / vi.mock path changes, or an approved entry in scripts/tests-unchanged.approved.mjs (${approvedCount} approved change(s) matched, ${pendingCount} PENDING a decision).`);
if (failures > 0) {
  console.log(`  FAIL ${failures} problem(s).`);
  process.exit(1);
}
console.log('  PASS');
process.exit(0);
