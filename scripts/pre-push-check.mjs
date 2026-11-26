#!/usr/bin/env node
/**
 * Fast local pre-push check: catches what would turn CI red, and never gets in the way of a push otherwise.
 *
 * Which areas a change touches is decided by `.github/scripts/affected-builds.mjs` (the function the Release workflow's
 * `plan` job calls). Each area is a data row in scripts/lib/prePushAreas.mjs; the runner has no per-area branches. Per
 * affected area it runs the guard suite and the typecheck, plus related tests when tests are on, then
 * `check-tests-unchanged.mjs` (in hook mode only when a test file changed). Modules under scripts/lib: prePushChanges (what
 * changed), prePushRelated + prePushNearby (which tests), prePushTasks (row to tasks), prePushInstall (stale installs),
 * prePushExec (running), prePushCache (pass stamps), prePushReport (the verdict).
 *
 * EXIT CODES. 0: nothing blocks (warnings allowed). 3: a real finding (a guard, a typecheck error, or a test failure with
 * tests on): the ONLY code the hook blocks on. 2: a usage error. Any other code (1, a Node crash, a broken import) means
 * the check itself broke; the hook lets the push through. Hook mode (BF_PREPUSH_HOOK=1, set by .githooks/pre-push): no
 * tests unless --tests / BF_PREPUSH_TESTS=1, a 90 s total budget (BF_PREPUSH_BUDGET_S) and a pass cache. Never prompts,
 * never reads the TTY. Testing the hook: BF_PREPUSH_BASE=<ref> picks the base without pushing.
 */
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { git } from './lib/git.mjs';
import { changedFiles, commitsAhead, parsePushedRefs, pushDecision, workingTreeState } from './lib/prePushChanges.mjs';
import { AREAS } from './lib/prePushAreas.mjs';
import { prepareCache } from './lib/prePushCache.mjs';
import { orphanRisk, runAll } from './lib/prePushExec.mjs';
import { touchesArea } from './lib/prePushRelated.mjs';
import { summarize } from './lib/prePushReport.mjs';
import { tasksFor } from './lib/prePushTasks.mjs';

const FINDING = 3;
const USAGE = `usage: node scripts/pre-push-check.mjs [--all] [--tests | --no-tests] [--lint] [--perf] [--base <ref>] [-h|--help]

  --all          ignore the affected filter: every area, as a CI full build does
  --tests        run the related tests (the default by hand; in the git hook also BF_PREPUSH_TESTS=1)
  --no-tests     skip the vitest runs
  --lint         also run frontend lint (\`next lint\`); slow, never part of --tests
  --perf         also run the knowledge-graph-view perf gate; slow, never part of --tests
  --base <ref>   comparison base (default: $BF_PREPUSH_BASE, else $AGENT_RUN_BASE, else origin/main)
  -h, --help     print this and exit

Exit 3 = a real finding (guard, typecheck or test failure); 2 = usage error; 0 = nothing blocks. Stale installs, missing
tools, timeouts and crashes are warnings. Hook mode skips tests and stops after BF_PREPUSH_BUDGET_S (default 90) seconds.
Skip once: git push --no-verify, or BF_SKIP_PREPUSH=1. Full logs of non-passing checks are written under the OS temp dir.`;

const startedAt = Date.now();
const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const isHook = process.env.BF_PREPUSH_HOOK === '1';
const flag = (name) => argv.includes(name);
const KNOWN = new Set(['--all', '--tests', '--no-tests', '--lint', '--perf', '--base', '-h', '--help']);
const baseAt = argv.indexOf('--base');
const badArg = argv.find((a, i) => (a.startsWith('-') ? !KNOWN.has(a) : argv[i - 1] !== '--base'));
const TEST_FILE = /\.(?:test|spec)\.|(?:^|\/)(?:test|tests|__tests__|parity)\/|oracle\.files\.txt|tests-unchanged|\.snap$/;

// Whatever breaks inside the check is the check's problem, never a reason to stop a push.
const tooling = (error) => { console.log(`pre-push-check: WARN the check itself failed (${String(error?.message ?? error).split('\n')[0]}); not verified locally, CI will check.`); process.exit(isHook ? 0 : 2); };
process.on('uncaughtException', tooling);
process.on('unhandledRejection', tooling);

/** Git's pushed-ref lines, or '' when there are none within 2 s (a missing stdin must not stall the push). */
async function readPushedRefs() {
  if (process.stdin.isTTY) return '';
  let text = '';
  const read = (async () => { for await (const chunk of process.stdin) text += chunk; })();
  await Promise.race([read, new Promise((r) => setTimeout(r, 2000).unref())]);
  process.stdin.destroy();
  return text;
}

