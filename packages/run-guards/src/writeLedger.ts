/**
 * The loop-breaker for a WRITE the run has already made: a full-content write that
 * SUCCEEDED and is sent again, byte for byte (chat #129: the identical 8.6 KB
 * `src/App.jsx` twice in a row, because the preview still showed an error from before
 * the first write). A full-content write is idempotent, so suppressing the replay never
 * changes meaning — it only removes the wasted turn.
 *
 * Keyed on the SHAPE of the call (`path` + `content`), never on a tool list, so every
 * host's writer is covered. An `edit`-style call is NOT covered: a replacement that
 * contains its own needle applies again, so its repeat is not a no-op. Any other call
 * naming the path forgets it; an unscoped mutation forgets everything. Pure.
 */
import { callFingerprint, pathArgOf } from "./fingerprint.js";

interface ContentWrite {
  path: string;
  fingerprint: string;
}

/** The `path` + `content` of a full-content write, or null when the call is not one. */
export function contentWriteOf(tool: string, args: unknown): ContentWrite | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const { path, content } = args as { path?: unknown; content?: unknown };
  if (typeof path !== "string" || !path.trim() || typeof content !== "string") return null;
  return { path: path.trim(), fingerprint: callFingerprint(tool, args) };
}

/** Per-run record of the last successful full-content write to each path. */
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
   * that names a path forgets that path; `unscoped` forgets everything. A FAILED write
   * forgets its path — the file's state is unknown.
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
    const path = pathArgOf(args);
    if (path) this.written.delete(path);
  }
}

/** What the model reads instead of a second identical write. */
export function repeatedWriteNote(tool: string, path: string): string {
  return `Not re-run: this exact \`${tool}\` of "${path}" already succeeded earlier in this run and nothing has changed the file since, so it already holds this content — writing it again cannot change anything. If something still looks broken, the cause is not that the write failed: re-read the error (it may predate your write), look elsewhere for the cause, or tell the user what you see.`;
}
