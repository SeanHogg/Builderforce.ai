/**
 * policy/compaction/compact — the cloud compaction behaviour.
 *
 * A faithful, dependency-free port of `api/src/application/llm/compactMessages.ts`
 * (PRD 35 WS2a). The cloud loop compresses a multi-turn transcript to fit a token
 * budget: an overflowing middle is packed (never dropping the system prompt, the
 * latest directive, the recent tail, or tool-call pairing), the dropped middle
 * becomes ONE note (the summarizer's memory, else the caller's recall, else an
 * elision marker — so correctness never depends on an LLM call), and bulky tool
 * results are truncated in place only when packing alone cannot fit.
 *
 * What is intentionally NOT carried over, because it is the cloud service's wiring,
 * not the policy: the gateway summarizer (`buildGatewaySummarizer`, which a consumer
 * passes as `summarize` — the hook binds the run's own `ModelTransport`), the
 * specialist eval-case capture, and the API vendor registry's catalog window (the
 * window here is `ModelTransport.window()`, passed as `contextWindow`). The budget rule
 * IS carried — {@link compactionBudget} is the source's, C9 included: the long-context
 * price-tier boundary (`@builderforce/model-catalog`) caps it while the lever is on
 * (`@builderforce/cost-levers`), exactly as the source decides it.
 *
 * The packer is `packHandoff` (`@seanhogg/builderforce-memory/handoff`, bound in
 * `./pack.js`) and the budget is `handoffTokenBudget` (`@builderforce/run-policy`) —
 * the same two pure functions the source imports, never a second copy of either.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { DEFAULT_HANDOFF_RESERVE_TOKENS, handoffTokenBudget } from '@builderforce/run-policy';
import { priceTierBoundary } from '@builderforce/model-catalog';
import { isCostLeverOn } from '@builderforce/cost-levers';
import { defaultEstimateTokens, packHandoff, tokensOf, type PackMessage } from './pack.js';

/** One transcript row, in the OpenAI-style shape the packer speaks. */
type Msg = Record<string, unknown>;

/**
 * Compress a chunk of conversation text into a concise memory. Returns null to
 * signal "couldn't summarize" so the caller falls back to recall / elision.
 */
export type CompactionSummarizer = (conversationText: string, ctx?: { tenantId?: string | number | null }) => Promise<string | null>;

export interface CompactOptions {
  /** Compact only when the messages estimate exceeds this token budget — the cost cap. */
  maxTokens: number;
  /** The model about to serve, when the caller knows it: its long-context price tier
   *  caps the budget while cost lever C9 is on for `env` / `tenantId`. */
  targetModel?: string;
  /** The serving model's context window (`ModelTransport.window()`): less
   *  `reserveOutputTokens`, it caps the budget when smaller than `maxTokens`. */
  contextWindow?: number;
  /** The lever environment C9 is read from. Absent = the caller did not opt in: no tier cap. */
  env?: unknown;
  /** The tenant the run bills to — buckets a partial C9 rollout. */
  tenantId?: string | number | null;
  /** A price-tier boundary the caller already resolved (its C9 lever on). Used when
   *  `targetModel` + `env` do not decide one. Absent = no tier cap. */
  priceTierBoundary?: number;
  /** Tokens held back for the reply when sizing to the window. */
  reserveOutputTokens?: number;
  /** Memory recall for the latest directive (an Evermind context source), at most
   *  `budgetChars` long — the note when the summarizer is absent or fails. */
  recall?: (query: string, budgetChars: number) => Promise<string>;
  /** Ceiling (ms) on each of the summarize / recall calls. */
  timeoutMs?: number;
  /** The tool schemas the request will advertise — their size is charged against the
   *  budget, so a tool-heavy request is packed tighter instead of 413ing upstream. */
  tools?: unknown;
  /** Cost lever C2: mask tool results older than this many assistant turns (the
   *  boundary advances in steps of the same size) BEFORE packing. Absent = no masking. */
  maskObservationsAfterTurns?: number;
  /** Keep the task brief (the FIRST user message) through packing even when a later
   *  nudge/steer is the latest directive. Absent = only the latest directive is kept. */
  pinTaskBrief?: boolean;
}

