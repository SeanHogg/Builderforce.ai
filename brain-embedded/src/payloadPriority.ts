/**
 * What a copied triage report must KEEP when its size budget runs short. (A command's
 * output is printed once because `toolStepView` emits only the result fields its terminal
 * panel does not show — no envelope stripping is needed here.)
 *
 * The budget used to spend first-come-first-served, so a run's early reads ate the pool
 * and the payloads a triager actually needs — the mutating commands, the write/edit
 * arguments, the commit/diff output, the errors — came out as "…(N chars omitted — the
 * report hit its size budget)". Those are classified HIGH here and the budget holds a
 * reserve for them (`transcriptBudget.ts`).
 *
 * Classification is STRUCTURAL over the payload (and its block label), so the budget can
 * apply it without the renderer passing anything; a renderer that knows the tool may still
 * pass an explicit priority.
 */

export type PayloadPriority = 'high' | 'normal';

/** A shell command line that changes something: git writes, file moves/deletes, installs, in-place edits, redirects. */
const MUTATING_COMMAND = new RegExp(
  [
    String.raw`\bgit\s+(?:commit|push|apply|merge|rebase|cherry-pick|am|reset|checkout|switch|add|rm|mv|tag|stash|restore)\b`,
    String.raw`(?:^|[\s;&|$])(?:rm|mv|cp|mkdir|touch|tee|patch|chmod|ln)\s`,
    String.raw`\bsed\s+-i\b`,
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|uninstall|version|publish)\b`,
    String.raw`[^\d&]>>?\s*(?!&|\s*/dev/null)[\w./~"'-]`,
  ].join('|'),
);

/** The arguments of a write/edit call carry the change itself. */
const CHANGE_ARGS = /"(?:old_string|new_string|content|patch|diff|edits|replacement)"\s*:/;
/** Unified-diff output (git diff, git show, a patch). */
const DIFF_OUTPUT = /^diff --git |^@@ -\d+(?:,\d+)? \+\d+/m;
/** A result that reports a failure. */
const ERROR_RESULT = /"ok"\s*:\s*false|"isError"\s*:\s*true|"error"\s*:\s*"[^"]/;
/** `Output (exit N)` with N ≠ 0 — the renderer's label for a failed command. */
const FAILED_EXIT_LABEL = /\(exit (?!0\))/;
/** A commit/push result (hash + branch, or a ref update line). */
const SHIP_OUTPUT = /^\[[\w./-]+ [0-9a-f]{7,}\]|^\s*[0-9a-f]{7,}\.\.[0-9a-f]{7,}\s+\S+\s+->\s+\S+/m;

/**
 * Rank one payload: mutations, diffs, ship output and errors are HIGH; reads and
 * everything else NORMAL.
 */
export function payloadPriority(label: string, payload: string): PayloadPriority {
  if (FAILED_EXIT_LABEL.test(label)) return 'high';
  if (/^command$/i.test(label.trim()) && MUTATING_COMMAND.test(payload)) return 'high';
  if (CHANGE_ARGS.test(payload) || DIFF_OUTPUT.test(payload) || SHIP_OUTPUT.test(payload) || ERROR_RESULT.test(payload)) return 'high';
  return 'normal';
}
