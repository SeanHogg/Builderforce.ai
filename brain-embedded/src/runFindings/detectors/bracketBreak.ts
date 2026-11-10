/**
 * `bracket_break` — a write whose new text changes `{}` / `()` / `[]` balance against the text it replaced
 * (`bracketDelta`, strings and comments ignored). Chat #70776's `labels.ts` edit closed an object early and the
 * call still reported success. One finding per offending edit.
 */
import { bracketDelta, changesBalance, type BracketDelta } from '@builderforce/agent-tools';
import { callEvidence, finding } from '../findingParts';
import type { RunFinding, RunView, ViewCall } from '../types';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `curly -1 · paren +1` — only the kinds that moved. */
function describeDelta(d: BracketDelta): string {
  return (['curly', 'paren', 'square'] as const)
    .filter((k) => d[k] !== 0)
    .map((k) => `${k} ${d[k] > 0 ? '+' : ''}${d[k]}`)
    .join(' · ');
}

/** Each (path, before, after) a write applied: one per `edits[]` entry, the single edit, or a whole-file write. */
function replacements(c: ViewCall): Array<{ path: string; before: string; after: string }> {
  const pathOf = (a: Record<string, unknown>): string => str(a.path ?? a.file_path ?? a.filePath);
  if (Array.isArray(c.args.edits)) {
    return c.args.edits.map((e) => {
      const a = (e ?? {}) as Record<string, unknown>;
      return { path: pathOf(a), before: str(a.old_string), after: str(a.new_string) };
    });
  }
  if ('new_string' in c.args) return [{ path: pathOf(c.args), before: str(c.args.old_string), after: str(c.args.new_string) }];
  if ('content' in c.args) return [{ path: pathOf(c.args), before: '', after: str(c.args.content) }];
  return [];
}

export function bracketBreak(view: RunView): RunFinding[] {
  const out: RunFinding[] = [];
  for (const c of view.calls) {
    if (!c.write) continue;
    for (const r of replacements(c)) {
      const delta = bracketDelta(r.before, r.after, r.path);
      if (!changesBalance(delta)) continue;
      out.push(finding('bracket_break', 'error', { path: r.path, delta: describeDelta(delta) },
        [callEvidence(c, r.path, r.after)]));
    }
  }
  return out;
}
