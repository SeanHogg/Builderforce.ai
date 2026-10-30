/**
 * The shell's per-call options and its BACKGROUND job shapes — split from
 * `capabilities.ts` (already the whole capability catalog) because they are one
 * subsystem: Stop reaching the process (`signal`), and a long command that runs on
 * while the agent keeps working (`start` → `poll` → `kill`).
 */

export interface ShellRunOptions {
  /**
   * The directory the command runs in: a WORKSPACE-RELATIVE path, already validated by the
   * tool (no `..`, not absolute, no shell metacharacters). The host spawns the command with
   * that working directory — the command text is never prefixed with a `cd`, because `cd X &&
   * cmd` is not one language (Windows PowerShell 5.1 cannot parse `&&`). Omitted ⇒ the
   * workspace root. A host whose transport cannot take a working directory scopes the command
   * itself, behind its own adapter.
   */
  cwd?: string;
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
