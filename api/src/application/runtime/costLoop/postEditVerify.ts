/**
 * D7 (durable half) — check a file the moment the run changes it, not at finish.
 *
 * The finish gate already runs the shell-free source/config policy
 * (`verifyWrittenFiles`) over every changed file, but only when the model calls
 * `finish` — by then it has built three more edits on top of the broken one. Here the
 * SAME policy runs right after each successful `write_file` / `edit_file`: a write is
 * checked on the bytes it sent (no read back), an edit on the committed result. Only a
 * FAILURE reaches the model, as one short note on that tool's result; a pass adds
 * nothing. The verdict also feeds the verifier cascade (D1) as the code unit's verifier.
 *
 * (The container half — real lint / type-check / tests after an edit — runs in the
 * container image, which has a shell.)
 */
import { withAdvisory } from '@builderforce/run-guards';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { checkFileContent, foldVerifyOutcomes, verifyWrittenFiles, isVerifiablePath, type VerifyResult } from '../../repos/verifyWrittenFiles';

const EDIT_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file']);

/** Errors quoted per note — enough to act on, short enough not to bury the result. */
const NOTE_ERRORS = 5;

function succeeded(data: unknown): boolean {
  return !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false);
}

/**
 * The post-edit verdict for one dispatched call, or null when there is nothing to check
 * (not an edit, it failed, no repo, or no policy applies to the path).
 */
export async function verifyAfterEdit(
  call: { name: string; args: Record<string, unknown> },
  data: unknown,
  repoCtx: TicketRepoContext | null,
): Promise<VerifyResult | null> {
  if (!EDIT_TOOLS.has(call.name) || !repoCtx || !succeeded(data)) return null;
  const path = typeof call.args.path === 'string' ? call.args.path.trim() : '';
  if (!path || !isVerifiablePath(path)) return null;
  const content = call.name === 'write_file' && typeof call.args.content === 'string' ? call.args.content : null;
  const result = content !== null
    ? foldVerifyOutcomes([{ path, ...checkFileContent(path, content) }])
    : await verifyWrittenFiles({ ...repoCtx, ref: repoCtx.branch }, [path]);
  return result.checked.length || result.errors.length ? result : null;
}

/** The one short note a failed check adds to the tool result. */
export function postEditNote(v: VerifyResult): string {
  const lines = v.errors.slice(0, NOTE_ERRORS).map((e) => `- ${e.path}${e.line ? `:${e.line}` : ''}${e.ruleId ? ` [${e.ruleId}]` : ''}: ${e.message}`);
  const more = v.errors.length > NOTE_ERRORS ? `\n- …and ${v.errors.length - NOTE_ERRORS} more` : '';
  return `Post-edit check FAILED (shell-free source/config policy) — fix this before building on it:\n${lines.join('\n')}${more}`;
}

/** The tool result the model reads: unchanged on a pass, with the note on a failure. */
export function withPostEditNote(data: unknown, v: VerifyResult | null): unknown {
  return v && !v.ok ? withAdvisory(data, postEditNote(v)) : data;
}
