/**
 * The editor's STAGE MODELS and run settings — which model each stage of a run asks
 * for, how runs are routed between the full pipeline and a quick pass, and the per-run
 * spend cap. Pure: `modelState.resolveStageModels` reads the settings and the operator
 * env, `editorRunSettings.ts` hands the result to a run.
 *
 * Sources, in order: the VS Code settings `builderforce.models.{plan,code,review,subagent}`
 * (and `builderforce.pipeline.quickModel`) → the operator's `ROLE_MODELS` env → unset,
 * where the gateway orders the tenant's models by the call's role. A stage model is a
 * DEFAULT beneath the run's own choice (`@builderforce/run-policy` `phaseModels`): the
 * user's explicit pick, the project's Evermind head or `builderforce.defaultModel` still
 * hold the whole run; the review model is the one stage that overrides them.
 */

import type { RunPipelineSettings, RunStageModels } from "@seanhogg/builderforce-brain-embedded";
import type { ShipPolicy } from "@builderforce/run-guards";
import { isLocalModelRef } from "@builderforce/local-inference";

/** The stages a run's models are chosen for. */
export interface StageModels {
  plan?: string;
  code?: string;
  /** The model that reviews the run's change (the run's verify phase). */
  review?: string;
  subagent?: string;
  /** The model a QUICK run codes on (else the code model). */
  quick?: string;
}

/** The settings as written (`builderforce.models.*`). */
export interface StageModelSettings {
  plan?: string;
  code?: string;
  review?: string;
  subagent?: string;
  quick?: string;
}

/**
 * How a run's stages pick their models.
 *
 * - `role` (the default, and when the policy is omitted) keeps today's resolution:
 *   the settings over the operator's role pins.
 * - `tip` is TIP's FIXED policy: Opus plans, implements and reviews; Sonnet runs the
 *   sub-agent work (build and test); Haiku — or the provisioned local model when one is
 *   already selected — takes the quick stage (search).
 */
export type ModelPolicy = "role" | "tip";

/**
 * TIP's models — the catalog's ids for the three families it uses, in ONE table.
 * Concrete catalog ids, not display names (`stageModels.test.ts` asserts each id is in
 * the model catalog). Fable, when that is the plan default, is swapped for the Opus id.
 */
export const TIP_MODELS = {
  /** plan, code and review. */
  opus: "claude-opus-5-5",
  /** the sub-agent stage — build and test run as sub-agent work. */
  sonnet: "claude-sonnet-5-5",
  /** the quick stage — search runs as quick. */
  haiku: "claude-haiku-5-5",
} as const;

/** The FABLE family — the model TIP's policy swaps for Opus when it is the plan default. */
const isFable = (model: string): boolean => model.startsWith("claude-fable");

const id = (raw: unknown): string | undefined => (typeof raw === "string" && raw.trim() ? raw.trim() : undefined);

/**
 * The stage models a run asks for — the settings over the operator's env pins, stage by
 * stage. `envPins` are the operator's role pins and ALWAYS win, for both policies: under
 * `tip` they override TIP's fixed mapping, and a Fable plan pin is swapped for the Opus id.
 */
export function stageModels(
  settings: StageModelSettings & { policy?: ModelPolicy },
  envPins: StageModels = {},
): StageModels {
  const out: StageModels = {};
  const set = (stage: keyof StageModels, value: string | undefined): void => {
    if (value) out[stage] = value;
  };
  if (settings.policy === "tip") {
    // TIP's fixed policy. The operator's pins still win over it.
    const planPin = id(envPins.plan);
    set("plan", planPin && !isFable(planPin) ? planPin : TIP_MODELS.opus);
    set("code", id(envPins.code) ?? TIP_MODELS.opus);
    set("review", id(envPins.review) ?? TIP_MODELS.opus);
    set("subagent", id(envPins.subagent) ?? TIP_MODELS.sonnet);
    // The quick stage takes Haiku — or the provisioned local model, when one is already selected.
    const local = id(settings.quick);
    set("quick", id(envPins.quick) ?? (local && isLocalModelRef(local) ? local : undefined) ?? TIP_MODELS.haiku);
    return out;
  }
  set("plan", id(settings.plan) ?? id(envPins.plan));
  set("code", id(settings.code) ?? id(envPins.code));
  set("review", id(settings.review) ?? id(envPins.review));
  set("subagent", id(settings.subagent) ?? id(envPins.subagent));
  set("quick", id(settings.quick) ?? id(envPins.quick));
  return out;
}

/** The raw pipeline + budget settings. */
export interface RunRoutingSettings {
  routing?: unknown;
  routeThreshold?: unknown;
  maxRunBudgetUsd?: unknown;
  independentReview?: unknown;
}

export type IndependentReview = "auto" | "required" | "off";

/** What a top-level run (or a sub-agent) is started with. */
export interface EditorRunSettings {
  phaseModels?: RunStageModels;
  pipeline?: RunPipelineSettings;
  maxRunBudgetUsd?: number;
  /** The sub-agent stage model — read by `modelForChildRun`. */
  subagentModel?: string;
  /** The run's project's ship policy (PRD 48, `policyGates.resolveRunShipPolicy`). Absent ⇒ the run uses `DEFAULT_SHIP_POLICY`. */
  shipPolicy?: ShipPolicy;
  independentReview?: IndependentReview;
}

/** The run settings from the resolved stage models and the raw settings. */
export function editorRunSettingsFrom(stages: StageModels, raw: RunRoutingSettings): EditorRunSettings {
  const phaseModels: RunStageModels = {
    ...(stages.plan ? { plan: stages.plan } : {}),
    ...(stages.code ? { code: stages.code } : {}),
    ...(stages.review ? { review: stages.review } : {}),
  };
  const threshold = typeof raw.routeThreshold === "number" && Number.isFinite(raw.routeThreshold)
    ? Math.min(1, Math.max(0, raw.routeThreshold))
    : undefined;
  const budget = typeof raw.maxRunBudgetUsd === "number" && Number.isFinite(raw.maxRunBudgetUsd) && raw.maxRunBudgetUsd > 0
    ? raw.maxRunBudgetUsd
    : undefined;
  return {
    ...(Object.keys(phaseModels).length ? { phaseModels } : {}),
    pipeline: {
      routing: raw.routing === "always" ? "always" : "auto",
      ...(threshold !== undefined ? { threshold } : {}),
      ...(stages.quick ? { quickModel: stages.quick } : {}),
    },
    ...(budget !== undefined ? { maxRunBudgetUsd: budget } : {}),
    ...(stages.subagent ? { subagentModel: stages.subagent } : {}),
    ...(raw.independentReview === "required" || raw.independentReview === "off"
      ? { independentReview: raw.independentReview }
      : {}),
  };
}

/** Settings supplied to every editor run. Spend is attributed to the root chat by lineage. */
export function runRequestFields(
  settings: EditorRunSettings | undefined,
): Pick<EditorRunSettings, "phaseModels" | "pipeline" | "maxRunBudgetUsd" | "shipPolicy"> {
  if (!settings) return {};
  return {
    ...(settings.phaseModels ? { phaseModels: settings.phaseModels } : {}),
    ...(settings.pipeline ? { pipeline: settings.pipeline } : {}),
    ...(settings.maxRunBudgetUsd ? { maxRunBudgetUsd: settings.maxRunBudgetUsd } : {}),
    ...(settings.shipPolicy ? { shipPolicy: settings.shipPolicy } : {}),
  };
}
