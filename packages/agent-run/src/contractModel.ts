/**
 * contractModel - the model half of the run contract: the transcript row, what the agent asks of a model, what comes back, and
 * the transport that answers. Split out of `contract.ts` (PRD 35 §5 rule 4); `contract.ts` re-exports every name, so no import changes.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { ModelFallbackSurface } from "@builderforce/agent-stall";
import type { TurnInterruption } from "./surface.js";

/** One row of the run's transcript, in the agent's own shape. */
export interface RunMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** The tool calls the assistant asked for, in the kernel's raw form. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** The call this row answers. */
  toolCallId?: string;
  /** This row carries the TASK the run was given: compaction pins it, whatever else the transcript holds before it (a prior conversation). Absent ⇒ the first user row. */
  task?: true;
  /**
   * The PERSON wrote this row (a message they steered in, a follow-up they queued): a model hand-off keeps it whole, as it keeps the task.
   * A note the agent wrote itself (a stall's nudge) does not carry it.
   */
  person?: true;
  /**
   * The row's non-text content (a picture the person attached), beside `content`, which stays the row's TEXT. The transport
   * puts the parts on the wire; token counting reads `content` alone, as it always has, so a picture costs what the
   * existing estimates say it does.
   */
  parts?: RunPart[];
  /**
   * Message-level fields the surface's own transcript needs back (a provider, the usage the model reported, a stop reason, a
   * timestamp). Opaque to the agent: it carries them from the completion or tool result to the row and never reads them.
   */
  meta?: Readonly<Record<string, unknown>>;
  /**
   * This row is the surface's own context, not the person's words (a bash execution, a branch or compaction summary, an extension's
   * message): the role says `user` because that is how the model reads it, but it is never the task or the latest directive.
   */
  custom?: true;
  /** This tool row is a FAILED call's answer (a refusal, a thrown tool, a skipped call). */
  isError?: true;
}

/**
 * One part of a row, beside its `content` text. Plain data, so a saved transcript round-trips as JSON.
 *
 * `image` is a picture the person attached (a URL or a data URL). The other kinds are a transport's NATIVE blocks, kept so a
 * row the model wrote or a tool returned reads back exactly as it was written: a signed thinking block and a tool call with
 * its signature are not text, and a provider that continues a conversation needs them back unchanged. The agent never reads
 * the native kinds; it carries them.
 */
export type RunPart =
  | { type: 'image'; url: string }
  | { type: 'text'; text: string; signature?: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown>; signature?: string };

/** What the agent asks the model for. The transport translates it to its own wire shape. */
export interface ModelRequest {
  /** The transcript so far. */
  messages: RunMessage[];
  /** The model the policy pinned, when it pinned one. */
  model?: string;
  /** The tools the surface can run, as the model sees them. */
  tools?: ToolSchema[];
  /** The hard cap for this turn's answer. */
  maxTokens?: number;
  /** The role the model policy asked this turn as (additive; a transport that routes by role reads it). */
  role?: string;
  /** The run phase (`plan` | `code` | `verify`) the turn is asked in (additive; usage rows are stamped with it). */
  phase?: string;
  /** A forced `tool_choice` for this one request (additive). */
  toolChoice?: "auto" | "required";
  /** The model is a hard pin: dispatch ONLY it, no silent swap (additive). */
  strict?: boolean;
  /** Models this turn must not be routed to — the ones the policy already tried and broke (additive). */
  excludeModels?: readonly string[];
  /** Reasoning levers the guards raised for this turn (D1's escalation), merged over the surface's own. */
  reasoning?: { thinkLevel?: string };
}

/** A tool call as the model asked for it: the arguments are the RAW JSON string. */
export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** What the model spent on the turn. */
export interface ModelUsage {
  costMc?: number;                 // millicents the gateway billed, when the transport reports it — §8.2 cost
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /**
   * What the turn is WORTH at the surface's own price book, in millicents (additive). Distinct from `costMc`, which is what the gateway BILLED:
   * a surface that bills nothing per call but prices its spend (the editor's run cap) reports it here, and only the run's USD cap reads it.
   * Absent ⇒ the turn has no known price.
   */
  pricedMc?: number;
}

/** What the model answered. */
export interface ModelCompletion {
  content: string;
  toolCalls?: ModelToolCall[];
  usage?: ModelUsage;
  model?: string;
  /** Set when the turn was cut off (the output ceiling, an unparseable call) rather than finished. The transport reads its own vendor's finish reason. */
  interrupted?: TurnInterruption;
  /** The answer's native blocks (thinking, signed text, tool calls with signatures), kept on the row it becomes. */
  parts?: RunPart[];
  /** The answer's message-level fields, kept on the row it becomes (`RunMessage.meta`). */
  meta?: Readonly<Record<string, unknown>>;
}

/** Where the model runs. The ONE thing an entry point supplies about the model. */
export interface ModelTransport {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion>;
  /**
   * The model's context window, when the transport knows it. The tools policy sizes
   * its result cap from it (§6.10); `undefined` ⇒ the fixed caps of today.
   */
  window?(model: string): number | undefined;
  /**
   * The compaction summarizer's call. A surface whose `complete` is visible to a person
   * (a streamed answer, a provenance row, a failure ledger) answers this one WITHOUT those
   * side effects: a summary is not a turn. Absent ⇒ the policy uses `complete`.
   */
  summarize?(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion>;
  /**
   * The BYO preflight (§6.10): before turn 1, which connected accounts the run's model
   * would need cannot be used. The transport refreshes an `expired` token once itself and
   * reports only what is STILL unresolved. Absent ⇒ the preflight reads `ok`.
   */
  preflight?(model: string | undefined): Promise<ModelPreflightResult | undefined> | ModelPreflightResult | undefined;
  /**
   * The models a stalled run may fail over ONTO, in the shared preference order — the tenant's
   * own connected flagships and the plan's curated coding pool. Absent ⇒ the stall policy's
   * default (never the model that just failed).
   */
  fallbackSurface?(): ModelFallbackSurface | null;
  /**
   * The model a stalled run fails over ONTO, chosen by the host from what it already tried (additive). For a host whose successor is
   * decided by a function of the models burned so far (an operator's declared chain) rather than by a surface to rank. `tried` holds
   * every model asked this run, the pin included, in the names the transport answers to. Wins over {@link fallbackSurface}.
   */
  pickFallback?(tried: readonly string[]): string | undefined;
}

/**
 * The error a transport throws when the gateway answered a failure the model policy may route
 * around (a rate limit, a context-window refusal, an outage). `status` is the HTTP status; the
 * policy releases a pin on 429/413/503 and re-asks once on the cascade.
 */
export class ModelTransportError extends Error {
  readonly status: number | undefined;
  /** Whether the model policy may route around this failure. A containment stop is never routable. */
  readonly routable: boolean;
  constructor(message: string, status?: number, opts: { routable?: boolean } = {}) {
    super(message);
    this.name = "ModelTransportError";
    this.status = status;
    this.routable = opts.routable ?? (status !== undefined && status >= 400);
  }
}

/** What a transport's preflight found. Empty `byoUnresolved` ⇒ every connected account resolves. */
export interface ModelPreflightResult {
  /** `provider:reason` entries, exactly as the gateway's `x-builderforce-byo-unresolved` header spells them. */
  byoUnresolved: readonly string[];
  /** Providers whose `expired` token the transport refreshed successfully. */
  refreshed?: readonly string[];
  /** The model the run falls back to, when the transport knows it. */
  fallback?: string;
}
