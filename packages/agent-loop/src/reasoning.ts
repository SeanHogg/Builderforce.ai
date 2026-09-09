/**
 * THE reasoning channel — one reading of what a model turn SAID versus what it THOUGHT.
 *
 * A turn's reasoning arrives in five shapes, and every one of them has to be told apart
 * from the answer before anything downstream can use the turn:
 *
 *   - `message.reasoning_content` — DeepSeek and most OpenAI-compatible servers (and
 *     what the direct-Anthropic normaliser emits for `thinking` blocks).
 *   - `message.reasoning` — OpenRouter's flat field.
 *   - `message.reasoning_details[]` — OpenRouter's structured field
 *     (`{ type: 'reasoning.text', text }`; encrypted/summary items are skipped).
 *   - inline tags in `message.content` — `<think>`, `<thinking>`, `<thought>`,
 *     `<antthinking>`, `<scratchpad>`, `<reasoning>` — on servers that do not split it
 *     out, WITH OR WITHOUT the closing tag.
 *   - `<final>` — the inverse convention: the answer wrapped rather than the reasoning.
 *
 * ── WHY IT IS ALL IN ONE MODULE ──────────────────────────────────────────────
 * This was written FOUR times, once per surface, and the four disagreed on the two
 * things that matter:
 *
 *   - whether an UNCLOSED block counts. The api's gateway splitter required the closing
 *     tag, so a model that never closed one had its whole scratchpad pass through as
 *     the answer, and the Brain run store stripped nothing at all. A reply — a question
 *     the run was blocked on — arrived that way and the editor's transcript ended on a
 *     muted "Thought" line with nothing readable in it.
 *   - whether a tag inside a code fence counts. Only the on-prem runner's copy checked,
 *     so a chat ABOUT reasoning tags had its own example eaten by the other three.
 *
 * The fix is not a fifth opinion, it is ONE scanner over the union of the tag
 * vocabulary with the strictly-better answer to both questions, plus the POLICIES that
 * genuinely differ named as their own functions. What varies between surfaces is what
 * to DO with a stranded thought — show it, drop it, keep the tail — never what a
 * thought IS.
 *
 * Zero dependencies and no DOM, like the rest of this package: imported by the Worker
 * (the api's gateway + Evermind learning), the browser (the Brain run store and the
 * shared transcript), Node (the on-prem runner) and the VS Code extension host.
 */

/** Reasoning-block tag names, matched case-insensitively. The union of every
 *  vocabulary the surfaces used to carry separately. */
const REASONING_TAG = "think(?:ing)?|thought|antthinking|scratchpad|reasoning";

/** Cheap pre-filter: is there anything here worth scanning? */
const QUICK_TAG_RE = new RegExp(`<\\s*/?\\s*(?:${REASONING_TAG}|final)\\b`, "i");
const FINAL_TAG_RE = /<\s*\/?\s*final\b[^<>]*>/gi;
const REASONING_TAG_RE = new RegExp(`<\\s*(/?)\\s*(?:${REASONING_TAG})\\b[^<>]*>`, "gi");

export type ReasoningTagMode = "strict" | "preserve";
export type ReasoningTagTrim = "none" | "start" | "both";

interface CodeRegion {
  start: number;
  end: number;
}

/**
 * The fenced and inline code spans of a Markdown text.
 *
 * A tag inside one is CONTENT — someone writing about reasoning tags — and stripping it
 * silently mangles the very message that explains them.
 */
