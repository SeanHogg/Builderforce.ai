/**
 * policy/compaction — `policy/compaction/**` — the transcript fold, the reserve tokens
 * and the window fit.
 *
 * Owned by WS2a. This module replaces the no-op stub with a real port of the
 * compaction behaviour the platform already runs today:
 *
 *   • `pack.ts` ports the pure `packHandoff` transcript packer
 *     (`@seanhogg/builderforce-memory/handoff`, PRD 34 §3.3) — the leading system
 *     messages stay first, the latest user directive stays verbatim, tool-call pairing
 *     is never broken, the verbatim tail takes what the budget allows, and the dropped
 *     middle becomes ONE note (summary → recall → elision marker) whose role keeps
 *     turns alternating. It is ported here, unchanged in algorithm, so this
 *     dependency-free package needs no runtime dependency.
 *
 *   • `compact.ts` ports the cloud loop's `compactMessages`
 *     (`api/src/application/llm/compactMessages.ts`): gate on window pressure with
 *     reserve tokens, charge the advertised tool schemas against the budget, mask stale
 *     observations (C2), pin the task brief when a nudge is the latest directive,
 *     compress the middle into ONE memory note, and fall back to truncating bulky tool
 *     results in place only when packing alone cannot fit. Never drops the system
 *     prompt or the current task. The Worker `env`/tenant service concerns (C9 tier
 *     reads, the gateway summarizer, specialist capture) are the surface's wiring, not
 *     the policy, so they are not carried — the budget rule and the summary request
 *     shape ARE.
 *
 *   • `reserve.ts` ports the reserve tokens (`DEFAULT_HANDOFF_RESERVE_TOKENS` /
 *     `handoffReserveTokens` and the on-prem floor/ensure helpers).
 *
 * The hook below is the ONE export the composition in `policy/index.ts` calls:
 * `compactionHook`. It reads the run's `PolicyContext`, returns the compacted
 * `RunMessage[]` and how many rows it dropped, and reports the reserve tokens it held
 * back. It returns nothing when the transcript already fits, leaving the run alone.
 *
 * `RunPolicy.entryPoint` is a telemetry label only — this module never branches on it.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { RunMessage } from "../../contract.js";
import type { CompactionHook, CompactionResult, PolicyContext } from "../hooks.js";
import {
  CLOUD_COMPACT_DEFAULTS,
  compactMessages,
  type CompactionSummarizer,
} from "./compact.js";
import { compactReserveTokens, resolveCompactReserveTokensFloor, ensureCompactReserveTokens } from "./reserve.js";
import type { PackMessage } from "./pack.js";

/** Cost lever C2 — mask stale tool-result observations before packing. */
const MASK_OBSERVATIONS_TURNS = 6;
/** Cost lever C9 — cap the budget at the model's long-context price-tier boundary. */
const C9_TIER_LEVER = "c9_price_tier_budget";

/** A RunMessage row, widened to what the packer reads (content stays a string). */
type Row = RunMessage & Record<string, unknown>;

/** The compaction options a hook decides for a run (so adapters can override). */
export interface CompactionHookOptions {
  /** The token cost cap — the run's token budget or the cloud default. */
  maxTokens?: number;
  /** The serving model's long-context price-tier boundary, when cost lever C9 is on. */
  priceTierBoundary?: number;
  /** The summarizer for the dropped middle; absence falls back to recall / elision. */
  summarize?: CompactionSummarizer;
  /** The memory recall for the latest directive, when there is no summarizer. */
  recall?: (query: string, budgetChars: number) => Promise<string>;
  /** Keep the task brief (the FIRST user message) even when a nudge is the latest turn. */
  pinTaskBrief?: boolean;
}

/** True when the run's policy carries a cost lever by id. */
function leverOn(ctx: PolicyContext, id: string): boolean {
  return ctx.policy.levers.some((l) => String(l) === id);
}

/**
 * Decide the compaction options for this run: the serving model's window, the reserve,
 * the advertised tool schemas, the C2/C9 cost levers and the cost cap.
 */
