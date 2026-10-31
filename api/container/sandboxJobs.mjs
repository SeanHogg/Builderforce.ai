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
function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * One run's job table. `maxWaitMs` bounds a poll's wait (the foreground command ceiling).
 */
export function createJobTable({ maxWaitMs }) {
  const table = new Map();
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
    const id = `job-${++seq}`;
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
    child.on('close', finish);
    child.on('error', (e) => { cap(`\n${e.message}`); finish(null); });
    table.set(id, job);
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

  /** Kill a job's process tree and report how it ended (waits briefly for the exit). */
  async function kill(id) {
    const job = table.get(id);
    if (!job) return unknownJob(id);
    if (job.status === 'running') {
      job.status = 'killed';
      killTree(job.child);
      let timer;
      await Promise.race([job.done, new Promise((r) => { timer = setTimeout(r, KILL_SETTLE_MS); })]);
      clearTimeout(timer);
    }
    return { ...statusOf(job), ...(job.status === 'killed' ? { error: 'stopped' } : {}) };
  }

  /** Kill every running job — the run is over. */
  async function closeAll() {
    await Promise.all([...table.values()].filter((j) => j.status === 'running').map((j) => kill(j.id)));
  }

  return { start, poll, kill, closeAll };
}
