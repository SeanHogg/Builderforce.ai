/**
 * `repeated_narration` — consecutive pre-call texts saying the same thing ("Continuing the wiring …" turn after
 * turn): the model narrating its loop instead of advancing it. Overlap is |A∩B| / min(|A|,|B|) of the word sets.
 */
import { finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView, ViewTurn } from '../types';

function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function overlap(a: Set<string>, b: Set<string>): number {
  const small = a.size <= b.size ? a : b;
  const large = small === a ? b : a;
  if (small.size === 0) return 0;
  let shared = 0;
  for (const w of small) if (large.has(w)) shared += 1;
  return shared / small.size;
}

export function repeatedNarration(view: RunView): RunFinding[] {
  // Pre-call text: what a turn said before the calls it made.
  const narrated = view.turns
    .filter((t) => t.calls.length > 0 && t.text.trim())
    .map((t) => ({ t, words: wordsOf(t.text) }))
    .filter((n) => n.words.size >= RUN_FINDING_POLICY.narrationMinWords);
  const repeats = new Set<ViewTurn>();
  for (let i = 1; i < narrated.length; i++) {
    if (overlap(narrated[i - 1]!.words, narrated[i]!.words) < RUN_FINDING_POLICY.narrationOverlap) continue;
    repeats.add(narrated[i - 1]!.t);
    repeats.add(narrated[i]!.t);
  }
  if (repeats.size === 0) return [];
  const turns = [...repeats].sort((a, b) => a.index - b.index);
  return [finding('repeated_narration', 'info', { turns: turns.length },
    turns.map((t) => turnEvidence(t, 'agent.message', t.text)))];
}
