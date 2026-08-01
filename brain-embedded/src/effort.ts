/**
 * The SINGLE source of truth for the composer's "Effort" control.
 *
 * Effort used to be prose-only (a system-prompt nudge), so picking Quick vs
 * Thorough changed nothing measurable about the request. It now drives THREE
 * things, and every consumer — the UI that describes an effort level to the
 * user, and the request builder that puts it on the wire — reads them from
 * here, so the numbers can never drift apart:
 *
 *   1. `maxTokens`  → the request's `max_tokens` (previously a hardcoded 4096
 *                     for every turn regardless of effort).
 *   2. `reasoningLevel` → the level sent when the Thinking toggle is ON.
 *   3. the system-prompt nudge (kept — but no longer the ONLY effect).
 *
 * ── Why the wire field is VENDOR-NEUTRAL ────────────────────────────────────
 * The client must NOT emit vendor-specific reasoning params. The gateway's
 * `reasoningCapability.ts` is the one conservative registry mapping a model id
 * to the CORRECT vendor param (Anthropic `thinking` for bare `claude-*` only;
 * OpenAI `reasoning_effort` for o-series/gpt-5; everything else dropped), and a
 * blanket Anthropic `thinking` sent to a strict OpenAI-compatible coder 400s the
 * whole run. The client frequently does not even know the model — the picker's
 * default is "auto (let the gateway choose)".
 *
 * So we send INTENT ONLY (`reasoning: { level }`) and the gateway maps it
 * against the model it actually RESOLVED. {@link ReasoningLevel} deliberately
 * uses the same member names as the server's `AgentThinkLevel` union so the
 * gateway can feed it straight into `reasoningParamsForModel` with no second
 * translation table.
 *
 * `balanced` + Thinking OFF is the neutral default and produces a request
 * byte-identical to the pre-change one (max_tokens 4096, no `reasoning` key).
 */

/** How hard the model should work on the next turn — the composer's `/` menu. */
export type Effort = 'quick' | 'balanced' | 'thorough';

/**
 * Vendor-neutral reasoning intent. Member names match the server's
 * `AgentThinkLevel` (from `@builderforce/agent-tools`) so the gateway maps them
 * without translating. Intentionally NOT imported from that package: this SDK
 * is published standalone and dependency-free.
 */
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high';

/** The vendor-neutral reasoning field carried on the wire. */
export interface ReasoningIntent {
  level: ReasoningLevel;
}

/** Everything one effort level decides. */
export interface EffortProfile {
  effort: Effort;
  /** `max_tokens` for the completion — the answer-length/cost lever. */
  maxTokens: number;
  /** The level sent as `reasoning.level` when Thinking is ON. */
  reasoningLevel: Exclude<ReasoningLevel, 'off'>;
  /**
   * The extended-thinking token budget the gateway's registry maps
   * `reasoningLevel` to. Mirrors `THINK_BUDGET_TOKENS` in
   * `api/src/application/llm/reasoningCapability.ts` (low 2048 / medium 8192 /
   * high 16384). DISPLAY ONLY — never sent, so the client cannot drift the
   * server's actual budget; it exists so the menu can tell the user what the
   * toggle really costs.
   */
  thinkingBudgetTokens: number;
  /**
   * The system-prompt nudge for this level, or '' for the neutral default.
   * Kept alongside the real params (belt and braces for models whose family the
   * server registry drops the reasoning param for).
   */
  directive: string;
}

const EFFORT_PROFILES: Record<Effort, EffortProfile> = {
  quick: {
    effort: 'quick',
    maxTokens: 2048,
    reasoningLevel: 'low',
    thinkingBudgetTokens: 2048,
    directive:
      'Effort: favour a fast, concise, direct answer. Keep exploration minimal unless the task truly requires more.',
  },
  balanced: {
    effort: 'balanced',
    maxTokens: 4096,
    reasoningLevel: 'medium',
    thinkingBudgetTokens: 8192,
    directive: '',
  },
  thorough: {
    effort: 'thorough',
    maxTokens: 16384,
    reasoningLevel: 'high',
    thinkingBudgetTokens: 16384,
    directive:
      'Effort: apply maximum rigor. Be exhaustive, consider edge cases, verify your work, and do not stop until the task is fully complete.',
  },
};

/** The profile for an effort level. Unknown/absent input falls back to `balanced`. */
export function effortProfile(effort: Effort | undefined): EffortProfile {
  return EFFORT_PROFILES[effort as Effort] ?? EFFORT_PROFILES.balanced;
}

/** Is this a known effort level? Guards a persisted/user-supplied string. */
export function isEffort(value: unknown): value is Effort {
  return value === 'quick' || value === 'balanced' || value === 'thorough';
}

/**
 * The vendor-neutral reasoning intent for a run, or `undefined` when Thinking is
 * OFF — in which case the caller omits the field entirely and the request stays
 * byte-identical to one from before this feature existed.
 */
export function reasoningForRun(o: { effort: Effort; thinking: boolean }): ReasoningIntent | undefined {
  return o.thinking ? { level: effortProfile(o.effort).reasoningLevel } : undefined;
}
