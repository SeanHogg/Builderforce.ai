/**
 * Conversation compaction for the cloud agent loop.
 *
 * A multi-turn coding run pushes the assistant turn AND every tool result
 * (read_file / search_code / list_files — each a JSON blob that can be tens of KB)
 * onto `messages`, and the WHOLE history is re-sent to the model every turn. Left
 * unbounded this balloons the request (a 97K-token turn 413'd a 32K model), inflates
 * cost, and forces the biggest-window models.
 *
 * Compaction COMPRESSES the bulky MIDDLE of the conversation into a concise "memory"
 * — the same builder-memory pattern BrainService uses ("Compress the following
 * conversation into a concise memory") — via an injected summarizer (the gateway on
 * the free pool). When no summarizer is available (or it fails) it falls back to
 * lossy elision so correctness never depends on an LLM call.
 *
 * Invariants (must hold or the upstream rejects the request):
 *   • The system prompt (instructions) and the FIRST user message (the task) are
 *     always kept verbatim — the run's anchor.
 *   • The most recent `recentMessages` turns are kept verbatim — the live context.
 *   • Tool-call ↔ tool-result PAIRING is never broken: the middle is replaced by a
 *     SINGLE synthetic note placed where a `tool` message can't be orphaned (the
 *     tail never starts on a `tool` message), or messages are only CONTENT-truncated
 *     (count + roles + tool_call ids unchanged).
 *
 * Dependency-light + summarizer-injected so it is unit-testable without an LLM.
 */
import { estimateRequestTokens, ideProxy, type ProxyEnv } from './LlmProxyService';

type Msg = Record<string, unknown>;

/** Compress a chunk of conversation text into a concise memory. Returns null to
 *  signal "couldn't summarize" so the caller falls back to elision. */
export type CompactionSummarizer = (conversationText: string) => Promise<string | null>;

export interface CompactOptions {
  /** Compact only when the messages estimate exceeds this token budget. */
  maxTokens: number;
  /** Trailing messages kept verbatim (the live working context). */
  recentMessages: number;
  /** Older message `content` truncated to this many chars in the elision fallback. */
  elidedContentCap: number;
}

/** Defaults for the cloud coding loop. ~40K keeps a run comfortably inside the
 *  mid-window models (128K) with headroom, well under the 97K that 413'd, while
 *  leaving enough recent context to keep working. */
export const CLOUD_COMPACT_DEFAULTS: CompactOptions = {
  maxTokens: 40_000,
  recentMessages: 6,
  elidedContentCap: 1_000,
};

export interface CompactResult {
  messages: Msg[];
  compacted: boolean;
  /** True when the middle was compressed via the summarizer (vs lossy elision). */
  summarized: boolean;
  beforeTokens: number;
  afterTokens: number;
  /** Messages removed (middle collapsed to one memory note). */
  droppedMessages: number;
}

const elisionNote = (chars: number): string => ` …[${chars} chars elided to fit the context budget]`;

/** Truncate a message's string `content` to `cap`, preserving role / tool ids /
 *  tool_calls. Non-string content (already-structured) is left untouched. */
