/**
 * policy/compaction/pack — the transcript packer.
 *
 * A faithful, dependency-free port of the pure `packHandoff` packer from
 * `@seanhogg/builderforce-memory/handoff` (PRD 34 §3.3). The cloud loop's
 * `compactMessages` (`api/src/application/llm/compactMessages.ts`) and the on-prem
 * stall hand-off (`agent-runtime/.../handoff-pack.ts`) both drive this same packer;
 * WS2a ports it so the compaction policy module needs no runtime dependency.
 *
 * The packing invariants are the packer's, and must hold or the upstream rejects the
 * request:
 *   • The leading run of system messages stays first; a later system message is never
 *     hoisted to the front.
 *   • The latest user directive stays verbatim (re-injected when it fell in the middle).
 *   • Tool-call ↔ tool-result pairing is never broken: an assistant `tool_calls`
 *     message and its `tool` results are kept or dropped together (a segment).
 *   • The verbatim tail takes what the budget allows, in whole segments.
 *   • The dropped middle becomes ONE note (summary → recall → elision marker) whose
 *     role keeps turns alternating.
 *
 * The estimator matches the gateway heuristic: a string content's length / 4, a
 * non-string content's JSON length / 4, plus the `tool_calls` payload's JSON length,
 * plus per-message role/framing overhead.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/** One chat message in the OpenAI-style shape every host speaks. */
export interface PackMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

/** What {@link packHandoff} packs, and the budget it packs into. */
export interface PackInput {
  messages: readonly PackMessage[];
  /** The serving model's context window, in tokens. */
  targetContextTokens: number;
  /** Tokens held back for the reply. */
  reserveOutputTokens: number;
  /** Tokens the advertised tool schemas cost. */
  toolsTokens?: number;
  /** Model refs, for the one-line hand-off note. */
  from?: string;
  to?: string;
  /** Memory block for the latest directive, at most `budgetChars` long. */
  recall?: (query: string, budgetChars: number) => Promise<string>;
  /** Summary of the dropped middle. */
  summarize?: (dropped: readonly PackMessage[]) => Promise<string>;
  /** Token estimate for a text. Default: chars/4, rounded up. */
  estimateTokens?: (text: string) => number;
  /** Ceiling (ms) on each of `summarize` / `recall`; an overlong call falls through. */
  timeoutMs?: number;
  /**
   * Messages that must survive packing verbatim even when they fall in the dropped
   * middle — e.g. the task brief (the FIRST user message). Only `user` messages and
   * `assistant` messages without `tool_calls` can be pinned; leading system messages
   * are always kept anyway. A pinned message that is dropped is re-injected right
   * after the system prefix, in original order.
   */
  pinned?: (message: PackMessage, index: number) => boolean;
}

/** The packed transcript and how it was made. */
export interface PackResult {
  messages: PackMessage[];
  /** Messages from the input that are in neither the verbatim tail nor re-injected. */
  dropped: number;
  /** The note carries the `summarize` result. */
  summarized: boolean;
  /** The note carries the `recall` result. */
  recalled: boolean;
  estimatedTokens: number;
  /** False only when the system message(s) + the latest directive alone exceed the budget. */
  fits: boolean;
}

/** A text → token-count estimator. */
export type TokenEstimator = (text: string) => number;

/** Per-message role/framing overhead, in tokens. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Default estimator — chars/4, rounded up. */
export const defaultEstimateTokens: TokenEstimator = (text) => Math.ceil(text.length / 4);

// ── Budget math ──────────────────────────────────────────────────────────────

/** The tokens a pack may use: the window less the reply reserve and the tool schemas. Never negative. */
export function handoffBudget(input: {
  targetContextTokens: number;
  reserveOutputTokens: number;
  toolsTokens?: number;
}): number {
  const budget = input.targetContextTokens - input.reserveOutputTokens - (input.toolsTokens ?? 0);
  return Math.max(0, Math.floor(budget));
}

/** A message's content as text: the string itself, else its JSON. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content ?? '') ?? '';
}

/** Does this assistant message carry tool calls? */
export function hasToolCalls(m: PackMessage): boolean {
  if (m.tool_calls == null) return false;
  return Array.isArray(m.tool_calls) ? m.tool_calls.length > 0 : true;
}

/** Estimated tokens for one message (content + tool-call payload + framing). */
export function messageTokens(m: PackMessage, estimate: TokenEstimator): number {
  let text = contentText(m.content);
  if (m.tool_calls != null) text += JSON.stringify(m.tool_calls) ?? '';
  return estimate(text) + MESSAGE_OVERHEAD_TOKENS;
}

