/**
 * The shell's per-call options and its BACKGROUND job shapes — split from
 * `capabilities.ts` (already the whole capability catalog) because they are one
 * subsystem: Stop reaching the process (`signal`), and a long command that runs on
 * while the agent keeps working (`start` → `poll` → `kill`).
 */

export interface ShellRunOptions {
  /**
   * The run's (or the step's) cancel signal. Aborting it kills the command — its whole
   * process tree — and the result comes back `{ ok: false, aborted: true }`. A shell that
   * cannot kill simply finishes; the caller still drops the late result.
   */
  signal?: AbortSignal;
}

/** A background job's state as `poll` / `kill` report it. */
export interface ShellJobStatus {
  ok: boolean;
  id: string;
  status: "running" | "exited" | "killed" | "unknown";
  exitCode?: number;
  /** The tail of the combined stdout/stderr, bounded by the shell. */
  output?: string;
  /** True when earlier output was dropped from the bounded buffer. */
  truncated?: boolean;
  error?: string;
}

export interface ShellJobStart {
  ok: boolean;
  id?: string;
  error?: string;
}
