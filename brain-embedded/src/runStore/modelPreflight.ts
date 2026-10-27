/**
 * MODEL PREFLIGHT (PRD 35 E7) — the run learns BEFORE turn 1 that a connected account
 * cannot serve it, instead of after a turn from `x-builderforce-byo-unresolved`.
 *
 * The host checks its BYO health (the VS Code client: the provider-key status reads,
 * which attempt the token refresh themselves) and hands back the unresolved entries in
 * the header's own `provider:reason` form. They are seeded into the run cell's
 * `byoUnresolved` — the SAME state the live banner reads — and recorded as a
 * `model.preflight` step, so the user sees "your Anthropic token expired; this run will
 * not use your own model" up front, and diagnostics can say why the run was weak.
 */

import { isAgenticTier, listPriceOf, resolveModelTier, snapshotPriceBook, type ModelTier, type PriceBook } from '@builderforce/model-catalog';
import { byoUnresolvedSummary, parseByoUnresolved, type BrainTraceEvent } from '../brainTriage';
import type { RunCell } from './runCell';
import { accrueByoUnresolved, emit, nowIso, pushTrace } from './runCells';

export const MODEL_PREFLIGHT_LABEL = 'model.preflight';

/** What a host's preflight found. Empty `byoUnresolved` = every connected account resolves. */
export interface ModelPreflightResult {
  /** `provider:reason` entries, exactly as the gateway's header spells them. */
  byoUnresolved: readonly string[];
  /** The model the run will fall back to, when the host knows it. */
  fallback?: string;
}

/** A pinned model whose catalog tier is Flash-class (not an agentic tier). */
export interface PlanModelWarning {
  model: string;
  tier: ModelTier;
}

/**
 * Would the run's PLAN phase land on a Flash-class model? Only answerable for a model the
 * run names explicitly (a pin); an auto-routed run (`undefined` / `default`) is the
 * gateway's pick, which only the BYO check speaks to. The tier is the catalog's own rule
 * over the release's bundled prices; an unpriced model (a local one) is unknown, not weak. Pure.
 */
export function planModelWarning(model: string | undefined, book: PriceBook = snapshotPriceBook()): PlanModelWarning | null {
  if (!model || model === 'default') return null;
  const price = listPriceOf(book, model);
  const tier = price ? resolveModelTier({ price }) : undefined;
  return tier && isAgenticTier(tier) === false ? { model, tier } : null;
}

/** The `model.preflight` step for a result, or null when there is nothing to say. Pure. */
export function modelPreflightEvent(result: ModelPreflightResult | null | undefined, ts: string, plan?: PlanModelWarning | null): BrainTraceEvent | null {
  const entries = parseByoUnresolved((result?.byoUnresolved ?? []).filter((e) => e.trim()));
  if (entries.length === 0 && !plan) return null;
  const said: string[] = [];
  if (entries.length > 0) {
    const onto = result?.fallback ? ` This run will use ${result.fallback} instead.` : ' This run will fall back to another model.';
    said.push(`${entries.map(byoUnresolvedSummary).join('; ')}.${onto}`);
  }
  if (plan) {
    said.push(`the plan phase will run on ${plan.model}, a ${plan.tier}-tier (Flash-class) model — weak at planning a multi-step change; pick a stronger model for planning if the result matters.`);
  }
  return {
    ts,
    category: 'message',
    label: MODEL_PREFLIGHT_LABEL,
    args: {
      ...(entries.length ? { byoUnresolved: entries.map((e) => (e.reason ? `${e.provider}:${e.reason}` : e.provider)).join(',') } : {}),
      ...(result?.fallback && entries.length ? { fallback: result.fallback } : {}),
      ...(plan ? { planModel: plan.model, planTier: plan.tier } : {}),
    },
    result: `Before the first turn: ${said.join(' Also: ')}`,
  };
}

/**
 * Run the host's preflight once and seed what it found into the run. Best-effort: a
 * throw or a slow host costs the notice, never the run.
 */
export async function applyModelPreflight(
  c: RunCell,
  preflight: (() => Promise<ModelPreflightResult | undefined>) | undefined,
  pinnedModel?: string,
): Promise<void> {
  if (!preflight) return;
  let result: ModelPreflightResult | undefined;
  try {
    result = await preflight();
  } catch {
    return;
  }
  // A run that already changed code has no plan phase left.
  const plan = c.codeChanged ? null : planModelWarning(pinnedModel);
  const event = modelPreflightEvent(result, nowIso(), plan);
  if (!event) return;
  if (result?.byoUnresolved.length) accrueByoUnresolved(c, result.byoUnresolved.join(','));
  pushTrace(c, event);
  emit(c);
}
