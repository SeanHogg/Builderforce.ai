/**
 * Runs the pre-push check's tasks: no shell (bar pnpm on Windows), a deadline per task, a bounded pool, full logs on disk.
 *
 * A task is `{ name, dir, kind, steps, env?, timeout?, advisory?, soft? }`: `steps` are argv arrays run in order in
 * `<root>/<dir>` (the first non-zero exit ends the task). Statuses: pass; fail (a finding: the ONLY blocking status); warn
 * (advisory or soft failure, missing tool, tooling error, crash); timeout (killed at the deadline: NOT VERIFIED, a warning).
 * `advisoryOnly` marks a warn that is just an advisory check failing: it does not stop a pass being recorded.
 * `kind: 'typecheck'` tasks are capped at `typecheckLimit` concurrent (a TypeScript program holds gigabytes). A task with
 * `background` set (hook mode) that has a tsc step is not killed at the budget: it is detached with its output going to its log
 * file, finishes on its own and leaves its tsbuildinfo, and is reported as `background` (never a pass, so never stamped).
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { isTsc } from './prePushIncremental.mjs';

const DEFAULT_TYPECHECK_LIMIT = 2;
const DEFAULT_TIMEOUT_S = 240;
const GRACE_MS = 1000;
/** After the total budget, how long a run may still take to stop its children and report. */
const HARD_STOP_MS = 2000;
const BIN_PACKAGE = { tsc: 'typescript' };
const GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX'];
const LOG_DIR = join(tmpdir(), 'bf-prepush', new Date().toISOString().replace(/[:.]/g, '-'));
const live = new Set();
let orphanSuspected = false;
const logPathFor = (task) => join(LOG_DIR, `${task.name.replace(/[^\w.-]+/g, '_')}.log`);

class ToolNotFound extends Error {}

/** True when `kill` could have left a process running (taskkill failed or hung). */
export const orphanRisk = () => orphanSuspected;

const pnpmOnPath = () => (process.env.PATH ?? process.env.Path ?? '').split(delimiter).some((d) => d && ['pnpm', 'pnpm.cmd', 'pnpm.exe'].some((n) => existsSync(join(d, n))));

/** The script a pnpm `.bin` shim runs (sh shims name it as "$basedir/<relative path>"; a posix symlink points at it). */
function shimTarget(binDir, name) {
  const shim = join(binDir, name);
  if (!existsSync(shim)) return undefined;
  const text = readFileSync(shim, 'utf8');
  if (!text.startsWith('#!')) return realpathSync(shim);
  return [...text.matchAll(/"\$basedir\/([^"]+)"/g)].map((m) => resolve(binDir, m[1])).find((p) => existsSync(p));
}

/**
 * Find a tool the way pnpm does: walk up from `<dir>` through node_modules dirs; in each prefer `.bin/<name>`, then the
 * package's `bin` map (an exact key, or the only entry: `@typescript/typescript6` ships just `tsc6`).
 */
function findBin(root, dir, name) {
  const pkg = BIN_PACKAGE[name] ?? name;
  let packageSeen = false;
  for (let d = resolve(root, dir); ; d = dirname(d)) {
    const nm = join(d, 'node_modules');
    const viaShim = shimTarget(join(nm, '.bin'), name);
    if (viaShim) return viaShim;
    const manifestFile = join(nm, pkg, 'package.json');
    if (existsSync(manifestFile)) {
      packageSeen = true;
      const { bin } = JSON.parse(readFileSync(manifestFile, 'utf8'));
      const entries = typeof bin === 'string' ? [[name, bin]] : Object.entries(bin ?? {});
      const entry = entries.find(([key]) => key === name) ?? (entries.length === 1 ? entries[0] : undefined);
      if (entry) return join(nm, pkg, entry[1]);
    }
    if (d === resolve(root) || dirname(d) === d) break;
  }
  throw new ToolNotFound(packageSeen ? `package "${pkg}" is installed but has no bin named "${name}"` : `package "${pkg}" was not found in ${dir}/node_modules or above`);
}

/** `node` is this node; `pnpm` runs as itself; any other name is a package bin run through node. */
function resolveArgv(root, dir, [name, ...args]) {
  if (name === 'node') return { file: process.execPath, args, shell: false };
  if (name === 'pnpm') {
    if (!pnpmOnPath()) throw new ToolNotFound('pnpm is not on PATH');
    return { file: 'pnpm', args, shell: process.platform === 'win32' };
  }
  return { file: process.execPath, args: [findBin(root, dir, name), ...args], shell: false };
}

/**
 * A package.json script as argv steps, split on `&&`. A script that needs a shell (quotes, `||`, `;`, `$`, `|`,
 * `cross-env`, `VAR=x`) is NOT tokenised: it runs as `pnpm run <script>` and `fallback` says so.
 */
