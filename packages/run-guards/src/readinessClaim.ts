/**
 * The UNKEPT READINESS CLAIM (PRD 35 WS8p): a run that says it is done gathering —
 * "Now I have everything I need", "one final check, then I write" — and then only reads.
 *
 * Every other progress window counts a NEW file as progress (`noProgress.ts`: exploring
 * IS progress), so a run that declares itself ready and then reads one more new file
 * resets them every turn. VS Code chat #6 did exactly that for hundreds of turns. What
 * that run never does is ACT on its own claim, so that is what this counts: a turn whose
 * text claims readiness and whose calls are all read-only is unkept; a turn that calls
 * anything else (an edit, a spawn, a hand-off, a question) keeps it and clears the count.
 *
 * Pure; the state is plain JSON.
 */

/** Unkept claims in a run that make a trip. One is a model thinking aloud; two is a habit. */
export const UNKEPT_READY_AT = 2;

/** Unkept claims in a run that raise the B1 advisory ({@link readinessAdvisory.ts}) —
 *  one is enough: the note arrives a full {@link UNKEPT_READY_AT} turns before the
 *  ladder's first steer. Advisory only; never trips. */
export const UNKEPT_STEER_AT = 1;

/** The model's own declaration that it has gathered enough, or is about to write. */
const READY_PATTERNS: readonly RegExp[] = [
  // "Now I have everything I need", "I've got all the context", "we now have enough"
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+(?:got\s+)?(?:everything|all\s+(?:the\s+)?(?:context|information|info|details|i\s+need|we\s+need)|enough)\b/,
  // "I've got all the component contracts", "we have all of the pieces" (run #70776)
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+all\s+(?:of\s+)?(?:the\s+)?(?:[\w/-]+\s+){0,3}(?:contracts|pieces|interfaces|signatures)\b/,
  // "Now I have the full picture", "I have a complete understanding", "I have a thorough map" (run #70776)
  /\b(?:now\s+)?(?:i|we)(?:'ve|\s+have)?\s+(?:now\s+)?(?:have\s+|got\s+)?(?:a|the)\s+(?:clear|complete|full|good|solid|whole|thorough)\s+(?:picture|understanding|view|overview|grasp|map)\b/,
  // "Analysis is over; time to build." (run #70776)
  /\b(?:analysis|investigation|exploration|research)\s+(?:is|'s)\s+(?:over|done|complete|finished)\b/,
  // "Now I understand the camera registry pattern" (run #70776) — never "I don't understand"
  /\b(?:now\s+(?:i|we)|(?:i|we)\s+now)\s+(?:fully\s+|clearly\s+)?understand\b/,
  // "Implementing now", "now implementing" (run #70776)
  /^\s*(?:(?:implementing|building|coding)(?:\s+(?:it|this|that))?\s+now|now\s+(?:implementing|building|coding))\b/,
  // "one final check, then I write", "one more file before I implement"
  /\bone\s+(?:last|final|more)\s+(?:check|look|read|thing|file)\b[^.!?\n]*\b(?:then|before)\b[^.!?\n]*\b(?:write|implement|edit|make|apply|update|change|fix|code)\b/,
  // "now I'll write", "let me now implement", "time to make the change" — never "make sure"
  /\b(?:now\s+(?:i'll|i\s+will|let\s+me|let's)|(?:i'll|i\s+will|let\s+me|let's)\s+now|time\s+to)\s+(?:write|implement|build|code|make(?!\s+(?:sure|certain))|apply|edit|update(?!\s+(?:my|our)\s+(?:understanding|notes|picture))|create|fix|start\s+(?:writing|implementing|coding|the\s+(?:edit|change|implementation)))\b/,
  /\blet\s+me\s+(?:write|make|apply)\s+the\s+(?:update|change|changes|edit|edits|fix|implementation)\s+now\b/,
];

/** Words before a claim that deny it or make it conditional ("I don't have…", "once I have…",
 *  "once the analysis is done…", "it's not time to build"). */
const NEGATION = /\b(?:don't|do\s+not|doesn't|haven't|have\s+not|isn't|is\s+not|not\s+yet|not\s+(?:time|ready)|still\s+need|need\s+(?:more|to\s+(?:read|check|look|see|find|understand))|before\s+(?:i|we)\s+have|until\s+(?:i|we)\s+have|once|unless|when\s+(?:i|we)\s+have|if\s+(?:i|we)\s+(?:have|had)|(?:if|when|after|until|before)\s+(?:the|my|our)\s+(?:\w+\s+){1,2}(?:is|are|'s))\b/;

/** Code fences, inline code, block quotes and quoted strings are someone else's words. */
function ownWords(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " ")
    .replace(/[’‘]/g, "'");
}

/** One sentence's claim: a match whose own lead-in denies nothing. A question claims nothing. */
function sentenceClaims(sentence: string): boolean {
  if (sentence.trimEnd().endsWith("?")) return false;
  return READY_PATTERNS.some((p) => {
    const m = p.exec(sentence);
    // Only the words up to the claim can deny it: "…everything I need — the parser
    // doesn't handle X" still claims.
    return !!m && !NEGATION.test(sentence.slice(0, m.index + m[0].length));
  });
}

/** Does `text` — the model's own turn — claim the run is ready to act? */
export function claimsReady(text: string): boolean {
  if (!text) return false;
  return ownWords(text).toLowerCase().split(/(?<=[.!?])\s+|\n+/).some(sentenceClaims);
}

export interface UnkeptClaimState {
  unkept: number;
}

export class UnkeptClaimTracker {
  private unkept: number;
  private claimed = false;
  private acted = false;
  private called = false;

  constructor(state?: UnkeptClaimState) {
    this.unkept = state?.unkept ?? 0;
  }

  /** The current turn's own text. */
  noteText(text: string): void {
    if (claimsReady(text)) this.claimed = true;
  }

  /** One call of the current turn. `readOnly` = it only read. */
  observe(readOnly: boolean): void {
    this.called = true;
    if (!readOnly) this.acted = true;
  }

  /** The turn's calls all ran. Returns the unkept-claim count after it. A turn with no
   *  calls is a final answer (or a narrated call, which the stall recovery owns). */
  endTurn(): number {
    if (this.acted) this.unkept = 0;
    else if (this.claimed && this.called) this.unkept += 1;
    this.claimed = false;
    this.acted = false;
    this.called = false;
    return this.unkept;
  }

  /** Start over (a trip, a steer, a human). */
  reset(): void {
    this.unkept = 0;
  }

  snapshot(): UnkeptClaimState {
    return { unkept: this.unkept };
  }
}
