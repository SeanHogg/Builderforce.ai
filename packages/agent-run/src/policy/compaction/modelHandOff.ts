/**
 * policy/compaction/modelHandOff - the run moved onto another model (a stall failover): the context it inherits is packed for
 * THE INCOMING model's window, and the incoming model is told it took over (`./handoff`). Every real change of serving model says so, whether
 * or not a row was dropped: the packer's note when it wrote one, else one short row of our own.
 *
 * For a run whose policy names `modelHandoff` this is the ONLY compaction the agent does: its session owns ordinary folding, and a
 * provider's overflow reaches the session. The note the packer writes stays in the run's own transcript, where the incoming model reads it.
 *
 * The reply reserve is the run's ONE reserve (`replyReserve`): the same number the request's `maxTokens` is bounded by (`replyAsk`),
 * so the packed context and the reply it asks for always fit the window. The volatile tail the request carries last and the one-line note
 * are charged against the same window.
 */

import { priceTierBoundary } from "@builderforce/model-catalog";
import type { RunMessage } from "../../contract.js";
import { emit } from "../../runContext.js";
import { turnTailTokens } from "../../turnTail.js";
import type { CompactionResult, PolicyContext } from "../hooks.js";
import { C9_TIER_LEVER, taskRowIndex } from "./compact.js";
import { handoffNoteTokens, packForModelHandoff, withHandoffNote } from "./handoff.js";
import { replyReserve, servingModel } from "./reserve.js";
import { runRowHandoff } from "./rows.js";

/**
 * Hand the context to the model that now serves the run. Nothing when the run did not change models (or has not been served yet). The
 * context is packed for the incoming window when that is known, and a context that cannot fit even packed is SAID (a `model.preflight`
 * warning) instead of sent as if it did. The incoming model is always told it took over.
 */
export async function handOff(ctx: PolicyContext): Promise<CompactionResult | void> {
  const to = servingModel(ctx);
  const from = ctx.state.preparedFor;
  ctx.state.preparedFor = to || undefined;
  if (!from || !to || from === to) return undefined;
  const lead = ctx.messages.findIndex((m) => m.role !== "system");
  const split = lead < 0 ? ctx.messages.length : lead;
  const system = ctx.messages.slice(0, split);
  const access = runRowHandoff();
  const contextWindow = ctx.ports.model.window?.(to);
  // A window the model does not declare cannot be packed for, but the incoming model is still told.
  if (!contextWindow) return { messages: [...system, ...withHandoffNote(ctx.messages.slice(split), from, to, access)], dropped: 0, summarized: false };
  const reserve = replyReserve(ctx);
  // The task the run was given survives the cut, and so does everything the person steered in: a stall's note is the latest directive now,
  // so the packer's own rule would let them go. A note the agent wrote itself (a stall's nudge) is not pinned.
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
      // The request also carries its volatile tail (about what the last one did) and the note.
      extraTokens: turnTailTokens(ctx.state) + handoffNoteTokens(from, to),
      pinned: (row) => row === task || row.person === true,
      ...(ctx.policy.levers.includes(C9_TIER_LEVER) ? { priceTierBoundary: priceTierBoundary(to) } : {}),
    },
    access,
  );
  if (!packed.fits) {
    await emit(ctx.ports.events, {
      kind: "model.preflight",
      step: ctx.step,
      status: "degraded",
      notices: [`The context cannot be made to fit ${to} (${contextWindow} tokens): the system prompt and the request that must stay whole already need about ${packed.afterTokens}.`],
    });
  }
  return {
    messages: [...system, ...(packed.noted ? packed.messages : withHandoffNote(packed.messages, from, to, access))],
    dropped: packed.dropped,
    reserveTokens: reserve,
    beforeTokens: packed.beforeTokens,
    afterTokens: packed.afterTokens,
    summarized: false,
  };
}