export function scriptSteps(root, dir, script) {
  const body = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).scripts?.[script];
  if (!body) throw new Error(`${dir}/package.json has no "${script}" script`);
  const parts = body.split('&&').map((part) => part.trim());
  if (/["'`|;$]|cross-env/.test(body) || parts.some((p) => /^\w+=/.test(p) || !p)) return { steps: [['pnpm', 'run', script]], fallback: true };
  return { steps: parts.map((part) => part.split(/\s+/)), fallback: false };
}

function killTree(child) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
    if (result.error) orphanSuspected = true;
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}
const killAll = () => live.forEach(killTree);
process.on('exit', killAll);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { killAll(); process.exit(130); });

function runStep(root, task, argv, deadline) {
  return new Promise((done) => {
    let command;
    try { command = resolveArgv(root, task.dir, argv); } catch (error) {
      done({ code: 1, out: `${error.message}\n`, notFound: error instanceof ToolNotFound, tooling: !(error instanceof ToolNotFound) });
      return;
    }
    const env = { ...process.env, ...task.env };
    GIT_ENV.forEach((key) => delete env[key]);
    // A BACKGROUND step (a typecheck in hook mode) writes straight to its log file from the start, so at the deadline it can be
    // detached instead of killed: it finishes on its own and leaves its tsbuildinfo behind, making the next push warm.
    const background = Boolean(task.background) && isTsc(argv);
    let logFile;
    let logFd;
    if (background) {
      try {
        mkdirSync(LOG_DIR, { recursive: true });
        logFile = logPathFor(task);
        logFd = openSync(logFile, 'w');
      } catch { logFile = undefined; }
    }
    const toFile = logFd !== undefined;
    const child = spawn(command.file, command.args, {
      cwd: join(root, task.dir), shell: command.shell, windowsHide: true, detached: toFile || process.platform !== 'win32', env,
      stdio: toFile ? ['ignore', logFd, logFd] : ['ignore', 'pipe', 'pipe'],
    });
    live.add(child);
    let out = `$ ${argv.join(' ')}\n`;
    let timedOut = false;
    let settled = false;
    let exitCode = null;
    const finish = (code, extra = '', flags = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (toFile) { try { closeSync(logFd); out += readFileSync(logFile, 'utf8'); } catch { /* the log is a convenience */ } }
      done({ code, out: out + extra, timedOut, logFile, ...flags });
    };
    // `close` waits for every pipe holder to exit; a detached grandchild can keep the pipes open for ever, so `exit` (or the
    // kill) starts a short grace period after which the step ends with the child's own exit code (a clean exit still passes).
    const grace = () => setTimeout(() => finish(exitCode ?? 1, '\n(output closed after a grace period: a child process held the pipes)\n', { signalled: exitCode === null && !timedOut }), GRACE_MS).unref();
    const timer = setTimeout(() => {
      if (toFile) { live.delete(child); child.unref(); finish(1, '', { background: true }); return; }
      timedOut = true; killTree(child); grace();
    }, Math.max(1, deadline - Date.now()));
    child.stdout?.on('data', (c) => { out += c; });
    child.stderr?.on('data', (c) => { out += c; });
    child.on('error', (e) => finish(1, `${e}\n`, e.code === 'ENOENT' ? { notFound: true } : { tooling: true }));
    child.on('exit', (code) => { exitCode = code; if (toFile) finish(code ?? 1, '', { signalled: code === null }); else grace(); });
    child.on('close', (code) => finish(code ?? 1, '', { signalled: code === null }));
  });
}

const BARE_MISSING = /Cannot find (?:package|module) '(?![./]|[A-Za-z]:|file:)/;
const RESOURCE_FAILURE = /heap out of memory|FATAL ERROR: |ENOSPC|EMFILE|EPERM.*spawn|Node\.js v\d+\.\d+/;
const FINDING = /error TS\d+|\bFAIL\b|(?:Test Files|Tests)\s+\d+ failed/;

/** A non-zero exit that is the tool failing to run (killed, out of resources, a bare package it needs is not installed), not a finding. */
const isCrash = (step) => step.signalled || RESOURCE_FAILURE.test(step.out) || (BARE_MISSING.test(step.out) && !FINDING.test(step.out));
const isNotFoundExit = (code) => code === 9009 || code === 127;

/**
 * Only a real finding blocks (`fail`): a nonzero exit from a guard, a typecheck or a test run. A missing tool, a tooling
 * error, a crash, a timeout, the total budget, or a task marked advisory/soft is a `warn` with its reason and fix.
 */
