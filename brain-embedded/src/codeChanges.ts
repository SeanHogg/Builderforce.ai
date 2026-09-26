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

import { isFailedToolResult } from './brainTriage';
import { codeChangeFile } from './chatWorkLinking';
import { isCodeChangeTool } from './localWorkspaceTools';

/** The tools a run delegates through — one child, or several side by side. Each result
 *  carries the files its children changed. */
export const DELEGATION_TOOLS: ReadonlySet<string> = new Set(['spawn_agent', 'spawn_agents']);

export function isDelegationTool(name: string): boolean {
  return DELEGATION_TOOLS.has(name);
}

/**
 * The files a finished call changed, or `null` when the call changes no code at all.
 * An empty array means "a code change happened, but no path could be read from it"
 * — still a code change for the backstop, just not one with a file to name.
 */
export function codeChangesOf(name: string, args: unknown, out: unknown): string[] | null {
  if (isCodeChangeTool(name)) {
    if (isFailedToolResult(out)) return null;
    const file = codeChangeFile(args);
    return file ? [file] : [];
  }
  // A delegation is read by what it REPORTS, not by whether it succeeded: a child that
  // wrote two files and then ran out of budget still moved the tree.
  if (isDelegationTool(name)) {
    const files = (out as { changedFiles?: unknown } | null)?.changedFiles;
    if (!Array.isArray(files)) return null;
    const named = files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
    return named.length ? named : null;
  }
  return null;
}
