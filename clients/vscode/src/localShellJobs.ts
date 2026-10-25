/**
 * The editor shell's BACKGROUND jobs — what `run_command` `background` / `yieldMs`,
 * `command_status` and `command_stop` run on.
 *
 * Module-level on purpose: the tool adapter builds a fresh capability provider per call
 * (`fileTools.ts`), so a job started by one call must still be there for the next.
 *
 * A job belongs to the RUN that started it (its `owner`, the run key): its id is scoped
 * to that run — `job-1` of one run is not `job-1` of another, and `command_status` /
 * `command_stop` from another run is told there is no such job. The host kills a run's
 * jobs when the run settles (finish, fail or Stop — `killRunJobs`) and every job when the
 * extension deactivates (`killAllJobs`), so no run leaves a dev server behind. A job
 * started with a `signal` also dies with it. Output is a bounded tail.
 */

import { spawn, type ChildProcess } from "child_process";
import type { ShellJobStart, ShellJobStatus } from "@builderforce/agent-tools";
import { killProcessTree, processGroupOption } from "./processTree";

/** The run a job belongs to; `undefined` = a caller with no run (a hook, a test). */
export type JobOwner = number | undefined;

interface Job {
  id: string;
  owner: JobOwner;
  child: ChildProcess;
  status: "running" | "exited" | "killed";
  exitCode?: number;
  output: string;
  truncated: boolean;
  done: Promise<void>;
}

/** Keyed by owner AND id, so a lookup from another run cannot reach the job. */
const jobs = new Map<string, Job>();
/** The next id per owner — ids are scoped to their run. */
const nextJobOf = new Map<JobOwner, number>();

const keyOf = (owner: JobOwner, id: string): string => `${owner ?? "-"}:${id}`;
/** Finished jobs kept for a late `command_status`; the oldest finished go first. */
const MAX_JOBS = 32;

export interface StartJobOptions {
  cwd: string;
  /** A POSIX interpreter to run the command under (`bash -c`), or null for the platform shell. */
  bash: string | null;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** The run that owns the job (see the module note). */
  owner?: JobOwner;
  /** Bound on the kept output tail. */
  maxOutput: number;
}

function evictFinished(): void {
  if (jobs.size < MAX_JOBS) return;
  for (const [id, job] of jobs) {
    if (job.status !== "running") jobs.delete(id);
    if (jobs.size < MAX_JOBS) return;
  }
}

function statusOf(job: Job): ShellJobStatus {
  return {
    ok: job.status !== "killed" && (job.status === "running" || job.exitCode === 0),
    id: job.id,
    status: job.status,
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    output: job.output.trim(),
    ...(job.truncated ? { truncated: true } : {}),
  };
}

const unknownJob = (id: string): ShellJobStatus => ({
  ok: false,
  id,
  status: "unknown",
  error: `no background job "${id}" in this run (it may belong to another run, or to one that has ended)`,
});

export function startJob(command: string, opts: StartJobOptions): ShellJobStart {
  if (opts.signal?.aborted) return { ok: false, error: "the run was stopped" };
  evictFinished();
  const common = {
    cwd: opts.cwd,
    windowsHide: true,
    ...processGroupOption(),
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  };
  let child: ChildProcess;
  try {
    child = opts.bash ? spawn(opts.bash, ["-c", command], common) : spawn(command, { ...common, shell: true });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const owner = opts.owner;
  const n = (nextJobOf.get(owner) ?? 0) + 1;
  nextJobOf.set(owner, n);
  const id = `job-${n}`;
  let settle!: () => void;
  const job: Job = { id, owner, child, status: "running", output: "", truncated: false, done: new Promise<void>((r) => { settle = r; }) };
  const append = (chunk: Buffer | string): void => {
    job.output += chunk.toString();
    if (job.output.length > opts.maxOutput) {
      job.output = job.output.slice(job.output.length - opts.maxOutput);
      job.truncated = true;
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const onAbort = (): void => { void killJob(id, owner); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const finish = (code: number | null): void => {
    if (job.status === "running") job.status = "exited";
    if (typeof code === "number") job.exitCode = code;
    opts.signal?.removeEventListener("abort", onAbort);
    settle();
  };
  child.on("error", (e) => { append(`\n${e.message}`); finish(null); });
  child.on("close", (code) => finish(code));
  jobs.set(keyOf(owner, id), job);
  return { ok: true, id };
}

/** Resolves once `signal` aborts (never, without one); `off` detaches it. */
function abortOf(signal: AbortSignal | undefined): { aborted: Promise<void>; off: () => void } {
  if (!signal) return { aborted: new Promise<void>(() => undefined), off: () => undefined };
  let off = (): void => undefined;
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = (): void => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    off = () => signal.removeEventListener("abort", onAbort);
  });
  return { aborted, off };
}

/**
 * A job's state, after waiting up to `waitMs` for it to finish. Aborting `signal` ends
 * the WAIT early with the status so far — the job itself runs on.
 */
export async function pollJob(id: string, waitMs = 0, opts: { owner?: JobOwner; signal?: AbortSignal } = {}): Promise<ShellJobStatus> {
  const job = jobs.get(keyOf(opts.owner, id));
  if (!job) return unknownJob(id);
  if (job.status === "running" && waitMs > 0 && !opts.signal?.aborted) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = abortOf(opts.signal);
    await Promise.race([job.done, stop.aborted, new Promise<void>((r) => { timer = setTimeout(r, waitMs); })]);
    if (timer) clearTimeout(timer);
    stop.off();
  }
  return statusOf(job);
}

/** Kill a job's process tree and report how it ended (waits briefly for the exit). */
export async function killJob(id: string, owner?: JobOwner): Promise<ShellJobStatus> {
  const job = jobs.get(keyOf(owner, id));
  if (!job) return unknownJob(id);
  if (job.status === "running") {
    job.status = "killed";
    await killProcessTree(job.child.pid);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([job.done, new Promise<void>((r) => { timer = setTimeout(r, 3_000); })]);
    if (timer) clearTimeout(timer);
  }
  return { ...statusOf(job), ...(job.status === "killed" ? { error: "stopped" } : {}) };
}

/** Kill every job a run still has running — called when the run settles. */
export async function killRunJobs(owner: JobOwner): Promise<void> {
  const mine = [...jobs.values()].filter((job) => job.owner === owner && job.status === "running");
  await Promise.all(mine.map((job) => killJob(job.id, owner)));
}

/** Kill every running job of every run — the extension is deactivating. */
export async function killAllJobs(): Promise<void> {
  const running = [...jobs.values()].filter((job) => job.status === "running");
  await Promise.all(running.map((job) => killJob(job.id, job.owner)));
}
