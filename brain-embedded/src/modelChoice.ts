/**
 * WHICH MODELS a chat surface may offer, in WHAT ORDER, and WHO PAYS for each —
 * the model-choice domain, with no UI in it.
 *
 * It lives here rather than in the React UI package because three very different
 * surfaces have to agree on it: the shared `/` composer menu (web + VS Code
 * webview), and the VS Code extension HOST's `Change model` QuickPick, which runs
 * in the Node extension process and cannot import React. When each owned its own
 * list they drifted on grouping order, on how a connected provider was named, and
 * on the sentence that told the user who was being billed.
 */

import {
  DEFAULT_MODEL_IDENTITY,
  productModelName,
  revealsModelId,
  type ModelIdentityContext,
} from './modelIdentity';

/** The gateway pin that expands to a project's CURRENT Evermind head at call time.
 *  Mirrors `PROJECT_EVERMIND_MODEL_PREFIX` on the gateway (api/.../projectEvermind.ts). */
export const PROJECT_EVERMIND_MODEL_PREFIX = 'project_evermind:';

/** What the user picked. `auto` lets the gateway route; `byo_pool` walks the
 *  tenant's connected accounts in their configured priority order; `model` is a
 *  strict pin. */
export type ChatModelSelection =
  | { mode: 'auto' }
  | { mode: 'byo_pool' }
  | { mode: 'model'; model: string };

/** The selectable model surface, grouped by WHO PAYS (see {@link ModelCategory}). */
export interface ChatModelOptions {
  /** Tenant-defined named LLM configs (`tenant_model:<slug>`). */
  configured?: Array<{ id: string; label: string }>;
  /** Models the tenant's own connected provider accounts can serve. */
  byo: Array<{ id: string; vendor: string; cost?: string }>;
  free: Array<string | { id: string; cost?: string }>;
  plan: Array<string | { id: string; cost?: string }>;
  paid: Array<string | { id: string; cost?: string }>;
}

/** Funding tier of a model row — the axis the list is grouped and filtered by. */
export type ModelCategory = 'auto' | 'byo' | 'free' | 'plan' | 'paid' | 'configured';

/** One row in the model list. `detail` is the funding sentence for that row. */
export interface ModelItem {
  key: string;
  label: string;
  detail: string;
  category: ModelCategory;
  selection: ChatModelSelection;
}

/**
 * The strings a model list needs. Hosts pass their own localized bundle (the web
 * app via next-intl, the VS Code surfaces via `vscode.l10n`); the English defaults
 * keep the list readable unmapped. The composer menu's own chrome extends this
 * (see `PromptOptionsLabels` in brain-ui).
 */
export interface ModelChoiceLabels {
  categoryAuto: string;
  categoryByo: string;
  categoryFree: string;
  categoryPlan: string;
  categoryPaid: string;
  categoryConfigured: string;
  /** The funding sentence for the routed row. Its NAME comes from the product
   *  ({@link BUILDERFORCE_PRODUCT_NAME}), not from a label — a brand token is not
   *  translated, and the tier it states must match what the gateway actually funds. */
  autoDetail: string;
  poolLabel: string;
  poolDetail: string;
  freeDetail: string;
  planDetail: string;
  paidDetail: string;
  /** Per-model premium price line. `{input}` / `{output}` are the formatted
   *  per-1M-token rates (see {@link premiumCostLabel}). */
  paidCostDetail: string;
  /** `{vendor}` is substituted with the connected provider's display name. */
  byoDetail: string;
  configuredDetail: string;
  /** Display name for a `project_evermind:<id>` pin (the raw pin is not a model name). */
  evermindLabel: string;
  /** Funding line for a `project_evermind:<id>` pin (a plan feature, not a catalog model). */
  evermindDetail: string;
}

