/**
 * A model STUCK REPEATING ITSELF — one reading, for every surface.
 *
 * Observed 2026-09-13 (chat #105, `direct/qwen/qwen3.8-max`): after "continue and build
 * it" the model wrote one sentence — "I'll start by checking this chat's linked tickets
 * and locating the Room bubble plus Brain Chat scroll code." — back to back until the
 * output ceiling, and nothing but the user's Stop could end it. The decoder had fallen
 * into a loop; every further token was the same block again.
 *
 * The gateway's coherence gate (`api/…/textCoherence.ts`) only sees ADJACENT word and
 * bigram repeats ("in the in the"), which is how an under-trained head degrades — a
 * frontier model degrades a whole sentence at a time, which that check never fires on.
 *
 * Two places read it: the Brain's stream client cuts a live stream the moment it is seen
 * (and routes the turn to another model), and the loop kernel trims any turn that
 * arrives already looped — the non-streaming server surfaces, the cloud engine and the
 * addressed-agent reply — to what it said before the loop.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * The TAIL of the text is the same block, verbatim, {@link LOOP_MIN_COPIES} times in a
 * row, where the block is at least {@link LOOP_MIN_BLOCK_CHARS} long and reads as prose
 * (several words with letters in them) — or, for a paragraph-length block of at least
 * {@link LOOP_LONG_BLOCK_CHARS}, twice in a row. Checked on the tail only, so it costs a
 * handful of character compares per call, and matches wherever in the block the text stops.
 *
 * ── WHAT IT IS CAREFUL NOT TO CATCH ──────────────────────────────────────────────
 *  - Short repeats ("ok ok ok", a row of `─`): below the block minimum, or not prose.
 *  - Code: text inside an open ``` fence is never judged — three identical lines of
 *    boilerplate are a legitimate answer.
 *  - Near-repeats: a list of similar-but-different items is not periodic, so it passes.
 *
 * ── A RUNAWAY COUNT ──────────────────────────────────────────────────────────────
 * Observed 2026-09-13 (chat #106, `xai-oauth/grok-4.6`): after writing its tool calls as
 * text, the decoder counted `0 1 2 3 … 593` until Stop. Every number differs, so no block
 * repeats and the periodic rule above can never fire. A tail of {@link COUNT_MIN_RUN}
 * integers, each one more than the last, is that failure; `kept` is everything before the
 * count, `block` the count itself and `copies` how many numbers it ran to.
 */

import type { RepetitionLoop } from "./types.js";

/** Consecutive integers, each one more than the last, before a tail counts as a runaway count. */
const COUNT_MIN_RUN = 50;
/** Longest number a counting run is read over. */
const COUNT_MAX_DIGITS = 6;

const isDigit = (code: number): boolean => code >= 48 && code <= 57;
/** Space, tab, newline, carriage return, comma — what separates the numbers of a count. */
const isCountSeparator = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13 || code === 44;

/** The counting run the text ends in, or null. Reads backwards and stops at the first break. */
function tailCountingRun(text: string): RepetitionLoop | null {
  let pos = text.length;
  let expected: number | null = null;
  let count = 0;
  let start = pos;
  for (;;) {
    let end = pos;
    while (end > 0 && isCountSeparator(text.charCodeAt(end - 1))) end -= 1;
    let begin = end;
    while (begin > 0 && end - begin <= COUNT_MAX_DIGITS && isDigit(text.charCodeAt(begin - 1))) begin -= 1;
    if (begin === end || end - begin > COUNT_MAX_DIGITS) break;
    // A number glued to a word ("v12") is not part of a count.
    if (begin > 0 && !isCountSeparator(text.charCodeAt(begin - 1))) break;
    const value = Number(text.slice(begin, end));
    if (expected !== null && value !== expected) break;
    count += 1;
    start = begin;
    pos = begin;
    expected = value - 1;
  }
  if (count < COUNT_MIN_RUN) return null;
  return { block: text.slice(start).trim(), copies: count, kept: text.slice(0, start).trimEnd() };
}

