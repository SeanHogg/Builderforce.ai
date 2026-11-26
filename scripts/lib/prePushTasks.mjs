/**
 * Turns one area-table row (prePushAreas.mjs) and the changed files into the tasks the executor runs.
 * One generic path for every area: the row's data decides which tasks exist. Nothing here can block a push by itself:
 * install problems and unusable configuration come back as `warnings`, and an area with a missing or stale install has its
 * tasks marked `soft` (a failure there is a warning, not a block).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installIssues } from './prePushInstall.mjs';
import { scriptSteps } from './prePushExec.mjs';
import { withIncremental } from './prePushIncremental.mjs';
import { nearbyTests } from './prePushNearby.mjs';
import { groupByOwner, relatedInputs } from './prePushRelated.mjs';
import { SOURCE_RE, TEST_RE, chunkByChars, relativeTo } from './prePushUtil.mjs';

const TEST_TIMEOUT_S = 150;
/** Quiet output: a dot per test instead of a line per file. The pool is NOT forced: switching forks to threads changes test semantics. */
const VITEST_FLAGS = ['--reporter=dot'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Vitest invocations for a set of files, chunked so no command line passes ~6,000 characters. */
function vitestSteps(runner, args, verb, files) {
  return chunkByChars(files).map((chunk) => [...runner, verb, ...chunk, ...(verb === 'related' ? ['--run', '--passWithNoTests'] : []), ...VITEST_FLAGS, ...(args ?? [])]);
}

/** @returns {{ tasks: object[], warnings: string[], uncovered: string[], incomplete: boolean }} incomplete: not a full verification. */
export function tasksFor(root, area, files, { testsOn, optIns }) {
  const warnings = [];
  let soft = false;
  for (const dir of area.needsInstall ?? [area.dir]) {
    const { missing, stale } = installIssues(root, dir);
    if (missing || stale) { warnings.push(missing ?? stale); soft = true; }
  }
  let incomplete = soft;
  const make = (kind, label, steps, extra = {}) => ({ name: `${area.id}: ${label}`, dir: area.dir, kind, steps, timeout: kind === 'test' ? (area.testTimeout ?? TEST_TIMEOUT_S) : area.timeout, soft, ...extra });
  const tasks = [];
  if (area.guards) tasks.push(make('guards', 'guards', [area.guards]));
  if (area.typecheck) {
    const { script, steps = [], before = [], advisory } = area.typecheck;
    try {
      const scripted = script ? scriptSteps(root, area.dir, script) : { steps, fallback: false };
      if (scripted.fallback) warnings.push(`${area.id}: script "${script}" needs a shell; ran it as pnpm run ${script}`);
      const wrapped = [...before, ...scripted.steps].map((step) => withIncremental(root, area, step));
      tasks.push(make('typecheck', advisory ? 'typecheck (advisory: CI does not run it)' : 'typecheck', wrapped.map((w) => w.argv), { advisory, buildInfos: wrapped.map((w) => w.buildInfo).filter(Boolean) }));
    } catch (error) {
      warnings.push(`${area.id}: typecheck not run (${error.message})`);
      incomplete = true;
    }
  }

  const { inputs, uncovered } = relatedInputs(root, area, files);
  const testEnv = { NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192' };
  if (testsOn && inputs.length) {
    if (area.related === 'nearby') {
      const { tests, notes } = nearbyTests(root, area, inputs);
      warnings.push(...notes);
      if (notes.length) incomplete = true;
      if (!tests.length) warnings.push(`${area.id}: no test file imports the ${plural(inputs.length, 'changed file')} within two hops`);
      for (const [owner, rels] of groupByOwner(root, area, tests)) {
        const runner = area.vitest ?? (existsSync(join(root, owner, 'node_modules', '.bin', 'vitest')) ? ['vitest'] : null);
        if (!runner) { warnings.push(`${area.id}: ${plural(rels.length, 'test file')} under ${owner} not run (no vitest installed there)`); incomplete = true; continue; }
        const label = `vitest nearby (${plural(rels.length, 'test file')}${owner === area.dir ? '' : ` in ${owner}`})`;
        tasks.push(make('test', label, vitestSteps(runner, area.vitestArgs, 'run', rels), { dir: owner, env: testEnv }));
      }
    } else {
      const rel = inputs.map((abs) => relativeTo(root, area.dir, abs));
      tasks.push(make('test', `vitest related (${plural(rel.length, 'file')})`, vitestSteps(area.vitest ?? ['vitest'], area.vitestArgs, 'related', rel), { env: testEnv }));
    }
  }

  const ownSource = files.filter((f) => f.startsWith(`${area.dir}/`)).map((f) => f.slice(area.dir.length + 1)).filter((f) => SOURCE_RE.test(f) && !TEST_RE.test(f));
  for (const extra of area.extras ?? []) {
    // `optIn` extras (lint, perf gate) run only when asked for: `--tests` never turns them on. `when` narrows them to relevant changes.
    if (extra.optIn ? !optIns.has(extra.optIn) : !testsOn) continue;
    if (extra.when && !ownSource.some((f) => extra.when.test(f))) continue;
    tasks.push(make(extra.optIn === 'lint' ? 'extra' : 'test', extra.name, [extra.cmd]));
  }
  return { tasks, warnings, uncovered, incomplete };
}
