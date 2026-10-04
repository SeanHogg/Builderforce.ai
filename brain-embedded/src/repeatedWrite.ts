/**
 * The loop-breaker for a WRITE the run has already made.
 *
 * `readCoverage.ts` stops the successful read that keeps coming back, and
 * `repeatedFailure.ts` the failure that keeps coming back. Neither sees the third
 * shape: a write that SUCCEEDED and is sent again, byte for byte. Measured on a real
 * run (web Brain, chat #129, MiniMax-M1): `canvas_write_build_file` of `src/App.jsx`
 * with the identical 8.6 KB body twice in a row — the preview was still showing an
 * error from before the first write, so the model concluded its write had not taken
 * and made it again. It had; the second call spent a 15-second turn changing nothing.
 *
 * A full-content write (`path` + `content`) is idempotent by construction: replaying
 * it leaves the file exactly as the first call did. So suppressing the replay is never
 * a change of meaning — the only thing it removes is the wasted turn — and the stub
 * tells the model the one thing it got wrong: the file already holds that content.
 * Keyed on the SHAPE of the call rather than a tool list, so every host's writer
 * (`write_file`, `canvas_write_build_file`, …) is covered without this package naming
 * tools it does not own. An `edit`-style call (`find`/`replace`) is NOT covered: a
 * replacement that contains its own needle applies again, so its repeat is not a no-op.
 *
 * "Since" matters: any other call that names the same `path` (an edit, a restore, a
 * delete) forgets it, and an unscoped mutation (a shell command) forgets everything —
 * after either, the file may no longer hold what was written, and the write is real
 * again. Pure and self-contained, like `FailureTally`: no clock, no I/O.
 */

import { stableStringify } from '@builderforce/agent-tools';

interface ContentWrite {
  path: string;
  fingerprint: string;
}

/** The `path` + `content` of a full-content write, or null when the call is not one. */
function contentWriteOf(tool: string, args: unknown): ContentWrite | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const { path, content } = args as { path?: unknown; content?: unknown };
  if (typeof path !== 'string' || !path.trim() || typeof content !== 'string') return null;
  return { path: path.trim(), fingerprint: `${tool}:${stableStringify(args)}` };
}

function pathOf(args: unknown): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const path = (args as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

/** Per-run record of the last successful full-content write to each path. One
 *  instance per run; the run loop owns it and drops it when the run ends. */
export class WriteLedger {
  private readonly written = new Map<string, string>();

  /** Is this call a full-content write identical to the last one that landed on its
   *  path, with nothing touching that path since? */
  isRepeat(tool: string, args: unknown): boolean {
    const write = contentWriteOf(tool, args);
    return !!write && this.written.get(write.path) === write.fingerprint;
  }

  /**
   * A non-read call ran. A successful full-content write is remembered; anything else
   * that names a path forgets that path; `unscoped` (a shell command, a checkout)
   * forgets everything. A FAILED write forgets its path — the file's state is unknown.
   */
  record(tool: string, args: unknown, options: { ok: boolean; unscoped?: boolean }): void {
    if (options.unscoped) {
      this.written.clear();
      return;
    }
    const write = options.ok ? contentWriteOf(tool, args) : null;
    if (write) {
      this.written.set(write.path, write.fingerprint);
      return;
    }
    const path = pathOf(args);
    if (path) this.written.delete(path);
  }
}

/** What the model reads instead of a second identical write. */
export function repeatedWriteNote(tool: string, path: string): string {
  return `Not re-run: this exact \`${tool}\` of "${path}" already succeeded earlier in this run and nothing has changed the file since, so it already holds this content — writing it again cannot change anything. If something still looks broken, the cause is not that the write failed: re-read the error (it may predate your write), look elsewhere for the cause, or tell the user what you see.`;
}