/** Consecutive verbatim copies of a block before the text counts as looping. */
const LOOP_MIN_COPIES = 3;
/** Shortest block that can count — a sentence, not a word or a divider. */
const LOOP_MIN_BLOCK_CHARS = 40;
/**
 * A block at least this long loops on its SECOND verbatim copy. A sentence said twice
 * can be emphasis; a whole paragraph written out again, character for character and
 * back to back, never is. Observed 2026-09-13 (chat #106, MiniMax): the model replayed
 * its own ~1,300-char run of narration — a dozen DIFFERENT sentences — over and over, so
 * no single sentence repeated and the old 800-char / three-copy rule could never fire.
 */
const LOOP_LONG_BLOCK_CHARS = 240;
/** Copies a {@link LOOP_LONG_BLOCK_CHARS} block needs. */
const LOOP_LONG_MIN_COPIES = 2;
/** Longest block looked for — a replayed paragraph of narration, not a whole answer. */
const LOOP_MAX_BLOCK_CHARS = 4000;

/** Copies a block of `chars` needs, back to back, before it reads as a loop. */
const minCopiesFor = (chars: number): number => (chars >= LOOP_LONG_BLOCK_CHARS ? LOOP_LONG_MIN_COPIES : LOOP_MIN_COPIES);
/** Words (with at least one letter) a block needs before it reads as prose. */
const LOOP_MIN_BLOCK_WORDS = 5;

/** Inside an unclosed ``` fence — code, which is allowed to repeat itself. */
function inOpenCodeFence(text: string): boolean {
  let fences = 0;
  for (let i = text.indexOf("```"); i !== -1; i = text.indexOf("```", i + 3)) fences += 1;
  return fences % 2 === 1;
}

function readsAsProse(block: string): boolean {
  let words = 0;
  for (const word of block.split(/\s+/)) {
    if (/\p{L}/u.test(word)) words += 1;
    if (words >= LOOP_MIN_BLOCK_WORDS) return true;
  }
  return false;
}

/** True when the last `span` characters of `text` repeat with period `p`. */
function tailHasPeriod(text: string, p: number, span: number): boolean {
  const end = text.length;
  for (let i = end - 1; i >= end - span + p; i -= 1) {
    if (text.charCodeAt(i) !== text.charCodeAt(i - p)) return false;
  }
  return true;
}

/**
 * The loop the text is ending in, or null. Pure; safe to call on every streamed delta.
 * The shortest qualifying block wins, so a loop of a two-sentence block is reported as
 * that block, not as a multiple of it.
 */
export function detectRepetitionLoop(text: string): RepetitionLoop | null {
  const counting = tailCountingRun(text);
  if (counting) return inOpenCodeFence(text) ? null : counting;
  const length = text.length;
  if (length < LOOP_MIN_COPIES * LOOP_MIN_BLOCK_CHARS) return null;
  const maxBlock = Math.min(LOOP_MAX_BLOCK_CHARS, Math.floor(length / LOOP_LONG_MIN_COPIES));
  for (let p = LOOP_MIN_BLOCK_CHARS; p <= maxBlock; p += 1) {
    const copies = minCopiesFor(p);
    if (copies * p > length || !tailHasPeriod(text, p, copies * p)) continue;
    // Walk back to where the loop began, so `kept` drops every copy but the first and
    // `block` is that first copy as written, not a rotation of it cut mid-sentence.
    let start = length - copies * p;
    while (start > 0 && text.charCodeAt(start - 1) === text.charCodeAt(start - 1 + p)) start -= 1;
    const block = text.slice(start, start + p);
    if (!readsAsProse(block)) continue;
    // Checked last: it scans the whole text, and almost every call has no loop to excuse.
    if (inOpenCodeFence(text)) return null;
    return { block, copies: Math.floor((length - start) / p), kept: text.slice(0, start + p) };
  }
  return null;
}

/** The text with a trailing loop cut back to its first copy; unchanged when there is none. */
export function trimRepetitionLoop(text: string): string {
  return detectRepetitionLoop(text)?.kept ?? text;
}
