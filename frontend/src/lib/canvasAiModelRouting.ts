import { MAX_STALL_REROUTES, MAX_STALLED_STREAMS } from '@/lib/canvasAiTurnBudget';

/**
 * Which model ONE Canvas turn talks to, and how it moves off a model that failed.
 *
 * Owns the routing state `runCreationCanvasAi` used to keep as loose locals: the active
 * pin, the models that proved they can call tools in this turn, the models that proved
 * they cannot, and the stalled-provider ladder. The runner keeps everything that is not
 * routing (the recovery counters, the messages, the user-facing callbacks) and asks this
 * object only "which model next?".
 */
export class CanvasModelRouter {
  private activeModel: string | undefined;
  private activeModelStrict: boolean | undefined;
  /** Models that emitted valid tool calls earlier in this turn — the only fallbacks. */
  private readonly toolCallingModels: string[] = [];
  /** Models that proved unable to execute a Canvas command (session-seeded). */
  private readonly commandFailedModels: Set<string>;
  /** Models this AUTO-routed turn handed back to the gateway after they stalled with no
   *  proven model to switch to (`MAX_STALL_REROUTES`). Turn-scoped and never reported as
   *  disabled: a stall says nothing about the model's next turn. */
  private readonly stallReroutedModels = new Set<string>();
  /** Silent round-trips IN A ROW on the current model — what the stall ladder counts. A
   *  completion that returns resets it: two stalls minutes apart with a file written in
   *  between are two bad connections, not a dead model. */
  private consecutiveStalls = 0;
  /** Round-trips this turn abandoned because the provider went silent — in total, for the
   *  tail's "the provider stalled" verdict. */
  private stalledStreamCount = 0;

  /**
   * @param requestedModel the caller's pinned model, if any.
   * @param requestedModelStrict whether that pin is strict.
   * @param excludeModels session routing hints, honoured only while unpinned.
   * @param disabledModels models the session already proved will not execute a command.
   */
  constructor(
    private readonly requestedModel: string | undefined,
    private readonly requestedModelStrict: boolean | undefined,
    private readonly excludeModels: readonly string[],
    disabledModels: readonly string[],
  ) {
    this.activeModel = requestedModel;
    this.activeModelStrict = requestedModelStrict;
    this.commandFailedModels = new Set(disabledModels);
  }

  get model(): string | undefined { return this.activeModel; }

  get modelStrict(): boolean | undefined { return this.activeModelStrict; }

  get stalledStreams(): number { return this.stalledStreamCount; }

  /**
   * Models this session (or this turn) already proved will not execute a Canvas command.
   * Only meaningful while UNPINNED — with a pin the caller has made the choice — and the
   * gateway ignores it rather than emptying the cascade, so this can steer routing
   * without ever refusing to answer. Empty object when there is nothing to exclude, so
   * the request carries no `excludeModels` key at all.
   */
  exclusionField(): { excludeModels?: string[] } {
    if (this.activeModel) return {};
    if (!this.excludeModels.length && !this.commandFailedModels.size && !this.stallReroutedModels.size) return {};
    return { excludeModels: [...new Set([...this.excludeModels, ...this.commandFailedModels, ...this.stallReroutedModels])] };
  }

  /**
   * A completion came back. Resets the stall ladder, remembers a model that called tools
   * as a proven fallback, and keeps the turn's continuations on the model that began it.
   *
   * A bounded tool loop is one logical agent turn. Keep its continuations on the model
   * that began it instead of asking Auto to reroute every tool result independently
   * (which previously moved research from MiniMax to Gemini just before the required
   * Canvas write). This is a preference, not a strict pin: the gateway may still
   * substitute when the provider becomes unavailable.
   */
  recordCompletion(resolvedModel: string | null | undefined, calledTools: boolean): void {
    this.consecutiveStalls = 0;
    if (calledTools && resolvedModel && !this.toolCallingModels.includes(resolvedModel)) {
      this.toolCallingModels.push(resolvedModel);
    }
    if (!this.activeModel && resolvedModel) {
      this.activeModel = resolvedModel;
      this.activeModelStrict = false;
    }
  }

  /**
   * Retire `failedModel` and pin the most recent model that already emitted valid tool
   * calls in this turn. Returns that model, or null when no proven model is left.
   *
   * With nothing to switch to the failure is NOT recorded: the record's only purpose is
   * to route around the model on a later turn, and a session that has no alternative
   * gains nothing from it while paying the full price — the list is session-scoped, so
   * one weak turn used to end the session outright. The pin is released instead, so the
   * next iteration asks the gateway to choose again rather than re-pinning the model
   * that just failed.
   */
  switchToProven(failedModel: string | null | undefined): string | null {
    // A model this turn already re-routed AWAY from after it stalled is never a fallback:
    // the next stall has no model name to report (nothing resolved), and the "proven"
    // model it would otherwise pick is the one that went silent.
    const alreadyFailed = new Set([...this.commandFailedModels, ...this.stallReroutedModels, ...(failedModel ? [failedModel] : [])]);
    const fallback = [...this.toolCallingModels].reverse().find((model) => !alreadyFailed.has(model));
    if (!fallback || (fallback === this.activeModel && this.activeModelStrict === true)) {
      this.releasePin();
      return null;
    }
    if (failedModel) this.commandFailedModels.add(failedModel);
    this.activeModel = fallback;
    this.activeModelStrict = true;
    return fallback;
  }

  /**
   * The provider went silent on the current model. Returns the model that stalled, the
   * attempt number on it, and whether the ladder still allows a plain retry (a stall is
   * often a single bad connection) before escalating.
   */
  recordStall(): { model: string | undefined; attempt: number; retry: boolean } {
    this.stalledStreamCount += 1;
    this.consecutiveStalls += 1;
    return { model: this.activeModel, attempt: this.consecutiveStalls, retry: this.consecutiveStalls < MAX_STALLED_STREAMS };
  }

  /** The stall was escalated to another model; its ladder starts over. */
  resetStalls(): void {
    this.consecutiveStalls = 0;
  }

  /**
   * No PROVEN model to hand over to — but on auto routing the gateway still has its pool.
   * Hand the turn back to it with the stalled model excluded. Never with a model the
   * caller picked: that choice is theirs. Returns false when that rung is spent.
   */
  rerouteAfterStall(stalledModel: string | undefined): boolean {
    if (this.requestedModel || !stalledModel || this.stallReroutedModels.has(stalledModel)
      || this.stallReroutedModels.size >= MAX_STALL_REROUTES) return false;
    this.stallReroutedModels.add(stalledModel);
    this.consecutiveStalls = 0;
    this.activeModel = undefined;
    this.activeModelStrict = this.requestedModelStrict;
    return true;
  }

  private releasePin(): void {
    this.activeModel = this.requestedModel;
    this.activeModelStrict = this.requestedModelStrict;
  }
}