async function main() {
  if (flag('-h') || flag('--help')) { console.log(USAGE); return 0; }
  if (badArg || (baseAt >= 0 && (!argv[baseAt + 1] || argv[baseAt + 1].startsWith('-')))) {
    console.error(`pre-push-check: ${badArg ? `unexpected argument "${badArg}"` : '--base needs a ref'}\n\n${USAGE}`);
    return 2;
  }
  if (process.env.BF_SKIP_PREPUSH === '1') { console.log('pre-push-check: skipped (BF_SKIP_PREPUSH=1)'); return 0; }

  const budgetS = Number(process.env.BF_PREPUSH_BUDGET_S) || (isHook ? 90 : 0);
  const budgetEnd = budgetS ? startedAt + budgetS * 1000 : Infinity;
  const warnings = [];
  if (isHook) {
    const decision = pushDecision(parsePushedRefs(await readPushedRefs()), git(['rev-parse', 'HEAD'], { cwd: root, trim: true }));
    if (decision.skip) { console.log(`pre-push-check: skipped, ${decision.skip}`); return 0; }
    warnings.push(...decision.warnings);
  }

  const baseRef = baseAt >= 0 ? argv[baseAt + 1] : (process.env.BF_PREPUSH_BASE || process.env.AGENT_RUN_BASE || 'origin/main');
  const testsOn = !flag('--no-tests') && (flag('--tests') || process.env.BF_PREPUSH_TESTS === '1' || !isHook);
  const optIns = new Set([flag('--lint') && 'lint', flag('--perf') && 'perf'].filter(Boolean));
  let files = [];
  let mergeBase = 'unknown';
  let full = flag('--all');
  try {
    ({ files, mergeBase } = changedFiles(root, baseRef, { includeWorkingTree: !isHook }));
  } catch (error) {
    if (isHook) { console.log(`pre-push-check: WARN ${error.message}; check skipped (git trouble never blocks a push)`); return 0; }
    console.warn(`pre-push-check: ${error.message}; running every area against it as given.`);
    full = true;
  }

  const { affectedBuilds } = await import(pathToFileURL(join(root, '.github/scripts/affected-builds.mjs')).href);
  const plan = affectedBuilds(files, full);
  const active = AREAS.filter((a) => (full || (a.flag ? plan[a.flag] : true)) && (full || touchesArea(root, a, files)));
  const areas = active.map((a) => a.id);
  const state = workingTreeState(root);
  // The areas come from the pushed range; the checks read the working tree, so a dirty tracked file in them skews the result.
  const dirtyHere = state.tracked.filter((f) => active.some((a) => f.startsWith(`${a.dir}/`)) || /^(?:packages|scripts)\//.test(f));
  if (isHook && dirtyHere.length) warnings.push(`${dirtyHere.length} uncommitted tracked file(s) in the checked areas; results reflect the working tree, not the pushed commit`);

  let cache;
  try {
    cache = prepareCache(root, { shape: { areas, testsOn, optIns: [...optIns], full }, mergeBase, state });
    if (isHook && cache.has()) { console.log(`pre-push-check: already checked (${areas.join(', ') || 'no areas'}); nothing changed since it passed.`); return 0; }
  } catch { cache = undefined; /* no stamp: the checks simply run */ }

  const tasks = [];
  if (!isHook || [...files, ...state.tracked].some((f) => TEST_FILE.test(f))) {
    tasks.push({ name: 'tests-unchanged', dir: '.', kind: 'base', steps: [['node', 'scripts/check-tests-unchanged.mjs']], env: { AGENT_RUN_BASE: baseRef } });
  }
  let complete = true;
  for (const area of active) {
    try {
      const built = tasksFor(root, area, files, { testsOn, optIns });
      tasks.push(...built.tasks);
      warnings.push(...built.warnings);
      complete &&= !built.incomplete;
      if (built.uncovered.length) warnings.push(`${area.id}: ${built.uncovered.length} changed file(s) not covered by tests (deleted or config)`);
    } catch (error) {
      warnings.push(`${area.id}: not checked (${error.message})`);
      complete = false;
    }
  }

  if (Date.now() >= budgetEnd) { console.log(`pre-push-check: WARN setup used the whole ${budgetS}s budget; not verified locally, CI will check.`); return 0; }
  if (!isHook) {
    const rowFlags = new Set(AREAS.map((a) => a.flag));
    const unchecked = Object.entries(plan).filter(([k, v]) => !rowFlags.has(k) && (k === 'npm' ? v.include.length > 0 : v === true)).map(([k]) => k);
    console.log(`pre-push-check: base ${baseRef} (${commitsAhead(root, baseRef)} commit(s) ahead), ${files.length} changed file(s), tests ${testsOn ? 'on' : 'off'}, lint ${optIns.has('lint') ? 'on' : 'off (--lint)'}, perf ${optIns.has('perf') ? 'on' : 'off (--perf)'}`);
    if (unchecked.length) console.log(`  not checked locally: ${unchecked.join(', ')}`);
  }

  const results = await runAll(root, tasks, Math.max(1, availableParallelism() - 1), { budgetEnd, verbose: !isHook });
  if (orphanRisk()) warnings.push('a timed-out process could not be killed (taskkill failed); check Task Manager for stray node processes');
  const { lines, failed } = summarize({ results, warnings, areas, seconds: (Date.now() - startedAt) / 1000 });
  console.log(lines.join('\n'));
  // Stamp only a full verification: any timeout, missing tool, install problem, crash or truncation means "not proven".
  if (!failed && complete && !orphanRisk() && results.every((r) => r.status === 'pass' || r.advisoryOnly)) cache?.record();
  return failed ? FINDING : 0;
}

// Set the code and let output flush (a piped FAIL summary must not be cut off); a backstop ends a hung loop.
process.exitCode = await main();
setTimeout(() => process.exit(process.exitCode), 3000).unref();
