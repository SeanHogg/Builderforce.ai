/**
 * policy/compaction/modelHandOff - the run moved onto another model (a stall failover): the context it inherits is packed for
 * THE INCOMING model's window, and the incoming model is told it took over (`./handoff`).
 *
 * The reply reserve is the run's ONE reserve (`replyReserve`): the same number the ordinary compaction holds back and the model
 * policy clamps the request's `maxTokens` to, so the packed context and the reply it asks for always fit the window.
 */

import { priceTierBoundary } from "@builderforce/model-catalog";
import type { CostLeverId, RunMessage } from "../../contract.js";
import { emit } from "../../runContext.js";
import type { CompactionResult, PolicyContext } from "../hooks.js";
import { packForModelHandoff } from "./handoff.js";
import { replyReserve } from "./reserve.js";
import { runRowHandoff } from "./rows.js";

/** Cost lever C9 - cap the budget at the model's long-context price-tier boundary. */
const C9_TIER_LEVER: CostLeverId = "c9_price_tier_budget";

/**
 * Pack the context for the model that now serves the run. Nothing when the run does not hand off between models, the model did not
 * change, the window is unknown, or the context already fits. A context that cannot fit even packed is SAID (a `model.preflight`
 * warning) instead of sent as if it did.
 */
export async function handOff(ctx: PolicyContext): Promise<CompactionResult | void> {
  if (!ctx.policy.modelHandoff) return undefined;
  const to = ctx.state.model?.model ?? ctx.policy.pinnedModel;
  const from = ctx.state.preparedFor;
  ctx.state.preparedFor = to;
  if (!from || !to || from === to) return undefined;
  const contextWindow = ctx.ports.model.window?.(to);
  if (!contextWindow) return undefined;
  const lead = ctx.messages.findIndex((m) => m.role !== "system");
  const split = lead < 0 ? ctx.messages.length : lead;
  const system = ctx.messages.slice(0, split);
  const reserve = replyReserve(ctx);
  // The task the run was given survives the cut: a stall's note is the latest directive now, so the packer's own rule would let it go.
  const task = ctx.messages.find((m) => m.task === true) ?? ctx.messages.find((m) => m.role === "user");
  let note = "";
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
    runRowHandoff((text) => {
      note = text;
    }),
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
    ...(note ? { note } : {}),
  };
}