export function compactionOptions(ctx: PolicyContext, opts: CompactionHookOptions = {}) {
  const model = ctx.policy.pinnedModel ?? "";
  const window = ctx.ports.model.window?.(model);
  // On-prem floor: never let the reserve sit below the serving model's window floor.
  const reserve = ensureCompactReserveTokens(
    compactReserveTokens(ctx.policy.budgets.tokens),
    resolveCompactReserveTokensFloor(window),
  );
  return {
    ...CLOUD_COMPACT_DEFAULTS,
    maxTokens: opts.maxTokens ?? ctx.policy.budgets.tokens ?? CLOUD_COMPACT_DEFAULTS.maxTokens,
    contextWindow: window,
    priceTierBoundary: leverOn(ctx, C9_TIER_LEVER) ? opts.priceTierBoundary : undefined,
    reserveOutputTokens: reserve,
    tools: ctx.tools as unknown,
    ...(leverOn(ctx, "c2_mask_stale_observations") ? { maskObservationsAfterTurns: MASK_OBSERVATIONS_TURNS } : {}),
    ...(opts.summarize ? { summarize: opts.summarize } : {}),
    ...(opts.recall ? { recall: opts.recall } : {}),
    pinTaskBrief: opts.pinTaskBrief ?? true,
    timeoutMs: CLOUD_COMPACT_DEFAULTS.timeoutMs,
  };
}

/** Map a RunMessage row to the packer's OpenAI shape. */
function toPackRow(m: RunMessage): PackMessage {
  const row: PackMessage = { role: m.role, content: m.content };
  if (m.toolCalls && m.toolCalls.length > 0) {
    row.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  if (m.toolCallId != null) row.tool_call_id = m.toolCallId;
  return row;
}

/** Map a packed OpenAI row back to the RunMessage row shape. */
function toRunRow(m: PackMessage | Record<string, unknown>): RunMessage {
  const src = m as PackMessage;
  const toolCalls = Array.isArray(src.tool_calls)
    ? (src.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>).map((tc) => ({
        id: tc.id ?? "",
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? "",
      }))
    : undefined;
  const out: RunMessage = {
    role: src.role as RunMessage["role"],
    content: typeof src.content === "string" ? src.content : JSON.stringify(src.content ?? ""),
  };
  if (toolCalls && toolCalls.length > 0) out.toolCalls = toolCalls;
  if (src.tool_call_id != null) out.toolCallId = src.tool_call_id;
  return out;
}

/**
 * The compaction hook, as WS2a lands it. Compacts the run's transcript when it
 * outgrows the budget, never dropping the system prompt or the current task, and
 * returns the compacted rows with what it dropped and the reserve it held back.
 * Returns nothing when the transcript already fits.
 */
export const compactionHook: CompactionHook = {
  async compact(ctx: PolicyContext): Promise<CompactionResult | void> {
    const options = compactionOptions(ctx);
    const result = await compactMessages(
      (ctx.messages as readonly Row[]).map(toPackRow) as unknown as Array<Record<string, unknown>>,
      options,
      options.summarize,
    );
    if (!result.compacted) return undefined;
    return {
      messages: result.messages.map(toRunRow),
      dropped: result.droppedMessages,
      reserveTokens: options.reserveOutputTokens,
    };
  },
};

export {
  CLOUD_COMPACT_DEFAULTS,
  compactMessages,
  compactionTokenBudget,
  elideToFit,
  maskOldObservations,
  toolsTokensOf,
  compactionSummaryRequest,
  COMPACTION_SUMMARY_SYSTEM,
} from "./compact.js";
export {
  compactReserveTokens,
  resolveCompactReserveTokensFloor,
  ensureCompactReserveTokens,
  DEFAULT_COMPACT_RESERVE_TOKENS,
  MIN_COMPACT_RESERVE_TOKENS,
} from "./reserve.js";
export { packHandoff, handoffBudget, defaultEstimateTokens } from "./pack.js";
export type { CompactionSummarizer } from "./compact.js";
export type { PackMessage, PackInput, PackResult, TokenEstimator } from "./pack.js";