/** Defaults for the cloud coding loop. ~40K keeps a run comfortably inside the
 *  mid-window models (128K) with headroom, well under the 97K that 413'd, while
 *  leaving enough recent context to keep working. */
export const CLOUD_COMPACT_DEFAULTS: CompactOptions = {
  maxTokens: 40_000,
  reserveOutputTokens: DEFAULT_HANDOFF_RESERVE_TOKENS,
  timeoutMs: 30_000,
};

export interface CompactResult {
  messages: Msg[];
  compacted: boolean;
  /** True when the middle was compressed via the summarizer (vs recall / elision). */
  summarized: boolean;
  beforeTokens: number;
  afterTokens: number;
  /** Messages removed (the middle collapsed to one memory note). */
  droppedMessages: number;
  /** Tool results replaced by a one-line placeholder ({@link maskOldObservations}). */
  maskedObservations?: number;
}

/** THE estimator — gate, packer and reporting all count with it (the packer's own). */
const estimateTokens = defaultEstimateTokens;

/** Tokens the advertised tool schemas cost. */
export function toolsTokensOf(tools: unknown): number {
  if (tools == null) return 0;
  if (Array.isArray(tools) && tools.length === 0) return 0;
  return estimateTokens(JSON.stringify(tools) ?? '');
}

/** Tokens the messages cost, counted exactly as the packer counts them. */
function messagesTokens(messages: readonly Msg[]): number {
  return tokensOf(messages as unknown as readonly PackMessage[], estimateTokens);
}

const elisionNote = (chars: number): string => ` …[${chars} chars elided to fit the context budget]`;

/** Progressively tighter per-message caps for the truncation fallback. */
const ELIDE_CAPS = [4_000, 1_000, 200] as const;

/**
 * The truncation fallback: shrink string content of tool results first (largest first,
 * oldest breaking ties), then of other unpinned messages, through progressively tighter
 * caps until the messages fit `budget`. The system message(s) and the latest user
 * directive are never touched, and no message is removed, so tool-call pairing cannot
 * break. Returns the input when nothing shrank.
 */
export function elideToFit(messages: readonly Msg[], budget: number): Msg[] {
  const out = [...messages];
  let latestUser = -1;
  for (let i = out.length - 1; i >= 0; i--) if (out[i]?.role === 'user') { latestUser = i; break; }
  const candidates = (toolsOnly: boolean): number[] =>
    out
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => i !== latestUser && m.role !== 'system' && typeof m.content === 'string'
        && (toolsOnly ? m.role === 'tool' : m.role !== 'tool'))
      .sort((a, b) => (b.m.content as string).length - (a.m.content as string).length || a.i - b.i)
      .map(({ i }) => i);
  let total = messagesTokens(out);
  for (const toolsOnly of [true, false]) {
    for (const cap of ELIDE_CAPS) {
      for (const i of candidates(toolsOnly)) {
        if (total <= budget) return out;
        const msg = out[i]!;
        const content = msg.content as string;
        if (content.length <= cap) continue;
        const next = { ...msg, content: content.slice(0, cap) + elisionNote(content.length - cap) };
        total += messagesTokens([next]) - messagesTokens([msg]);
        out[i] = next;
      }
    }
  }
  return out;
}

/** Steps the observation-mask boundary advances in (cost lever C2). */
export const OBSERVATION_MASK_TURNS = 6;
const MASK_PREFIX = '[masked tool output';
/** Results smaller than this cost less to keep than to mask. */
const MIN_MASK_CHARS = 400;

/**
 * Observation masking (cost lever C2): replace the content of tool results older than
 * `turns` assistant turns with ONE line naming the tool, a short summary of its
 * arguments and the original size. The message itself stays, so tool-call pairing is
 * untouched. The boundary is quantised to whole steps of `turns`, so the transcript
 * prefix is rewritten once every `turns` turns rather than every turn — keeping the
 * cached prefix stable in between. Idempotent; returns the input array when nothing changed.
 */
