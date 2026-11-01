/**
 * policy/compaction/handoff — a context handed from one model to another is packed for THE INCOMING model's window.
 *
 * When a run moves onto a model with a smaller window (a stall failover onto the operator's declared chain), the context it
 * inherits must fit THAT model, and the incoming model is told it took over: the shared packer (`packHandoff`) cuts the
 * middle, never splits a call from its results, pins the directive, and writes the ONE "Handed off from X to Y." note.
 *
 * The packer speaks the OpenAI message shape; this module is generic over the host's row via a small {@link HandoffAccessor}
 * (`runRowHandoff` in `./rows` is the run's own `RunMessage`), so the budget rules live in ONE place: the window, the reply reserve
 * (`maxTokens`), the tool schemas' cost, and the long-context price boundary (cost lever C9, decided by the caller). Rows come back by
 * identity; the note comes back as the host's own summary row.
 */

import { defaultEstimateTokens, handoffLine, isVolatileTail, messageTokens, packHandoff, tokensOf, type HandoffMessage } from "@seanhogg/builderforce-memory/handoff";
import { handoffReserveTokens, handoffTokenBudget, toolSchemaTokens } from "@builderforce/run-policy";

/** How a host's row maps to the packer's, and how the packer's note maps back. */
export interface HandoffAccessor<M> {
  /** The packer's view of one row (for measuring and for never splitting a call from its results). */
  toHandoff(row: M): HandoffMessage;
  /** The host's row for a hand-off note, in the role the packer chose for it (the role keeps turns alternating). */
  summary(text: string, role: HandoffMessage["role"]): M;
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
  /** The hard cap for the incoming turn's answer; sizes the reply reserve. A run passes the reserve it holds back (`replyReserve`), so the packer and the compaction never disagree. */
  maxTokens?: number;
  /** Rows that survive the cut whole even when they fall in the dropped middle (the task the run was given, what the person steered in). */
  pinned?: (row: M) => boolean;
  /** What else the incoming request costs beyond the rows and the tool schemas (the volatile tail it carries last, the hand-off note), in tokens. */
  extraTokens?: number;
}

export interface ModelHandoffResult<M> {
  messages: M[];
  /** Rows dropped from the context (0 = it already fit; `messages` is the input). */
  dropped: number;
  /** The packer wrote the note for the dropped middle (it is in `messages`). False when nothing was dropped, and when the rows that must stay whole fill the window on their own. */
  noted: boolean;
  /** False when the system prompt and the rows that must stay whole (the latest directive, a pinned row) alone exceed the window. */
  fits: boolean;
  /** What the whole context (system prompt included) cost before the cut, and after it - the packer's own estimate. */
  beforeTokens: number;
  afterTokens: number;
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
  const beforeTokens = tokensOf(all, defaultEstimateTokens);
  const reserve = handoffReserveTokens(input.maxTokens);
  const pack = await packHandoff({
    messages: all,
    targetContextTokens: packTargetTokens(input.contextWindow, input.priceTierBoundary, reserve),
    reserveOutputTokens: reserve,
    toolsTokens: toolSchemaTokens(input.tools, defaultEstimateTokens) + (input.extraTokens ?? 0),
    from: input.from,
    to: input.to,
    ...(input.pinned ? { pinned: (view: HandoffMessage) => { const row = back.get(view); return row !== undefined && input.pinned!(row); } } : {}),
  });
  if (pack.dropped === 0) return { messages: [...input.messages], dropped: 0, noted: false, fits: pack.fits, beforeTokens, afterTokens: beforeTokens };
  const messages: M[] = [];
  let noted = false;
  for (const view of pack.messages) {
    if (view === system) continue;
    const original = back.get(view);
    if (original) {
      messages.push(original);
      continue;
    }
    messages.push(access.summary(typeof view.content === "string" ? view.content : JSON.stringify(view.content), view.role));
    noted = true;
  }
  return { messages, dropped: pack.dropped, noted, fits: pack.fits, beforeTokens, afterTokens: pack.estimatedTokens };
}

/** What the one-line hand-off note costs the incoming request (0 when the model did not change). */
export function handoffNoteTokens(from: string, to: string): number {
  const line = handoffLine(from, to);
  return line ? messageTokens({ role: "user", content: line }, defaultEstimateTokens) : 0;
}

/**
 * Tell the incoming model it took over, for a hand-off in which the packer wrote no note of its own: the context fit as it was, or the
 * rows that must stay whole filled the window. ONE short row, before the latest directive and in the role that keeps turns alternating,
 * so the directive stays the last thing the person said and a later hand-off never mistakes the note for it. Rows come back by identity.
 */
export function withHandoffNote<M>(rows: readonly M[], from: string, to: string, access: HandoffAccessor<M>): M[] {
  const line = handoffLine(from, to);
  if (!line) return [...rows];
  const views = rows.map((row) => access.toHandoff(row));
  let at = -1;
  for (let i = views.length - 1; i >= 0; i -= 1) {
    if (views[i]!.role === "user" && !isVolatileTail(views[i]!)) {
      at = i;
      break;
    }
  }
  if (at < 0) return [...rows, access.summary(line, "user")];
  return [...rows.slice(0, at), access.summary(line, "assistant"), ...rows.slice(at)];
}