async function execute(root, task, budgetEnd) {
  const startedAt = Date.now();
  const deadline = Math.min(startedAt + (task.timeout ?? DEFAULT_TIMEOUT_S) * 1000, budgetEnd);
  const notVerified = 'not verified locally, CI will check';
  let output = '';
  let status = 'pass';
  let reason;
  let advisoryOnly = false;
  for (const argv of task.steps) {
    if (Date.now() >= deadline) { status = 'timeout'; reason = `out of time before it started (${notVerified})`; break; }
    const step = await runStep(root, task, argv, deadline);
    output += step.out;
    if (step.background) {
      status = 'background';
      reason = `still checking in the background (log: ${step.logFile}); the next push will be fast`;
      break;
    }
    if (step.timedOut) { status = 'timeout'; reason = `timed out (${notVerified})`; break; }
    if (step.notFound || (step.code !== 0 && isNotFoundExit(step.code))) { status = 'warn'; reason = `tool not found (${step.out.trim().split('\n').pop()}); install it or run pnpm install in ${task.dir}`; break; }
    if (step.tooling) { status = 'warn'; reason = `tooling error (${step.out.trim().split('\n').pop()}); ${notVerified}`; break; }
    if (step.code === 0) continue;
    if (task.advisory) { status = 'warn'; reason = 'advisory: CI does not run this check'; advisoryOnly = true; break; }
    if (task.soft) { status = 'warn'; reason = `install problem in ${task.dir}; run pnpm install`; break; }
    if (isCrash(step)) { status = 'warn'; reason = `tool crashed or a dependency is missing; run pnpm install in ${task.dir}`; break; }
    status = 'fail';
    break;
  }
  let logPath;
  if (status !== 'pass') {
    try {
      mkdirSync(LOG_DIR, { recursive: true });
      logPath = logPathFor(task);
      if (status !== 'background') writeFileSync(logPath, output); // a background step's log is still being written by the step itself
    } catch { logPath = undefined; }
  }
  return { task, status, reason, advisoryOnly, ms: Date.now() - startedAt, output, logPath, rerun: `(cd ${task.dir} && ${task.steps.map((s) => s.join(' ')).join(' && ')})` };
}

const LABEL = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', timeout: 'TIMEOUT (not verified)', background: 'BACKGROUND' };
const rerunOf = (task) => `(cd ${task.dir} && ${task.steps.map((s) => s.join(' ')).join(' && ')})`;

/**
 * Run every task (printing a line as each finishes when `verbose`). Queue order is start order, so callers put the tasks that
 * must finish first up front. At `budgetEnd` (epoch ms) running tasks are killed (a background typecheck is detached instead);
 * HARD_STOP_MS later the run stops waiting: whatever is unfinished is reported as a timeout and children are killed.
 */
export function runAll(root, tasks, limit, { budgetEnd = Infinity, verbose = true, typecheckLimit = DEFAULT_TYPECHECK_LIMIT } = {}) {
  const queue = [...tasks];
  const results = [];
  const inflight = new Set();
  let typechecks = 0;
  let finished = false;
  return new Promise((resolveAll) => {
    const stop = () => { finished = true; clearTimeout(hardStop); resolveAll(results); };
    const hardStop = Number.isFinite(budgetEnd) ? setTimeout(() => {
      killAll();
      for (const task of [...inflight, ...queue]) results.push({ task, status: 'timeout', reason: 'out of time (not verified locally, CI will check)', ms: 0, output: '', logPath: undefined, rerun: rerunOf(task) });
      stop();
    }, Math.max(0, budgetEnd - Date.now()) + HARD_STOP_MS) : undefined;
    const pump = () => {
      while (!finished && inflight.size < limit) {
        const next = queue.findIndex((t) => t.kind !== 'typecheck' || typechecks < typecheckLimit);
        if (next < 0) break;
        const [task] = queue.splice(next, 1);
        inflight.add(task);
        if (task.kind === 'typecheck') typechecks += 1;
        execute(root, task, budgetEnd)
          .catch((error) => ({ task, status: 'warn', reason: `the check runner failed (${String(error?.message ?? error).split('\n')[0]}); not verified locally, CI will check`, ms: 0, output: String(error?.stack ?? error), logPath: undefined, rerun: rerunOf(task) }))
          .then((r) => {
            if (finished) return;
            if (verbose) console.log(`${LABEL[r.status].padEnd(22)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${task.name}`);
            results.push(r);
          })
          .finally(() => {
            inflight.delete(task);
            if (task.kind === 'typecheck') typechecks -= 1;
            pump();
          });
      }
      if (!finished && queue.length === 0 && inflight.size === 0) stop();
    };
    pump();
  });
}
