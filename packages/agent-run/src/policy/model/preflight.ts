/**
 * policy/model/preflight — the inference-mode rules (Local only / Hybrid / Specific) and
 * the BYO preflight that names a degraded model before turn 1.
 *
 * Owned by WS2g; split out of `policy/model/index.ts` to keep each file under the
 * size limit. Ports `clients/vscode/src/modelRouting.ts`' policy half and the
 * `tenantProviderKeyService.unresolvedReasons` / `byoCredentialHealth.ts` signal.
 *
 * Also the two run events the policy emits from them: `model.preflight` once before
 * turn 1, and `llm.model_downgrade` when a turn is answered by another model than the run
 * expected — ported from brain-embedded `runStore/modelPreflight.ts` +
 * `runStore/modelDowngrade.ts` (the replacement home; that copy goes when the Brain's
 * adapter switches over, WS4). The tier rule is the catalog's own
 * (`@builderforce/model-catalog`).
 *
 * No `node:*`, no DOM. The hook halves read their port and the run state; the rest is pure.
 */

import { isAgenticTier, listPriceOf, resolveModelTier, snapshotPriceBook, tierRank, type ModelTier, type PriceBook } from "@builderforce/model-catalog";
import type { ModelPreflightResult, RunEvent } from "../../contract.js";
import type { PolicyContext } from "../hooks.js";

// ── The inference-mode rules (modelRouting.ts policy half) ──────────────────

/**
 * The inference mode (`RunPolicy.inference`), promised by every entry point:
 *   • `local-only` — the run never reaches the gateway, never owes an account; a turn
 *     nothing on this machine can serve fails, it does not fall back to the cloud.
 *   • `hybrid` — a turn this machine cannot serve alone is completed on the gateway
 *     after the connected accounts this surface calls itself; the fallback is never
 *     silent (the surface hears it and says so).
 *   • `specific` — the run asks for exactly the pinned model and nothing else; with
 *     nothing pinned it fails rather than quietly running whatever is to hand.
 *
 * `pick` is what the surface resolved the pin / default to (empty ⇒ auto-select);
 * `localServable` is whether the model port can serve this turn on the machine.
 */
export function inferenceDecision(input: {
  mode: "local-only" | "hybrid" | "specific";
  pick?: string;
  localServable?: boolean;
}): { decision: "local" | "gateway" | "specific" | "no_local_model" | "no_specific_model" } {
  const pick = input.pick?.trim() ?? "";
  if (input.mode === "local-only") {
    return input.localServable ? { decision: "local" } : { decision: "no_local_model" };
  }
  if (input.mode === "specific") {
    return pick ? { decision: "specific" } : { decision: "no_specific_model" };
  }
  // Hybrid: the machine first when it can serve the pick, else the gateway. A pick this
  // machine cannot serve is a gateway turn, not a refusal — the fallback is announced,
  // never silent.
  return input.localServable ? { decision: "local" } : { decision: "gateway" };
}

/** Local only refuses to dispatch to a runtime that leaves the machine (registry data). */
export function localOnlyServable(onDevice: boolean): boolean {
  return onDevice;
}

// ── The BYO preflight (tenantProviderKeyService.unresolvedReasons) ──────────

/**
 * Why a configured BYO credential could not be used — the `unresolvedReasons` values
 * the key service reports. `expired` earns one refresh attempt; anything else is
 * owner-actionable and the run should say so BEFORE any work starts.
 */
export type ByoUnresolvedReason =
  | "expired"
  | "revoked"
  | "undecryptable"
  | "unsupported-auth"
  | "wrong-workspace"
  | "not_connected";

/** The unresolved reasons for the vendors the role ladder would use. */
export type UnresolvedReasons = Readonly<Partial<Record<string, ByoUnresolvedReason>>>;

/**
 * The preflight check the PRD names: an `expired` token gets one refresh attempt, and a
 * still-unresolved credential — or a plan phase landing on a Flash-class
 * (non-`agentic`) model — is a `model.preflight` notice the HumanChannel shows before
 * any work starts. `agentic` is whether the model the plan phase would land on is
 * agentic-tier. `byoModelSelected` says a BYO pool model is pinned (so an unresolved
 * BYO credential matters).
 */
