/**
 * The run sandbox's BACKGROUND jobs — what `run_command` `background` / `yieldMs`,
 * `command_status` and `command_stop` run on, in a cloud run.
 *
 * The table lives HERE, in the sandbox process, never in a Worker isolate: a cloud run
 * spans ticks, so a job started on one tick has to be pollable on the next. One table
 * belongs to one run's box (ids are `job-N` within it), and the box's close kills every
 * job in it — a job cannot outlive its run. A container that restarts loses its table;
 * a poll then answers status `unknown`, which the tools pass to the model.
 *
 * The semantics are the editor's (`clients/vscode/src/localShellJobs.ts`): output is a
 * bounded tail, `poll` may wait for the job to end, `kill` reaches the whole process tree.
 * A job has no timeout of its own — that is what makes it a background job.
 *
 * Plain ESM, node builtins only: the GitHub Actions runner inlines it verbatim beside
 * `sandboxCore.mjs` (`api/scripts/gen-sandbox-core-source.mjs`).
 */
import { spawn } from 'node:child_process';
import { SHELL_CAPTURE_CHARS, keepTail } from './toolOutputPolicy.mjs';

/** Finished jobs kept for a late poll; past this the oldest finished go first. */
const MAX_JOBS = 32;
/** How long `kill` waits for the tree to report its exit before answering anyway. */
const KILL_SETTLE_MS = 3_000;

const unknownJob = (id) => ({
  ok: false,
  id,
  status: 'unknown',
  error: `no background job "${id}" in this run (the sandbox may have restarted, or the job ended with the run)`,
});

function statusOf(job) {
  return {
    ok: job.status === 'running' || (job.status === 'exited' && job.exitCode === 0),
    id: job.id,
    status: job.status,
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    output: job.output.trim(),
    ...(job.truncated ? { truncated: true } : {}),
  };
}

/** SIGKILL the job's whole process group (it was spawned detached, so it leads one): a
 *  `bash -lc` child killed alone would leave its grandchildren running. */
export function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/** Whether anything in the child's process group is still alive (signal 0 delivers nothing). */
function groupAlive(child) {
  try { process.kill(-child.pid, 0); return true; } catch { return false; }
}

/** A prefix for one sandbox boot's job ids. Ids restart at `job-1` in a fresh table, so a
 *  poll from before a restart would otherwise read a DIFFERENT job under the same id. */
export function bootJobIdPrefix() {
  return `${Math.random().toString(36).slice(2, 8)}-`;
}

/**
 * One run's job table. `maxWaitMs` bounds a poll's wait (the foreground command ceiling);
 * `idPrefix` (default none) is put before `job-N` in every id.
 */
export function createJobTable({ maxWaitMs, idPrefix = '' }) {
  const table = new Map();
  /** Every job's process group leader, for the life of the table. NOT evicted with the
   *  job record, and kept after the job reads `exited`: `nohup srv &` ends its bash while
   *  `srv` runs on, and `kill` / `closeAll` must still reach it. */
  const groups = new Set();
  let seq = 0;

  function evictFinished() {
    for (const [id, job] of table) {
      if (table.size < MAX_JOBS) return;
      if (job.status !== 'running') table.delete(id);
    }
  }

  /** Start `command` in `cwd` (already resolved inside the clone). */
  function start(command, cwd) {
    evictFinished();
    if (table.size >= MAX_JOBS) return { ok: false, error: `too many running background jobs (${MAX_JOBS}); stop one with command_stop first` };
    const id = `${idPrefix}job-${++seq}`;
    const child = spawn('bash', ['-lc', command], { cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let settle;
    const job = { id, child, status: 'running', output: '', truncated: false, done: new Promise((r) => { settle = r; }) };
    const cap = (chunk) => {
      const next = job.output + chunk;
      if (next.length > SHELL_CAPTURE_CHARS.container) job.truncated = true;
      job.output = keepTail(next, SHELL_CAPTURE_CHARS.container);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const finish = (code) => {
      if (job.status === 'running') job.status = 'exited';
      job.exitCode = code ?? -1;
      settle();
    };
    child.on('close', (code) => {
      finish(code);
      // Nothing left in the group ⇒ stop tracking it, so a recycled pid is never signalled.
      if (!groupAlive(child)) groups.delete(child);
    });
    child.on('error', (e) => { cap(`\n${e.message}`); finish(null); });
    table.set(id, job);
    groups.add(child);
    return { ok: true, id };
  }

  /** A job's state, after waiting up to `waitMs` for it to end. `onAbort(wake)` lets the
   *  transport end the WAIT early when the engine gives up on the request (the job runs on). */
  async function poll(id, waitMs, onAbort = () => {}) {
    const job = table.get(id);
    if (!job) return unknownJob(id);
    const wait = Number.isFinite(waitMs) && waitMs > 0 ? Math.min(waitMs, maxWaitMs) : 0;
    if (job.status === 'running' && wait > 0) {
      let timer;
      let release;
      const aborted = new Promise((resolve) => { release = onAbort(resolve); });
      await Promise.race([job.done, aborted, new Promise((r) => { timer = setTimeout(r, wait); })]);
      clearTimeout(timer);
      if (typeof release === 'function') release();
    }
    return statusOf(job);
  }

  /** Kill a job's process tree and report how it ended (waits briefly for the exit). A job
   *  that already read `exited` is still signalled: its group may hold a daemon it left
   *  behind. Its status stays `exited` — only a job that was running reads `killed`. */
  async function kill(id) {
    const job = table.get(id);
    if (!job) return unknownJob(id);
    const wasRunning = job.status === 'running';
    if (wasRunning) job.status = 'killed';
    killTree(job.child);
    groups.delete(job.child);
    if (wasRunning) {
      let timer;
      await Promise.race([job.done, new Promise((r) => { timer = setTimeout(r, KILL_SETTLE_MS); })]);
      clearTimeout(timer);
    }
    return { ...statusOf(job), ...(job.status === 'killed' ? { error: 'stopped' } : {}) };
  }

  /** Kill every job and every group a job left behind — the run is over. */
  async function closeAll() {
    await Promise.all([...table.values()].filter((j) => j.status === 'running').map((j) => kill(j.id)));
    for (const child of groups) killTree(child);
    groups.clear();
  }

  /** Whether any job is still running — what keeps an idle container alive. */
  function hasRunning() {
    for (const job of table.values()) if (job.status === 'running') return true;
    return false;
  }

  return { start, poll, kill, closeAll, hasRunning };
}
