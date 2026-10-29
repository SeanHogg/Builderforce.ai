/**
 * A read-only `run_command` that printed one workspace file (`cat F`, `sed -n 'A,Bp' F`,
 * `head`/`tail`, after an optional `cd X &&`) is the `read_file` it stands for (PRD 35 E1) —
 * so the visit tally sees the revisit and a later `read_file` of the same lines is a covered
 * window, not a second read. Moved here from the Brain's run store so the Brain's read guard
 * and the agent's (`@builderforce/agent-run` `policy/tools`) read a shell print the same way.
 *
 * The parsing is `shellReadAsFileRead`'s (`shellFileRead.ts`); what is decided here is which
 * calls qualify: a read-only shell command (`readOnlyShell.ts`), a clean exit, and output the
 * model was handed WHOLE (a trimmed or compressed print did not show every line it printed).
 * Pure.
 */

import type { ReadCoverage } from "./readCoverage.js";
import { isReadOnlyShellCall } from "./readOnlyShell.js";
import { shellReadAsFileRead, type ShellReadAsFileRead } from "./shellFileRead.js";

/** The command and the printed text of a successful, verbatim shell result; null otherwise. */
function cleanPrint(args: unknown, out: unknown): { command: string; stdout: string } | null {
  if (!args || typeof args !== "object" || !out || typeof out !== "object" || Array.isArray(out)) return null;
  const a = args as Record<string, unknown>;
  const r = out as Record<string, unknown>;
  if (r.ok === false || r.compressed === true || (r.exitCode !== undefined && r.exitCode !== 0)) return null;
  const stdout = typeof r.stdout === "string" ? r.stdout : typeof r.output === "string" ? r.output : null;
  const raw = typeof a.command === "string" ? a.command : typeof a.cmd === "string" ? a.cmd : "";
  if (stdout === null || !raw.trim()) return null;
  // Where it RAN is a leading `cd` (confined to the workspace): the effective directory
  // the shell reports (`cwd` — the run's default checkout or the `cwd` argument), else
  // the argument itself.
  const cwd = [r.cwd, a.cwd].map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean) ?? "";
  return { command: cwd ? `cd ${JSON.stringify(cwd)} && ${raw}` : raw, stdout };
}

/**
 * The `read_file` a shell print stands for, or null when the call is not a print of one
 * workspace file. `servedWhole` is false when the transcript budget cut the result.
 */
export function shellPrintAsRead(tool: string, args: unknown, out: unknown, servedWhole: boolean): ShellReadAsFileRead | null {
  if (!servedWhole || !isReadOnlyShellCall(tool, args)) return null;
  const print = cleanPrint(args, out);
  return print ? shellReadAsFileRead(print.command, print.stdout) : null;
}

/**
 * Record a file print as a read in `coverage`, cached against `anchor` (the row that carries
 * it). Returns whether anything was recorded.
 */
export function recordShellFileRead(coverage: ReadCoverage, tool: string, args: unknown, out: unknown, servedWhole: boolean, anchor: unknown): boolean {
  const read = shellPrintAsRead(tool, args, out, servedWhole);
  if (!read) return false;
  coverage.record("read_file", read.args);
  coverage.cacheResult("read_file", read.args, { result: read.result, anchor });
  return true;
}
