/**
 * The post-edit NOTES a successful edit carries on the result the model reads (PRD 46 §3.6,
 * PRD 45 §4.5 row 1) — the one call `callRunner` makes for them.
 *
 * Two independent checks, each said in the D7 post-edit note format, concatenated:
 *   - bracket balance (PRD 46 §3.2): an `edit_file` whose `new_string` changes the `{}` / `()`
 *     / `[]` balance of the `old_string` it replaced. Chat #70776's `labels.ts` edit closed the
 *     object early with `};` and orphaned the spreads that followed — `applyStringEdit` is
 *     atomic, so the call reported success over an unparseable file. Needs no verifier: the
 *     delta is computed from the call's own arguments, so it holds on every host.
 *   - the host's language-server diagnostics (`postEditDiagnostics.ts`), when a verifier is bound.
 *
 * Both run whatever other advisory the call already carries (a placeholder warning, a
 * delegation nudge): `callRunner` appends these notes to it instead of dropping them —
 * diagnostics used to be skipped whenever any advisory was attached (PRD 46 F4).
 *
 * `write_file` is not balance-checked: the delta needs the bytes the write replaced, and
 * neither the executor's result nor the run's ledgers carry them. ADVISORY ONLY — nothing
 * here blocks, refuses or rewrites an edit.
 */

import { bracketDelta, changesBalance, describeBracketDelta, editedFilesOf } from '@builderforce/agent-tools';
import { postEditDiagnostics } from './postEditDiagnostics';
import type { VerifierPort } from './runTypes';

/** The tool calls a bracket-balance note is computed for. */
const BALANCE_TOOLS: ReadonlySet<string> = new Set(['edit_file']);

/** The call succeeded (the reading `postEditDiagnostics` uses). */
function succeeded(data: unknown): boolean {
  return !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false);
}

/**
 * The bracket-balance note for ONE finished call, or null: not an edit, the edit failed, or
 * every replacement kept the balance of the text it replaced. Same note format as the D7
 * post-edit note (`postEditNote`).
 */
export function bracketBalanceNote(call: { name: string; args: unknown; result: unknown }): string | null {
  if (!BALANCE_TOOLS.has(call.name) || !succeeded(call.result)) return null;
  const lines: string[] = [];
  for (const e of editedFilesOf(call.name, call.args)) {
    if (e.before === undefined || e.after === undefined) continue;
    const delta = bracketDelta(e.before, e.after, e.path);
    if (changesBalance(delta)) lines.push(`- ${e.path}: ${describeBracketDelta(delta, 'glyph')} (new_string vs old_string)`);
  }
  if (!lines.length) return null;
  return (
    'Post-edit check FAILED (bracket balance) — the replacement changed the bracket balance of the text it replaced, ' +
    `so the file is likely unparseable. Read the edited lines and fix this before building on it:\n${lines.join('\n')}`
  );
}

/**
 * Every post-edit note for ONE finished call, joined — or null when there is nothing to say.
 * The balance note first (it needs no host), then the host's diagnostics.
 */
export async function postEditNotes(
  call: { name: string; args: unknown; result: unknown },
  verifier: VerifierPort | undefined,
): Promise<string | null> {
  const notes = [bracketBalanceNote(call), await postEditDiagnostics(call, verifier)].filter((n): n is string => !!n);
  return notes.length ? notes.join('\n\n') : null;
}
