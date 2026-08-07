/**
 * The model list behind the composer's `/` menu — pure, so both hosts (and the
 * tests) build the SAME rows in the SAME order from the same surface.
 */

import { PROJECT_EVERMIND_MODEL_PREFIX } from '@seanhogg/builderforce-brain-embedded';
import type { ChatModelOptions, ChatModelSelection, ModelCategory, ModelItem, PromptOptionsLabels } from './types';

/** Re-exported for hosts that render model refs — ONE definition of the pin, shared
 *  with the funding classifier that has to recognise it too. */
export { PROJECT_EVERMIND_MODEL_PREFIX };

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

/** The filter chips, in display order. Only the populated ones are offered. */
export const MODEL_CATEGORIES: ModelCategory[] = ['auto', 'byo', 'free', 'plan', 'paid', 'configured'];

export function modelCategoryLabel(category: ModelCategory, labels: PromptOptionsLabels): string {
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
 */
export function buildModelItems(options: ChatModelOptions, labels: PromptOptionsLabels): ModelItem[] {
  const items: ModelItem[] = [
    { key: 'auto', label: labels.autoLabel, detail: labels.autoDetail, category: 'auto', selection: { mode: 'auto' } },
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
    add(model.id, model.id, model.cost ?? labels.byoDetail.replace('{vendor}', model.vendor), 'byo');
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
  labels: PromptOptionsLabels,
  query: string,
  category: 'all' | ModelCategory,
): ModelItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (category === 'all' || item.category === category)
    && (!needle || `${item.label} ${item.detail} ${modelCategoryLabel(item.category, labels)}`.toLowerCase().includes(needle)));
}

/**
 * What is ACTUALLY running the next turn, said in one line: the pinned model, the
 * BYO pool, or — under `auto` — whatever the host resolved (a configured default
 * or a project-Evermind pin), which is the thing the user came to the menu to read.
 */
export function modelInUse(
  selection: ChatModelSelection,
  items: ModelItem[],
  labels: PromptOptionsLabels,
  effective?: string,
): { name: string; detail: string } {
  const resolve = (model: string) => {
    const item = items.find((entry) => entry.key === `model:${model}`);
    if (item) return { name: item.label, detail: item.detail };
    // Not in the offered surface. An Evermind pin is a plan FEATURE (the gateway
    // expands it to the project's learned head), not a premium catalog model, so it
    // must be named — and funded — as one rather than shown as a raw pin.
    return model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)
      ? { name: labels.evermindLabel, detail: labels.evermindDetail }
      : { name: model, detail: labels.autoDetail };
  };
  if (selection.mode === 'model') return resolve(selection.model);
  if (selection.mode === 'byo_pool') return { name: labels.poolLabel, detail: labels.poolDetail };
  if (effective) return resolve(effective);
  return { name: labels.autoLabel, detail: labels.autoDetail };
}
