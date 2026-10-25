/**
 * A read-only `run_command` that printed one workspace file (`cat F`, `sed -n 'A,Bp' F`,
 * `head`/`tail`, after an optional `cd X &&`) is recorded as the `read_file` it stands
 * for (PRD 35 E1) — so the visit tally sees the revisit and a later `read_file` of the
 * same lines is a covered window, not a second read. The parsing is the shared guard's
 * (`shellReadAsFileRead`); what is the Brain's own is which calls qualify: its read-only
 * shell classifier, a clean exit, and output the model was handed WHOLE (a trimmed or
 * compressed print did not show every line it printed).
 */

import { shellReadAsFileRead } from '@builderforce/run-guards';
import { isReadOnlyShellCall } from '../readOnlyShell';
import type { ReadCoverage } from '../readCoverage';

/** The command and the printed text of a successful, verbatim shell result; null otherwise. */
function cleanPrint(args: unknown, out: unknown): { command: string; stdout: string } | null {
  if (!args || typeof args !== 'object' || !out || typeof out !== 'object' || Array.isArray(out)) return null;
  const a = args as Record<string, unknown>;
  const r = out as Record<string, unknown>;
  if (r.ok === false || r.compressed === true || (r.exitCode !== undefined && r.exitCode !== 0)) return null;
  const stdout = typeof r.stdout === 'string' ? r.stdout : typeof r.output === 'string' ? r.output : null;
  const raw = typeof a.command === 'string' ? a.command : typeof a.cmd === 'string' ? a.cmd : '';
  if (stdout === null || !raw.trim()) return null;
  // Where it RAN is a leading `cd` (confined to the workspace): the effective directory
  // the shell reports (`cwd` — the run's default checkout or the `cwd` argument), else
  // the argument itself.
  const cwd = [r.cwd, a.cwd].map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) ?? '';
  return { command: cwd ? `cd ${JSON.stringify(cwd)} && ${raw}` : raw, stdout };
}

/**
 * Record a file print as a read. `servedWhole` is false when the transcript budget cut
 * the result. Returns whether anything was recorded.
 */
export function recordShellFileRead(coverage: ReadCoverage, tool: string, args: unknown, out: unknown, servedWhole: boolean, anchor: unknown): boolean {
  if (!servedWhole || !isReadOnlyShellCall(tool, args)) return false;
  const print = cleanPrint(args, out);
  const read = print ? shellReadAsFileRead(print.command, print.stdout) : null;
  if (!read) return false;
  coverage.record('read_file', read.args);
  coverage.cacheResult('read_file', read.args, { result: read.result, anchor });
  return true;
}
