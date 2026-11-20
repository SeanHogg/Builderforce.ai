/**
 * Which workspace files ONE finished tool call changed — the single reading the
 * code-change backstop (open a ticket on the first edit, remember the touched files)
 * takes, on every surface.
 *
 * Two shapes of call change code. A direct writer (`write_file` / `edit_file` /
 * `delete_file`) names its file in `args.path`. A DELEGATION (`spawn_agent` with a
 * writable child) changes code INSIDE one call: the child's writes run in its own loop,
 * so the parent's dispatch never sees them as calls and — before this reading existed —
 * a child could rewrite half the workspace with no ticket opened and no file recorded.
 * The editor's delegation tool therefore reports every file its child wrote in the
 * result's `changedFiles`, and this is where the parent reads it.
 *
 * A failed direct write changed nothing, so it yields nothing. Pure: no I/O.
 */

import { delegatedChangedPathsOf, isScratchScriptPath } from '@builderforce/run-guards';
import { isFailedToolResult } from './brainTriage';
import { codeChangeFiles } from './chatWorkLinking';
import { isCodeChangeTool } from './localWorkspaceTools';

/**
 * The files a finished call changed, or `null` when the call changes no code at all.
 * An empty array means "a code change happened, but no path could be read from it"
 * — still a code change for the backstop, just not one with a file to name.
 */
export function codeChangesOf(name: string, args: unknown, out: unknown): string[] | null {
  if (isCodeChangeTool(name)) {
    if (isFailedToolResult(out)) return null;
    const files = codeChangeFiles(args);
    // A throwaway helper is not a change to the project (VS Code chat #275: a `_split.cjs`
    // helper opened "Code change (1 file)" before any real file changed).
    const real = files.filter((f) => !isScratchScriptPath(f));
    if (files.length > 0 && real.length === 0) return null;
    return real;
  }
  // A delegation (`DELEGATION_TOOLS`, `@builderforce/run-guards`) is read by what it REPORTS, not by whether it succeeded: a
  // child that wrote two files and then ran out of budget still moved the tree. THE reader, which is empty for any other tool.
  const named = delegatedChangedPathsOf(name, out).filter((f) => !isScratchScriptPath(f));
  return named.length ? named : null;
}