export const DEFAULT_MODEL_CHOICE_LABELS: ModelChoiceLabels = {
  categoryAuto: 'Auto',
  categoryByo: 'BYO',
  categoryFree: 'Free',
  categoryPlan: 'Plan',
  categoryPaid: 'Paid',
  categoryConfigured: 'Configured',
  autoDetail: 'Routed per turn — your connected accounts first, then your plan.',
  poolLabel: 'BYO pool',
  poolDetail: 'Tries your connected accounts in the order configured in Account settings.',
  freeDetail: 'Free · included with BuilderForce',
  planDetail: 'Included with your BuilderForce plan',
  paidDetail: 'Premium — metered at cost + 1¢ per request',
  paidCostDetail: '{input} input / {output} output per 1M tokens + $0.01 per request',
  byoDetail: 'Billed to your own {vendor} account — no plan credit used.',
  configuredDetail: 'Saved workspace LLM configuration',
  evermindLabel: 'Project Evermind',
  evermindDetail: "Your project's own learned Evermind model.",
};

/** Human-facing provider names for the BYO groups. One map, so a connected
 *  account is called the same thing in the composer menu and in the editor's
 *  model picker. Unknown keys fall back to a title-cased key. */
const BYO_VENDOR_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'kimi-code': 'Kimi Code',
  moonshot: 'Moonshot AI',
  google: 'Google',
  meta: 'Meta',
  xai: 'xAI',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
};

export function byoVendorLabel(vendor: string): string {
  return BYO_VENDOR_LABELS[vendor] ?? vendor.replace(/^./, (ch) => ch.toUpperCase());
}

/** A gateway per-token rate as the per-1M-token price every surface quotes. */
export function perMillionUsd(rate: number): string {
  return `$${(rate * 1_000_000).toFixed(2)}`;
}

/**
 * What a premium (metered) model costs, formatted from the gateway's per-token
 * rates against the host's localized `paidCostDetail` line. For a host with an
 * ICU formatter (the web app) prefer interpolating {@link perMillionUsd} through
 * it; this is the plain-substitution path for hosts without one.
 */
export function premiumCostLabel(pricing: { prompt: number; completion: number }, template: string): string {
  return template.replace('{input}', perMillionUsd(pricing.prompt)).replace('{output}', perMillionUsd(pricing.completion));
}

/** The categories, in display order. Only the populated ones are ever offered. */
export const MODEL_CATEGORIES: ModelCategory[] = ['auto', 'byo', 'free', 'plan', 'paid', 'configured'];

export function modelCategoryLabel(category: ModelCategory, labels: ModelChoiceLabels): string {
  switch (category) {
    case 'auto': return labels.categoryAuto;
    case 'byo': return labels.categoryByo;
    case 'free': return labels.categoryFree;
    case 'plan': return labels.categoryPlan;
    case 'paid': return labels.categoryPaid;
    case 'configured': return labels.categoryConfigured;
  }
}

/**
 * Every selectable route, ordered by what it COSTS the user: BuilderForce
 * collections (free → plan → paid) lead, then the tenant's own connected
 * accounts (BYO pool + its models, in the server-supplied provider priority
 * order), then saved workspace LLM configs. A model already listed in a cheaper
 * group is never repeated.
 *
 * `identity` names the ROUTED row after the product that actually funds it —
 * "Builderforce Free" / "Builderforce PRO" rather than a bare "Auto" — because that
 * is the thing the user bought and the only honest answer to "what am I running on?"
 * when the gateway picks per turn. Omit it and the row degrades to the free product
 * (see {@link DEFAULT_MODEL_IDENTITY}: the safe default is masked, never leaked).
 */
