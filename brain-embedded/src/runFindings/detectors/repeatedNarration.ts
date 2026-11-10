/**
 * `repeated_narration` — pre-call texts saying the same thing ("Continuing the wiring …" turn after turn): the
 * model narrating its loop instead of advancing it.
 *
 * The verdict is memory's B7 fold itself (`foldRepeatedNarration`, `@seanhogg/builderforce-memory/working`), run
 * over the turns' pre-call texts: a turn is a repeat exactly when the fold would replace its narration with a
 * progress note, and the narration it repeated is the one the fold kept. So the diagnostic reports what the fold
 * does — one similarity (Jaccard + containment over memory's tokenizer), never a second one here.
 */
import { foldRepeatedNarration, type TranscriptMessage } from '@seanhogg/builderforce-memory/working';
import { finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView, ViewTurn } from '../types';

/** A narrated tool-call turn as the fold sees it: an assistant message with its text and (opaque) tool calls. */
function asNarration(t: ViewTurn): TranscriptMessage {
  return { role: 'assistant', content: t.text, tool_calls: t.calls.map(() => ({})) } as TranscriptMessage;
}

/** A turn the fold judges at all: one with tool calls AND pre-call text (memory's `narrationOf` rule). */
const isCandidate = (t: ViewTurn): boolean => t.calls.length > 0 && t.text.trim().length > 0;

export function repeatedNarration(view: RunView): RunFinding[] {
  // Every turn goes to the fold; only a candidate it KEPT becomes the original a later repeat names.
  const msgs = view.turns.map(asNarration);
  const folded = foldRepeatedNarration(msgs, RUN_FINDING_POLICY.narrationOverlap);
  const repeats = new Set<ViewTurn>();
  let lastKept: ViewTurn | null = null;
  for (let i = 0; i < view.turns.length; i++) {
    const t = view.turns[i]!;
    if (!isCandidate(t)) continue;
    if (folded[i] === msgs[i]) { lastKept = t; continue; }
    if (lastKept) repeats.add(lastKept);
    repeats.add(t);
  }
  if (repeats.size === 0) return [];
  const turns = [...repeats].sort((a, b) => a.index - b.index);
  return [finding('repeated_narration', 'info', { turns: turns.length },
    turns.map((t) => turnEvidence(t, 'agent.message', t.text)))];
}
