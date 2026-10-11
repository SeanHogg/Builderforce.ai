/**
 * Agent MID-TURN NARRATION — one reading of the play-by-play a coding agent writes
 * between tool calls ("Let me check if X is imported:", "Now I need to update the
 * hook:"), for every surface that has to tell it apart from an answer.
 *
 * Observed 2026-10-11 (project #30 Evermind diagnostics): with no teacher pinned, every
 * run's raw text self-learned straight into the head — and the IDE run text is mostly
 * this chatter. 9 of the last 24 learned memories were flagged narration-like by the
 * console, held-out loss regressed 2.72 → 3.24, and the head stayed quarantined. The
 * heuristic only ever lived in the diagnostics REPORT, so the trainer never saw it.
 *
 * Two places read it: the Evermind coordinator strips narration from a raw run text
 * before it is adapted on (and learns nothing when nothing else remains), and the
 * Evermind console flags learned memories that still read as narration.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * Prose is split into sentences; a sentence is narration when it
 *   - OPENS with an intent ("Let me…", "I'll…", "I need to…", "Now I…", "Looking at…",
 *     optionally after a filler such as "Now," / "First," / "Actually,"), or
 *   - is a LEAD-IN — ends with ":" and is not immediately followed by a code block, or
 *   - talks about the agent's own process (tool calls, `run_command`, "my last turn").
 * Everything else is kept, in order.
 *
 * ── WHAT IT IS CAREFUL NOT TO CATCH ──────────────────────────────────────────────
 *  - Code: a ``` fenced block is never judged and always kept — it is the answer.
 *  - A lead-in to code ("The fix:" right before a fence) stays with its code.
 *  - Statements of fact ("`fetch` is a browser global, so it is not exported.") pass.
 */

/** Below this many characters a text is too short to call narration either way. */
export const NARRATION_MIN_CHARS = 40;

/** Intent openers, after any run of fillers. Anchored to the sentence start. */
const NARRATION_OPENER = new RegExp(
  "^(?:(?:now|next|first|then|so|okay|ok|alright|actually|great|good|perfect|but|and|also|finally)[,!.]?\\s+)*" +
    "(?:let me|let's|i(?:'ll| will| need to| should| want to| am going to|'m going to| think| see| can see| notice| ran)\\b" +
    "|looking (?:at|back|for)\\b|checking\\b|now the\\b|that was expected\\b)",
  "i",
);

/** Self-referential process talk — narration wherever it sits in the sentence. */
const NARRATION_ANYWHERE: readonly RegExp[] = [
  /\btool calls?\b/i,
  /\brun_command\b/i,
  /\bgit_status\b/i,
  /\bmy (?:previous|last) turn\b/i,
  /\brather than (?:just )?assum/i,
];

const FENCE = /```[\s\S]*?(?:```|$)/g;

function isNarrationSentence(sentence: string, leadsIntoCode: boolean): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (NARRATION_OPENER.test(s)) return true;
  if (NARRATION_ANYWHERE.some((re) => re.test(s))) return true;
  return s.endsWith(":") && !leadsIntoCode;
}

/**
 * Split prose into sentences AND lines, keeping every separator, so what survives is
 * reassembled exactly as written (paragraphs, list items). Even indexes are pieces,
 * odd indexes the whitespace that followed them.
 */
function piecesOf(prose: string): string[] {
  return prose.split(/((?<=[.!?:])[ \t]+|\s*\n\s*)/);
}

export interface StrippedNarration {
  /** The text with every narration sentence removed (code blocks untouched). */
  text: string;
  /** How many sentences were dropped as narration. */
  dropped: number;
}

/** Remove agent narration from `text`, keeping code blocks and factual prose as written. */
export function stripRunNarration(text: string): StrippedNarration {
  let out = "";
  let dropped = 0;
  const keepProse = (prose: string, leadsIntoCode: boolean) => {
    const pieces = piecesOf(prose);
    // The last non-empty piece is the one a following code fence belongs to.
    let lastIdx = pieces.length - 1;
    while (lastIdx > 0 && !pieces[lastIdx]!.trim()) lastIdx -= 2;
    for (let i = 0; i < pieces.length; i += 2) {
      const piece = pieces[i]!;
      const sep = pieces[i + 1] ?? "";
      if (isNarrationSentence(piece, leadsIntoCode && i === lastIdx)) {
        dropped += 1;
        continue;
      }
      out += piece + sep;
    }
  };
  let last = 0;
  for (const m of text.matchAll(FENCE)) {
    keepProse(text.slice(last, m.index), true);
    out += m[0];
    last = m.index + m[0].length;
  }
  keepProse(text.slice(last), false);
  return { text: out.replace(/\n{3,}/g, "\n\n").trim(), dropped };
}

/**
 * True when `text` is MOSTLY narration — stripping it removes at least half its
 * characters. A single "Let me…" ahead of a real answer does not qualify.
 */
export function looksLikeRunNarration(text: string): boolean {
  const t = text.trim();
  if (t.length < NARRATION_MIN_CHARS) return false;
  const { text: kept, dropped } = stripRunNarration(t);
  return dropped > 0 && kept.length * 2 <= t.length;
}