/** Estimated tokens for a list of messages. */
export function tokensOf(msgs: readonly PackMessage[], estimate: TokenEstimator): number {
  let total = 0;
  for (const m of msgs) total += messageTokens(m, estimate);
  return total;
}

/** The longest prefix of `text` (with a trailing ellipsis when cut) whose estimate is at most `maxTokens`. */
export function fitText(text: string, maxTokens: number, estimate: TokenEstimator): string {
  if (maxTokens <= 0) return '';
  if (estimate(text) <= maxTokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimate(`${text.slice(0, mid)}…`) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '';
}

/** A char budget a `recall` callback can honour for `tokens` tokens under `estimate`. */
export function charsForTokens(tokens: number, estimate: TokenEstimator): number {
  if (tokens <= 0) return 0;
  const probe = 'x'.repeat(400);
  const perChar = Math.max(estimate(probe), 1) / probe.length;
  return Math.max(0, Math.floor(tokens / perChar));
}

// ── The volatile tail convention ─────────────────────────────────────────────

const VOLATILE_TAIL_TAG = '<run-state>';

/** True when `content` (a string or a content-part array) opens with the volatile-tail tag. */
export function isVolatileContent(content: unknown): boolean {
  if (typeof content === 'string') return content.startsWith(VOLATILE_TAIL_TAG);
  if (Array.isArray(content)) {
    const first = content[0] as { text?: unknown } | undefined;
    return typeof first?.text === 'string' && first.text.startsWith(VOLATILE_TAIL_TAG);
  }
  return false;
}

/** True for a `user` message that is a volatile tail (never the latest directive). */
export function isVolatileTail(message: Pick<PackMessage, 'role' | 'content'>): boolean {
  return message.role === 'user' && isVolatileContent(message.content);
}

// ── Segments: atomic keep-or-drop units ─────────────────────────────────────

/** A contiguous, never-split run of messages: `messages = convo.slice(start, end)`. */
interface Segment {
  start: number;
  end: number;
  tokens: number;
}

/** Split `convo` into atomic units, in order. An assistant `tool_calls` + its `tool`
 * results form ONE unit; a stray `tool` result joins the unit before it. */
export function segmentTranscript(convo: readonly PackMessage[], estimate: TokenEstimator): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < convo.length) {
    const m = convo[i]!;
    let end = i + 1;
    if (m.role === 'assistant' && hasToolCalls(m)) {
      while (end < convo.length && convo[end]!.role === 'tool') end += 1;
    }
    let tokens = 0;
    for (let k = i; k < end; k++) tokens += messageTokens(convo[k]!, estimate);
    const prev = out[out.length - 1];
    if (m.role === 'tool' && prev) {
      prev.end = end;
      prev.tokens += tokens;
    } else {
      out.push({ start: i, end, tokens });
    }
    i = end;
  }
  return out;
}

// ── The note ─────────────────────────────────────────────────────────────────

/** The hand-off line, or '' when either ref is missing or they are the same model. */
export function handoffLine(from?: string, to?: string): string {
  return from && to && from !== to ? `Handed off from ${from} to ${to}.` : '';
}

/** The marker for `n` messages that were dropped with nothing to stand in for them. */
export function elisionMarker(n: number): string {
  return `[${n} earlier messages omitted]`;
}

/** Header + body as one note text. */
export function composeNote(header: string, body: string): string {
  return header ? `${header}\n${body}` : body;
}

/** Tokens the note message costs, framing included. */
export function noteTokens(text: string, estimate: TokenEstimator): number {
  return estimate(text) + MESSAGE_OVERHEAD_TOKENS;
}

interface NoteRequest {
  header: string;
  dropped: readonly PackMessage[];
  directive: PackMessage | undefined;
  /** Tokens the note message may cost, framing included. */
  room: number;
  estimate: TokenEstimator;
  summarize?: PackInput['summarize'];
  recall?: PackInput['recall'];
  timeoutMs?: number;
}

interface NoteResult {
  text: string;
  summarized: boolean;
  recalled: boolean;
}