export function classifyPreflight(input: {
  byoSelected: boolean;
  unresolvedReasons: UnresolvedReasons;
  /** Whether the model the plan phase would land on is agentic-tier (not Flash-class). */
  planModelAgentic?: boolean;
  /** The unresolved reason AFTER one refresh attempt on an `expired` credential. */
  unresolvedAfterRefresh?: ByoUnresolvedReason | null;
}): { notices: string[]; refreshExpired: boolean } {
  const notices: string[] = [];
  let refreshExpired = false;
  if (input.byoSelected) {
    for (const [provider, reason] of Object.entries(input.unresolvedReasons)) {
      if (!reason) continue;
      if (reason === "expired") {
        // One refresh attempt; only a STILL-unresolved credential is a notice.
        if (input.unresolvedAfterRefresh) {
          notices.push(`${provider}: credential ${input.unresolvedAfterRefresh} — reconnect it in Settings ▸ Integrations.`);
        } else {
          refreshExpired = true;
        }
      } else {
        notices.push(`${provider}: credential ${reason} — reconnect it in Settings ▸ Integrations.`);
      }
    }
  }
  if (input.planModelAgentic === false) {
    notices.push("plan phase would land on a Flash-class model — routing around it for the run's quality.");
  }
  return { notices, refreshExpired };
}

// ── The run events (model.preflight, llm.model_downgrade) ───────────────────

/** The `model.preflight` run event. */
export type ModelPreflightEvent = Extract<RunEvent, { kind: "model.preflight" }>;
/** The `llm.model_downgrade` run event. */
export type ModelDowngradeEvent = Extract<RunEvent, { kind: "llm.model_downgrade" }>;

/** A model whose catalog tier is Flash-class (not an agentic tier). */
export interface PlanModelWarning {
  model: string;
  tier: ModelTier;
}

/**
 * Would the run's PLAN phase land on a Flash-class model? Only answerable for a model the
 * run names; an unpriced model (a local one) is unknown, not weak.
 */
export function planModelWarning(model: string | undefined, book: PriceBook = snapshotPriceBook()): PlanModelWarning | null {
  if (!model || model === "default") return null;
  const price = listPriceOf(book, model);
  const tier = price ? resolveModelTier({ price }) : undefined;
  return tier && isAgenticTier(tier) === false ? { model, tier } : null;
}

/**
 * THE rule for "served by a WEAKER model than the run asked for" - what makes a run `degraded` (§8.2),
 * whichever entry point and whichever path reports it: the ONE agent's `modelDowngrade` records a weaker
 * failover with it, and the legacy embedded runner derives its `degraded` from it. Weaker = a worse catalog
 * tier (ULTRA > PREMIUM > STANDARD > FREE). A model the book does not price is UNKNOWN, not weak, and a
 * failover to a model of the same standing is not a downgrade. Pure.
 */
export function isWeakerModel(requested: string | undefined, served: string | undefined, book: PriceBook = snapshotPriceBook()): boolean {
  const tierOf = (model: string | undefined): ModelTier | undefined => {
    const price = model && model !== "default" ? listPriceOf(book, model) : undefined;
    return price ? resolveModelTier({ price }) : undefined;
  };
  const asked = tierOf(requested);
  const got = tierOf(served);
  return asked !== undefined && got !== undefined && tierRank(got) > tierRank(asked);
}

/** `provider:reason` entries (the gateway header's spelling) as the reasons map. */
function reasonsOf(entries: readonly string[]): Record<string, ByoUnresolvedReason> {
  const out: Record<string, ByoUnresolvedReason> = {};
  for (const entry of entries) {
    const [provider = "", reason = ""] = entry.split(":").map((part) => part.trim());
    if (provider) out[provider] = (reason || "not_connected") as ByoUnresolvedReason;
  }
  return out;
}

