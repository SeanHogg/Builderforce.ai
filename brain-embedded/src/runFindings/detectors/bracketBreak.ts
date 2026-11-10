/**
 * `bracket_break` — an edit whose new text changes `{}` / `()` / `[]` balance against the text it replaced
 * (`bracketDelta`, strings, comments, regex literals and JSX text ignored). Chat #70776's `labels.ts` edit closed
 * an object early and the call still reported success. One finding per offending replacement.
 *
 * Only replacements are checked: a whole-file `write_file` carries no `before`, and a whole file's absolute balance
 * says nothing the lexer can be trusted with, so it is never flagged here.
 */
import { bracketDelta, changesBalance, describeBracketDelta, editedFilesOf } from '@builderforce/agent-tools';
import { callEvidence, finding } from '../findingParts';
import type { RunFinding, RunView } from '../types';

export function bracketBreak(view: RunView): RunFinding[] {
  const out: RunFinding[] = [];
  for (const c of view.calls) {
    if (!c.write) continue;
    for (const r of editedFilesOf(c.name, c.args)) {
      if (r.before === undefined || r.after === undefined) continue;
      const delta = bracketDelta(r.before, r.after, r.path);
      if (!changesBalance(delta)) continue;
      out.push(finding('bracket_break', 'error', { path: r.path, delta: describeBracketDelta(delta) },
        [callEvidence(c, r.path, r.after)]));
    }
  }
  return out;
}