/** Settle `run()` to its trimmed string, or '' on throw, rejection, timeout or non-string. */
async function attempt(run: () => Promise<string>, timeoutMs?: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = Promise.resolve().then(run);
    const raced = timeoutMs && timeoutMs > 0
      ? Promise.race([work, new Promise<string>((resolve) => { timer = setTimeout(() => resolve(''), timeoutMs); })])
      : work;
    const out = await raced;
    return typeof out === 'string' ? out.trim() : '';
  } catch {
    return '';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** `body` cut so header + body fits `room`; '' when nothing of it fits. */
function fitBody(req: NoteRequest, body: string): string {
  const headerTokens = req.header ? req.estimate(`${req.header}\n`) : 0;
  let max = req.room - MESSAGE_OVERHEAD_TOKENS - headerTokens;
  for (let tries = 0; tries < 16 && max > 0; tries++, max--) {
    const fitted = fitText(body, max, req.estimate);
    if (!fitted) return '';
    if (noteTokens(composeNote(req.header, fitted), req.estimate) <= req.room) return fitted;
  }
  return '';
}

/** Build the note, or null when not even the elision marker fits `room`. */
async function buildNote(req: NoteRequest): Promise<NoteResult | null> {
  if (req.summarize) {
    const summarize = req.summarize;
    const summary = fitBody(req, await attempt(() => summarize(req.dropped), req.timeoutMs));
    if (summary) return { text: composeNote(req.header, summary), summarized: true, recalled: false };
  }

  if (req.recall && req.directive) {
    const recall = req.recall;
    const headerTokens = req.header ? req.estimate(`${req.header}\n`) : 0;
    const budgetChars = charsForTokens(req.room - MESSAGE_OVERHEAD_TOKENS - headerTokens, req.estimate);
    if (budgetChars > 0) {
      const query = contentText(req.directive.content);
      const block = fitBody(req, await attempt(() => recall(query, budgetChars), req.timeoutMs));
      if (block) return { text: composeNote(req.header, block), summarized: false, recalled: true };
    }
  }

  const marker = composeNote(req.header, elisionMarker(req.dropped.length));
  if (noteTokens(marker, req.estimate) <= req.room) return { text: marker, summarized: false, recalled: false };
  return null;
}

// ── The packer ───────────────────────────────────────────────────────────────

interface Tail {
  /** Index in the non-system transcript where the verbatim tail begins. */
  start: number;
  tokens: number;
}

/** Length of the leading run of `system` messages. */
function leadingSystemCount(all: readonly PackMessage[]): number {
  let n = 0;
  while (n < all.length && all[n]!.role === 'system') n += 1;
  return n;
}

/** The note's role: `user` before an assistant turn (or at the end), else `assistant`. */
function noteRole(next: PackMessage | undefined): 'user' | 'assistant' {
  return next === undefined || next.role === 'assistant' ? 'user' : 'assistant';
}

/** Index of the last `user` message that is a real directive (never a volatile tail), or -1. */
function latestDirectiveIndex(convo: readonly PackMessage[]): number {
  for (let i = convo.length - 1; i >= 0; i--) if (convo[i]!.role === 'user' && !isVolatileTail(convo[i]!)) return i;
  return -1;
}

/** Where the trailing run of volatile tails begins (`messages.length` when there is none). */
function trailingVolatileStart(messages: readonly PackMessage[]): number {
  let i = messages.length;
  while (i > 0 && isVolatileTail(messages[i - 1]!)) i -= 1;
  return i;
}

/** Convo indices the caller pinned (pinnable roles only), excluding the directive. */
function pinnedIndices(
  convo: readonly PackMessage[],
  prefixLen: number,
  directiveIdx: number,
  pinned: PackInput['pinned'],
): number[] {
  if (!pinned) return [];
  const out: number[] = [];
  for (let i = 0; i < convo.length; i++) {
    const m = convo[i]!;
    const pinnable = m.role === 'user' || (m.role === 'assistant' && !m.tool_calls);
    if (pinnable && i !== directiveIdx && pinned(m, prefixLen + i)) out.push(i);
  }
  return out;
}

/** Longest suffix of whole segments that fits `room`, counting the directive's cost
 * separately while it still sits before the suffix. Never leads with a `tool` result. */
function selectTail(
  convo: readonly PackMessage[],
  segs: readonly Segment[],
  directiveIdx: number,
  directiveTokens: number,
  room: number,
): Tail {
  let start = convo.length;
  let tokens = 0;
  let first = segs.length;
  for (let s = segs.length - 1; s >= 0; s--) {
    const seg = segs[s]!;
    const directiveOutside = directiveIdx >= 0 && directiveIdx < seg.start;
    if (tokens + seg.tokens + (directiveOutside ? directiveTokens : 0) > room) break;
    tokens += seg.tokens;
    start = seg.start;
    first = s;
  }
  while (first < segs.length && convo[segs[first]!.start]!.role === 'tool') {
    tokens -= segs[first]!.tokens;
    first += 1;
    start = first < segs.length ? segs[first]!.start : convo.length;
  }
  return { start, tokens };
}

function result(
  messages: PackMessage[],
  dropped: number,
  estimate: TokenEstimator,
  extra: Partial<Pick<PackResult, 'summarized' | 'recalled' | 'fits'>> = {},
): PackResult {
  return {
    messages,
    dropped,
    summarized: extra.summarized ?? false,
    recalled: extra.recalled ?? false,
    estimatedTokens: tokensOf(messages, estimate),
    fits: extra.fits ?? true,
  };
}

/** Fit `messages` into `targetContextTokens`: leading system first, the latest directive
 * verbatim, tool pairing never broken, the verbatim tail takes what fits, and the
 * dropped middle becomes ONE note. */
export async function packHandoff(input: PackInput): Promise<PackResult> {
  const estimate = input.estimateTokens ?? defaultEstimateTokens;
  const budget = handoffBudget(input);
  if (tokensOf(input.messages, estimate) <= budget) return result(input.messages.slice(), 0, estimate);

  // The volatile tail is set aside, the history packed into what is left, and the tail
  // put back LAST — never the directive, never in the middle. When the history needs the
  // whole budget, the tail is what goes.
  const cut = trailingVolatileStart(input.messages);
  const volatile = input.messages.slice(cut);
  const volatileTokens = tokensOf(volatile, estimate);
  if (volatile.length > 0) {
    const history = input.messages.slice(0, cut);
    const withTail = await packHistory({ ...input, messages: history }, budget - volatileTokens, estimate);
    if (withTail.fits) return result([...withTail.messages, ...volatile], withTail.dropped, estimate, withTail);
    return packHistory({ ...input, messages: history }, budget, estimate);
  }
  return packHistory(input, budget, estimate);
}

async function packHistory(input: PackInput, budget: number, estimate: TokenEstimator): Promise<PackResult> {
  const all = input.messages;
  if (tokensOf(all, estimate) <= budget) return result(all.slice(), 0, estimate);

  const prefixLen = leadingSystemCount(all);
  const system = all.slice(0, prefixLen);
  const convo = all.slice(prefixLen);
  const systemTokens = tokensOf(system, estimate);
  const directiveIdx = latestDirectiveIndex(convo);
  const directive = directiveIdx >= 0 ? convo[directiveIdx] : undefined;
  const directiveTokens = directive ? messageTokens(directive, estimate) : 0;
  const pins = pinnedIndices(convo, prefixLen, directiveIdx, input.pinned);
  const pinTokens = pins.reduce((sum, i) => sum + messageTokens(convo[i]!, estimate), 0);
  const coreTokens = directiveTokens + pinTokens;

  // The irreducible core does not fit: send it anyway and say so.
  if (systemTokens + coreTokens > budget) {
    const core = [...system, ...pins.map((i) => convo[i]!), ...(directive ? [directive] : [])];
    return result(core, convo.length - pins.length - (directive ? 1 : 0), estimate, { fits: false });
  }

  // Reserve room for the smallest note (the marker, at its widest count) when it fits.
  const header = handoffLine(input.from, input.to);
  const minNote = noteTokens(composeNote(header, elisionMarker(convo.length)), estimate);
  const noteFits = systemTokens + coreTokens + minNote <= budget;
  const room = budget - systemTokens - pinTokens - (noteFits ? minNote : 0);

  const tail = selectTail(convo, segmentTranscript(convo, estimate), directiveIdx, directiveTokens, room);
  const reinject = directive !== undefined && directiveIdx < tail.start;
  const pinnedBefore = pins.filter((i) => i < tail.start);
  const keptBefore = new Set(pinnedBefore);
  const droppedMsgs = convo.slice(0, tail.start).filter((_, i) => !(reinject && i === directiveIdx) && !keptBefore.has(i));

  const used = systemTokens + tail.tokens + pinTokens + (reinject ? directiveTokens : 0);
  const note = droppedMsgs.length > 0
    ? await buildNote({
        header,
        dropped: droppedMsgs,
        directive,
        room: budget - used,
        estimate,
        summarize: input.summarize,
        recall: input.recall,
        timeoutMs: input.timeoutMs,
      })
    : null;

  const after: PackMessage[] = reinject && directive ? [directive] : [];
  after.push(...convo.slice(tail.start));
  const messages: PackMessage[] = [...system, ...pinnedBefore.map((i) => convo[i]!)];
  if (note) messages.push({ role: noteRole(after[0]), content: note.text });
  messages.push(...after);
  return result(messages, droppedMsgs.length, estimate, {
    summarized: note?.summarized ?? false,
    recalled: note?.recalled ?? false,
  });
}
