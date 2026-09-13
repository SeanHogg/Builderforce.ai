/**
 * GROK'S REASONING, CARRIED ACROSS TOOL CALLS — the encrypted-reasoning round-trip
 * xAI's own client does.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────
 * Grok reasons before it calls a tool. With `store:false` that reasoning exists only in
 * the response that produced the call, so unless the next request sends it back, every
 * turn of a tool loop starts from a cold chain of thought. xAI's reference client
 * (grok-build: `xai-grok-sampler/src/client.rs`,
 * `xai-grok-sampling-types/src/conversation/responses.rs`) asks for
 * `include: ["reasoning.encrypted_content"]` and replays each reasoning item as a
 * top-level input sibling, in its original order, immediately before the function call
 * it led to. Without it Grok drifted out of native function calling into text dialects
 * mid-run (chats #104 and #106).
 *
 * ── WHERE IT LIVES ───────────────────────────────────────────────────────────────
 * The chat-completions shape the rest of the platform speaks has no slot for an opaque
 * reasoning item, and the gateway keeps nothing between turns, so the vendor keeps it.
 * When a turn that called tools completes, the WHOLE chain so far (every call id → the
 * reasoning that preceded that call) is saved under that turn's first call id. The next
 * request loads the record of its newest tool turn and puts each reasoning group back in
 * front of its call — one read and one write, however long the loop. Only when that turn
 * was another model's (the coder a run hands off to) does it look further back.
 *
 * The items are replayed exactly as xAI returned them. They are opaque (encrypted), and
 * re-serialising them is what cost grok-build a 400 (`patch_reasoning_text_types`).
 */

/** Every call id of the conversation so far → the reasoning items that preceded that call. */
export type ReasoningChain = Record<string, unknown[]>;

/** Where chains are kept between requests. Implemented over the platform cache. */
export interface ReasoningReplayStore {
  load(key: string): Promise<ReasoningChain | null>;
  save(key: string, chain: ReasoningChain): Promise<void>;
}

/** The `include` value that makes the Responses API return encrypted reasoning. */
export const REASONING_INCLUDE = 'reasoning.encrypted_content';

/** Calls a chain remembers reasoning for — the most recent. Each blob is opaque and can be large. */
export const MAX_REASONING_CALLS = 64;

/** A Responses output/input item, read only for the fields this module needs. */
interface ItemLike {
  type?: unknown;
  call_id?: unknown;
}

const callIdOf = (item: ItemLike): string | null =>
  item.type === 'function_call' && typeof item.call_id === 'string' && item.call_id ? item.call_id : null;

/**
 * The first call id of every assistant turn that called tools, NEWEST first — the keys
 * chains were saved under. A run starts on one model and hands the coding to another
 * (`modelRoles.ts`), so the newest tool turns are often another model's, whose calls were
 * never saved here; Grok's own last turn can sit further back.
 */
export function toolTurnCallIds(messages: ReadonlyArray<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message['role'] !== 'assistant' || !Array.isArray(message['tool_calls'])) continue;
    const first = message['tool_calls'][0] as { id?: unknown } | undefined;
    if (typeof first?.id === 'string' && first.id) ids.push(first.id);
  }
  return ids;
}

/**
 * The store key for a chain: the call id, scoped to the credential that produced it.
 * Encrypted reasoning is bound to that xAI account, and one account's chain must never
 * be replayed into another account's request.
 */
export async function reasoningReplayKey(apiKey: string, callId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey)));
  const account = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `xai-reasoning:v1:${account}:${callId}`;
}

/** Each call's reasoning in one turn's output, in order: reasoning items attach to the next call. */
export function reasoningByCall(items: ReadonlyArray<ItemLike>): ReasoningChain {
  const chain: ReasoningChain = {};
  let pending: unknown[] = [];
  for (const item of items) {
    if (item.type === 'reasoning') {
      pending.push(item);
      continue;
    }
    const callId = callIdOf(item);
    if (callId && pending.length > 0) {
      chain[callId] = pending;
      pending = [];
    }
  }
  return chain;
}

/**
 * The chain to save after a turn, and the call id to save it under — or null when the
 * turn called no tool (a reply that ends the loop is never looked up) or there is still
 * nothing to remember. The prior chain rides along, so the newest record is complete.
 */
export function nextReasoningChain(
  prior: ReasoningChain,
  items: ReadonlyArray<ItemLike>,
): { firstCallId: string; chain: ReasoningChain } | null {
  const firstCallId = items.map(callIdOf).find((id): id is string => id !== null);
  if (!firstCallId) return null;
  const merged = Object.entries({ ...prior, ...reasoningByCall(items) });
  if (merged.length === 0) return null;
  return { firstCallId, chain: Object.fromEntries(merged.slice(-MAX_REASONING_CALLS)) };
}

/**
 * The request input with every remembered reasoning group put back immediately before
 * the call it led to — the position it held in the original output.
 */
export function withReplayedReasoning(
  input: ReadonlyArray<Record<string, unknown>>,
  chain: ReasoningChain,
): Array<Record<string, unknown>> {
  return input.flatMap((item) => {
    const callId = callIdOf(item);
    const reasoning = callId ? chain[callId] : undefined;
    return reasoning ? [...(reasoning as Array<Record<string, unknown>>), item] : [item];
  });
}