function elide(msg: Msg, cap: number): Msg {
  const c = msg.content;
  if (typeof c !== 'string' || c.length <= cap) return msg;
  return { ...msg, content: c.slice(0, cap) + elisionNote(c.length - cap) };
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

/** Split into the pinned head (system + task), the compressible middle, and the
 *  verbatim recent tail — with the tail guaranteed NOT to start on a `tool` message
 *  (which would orphan it once the middle is replaced). */
function partition(messages: readonly Msg[], recentMessages: number): { head: Msg[]; middle: Msg[]; tail: Msg[] } {
  const hasSystem = messages[0]?.role === 'system';
  let taskIdx = messages.findIndex((m) => m.role === 'user');
  if (taskIdx < 0) taskIdx = hasSystem ? 0 : -1;
  const pinnedCount = taskIdx + 1;
  let tailStart = Math.max(pinnedCount, messages.length - recentMessages);
  while (tailStart > pinnedCount && messages[tailStart]?.role === 'tool') tailStart--;
  return {
    head: messages.slice(0, pinnedCount),
    middle: messages.slice(pinnedCount, tailStart),
    tail: messages.slice(tailStart),
  };
}

/**
 * Compact `messages` to fit `maxTokens`, preserving the system prompt, the task,
 * the recent tail, and tool-call pairing. Returns the input unchanged
 * (compacted: false) when already within budget.
 *
 * Compression strategy, best-first:
 *   1. summarizer present → compress the middle into ONE memory note (builder memory);
 *   2. else / on failure → elide the middle's bulky content (lossy but structure-safe);
 *   3. if elision still overflows → collapse the middle to a single placeholder note.
 */
export async function compactMessages(
  messages: readonly Msg[],
  opts: CompactOptions = CLOUD_COMPACT_DEFAULTS,
  summarize?: CompactionSummarizer,
): Promise<CompactResult> {
  const beforeTokens = estimateRequestTokens(messages);
  if (messages.length === 0 || beforeTokens <= opts.maxTokens) {
    return { messages: [...messages], compacted: false, summarized: false, beforeTokens, afterTokens: beforeTokens, droppedMessages: 0 };
  }

  const { head, middle, tail } = partition(messages, opts.recentMessages);

  // 1) Builder-memory compression: summarize the middle into one concise note.
  if (summarize && middle.length > 0) {
    const summary = await summarize(renderForSummary(middle)).catch(() => null);
    if (summary && summary.trim()) {
      const note: Msg = { role: 'assistant', content: `[Compressed memory of ${middle.length} earlier step(s) — the task and recent steps are retained verbatim]\n${summary.trim()}` };
      const out = [...head, note, ...tail];
      return { messages: out, compacted: true, summarized: true, beforeTokens, afterTokens: estimateRequestTokens(out), droppedMessages: middle.length - 1 };
    }
  }

  // 2) Elision fallback (no summarizer / it failed): truncate the bulky middle.
  const elidedMiddle = middle.map((m) => elide(m, opts.elidedContentCap));
  let out = [...head, ...elidedMiddle, ...tail];
  let droppedMessages = 0;
  let afterTokens = estimateRequestTokens(out);

  // 3) Still over budget → collapse the elided middle to a single placeholder note.
  if (afterTokens > opts.maxTokens && elidedMiddle.length > 0) {
    const note: Msg = { role: 'assistant', content: `[${elidedMiddle.length} earlier message(s) omitted to fit the context budget. The recent steps and the task above are retained.]` };
    out = [...head, note, ...tail];
    droppedMessages = elidedMiddle.length - 1;
    afterTokens = estimateRequestTokens(out);
  }

  return { messages: out, compacted: true, summarized: false, beforeTokens, afterTokens, droppedMessages };
}

/**
 * Build the gateway-backed {@link CompactionSummarizer} — the live "builder memory"
 * compressor. Runs a single non-streaming completion on the FREE pool (cheap), with
 * the same intent as BrainService's chat summariser. Returns null on any failure so
 * compaction degrades to elision rather than breaking the run.
 */
export function buildGatewaySummarizer(env: ProxyEnv): CompactionSummarizer {
  return async (conversationText: string) => {
    try {
      const result = await ideProxy(env).complete({
        messages: [
          { role: 'system', content: 'You compress an in-progress coding agent transcript into a concise memory. Preserve, as terse bullet points: files read/edited and the key facts learned from them, decisions made, commands/checks run and their outcomes, and anything still TODO. Drop chatter and raw file dumps. Output ONLY the memory, no preamble.' },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 700,
        temperature: 0,
      });
      if (result.response.status >= 400) return null;
      const json = (await result.response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === 'string' && content.trim() ? content : null;
    } catch {
      return null;
    }
  };
}