function findCodeRegions(text: string): CodeRegion[] {
  const regions: CodeRegion[] = [];

  const fencedRe = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2(?:\n|$)|$)/g;
  for (const match of text.matchAll(fencedRe)) {
    const lead = match[1] ?? "";
    const start = (match.index ?? 0) + lead.length;
    regions.push({ start, end: start + match[0].length - lead.length });
  }

  const inlineRe = /`+[^`]+`+/g;
  for (const match of text.matchAll(inlineRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const insideFenced = regions.some((r) => start >= r.start && end <= r.end);
    if (!insideFenced) regions.push({ start, end });
  }

  regions.sort((a, b) => a.start - b.start);
  return regions;
}

function isInsideCode(pos: number, regions: readonly CodeRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/**
 * One contiguous run of the text, and whether it is answer or thought.
 *
 * Four spans per region, not two: `[start, contentStart)` is the opening tag and
 * `[contentEnd, end)` the closing one. A policy that REBUILDS the text (the plain-text
 * stripper, the learning exciser) needs the tag boundaries; a policy that reads the
 * text needs the content boundaries. Keeping both is what lets every policy work off
 * one scan instead of its own regex.
 */
interface ReasoningSpan {
  kind: "answer" | "thought";
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  /** A thought whose closing tag never arrived: the model was cut off, or never closed
   *  it. The single most consequential fact here. */
  unterminated: boolean;
}

/**
 * THE scan. Walks the reasoning tags that are not inside code, and returns the text as
 * contiguous answer/thought spans covering it end to end.
 *
 * A nested opener inside a thought is not a new span — the first close ends the block,
 * which is how these models actually behave. A lone closing tag outside a thought is
 * simply markup: it ends one answer span and starts the next, so the tag itself falls
 * between them and disappears from every policy's output.
 */
function scanReasoning(text: string): ReasoningSpan[] {
  const regions = findCodeRegions(text);
  const spans: ReasoningSpan[] = [];
  let kind: ReasoningSpan["kind"] = "answer";
  let start = 0;
  let contentStart = 0;

  REASONING_TAG_RE.lastIndex = 0;
  for (const match of text.matchAll(REASONING_TAG_RE)) {
    const idx = match.index ?? 0;
    if (isInsideCode(idx, regions)) continue;
    const isClose = match[1] === "/";
    if (kind === "thought" && !isClose) continue;
    const after = idx + match[0].length;
    spans.push({ kind, start, contentStart, contentEnd: idx, end: isClose ? after : idx, unterminated: false });
    kind = isClose ? "answer" : "thought";
    start = isClose ? after : idx;
    contentStart = after;
  }
  spans.push({
    kind,
    start,
    contentStart,
    contentEnd: text.length,
    end: text.length,
    unterminated: kind === "thought",
  });
  return spans;
}

export interface ReasoningSegment {
  kind: "answer" | "thought";
  content: string;
}

/**
 * Split a turn's text into answer and thought segments, tags and code fences handled.
 *
 * Empty spans are dropped and content is trimmed, so this is the shape a renderer
 * wants. Text with no tags at all comes back as one untouched answer segment — no
 * trimming, no reflow — because the overwhelmingly common case must be a pass-through.
 */
export function splitReasoningSegments(text: string): ReasoningSegment[] {
  if (!text) return [];
  if (!QUICK_TAG_RE.test(text)) return [{ kind: "answer", content: text }];
  // Scan and slice the SAME string: `<final>` removal shifts every later index, so a
  // span from the cleaned text can only be read back out of the cleaned text.
  const cleaned = unwrapFinalTags(text);
  const segments = segmentsOf(cleaned, scanReasoning(cleaned));
  if (segments.length === 0) return [{ kind: "answer", content: text }];
  return promoteSwallowedAnswer(segments);
}

/** Spans → trimmed, non-empty segments. */
function segmentsOf(text: string, spans: readonly ReasoningSpan[]): ReasoningSegment[] {
  const out: ReasoningSegment[] = [];
  for (const span of spans) {
    const content = text.slice(span.contentStart, span.contentEnd).trim();
    if (content) out.push({ kind: span.kind, content });
  }
  return out;
}

/** Remove `<final>` markup outside code, keeping the content it wrapped. */
function unwrapFinalTags(text: string): string {
  FINAL_TAG_RE.lastIndex = 0;
  if (!FINAL_TAG_RE.test(text)) {
    FINAL_TAG_RE.lastIndex = 0;
    return text;
  }
  FINAL_TAG_RE.lastIndex = 0;
  const regions = findCodeRegions(text);
  const cuts: Array<{ start: number; length: number }> = [];
  for (const match of text.matchAll(FINAL_TAG_RE)) {
    const start = match.index ?? 0;
    if (!isInsideCode(start, regions)) cuts.push({ start, length: match[0].length });
  }
  let out = text;
  for (let i = cuts.length - 1; i >= 0; i--) {
    const cut = cuts[i]!;
    out = out.slice(0, cut.start) + out.slice(cut.start + cut.length);
  }
  return out;
}

/**
 * Strip reasoning markup for DISPLAY in a plain-text surface (the on-prem runner's TUI
 * and its message tool).
 *
 * `strict` drops an unterminated block's tail; `preserve` keeps its CONTENT (without
 * the opening tag), for a stream still arriving that would otherwise show nothing at
 * all. `<final>` markup is removed but its content kept — the answer was merely
 * wrapped. Rebuilt from the original text, so spacing around a removed block is the
 * spacing the model wrote.
 */
export function stripReasoningTagsFromText(
  text: string,
  options?: { mode?: ReasoningTagMode; trim?: ReasoningTagTrim },
): string {
  if (!text) return text;
  if (!QUICK_TAG_RE.test(text)) return text;

  const mode = options?.mode ?? "strict";
  const trimMode = options?.trim ?? "both";
  const cleaned = unwrapFinalTags(text);

  let result = "";
  for (const span of scanReasoning(cleaned)) {
    if (span.kind === "answer") result += cleaned.slice(span.contentStart, span.contentEnd);
    else if (span.unterminated && mode === "preserve") result += cleaned.slice(span.contentStart, span.contentEnd);
  }
  if (trimMode === "none") return result;
  return trimMode === "start" ? result.trimStart() : result.trim();
}

/**
 * The answer a reader would have seen, for LEARNING — the turn with its reasoning
 * spans excised in place.
 *
 * Its own policy for two reasons. It must NEVER promote a stranded thought: an exemplar
 * taught to a project's Evermind has to be the answer or nothing, and adapting an SSM
 * on half-finished deliberation ("<think>The user is right - I should have: 1. Deleted
 * the branch…") is exactly how a merged model came to fail its coherence probe — the
 * newest contributions on a real project head were almost entirely think blocks,
 * several truncated mid-sentence by the 8k transport cap. And it excises IN PLACE
 * rather than re-joining trimmed pieces, so the prose keeps the shape it had instead of
 * reading as an answer full of invented paragraph breaks.
 *
 * Returns an empty string when the turn was nothing BUT reasoning, which the caller
 * must treat as "there is no answer here to learn" rather than teaching the remains.
 */
export function stripReasoningScratchpad(text: string): string {
  const source = text ?? "";
  if (!source) return "";
  if (!QUICK_TAG_RE.test(source)) return source;
  const cleaned = unwrapFinalTags(source);
  let out = "";
  for (const span of scanReasoning(cleaned)) {
    // A removed block leaves ONE space behind, so two sentences that hugged it do not
    // run together; the collapse below tidies the runs that produces.
    out += span.kind === "answer" ? cleaned.slice(span.contentStart, span.contentEnd) : " ";
  }
  return out
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Longest a leftover can be and still be judged a fragment rather than a short reply.
 * A real answer that runs past this is a reply whatever it starts with.
 */
const MAX_FRAGMENT_CHARS = 40;

/**
 * Characters a genuine reply can OPEN with: a capital, a digit, or a Markdown block
 * marker. The discriminator is deliberately the first character rather than the
 * length — "Done." is a complete answer and must never be second-guessed, while
 * "/task number?" is visibly the tail of a sentence that began somewhere else.
 */
const REPLY_OPENER = /^[A-Z0-9#*\-_>`[|("']/;

/** Is this leftover text a dangling fragment rather than a reply in its own right? */
function isFragment(text: string): boolean {
  return text.length > 0 && text.length <= MAX_FRAGMENT_CHARS && !REPLY_OPENER.test(text);
}

/**
 * Rescue a reply whose answer ended up INSIDE the thought block.
 *
 * Some models close the block in the wrong place. Observed verbatim from a real run:
 * the entire reply — "\"Fix\" is too vague — I need to know what to fix. Could you
 * specify: a file or error message? a ticket" — sat inside the think block, and the
 * only text after the closing tag was "/task number?". Rendered faithfully, the user's
 * whole answer was the words "/task number?".
 *
 * Hiding reasoning is a presentation preference; showing the user a scrap is a broken
 * turn, so the scrap loses. When the text outside the block is a FRAGMENT and a thought
 * carries a real reply, the thought is promoted and the fragment appended to it —
 * usually the tail of the same sentence, so nothing is lost and the sentence reads
 * whole again.
 *
 * A short but complete answer ("Done.") is a reply and keeps its reasoning hidden. A
 * response with NO answer segment at all is left alone here: mid-run it is a block
 * still streaming, and promoting it would show reasoning as the answer on every turn.
 * Deciding THAT one needs to know whether the run is over, which is a fact about the
 * conversation rather than the text — see `strandedReplyKey` in the shared transcript.
 */
function promoteSwallowedAnswer(segments: ReasoningSegment[]): ReasoningSegment[] {
  const answers = segments.filter((s) => s.kind === "answer");
  if (answers.length === 0) return segments;

  const answerText = answers.map((s) => s.content).join(" ").trim();
  if (!isFragment(answerText)) return segments;

  const thoughts = segments.filter((s) => s.kind === "thought");
  const richest = thoughts.reduce<ReasoningSegment | null>(
    (best, s) => (!best || s.content.length > best.content.length ? s : best),
    null,
  );
  // Nothing worth promoting: leave the fragment as the answer rather than replacing it
  // with something even thinner.
  if (!richest || richest.content.length <= answerText.length) return segments;

  const promoted: ReasoningSegment[] = [{ kind: "answer", content: `${richest.content} ${answerText}`.trim() }];
  // Any OTHER thought blocks stay thoughts — only the one carrying the reply moves.
  for (const s of thoughts) if (s !== richest) promoted.unshift(s);
  return promoted;
}

/**
 * The reply WITHOUT its reasoning — every `answer` segment joined back together.
 *
 * Empty when the turn was reasoning only: a model that thought and then called a tool
 * without saying anything to the user. The transcript uses that emptiness to decide
 * what a turn deserves — a thought-only turn is a single collapsed line with no author
 * header, no copy / send-again / rating row and no attribution chip, while copy and
 * replay on a real reply hand back the answer alone, never the scaffolding around it.
 */
export function answerTextOf(content: string): string {
  return splitReasoningSegments(content)
    .filter((s) => s.kind === "answer")
    .map((s) => s.content)
    .join("\n\n")
    .trim();
}

/**
 * The REASONING of a turn, with the scaffolding removed.
 *
 * The counterpart to {@link answerTextOf}, and the text a stranded turn is rescued
 * with: when a run ENDS on a reasoning-only message there is no answer to show, and the
 * reply — a question, a recommendation, whatever the model actually wanted from the
 * user — is in here.
 *
 * Returns '' when the turn carried no reasoning at all.
 */
export function thoughtTextOf(content: string): string {
  return splitReasoningSegments(content)
    .filter((s) => s.kind === "thought")
    .map((s) => s.content)
    .join("\n\n")
    .trim();
}

export interface ChoiceMessageLike {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
}

export interface ReasoningSplit {
  /** Visible assistant text with inline reasoning removed. */
  content: string;
  /** The model's reasoning path, '' when the turn carried none. */
  reasoning: string;
}

function detailsText(details: unknown): string {
  if (!Array.isArray(details)) return "";
  return details
    .map((d) => {
      const item = d as { type?: unknown; text?: unknown } | null;
      return item && (item.type === undefined || item.type === "reasoning.text") && typeof item.text === "string"
        ? item.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Split a vendor's assistant choice message into visible content and reasoning — the
 * ONE reader every loop uses, so the "thinking" timeline row is written identically
 * whichever model served the turn.
 *
 * The inline case goes through the shared scan, which is what makes an UNCLOSED block
 * count. The regex this replaced needed the closing tag, so a model that never emitted
 * one had its whole scratchpad pass through as the answer.
 */
export function splitVendorReasoning(message: ChoiceMessageLike | null | undefined): ReasoningSplit {
  const rawContent = typeof message?.content === "string" ? message.content : "";
  const inlineThought = thoughtTextOf(rawContent);
  const content = inlineThought ? answerTextOf(rawContent) : rawContent;
  const structured = [
    typeof message?.reasoning_content === "string" ? message.reasoning_content : "",
    typeof message?.reasoning === "string" ? message.reasoning : "",
    detailsText(message?.reasoning_details),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const reasoning = [...structured, ...(inlineThought ? [inlineThought] : [])].join("\n\n").trim();
  return { content, reasoning };
}

/**
 * The CANONICAL text for a turn that carried reasoning: one CLOSED block, then the
 * answer.
 *
 * A loop persists this rather than whatever the vendor happened to emit, so nothing
 * downstream depends on a model closing its own tag — the transcript still gets its
 * collapsible reasoning, and everything that strips reasoning gets a block it can
 * match. Idempotent on text that is already canonical.
 */
export function canonicalReasoningText(content: string, reasoning: string): string {
  const answer = (content ?? "").trim();
  const thought = (reasoning ?? "").trim();
  if (!thought) return answer;
  return answer ? `<think>${thought}</think>\n\n${answer}` : `<think>${thought}</think>`;
}
