/**
 * policy/compaction — `policy/compaction/**` — the transcript fold, the reserve tokens
 * and the window fit.
 *
 * Owned by WS2a. This module replaces the no-op stub with a real port of the
 * compaction behaviour the platform already runs today:
 *
 *   • `pack.ts` BINDS the pure `packHandoff` transcript packer
 *     (`@seanhogg/builderforce-memory/handoff`, PRD 34 §3.3) — the leading system
 *     messages stay first, the latest user directive stays verbatim, tool-call pairing
 *     is never broken, the verbatim tail takes what the budget allows, and the dropped
 *     middle becomes ONE note (summary → recall → elision marker) whose role keeps
 *     turns alternating. Imported, never copied (PRD 35 §3.1).
 *
 *   • `compact.ts` ports the cloud loop's `compactMessages`
 *     (`api/src/application/llm/compactMessages.ts`): gate on window pressure with
 *     reserve tokens, charge the advertised tool schemas against the budget, mask stale
 *     observations (C2), pin the task brief when a nudge is the latest directive,
 *     compress the middle into ONE memory note, and fall back to truncating bulky tool
 *     results in place only when packing alone cannot fit. Never drops the system
 *     prompt or the current task. C9 reads `RunPolicy.levers` and the model's tier
 *     boundary (`@builderforce/model-catalog`); specialist capture is the surface's. The summarizer IS: the dropped middle is summarised through the
 *     run's own `ModelTransport` with the source's summary request
 *     (`compactionSummaryRequest`), and the recall note comes from the run's `memory`
 *     capability — both PORTS, so a surface supplies no compaction wiring at all.
 *
 *   • `reserve.ts` binds the reply reserve (`@builderforce/run-policy`
 *     `DEFAULT_HANDOFF_RESERVE_TOKENS` / `handoffReserveTokens`) and ports on-prem's
 *     reserve floor (`agent-settings.ts`, 20,000) with its ensure/resolve pair.
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

import type { CostLeverId, RunMessage } from "../../contract.js";
import type { CompactionHook, CompactionResult, PolicyContext } from "../hooks.js";
import {
  CLOUD_COMPACT_DEFAULTS,
  OBSERVATION_MASK_TURNS,
  compactMessages,
  compactionSummaryRequest,
  type CompactionSummarizer,
} from "./compact.js";
import { priceTierBoundary } from "@builderforce/model-catalog";
import { compactionReserve } from "./reserve.js";
import type { PackMessage } from "./pack.js";

/** Cost lever C2 — mask stale tool-result observations before packing. */
const C2_MASK_LEVER: CostLeverId = "c2_observation_masking";
/** Cost lever C9 — cap the budget at the model's long-context price-tier boundary. */
const C9_TIER_LEVER: CostLeverId = "c9_price_tier_budget";
/** How many recalled entries the dropped-middle note may draw on. */
const RECALL_LIMIT = 8;

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
function leverOn(ctx: PolicyContext, id: CostLeverId): boolean {
  return ctx.policy.levers.includes(id);
}

/**
 * The summarizer for the dropped middle, through the run's own model transport — the
 * source's gateway summarizer (`buildGatewaySummarizer`) with the same request
 * (`compactionSummaryRequest`). A transport that fails or answers nothing returns null,
 * and the packer falls back to recall, then the elision marker.
 */
function transportSummarizer(ctx: PolicyContext): CompactionSummarizer {
  return async (conversationText) => {
    const request = compactionSummaryRequest(conversationText);
    try {
      const completion = await ctx.ports.model.complete(
        { messages: request.messages, maxTokens: request.max_tokens },
        ctx.signal,
      );
      const text = completion.content?.trim();
      return text ? text : null;
    } catch {
      return null; // the packer's fallback chain owns a failed summary
    }
  };
}

/** The recall note for the latest directive, from the run's `memory` capability. */
function capabilityRecall(ctx: PolicyContext): ((query: string, budgetChars: number) => Promise<string>) | undefined {
  const memory = ctx.ports.capabilities.memory;
  if (!memory) return undefined;
  return async (query, budgetChars) => {
    const result = await memory.recall(query, RECALL_LIMIT);
    if (!result.ok || !result.entries?.length) return "";
    return result.entries.map((e) => `- ${e.key}: ${e.content}`).join("\n").slice(0, budgetChars);
  };
}

/**
 * Decide the compaction options for this run: the serving model's window, the reserve,
 * the advertised tool schemas, the C2/C9 cost levers and the cost cap.
 */
export function compactionOptions(ctx: PolicyContext, opts: CompactionHookOptions = {}) {
  // The model about to serve: what the model policy last settled on (a failover moves
  // it), else the pin. Its window caps the budget.
  const model = ctx.state.model?.model ?? ctx.policy.pinnedModel ?? "";
  const window = ctx.ports.model.window?.(model);
  const recall = opts.recall ?? capabilityRecall(ctx);
  // The reply reserve is the shared hand-off default (the run's token BUDGET is a cost
  // ceiling, not a reply size), raised to on-prem's reserve floor (20,000).
  const reserve = compactionReserve(undefined);
  return {
    ...CLOUD_COMPACT_DEFAULTS,
    maxTokens: opts.maxTokens ?? ctx.policy.budgets.tokens ?? CLOUD_COMPACT_DEFAULTS.maxTokens,
    contextWindow: window,
    priceTierBoundary: leverOn(ctx, C9_TIER_LEVER) ? opts.priceTierBoundary ?? priceTierBoundary(model) : undefined,
    reserveOutputTokens: reserve,
    tools: ctx.tools as unknown,
    ...(leverOn(ctx, C2_MASK_LEVER) ? { maskObservationsAfterTurns: OBSERVATION_MASK_TURNS } : {}),
    summarize: opts.summarize ?? transportSummarizer(ctx),
    ...(recall ? { recall } : {}),
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
export function createCompactionHook(hookOptions: CompactionHookOptions = {}): CompactionHook {
  return {
    async compact(ctx: PolicyContext): Promise<CompactionResult | void> {
      const options = compactionOptions(ctx, hookOptions);
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
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        summarized: result.summarized,
        ...(result.maskedObservations ? { masked: result.maskedObservations } : {}),
      };
    },
  };
}

/** The compaction hook with the run's own transport as the summarizer. A surface with its own summary model binds it with {@link createCompactionHook}. */
export const compactionHook: CompactionHook = createCompactionHook();

export {
  CLOUD_COMPACT_DEFAULTS,
  compactMessages,
  compactionBudget,
  elideToFit,
  maskOldObservations,
  toolsTokensOf,
  compactionSummaryRequest,
  COMPACTION_SUMMARY_SYSTEM,
} from "./compact.js";
export {
  compactReserveTokens,
  compactionReserve,
  ensureCompactionReserveTokens,
  resolveCompactionReserveTokensFloor,
  DEFAULT_COMPACT_RESERVE_TOKENS,
  DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR,
} from "./reserve.js";
export { packHandoff, handoffBudget, defaultEstimateTokens } from "./pack.js";
export type { CompactionSummarizer, CompactOptions } from "./compact.js";
export type { PackMessage, PackInput, PackResult, TokenEstimator } from "./pack.js";
