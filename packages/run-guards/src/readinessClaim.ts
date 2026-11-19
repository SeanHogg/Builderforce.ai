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

/** A forward promise to PRODUCE the deliverable: "Next I'll write the report", "Let me now draft the summary". */
const DELIVERABLE_PROMISE =
  /\b(?:next,?\s+|now,?\s+|then,?\s+)?(?:i'll|i\s+will|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+am\s+about\s+to|i'm\s+about\s+to|let\s+me|let's)\s+(?:now\s+|next\s+|then\s+|go\s+ahead\s+and\s+)?(?:write|draft|produce|compose|prepare|put\s+together|assemble|deliver|create|implement|build)\b/;

/** A sentence that OFFERS rather than promises — the person decides ("if you'd like, I'll write the tests"). */
const OFFER = /\b(?:if\s+you|would\s+you\s+like|do\s+you\s+want|want\s+me\s+to|shall\s+i|should\s+i)\b/;

/** A reply longer than this many sentences, or {@link ANNOUNCEMENT_MAX_CHARS} of prose, IS an answer — its closing
 *  "Next, I'll implement the remaining endpoints." is a next step, not an unmade deliverable. */
const ANNOUNCEMENT_MAX_SENTENCES = 2;
const ANNOUNCEMENT_MAX_CHARS = 400;

/** A markdown list item ("- I'll create the migration in a follow-up PR"): a plan, not a sign-off. */
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;

/** Work deferred on purpose ("in a follow-up PR", "later", "in a separate ticket"). */
const DEFERRED = /\b(?:follow[- ]?up|later|afterwards|in\s+(?:a|the)\s+(?:separate|next|future|another|subsequent)\s+(?:pr|pull\s+request|ticket|issue|change|commit|task|step)|next\s+(?:pr|pull\s+request|ticket|sprint|iteration)|future\s+(?:pr|work|change))\b/;

/**
 * Does the CLOSING of a final, tool-free reply announce a deliverable it has not produced? A readiness claim
 * ({@link claimsReady}: "I have enough to write the ≤800-word alignment report.") or a forward promise ("Next I'll write
 * the report", "Let me now write it") as the reply's sign-off. VS Code chat #273 settled on exactly that sentence:
 * the {@link UnkeptClaimTracker} only counts claims followed by READS, so a claim followed by the end of the turn was
 * never caught. Only a reply that is MOSTLY the announcement counts (≤ {@link ANNOUNCEMENT_MAX_SENTENCES} sentences,
 * ≤ {@link ANNOUNCEMENT_MAX_CHARS} chars of prose): a finished report that closes on a next step is an answer. List
 * items, deferred work ("in a follow-up PR"), an offer ("if you'd like, I'll…") and a question are not promises.
 */
export function announcesDeliverable(text: string): boolean {
  if (!text || !text.trim()) return false;
  const prose = ownWords(text).toLowerCase().split(/\n+/).filter((line) => !LIST_ITEM.test(line)).join("\n").trim();
  if (!prose || prose.length > ANNOUNCEMENT_MAX_CHARS) return false;
  const sentences = prose.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > ANNOUNCEMENT_MAX_SENTENCES) return false;
  return sentences.some((sentence) => {
    if (sentence.endsWith("?") || OFFER.test(sentence) || DEFERRED.test(sentence)) return false;
    if (sentenceClaims(sentence)) return true;
    const m = DELIVERABLE_PROMISE.exec(sentence);
    return !!m && !NEGATION.test(sentence.slice(0, m.index + m[0].length));
  });
}

/** The ONE extra turn's steer for a run whose closing reply announced a deliverable it never produced. */
export const ANNOUNCED_DELIVERABLE_STEER =
  "Your last reply announced the deliverable (\"I have enough to write…\", \"Next I'll write…\") and then ended the turn without producing it. " +
  "Produce it NOW, in this reply: write the report or answer itself in full, or make the tool call that creates it. " +
  "Do not announce it again and do not describe what you are about to do.";

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
