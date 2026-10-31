/**
 * policy/compaction/handoff — a context handed from one model to another is packed for THE INCOMING model's window.
 *
 * When a run moves onto a model with a smaller window (a stall failover onto the operator's declared chain), the context it
 * inherits must fit THAT model, and the incoming model is told it took over: the shared packer (`packHandoff`) cuts the
 * middle, never splits a call from its results, pins the directive, and writes the ONE "Handed off from X to Y." note.
 *
 * The packer speaks the OpenAI message shape; this module is generic over the host's row via a small {@link HandoffAccessor}
 * (the agent's own `RunMessage` here, the embedded runner's `AgentMessage` in its binder), so ONE copy of the budget rules
 * serves both: the window, the reply reserve from `maxTokens`, the tool schemas' cost, and the long-context price boundary
 * (cost lever C9, decided by the caller). Rows come back by identity; the note comes back as the host's own summary row.
 */

import { defaultEstimateTokens, packHandoff, tokensOf, type HandoffMessage } from "@seanhogg/builderforce-memory/handoff";
import { handoffReserveTokens, handoffTokenBudget, toolSchemaTokens } from "@builderforce/run-policy";

/** How a host's row maps to the packer's, and how the packer's note maps back. */
export interface HandoffAccessor<M> {
  /** The packer's view of one row (for measuring and for never splitting a call from its results). */
  toHandoff(row: M): HandoffMessage;
  /** The host's row for the note the packer wrote for the dropped middle. */
  summary(text: string, tokensBefore: number): M;
}

export interface ModelHandoffInput<M> {
  messages: readonly M[];
  systemPrompt: string;
  /** The tools the incoming turn advertises (their schemas cost context). */
  tools?: ReadonlyArray<{ name: string; description?: string; parameters?: unknown }>;
  /** The models, as the host names them: the note says who handed off to whom. */
  from: string;
  to: string;
  /** The incoming model's context window, in tokens. */
  contextWindow: number;
  /** The lowest long-context price boundary of the incoming model, when cost lever C9 is on for this run. */
  priceTierBoundary?: number;
  /** The hard cap for the incoming turn's answer; sizes the reply reserve. */
  maxTokens?: number;
}

export interface ModelHandoffResult<M> {
  messages: M[];
  /** Rows dropped from the context (0 = it already fit; `messages` is the input). */
  dropped: number;
  fits: boolean;
}

/**
 * The window the packer fills: the model's context window, capped so the packed INPUT stays under the model's lowest
 * long-context price boundary (the packer takes the reply reserve back off this, so the cap is the boundary plus that reserve).
 * A flat-priced model packs to its window exactly.
 */
function packTargetTokens(contextWindow: number, boundary: number | undefined, reserve: number): number {
  const budget = handoffTokenBudget({ contextWindow, reserveOutputTokens: reserve, priceTierBoundary: boundary });
  return budget === undefined ? contextWindow : Math.min(contextWindow, budget + reserve);
}

/** Pack the run's context for the incoming model's window. */
export async function packForModelHandoff<M>(input: ModelHandoffInput<M>, access: HandoffAccessor<M>): Promise<ModelHandoffResult<M>> {
  const back = new Map<HandoffMessage, M>();
  const system: HandoffMessage = { role: "system", content: input.systemPrompt };
  const mapped = input.messages.map((row) => {
    const view = access.toHandoff(row);
    back.set(view, row);
    return view;
  });
  const all = [system, ...mapped];
  const reserve = handoffReserveTokens(input.maxTokens);
  const pack = await packHandoff({
    messages: all,
    targetContextTokens: packTargetTokens(input.contextWindow, input.priceTierBoundary, reserve),
    reserveOutputTokens: reserve,
    toolsTokens: toolSchemaTokens(input.tools, defaultEstimateTokens),
    from: input.from,
    to: input.to,
  });
  if (pack.dropped === 0) return { messages: [...input.messages], dropped: 0, fits: pack.fits };
  const messages: M[] = [];
  for (const view of pack.messages) {
    if (view === system) continue;
    const original = back.get(view);
    if (original) {
      messages.push(original);
      continue;
    }
    messages.push(access.summary(typeof view.content === "string" ? view.content : JSON.stringify(view.content), tokensOf(all, defaultEstimateTokens)));
  }
  return { messages, dropped: pack.dropped, fits: pack.fits };
}