export function maskOldObservations(messages: readonly Msg[], turns = OBSERVATION_MASK_TURNS): { messages: Msg[]; masked: number } {
  const assistants = messages.reduce((n, m) => n + (m.role === 'assistant' ? 1 : 0), 0);
  const boundary = Math.floor(assistants / turns) * turns - turns;
  if (turns <= 0 || boundary <= 0) return { messages: messages as Msg[], masked: 0 };
  const calls = new Map<string, { name: string; args: string }>();
  let ordinal = 0;
  let masked = 0;
  const out = messages.map((m) => {
    if (m.role === 'assistant') {
      ordinal += 1;
      for (const tc of (Array.isArray(m.tool_calls) ? m.tool_calls : []) as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) {
        if (tc.id) calls.set(tc.id, { name: tc.function?.name ?? 'tool', args: tc.function?.arguments ?? '' });
      }
      return m;
    }
    if (m.role !== 'tool' || ordinal > boundary || typeof m.content !== 'string') return m;
    const content = m.content;
    if (content.length < MIN_MASK_CHARS || content.startsWith(MASK_PREFIX)) return m;
    const call = calls.get(typeof m.tool_call_id === 'string' ? m.tool_call_id : '');
    const args = (call?.args ?? '').replace(/\s+/g, ' ').slice(0, 120);
    masked += 1;
    return { ...m, content: `${MASK_PREFIX}: ${call?.name ?? 'tool'}(${args}) — ${content.length} chars; re-run the tool to see it again]` };
  });
  return masked > 0 ? { messages: out, masked } : { messages: messages as Msg[], masked: 0 };
}

/** Render a slice of the conversation as role-tagged text for the summarizer, with
 *  per-message + total caps so the summarization call itself stays bounded. */
function renderForSummary(middle: readonly Msg[]): string {
  const PER_MSG = 1_500;
  const TOTAL = 30_000;
  const parts: string[] = [];
  let total = 0;
  for (const m of middle) {
    const role = typeof m.role === 'string' ? m.role : 'unknown';
    let body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    if (Array.isArray(m.tool_calls)) body += ` [called: ${(m.tool_calls as Array<{ function?: { name?: string } }>).map((t) => t.function?.name ?? '?').join(', ')}]`;
    const line = `${role}: ${body.slice(0, PER_MSG)}`;
    if (total + line.length > TOTAL) break;
    parts.push(line);
    total += line.length;
  }
  return parts.join('\n');
}

/**
 * The token budget: the smallest of the cost cap, the serving model's window (less the
 * reply reserve) and — while cost lever C9 is on — its long-context price-tier
 * boundary. The bound arithmetic is the shared hand-off rule (`@builderforce/run-policy`
 * `handoffTokenBudget`); nothing to bound by ⇒ the cost cap. The source's
 * `compactionBudget`, with the window taken from the run's transport.
 */
export function compactionBudget(opts: CompactOptions): number {
  const tierCap = opts.targetModel && opts.env !== undefined && isCostLeverOn(opts.env, 'c9_price_tier_budget', opts.tenantId);
  const boundary = tierCap && opts.targetModel ? priceTierBoundary(opts.targetModel) : opts.priceTierBoundary;
  return handoffTokenBudget({
    costCapTokens: opts.maxTokens,
    contextWindow: opts.contextWindow,
    reserveOutputTokens: opts.reserveOutputTokens,
    ...(boundary !== undefined ? { priceTierBoundary: boundary } : {}),
  }) ?? opts.maxTokens;
}

/**
 * Compact `messages` to fit the budget ({@link compactionBudget}), preserving the
 * system prompt, the latest directive, the recent tail and tool-call pairing. Returns
 * the input unchanged (compacted: false) when already within budget.
 */