/**
 * The `model.preflight` event for what the transport's preflight found. The transport has
 * already spent the one refresh attempt an `expired` token earns, so an entry it still
 * reports is unresolved. `planModel` is the model the plan phase would land on (none once
 * the run changed code). `ok` when nothing is wrong; `refreshed` when a token was renewed.
 */
export function modelPreflightEvent(step: number, result: ModelPreflightResult | undefined, planModel?: string): ModelPreflightEvent {
  const plan = planModelWarning(planModel);
  const { notices } = classifyPreflight({
    byoSelected: true,
    unresolvedReasons: reasonsOf(result?.byoUnresolved ?? []),
    ...(plan ? { planModelAgentic: false } : {}),
    unresolvedAfterRefresh: "expired",
  });
  if (notices.length > 0 && result?.fallback && (result.byoUnresolved.length ?? 0) > 0) {
    notices.push(`This run will use ${result.fallback} instead.`);
  }
  const status = notices.length > 0 ? "degraded" : (result?.refreshed?.length ?? 0) > 0 ? "refreshed" : "ok";
  return { kind: "model.preflight", step, status, notices };
}

/** What the outcome row records for a preflight: `ok`, `refreshed` or `degraded:<reasons>`. */
export function preflightVerdict(event: ModelPreflightEvent, result: ModelPreflightResult | undefined): string {
  if (event.status !== "degraded") return event.status;
  const reasons = (result?.byoUnresolved ?? []).join(",");
  return `degraded:${reasons || "plan_flash"}`;
}

/** The preflight half of the model hook: ask the transport once, before turn 1. Never throws. */
export async function runModelPreflight(ctx: PolicyContext): Promise<ModelPreflightEvent> {
  const model = ctx.state.model.model ?? ctx.policy.pinnedModel;
  let result: ModelPreflightResult | undefined;
  try {
    result = await ctx.ports.model.preflight?.(model);
  } catch {
    result = undefined; // a failed preflight costs the notice, never the run
  }
  const event = modelPreflightEvent(ctx.step, result, ctx.state.writtenPaths.length === 0 ? model : undefined);
  ctx.state.preflight = preflightVerdict(event, result);
  return event;
}

/**
 * `llm.model_downgrade` for one turn (PRD 35 E7):
 *  - a turn that ASKED for a model (a pin, a lock, the phase default) answered by another
 *    — a failover, every turn it happens;
 *  - an AUTO-ROUTED turn (asked for nothing) while the preflight found a connected account
 *    it could not use, or a plan-phase turn (no code changed yet) that landed on a
 *    Flash-class model — said once per served model per run (`RunState.downgrades`).
 */
export function modelDowngrade(ctx: PolicyContext, requested: string | undefined, served: string | undefined, book: PriceBook = snapshotPriceBook()): ModelDowngradeEvent | undefined {
  if (!served || served === "default") return undefined;
  if (requested && requested !== "default") {
    if (served === requested) return undefined;
    // A failover onto a WEAKER model is a downgrade the outcome row must carry (once per served model).
    if (isWeakerModel(requested, served, book) && !(ctx.state.downgrades ?? []).includes(served)) {
      ctx.state.downgrades = [...(ctx.state.downgrades ?? []), served];
    }
    return { kind: "llm.model_downgrade", step: ctx.step, requestedModel: requested, model: served, reason: "failover" };
  }
  if ((ctx.state.downgrades ?? []).includes(served)) return undefined;
  const degraded = ctx.state.preflight?.startsWith("degraded:") ? ctx.state.preflight.slice("degraded:".length) : "";
  const byo = degraded && degraded !== "plan_flash" ? degraded : "";
  const flash = !byo && ctx.state.writtenPaths.length === 0 ? planModelWarning(served) : null;
  if (!byo && !flash) return undefined;
  ctx.state.downgrades = [...(ctx.state.downgrades ?? []), served];
  return { kind: "llm.model_downgrade", step: ctx.step, requestedModel: "default", model: served, reason: byo ? `byo_unresolved:${byo}` : `plan_tier:${flash!.tier}` };
}
