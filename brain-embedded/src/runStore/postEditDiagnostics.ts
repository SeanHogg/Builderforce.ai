/**
 * Post-edit diagnostics (PRD 45 §4.5 row 1) — the fast verifier tier, run right
 * after a SUCCESSFUL `edit_file` / `write_file`, and surfaced on the tool result
 * the model reads.
 *
 * Why: chat #216's 14 KB Towers.tsx rewrite shipped a rules-of-hooks violation that
 * was only caught by luck. The D7 post-edit note (`postEditNote` in
 * `@builderforce/agent-run`) already covers the shell-free source/config policy; this
 * seam adds the HOST's language-server diagnostics to the same moment, in the same
 * note format, so a hooks-in-map violation is reported DETERMINISTICALLY on the edit
 * result instead of whenever the model happens to run the suite.
 *
 * ADVISORY ONLY: a diagnostic failure never blocks, refuses, or rewrites the edit —
 * the bytes on disk stand. A pass adds nothing to the result (noise budget), a
 * `null` (verifier unavailable on this host) adds nothing either — the §4.3 gate
 * reports "unavailable" where it matters, at push time (OD-3). A throw from the host
 * port is swallowed: a slow or broken verifier must never fail the edit's result
 * shaping.
 *
 * Thin on purpose: the orchestration (`noteWrite` → `diagnostics([path])` → note) is
 * all that lives here; the port itself and its evidence ledger come from
 * `@builderforce/run-guards` (§4.2/§4.4) and the host binds the port on the request
 * (`BrainRunRequest.verifier`). The VSIX's `clients/vscode/src/verify/` is the
 * reference host implementation.
 */

import type { CheckRecord } from '@builderforce/run-guards';
import type { VerifierPort } from './runTypes';

/** The tools whose successful result is checked on the spot (PRD §4.5 row 1). */
const EDIT_TOOLS: ReadonlySet<string> = new Set(['edit_file', 'write_file']);

/** Errors quoted per note — enough to act on, short enough not to bury the result
 *  (the D7 `postEditNote` budget in `@builderforce/agent-run`). */
const NOTE_ERRORS = 5;

/** The tool call succeeded (the same reading the D7 guard uses). */
function succeeded(data: unknown): boolean {
  return !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false);
}

/**
 * The post-edit diagnostics for ONE finished call, or null when there is nothing to
 * say: not an edit tool, the edit failed, no verifier is bound, the verifier is
 * unavailable here, or it passed. The returned string is ready to append to the
 * result as the D7 post-edit note.
 */
export async function postEditDiagnostics(
  call: { name: string; args: unknown; result: unknown },
  verifier: VerifierPort | undefined,
): Promise<string | null> {
  if (!verifier || !EDIT_TOOLS.has(call.name) || !succeeded(call.result)) return null;
  const paths = editedPaths(call.args);
  if (!paths.length) return null;

  let record: CheckRecord | null;
  try {
    record = await verifier.diagnostics(paths);
  } catch {
    // A broken or slow verifier is an availability fact, not an edit failure — the
    // §4.3 gate reports it at push time. The edit's result must not be disturbed.
    return null;
  }
  if (!record || record.outcome !== 'fail') return null;
  return postEditNote(record);
}

/** The files ONE edit call wrote: its `path`, and each entry of an `edit_file` batch's `edits[]`. */
function editedPaths(args: unknown): string[] {
  const a = (args ?? {}) as { path?: unknown; edits?: unknown };
  const raw = [a.path, ...(Array.isArray(a.edits) ? a.edits.map((e) => (e as { path?: unknown } | null)?.path) : [])];
  return [...new Set(raw.filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.trim()))];
}

/** The D7 note a failed diagnostics check adds to the tool result. */
export function postEditNote(record: CheckRecord): string {
  const lines = record.findings
    .slice(0, NOTE_ERRORS)
    .map((f) => `- ${f}`);
  const more = record.findings.length > NOTE_ERRORS ? `\n- …and ${record.findings.length - NOTE_ERRORS} more` : '';
  return (
    `Post-edit check FAILED (${record.name}${record.exitCode != null ? `, exit ${record.exitCode}` : ''}) — ` +
    `fix this before building on it:\n${lines.join('\n')}${more}`
  );
}