export async function compactMessages(
  messages: readonly Msg[],
  opts: CompactOptions = CLOUD_COMPACT_DEFAULTS,
  summarize?: CompactionSummarizer,
): Promise<CompactResult> {
  const toolsTokens = toolsTokensOf(opts.tools);
  const beforeTokens = messagesTokens(messages) + toolsTokens;
  const budget = compactionBudget(opts);
  const untouched = (): CompactResult =>
    ({ messages: [...messages], compacted: false, summarized: false, beforeTokens, afterTokens: beforeTokens, droppedMessages: 0 });
  // C2: mask stale observations first; packing (and its LLM summary) is the fallback
  // only when masking alone does not fit the budget.
  const mask = opts.maskObservationsAfterTurns
    ? maskOldObservations(messages, opts.maskObservationsAfterTurns)
    : { messages: messages as Msg[], masked: 0 };
  const source = mask.messages;
  const maskedTokens = mask.masked > 0 ? messagesTokens(source) + toolsTokens : beforeTokens;
  if (source.length === 0 || maskedTokens <= budget) {
    return mask.masked > 0
      ? { messages: [...source], compacted: true, summarized: false, beforeTokens, afterTokens: maskedTokens, droppedMessages: 0, maskedObservations: mask.masked }
      : untouched();
  }
  // The task brief is the FIRST user message; after a stall nudge or steer it is no
  // longer the latest directive the packer protects, so it is pinned explicitly.
  const briefIdx = opts.pinTaskBrief ? source.findIndex((m) => m.role === 'user') : -1;
  const brief = briefIdx >= 0 ? source[briefIdx] : undefined;

  const pack = await packHandoff({
    messages: source as unknown as readonly PackMessage[],
    ...(brief ? { pinned: (_m: PackMessage, i: number) => i === briefIdx } : {}),
    targetContextTokens: budget,
    reserveOutputTokens: 0,
    toolsTokens,
    estimateTokens,
    ...(summarize
      ? {
          summarize: async (dropped: readonly PackMessage[]) => {
            const summary = await summarize(renderForSummary(dropped as unknown as Msg[]), { tenantId: opts.tenantId }).catch(() => null);
            return summary && summary.trim()
              ? `[Compressed memory of ${dropped.length} earlier step(s) — the task and recent steps are retained verbatim]\n${summary.trim()}`
              : '';
          },
        }
      : {}),
    ...(opts.recall ? { recall: opts.recall } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
  // Packing dropped nothing (or could not fit even the pinned anchors): start from the
  // original transcript and truncate bulky tool results instead of shipping it over cap.
  const packed = pack.dropped > 0 ? (pack.messages as unknown as Msg[]) : [...source];
  const messageBudget = Math.max(0, budget - toolsTokens);
  const out = !pack.fits || messagesTokens(packed) > messageBudget ? elideToFit(packed, messageBudget) : packed;
  const elided = out.some((m, i) => m !== packed[i]);
  if (pack.dropped === 0 && !elided && mask.masked === 0) return untouched();
  return {
    messages: out,
    compacted: true,
    summarized: pack.summarized && pack.dropped > 0,
    beforeTokens,
    afterTokens: messagesTokens(out) + toolsTokens,
    droppedMessages: pack.dropped,
    ...(mask.masked > 0 ? { maskedObservations: mask.masked } : {}),
  };
}

/** The summary job's system instruction — one definition for the call and its eval cases. */
export const COMPACTION_SUMMARY_SYSTEM = 'You compress an in-progress coding agent transcript into a concise memory. Preserve, as terse bullet points: files read/edited and the key facts learned from them, decisions made, commands/checks run and their outcomes, and anything still TODO. Drop chatter and raw file dumps. Output ONLY the memory, no preamble.';

/** The dropped-middle summary request shape (a host turns this into its gateway call). */
export interface CompactionSummaryRequest {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  max_tokens: number;
}

/** The dropped-middle summary request — the same shape the cloud gateway summarizer sends. */
export function compactionSummaryRequest(conversationText: string): CompactionSummaryRequest {
  return {
    messages: [
      { role: 'system', content: COMPACTION_SUMMARY_SYSTEM },
      { role: 'user', content: conversationText },
    ],
    max_tokens: 700,
  };
}