export function buildModelItems(
  options: ChatModelOptions,
  labels: ModelChoiceLabels,
  identity: ModelIdentityContext = DEFAULT_MODEL_IDENTITY,
): ModelItem[] {
  const items: ModelItem[] = [
    { key: 'auto', label: productModelName(identity), detail: labels.autoDetail, category: 'auto', selection: { mode: 'auto' } },
  ];
  const normalized = (value: string | { id: string; cost?: string }) => (typeof value === 'string' ? { id: value } : value);
  const seen = new Set<string>();
  const add = (id: string, label: string, detail: string, category: ModelCategory) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({ key: `model:${id}`, label, detail, category, selection: { mode: 'model', model: id } });
  };
  for (const value of options.free) {
    const model = normalized(value);
    add(model.id, model.id, model.cost ?? labels.freeDetail, 'free');
  }
  const free = new Set(options.free.map((value) => normalized(value).id));
  for (const value of options.plan) {
    const model = normalized(value);
    if (!free.has(model.id)) add(model.id, model.id, model.cost ?? labels.planDetail, 'plan');
  }
  for (const value of options.paid) {
    const model = normalized(value);
    add(model.id, model.id, model.cost ?? labels.paidDetail, 'paid');
  }
  if (options.byo.length) {
    items.push({ key: 'byo_pool', label: labels.poolLabel, detail: labels.poolDetail, category: 'byo', selection: { mode: 'byo_pool' } });
  }
  for (const model of options.byo) {
    add(model.id, model.id, model.cost ?? labels.byoDetail.replace('{vendor}', byoVendorLabel(model.vendor)), 'byo');
  }
  for (const model of options.configured ?? []) add(model.id, model.label, model.id, 'configured');
  return items;
}

/** The key identifying the active row (matches {@link ModelItem.key}). */
export function activeModelKey(selection: ChatModelSelection): string {
  return selection.mode === 'model' ? `model:${selection.model}` : selection.mode;
}

/** Search + category narrowing. Matches label, funding detail, and category name. */
export function filterModelItems(
  items: ModelItem[],
  labels: ModelChoiceLabels,
  query: string,
  category: 'all' | ModelCategory,
): ModelItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (category === 'all' || item.category === category)
    && (!needle || `${item.label} ${item.detail} ${modelCategoryLabel(item.category, labels)}`.toLowerCase().includes(needle)));
}

/**
 * What is ACTUALLY running the next turn, said in one line: the pinned model, the
 * BYO pool, or — under `auto` — the routing PRODUCT that funds it.
 *
 * `effective` (what the host resolved an `auto` turn to) is honoured only when it names
 * something the user owns: a project-Evermind head, a saved workspace LLM config, or —
 * for a viewer entitled to pick models at all — a catalog id. On a routed plan the
 * answer is the product, not the upstream model the cascade happened to reach for; see
 * `modelIdentity.ts` for why. This is the fix for a free-plan composer that announced
 * "minimaxai/minimax-m3" beside a menu that would not let the user change it.
 */
export function modelInUse(
  selection: ChatModelSelection,
  items: ModelItem[],
  labels: ModelChoiceLabels,
  effective?: string,
  identity: ModelIdentityContext = DEFAULT_MODEL_IDENTITY,
): { name: string; detail: string } {
  const routed = { name: productModelName(identity), detail: labels.autoDetail };
  const resolve = (model: string) => {
    const item = items.find((entry) => entry.key === `model:${model}`);
    // An Evermind pin is a plan FEATURE (the gateway expands it to the project's
    // learned head), not a premium catalog model, so it must be named — and funded —
    // as one rather than shown as a raw pin.
    if (model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)) {
      return { name: labels.evermindLabel, detail: labels.evermindDetail };
    }
    // A viewer who cannot pin has nothing to learn from an upstream id; they are on
    // the product, whatever the cascade resolved to underneath it.
    if (!revealsModelId(identity)) return routed;
    return item ? { name: item.label, detail: item.detail } : { name: model, detail: labels.autoDetail };
  };
  if (selection.mode === 'model') return resolve(selection.model);
  if (selection.mode === 'byo_pool') return { name: labels.poolLabel, detail: labels.poolDetail };
  if (effective) return resolve(effective);
  return routed;
}
