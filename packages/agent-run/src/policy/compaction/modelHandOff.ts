/**
 * policy/compaction/modelHandOff - the run moved onto another model (a stall failover): the context it inherits is packed for
 * THE INCOMING model's window, and the incoming model is told it took over (`./handoff`).
 *
 * For a run whose policy names `modelHandoff` this is the ONLY compaction the agent does: its session owns ordinary folding, and a
 * provider's overflow reaches the session. The note the packer writes stays in the run's own transcript, where the incoming model reads it.
 *
 * The reply reserve is the run's ONE reserve (`replyReserve`): the same number the request's `maxTokens` is bounded by (`replyAsk`),
 * so the packed context and the reply it asks for always fit the window.
 */

import { priceTierBoundary } from "@builderforce/model-catalog";
import type { RunMessage } from "../../contract.js";
import { emit } from "../../runContext.js";
import type { CompactionResult, PolicyContext } from "../hooks.js";
import { C9_TIER_LEVER, taskRowIndex } from "./compact.js";
import { packForModelHandoff } from "./handoff.js";
import { replyReserve, servingModel } from "./reserve.js";
import { runRowHandoff } from "./rows.js";

/**
 * Pack the context for the model that now serves the run. Nothing when the run does not hand off between models, the model did not
 * change, the window is unknown, or the context already fits. A context that cannot fit even packed is SAID (a `model.preflight`
 * warning) instead of sent as if it did.
 */
export async function handOff(ctx: PolicyContext): Promise<CompactionResult | void> {
  if (!ctx.policy.modelHandoff) return undefined;
  const to = servingModel(ctx);
  const from = ctx.state.preparedFor;
  ctx.state.preparedFor = to || undefined;
  if (!from || !to || from === to) return undefined;
  const contextWindow = ctx.ports.model.window?.(to);
  if (!contextWindow) return undefined;
  const lead = ctx.messages.findIndex((m) => m.role !== "system");
  const split = lead < 0 ? ctx.messages.length : lead;
  const system = ctx.messages.slice(0, split);
  const reserve = replyReserve(ctx);
  // The task the run was given survives the cut: a stall's note is the latest directive now, so the packer's own rule would let it go.
  const task = ctx.messages[taskRowIndex(ctx.messages)];
  const packed = await packForModelHandoff<RunMessage>(
    {
      messages: ctx.messages.slice(split),
      systemPrompt: system.map((m) => m.content).join("\n\n"),
      tools: ctx.tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
      from,
      to,
      contextWindow,
      maxTokens: reserve,
      ...(task ? { pinned: (row) => row === task } : {}),
      ...(ctx.policy.levers.includes(C9_TIER_LEVER) ? { priceTierBoundary: priceTierBoundary(to) } : {}),
    },
    runRowHandoff(),
  );
  if (!packed.fits) {
    await emit(ctx.ports.events, {
      kind: "model.preflight",
      step: ctx.step,
      status: "degraded",
      notices: [`The context cannot be made to fit ${to} (${contextWindow} tokens): the system prompt and the request that must stay whole already need about ${packed.afterTokens}.`],
    });
  }
  if (packed.dropped === 0) return undefined;
  return {
    messages: [...system, ...packed.messages],
    dropped: packed.dropped,
    reserveTokens: reserve,
    beforeTokens: packed.beforeTokens,
    afterTokens: packed.afterTokens,
    summarized: false,
  };
}
