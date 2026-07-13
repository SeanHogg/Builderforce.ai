/**
 * Evermind recipes (display catalog) — the one-click starting points shown when a
 * user creates an LLM ("Evermind") project. This is the FRONTEND half: ids + icon +
 * i18n key + which teacher to preset. The behavior each id triggers lives in the api
 * (`application/llm/evermindRecipes.ts`); the two must agree on the id set.
 *
 * Picking a recipe replaces the old "select an automation workflow" gate — the new
 * project opens with a working, learnable model instead of a required detour.
 */

/** Keep in lockstep with the api's `EVERMIND_RECIPE_IDS`. */
export type EvermindRecipeId = 'coding' | 'assistant' | 'docs' | 'seed-published' | 'blank';

export interface EvermindRecipeMeta {
  id: EvermindRecipeId;
  icon: string;
  /** i18n key suffix under the `ide` namespace for the recipe's name. */
  nameKey: string;
  /** i18n key suffix under the `ide` namespace for the recipe's one-line description. */
  descKey: string;
  /** Which teacher the caller should preset: a coding model, or none (self-learning). */
  teacher: 'coding' | 'none';
  /** True when the recipe requires the user to pick a published model to seed from. */
  needsSeedModel?: boolean;
  /** Shown with a "Recommended" chip and selected by default. */
  recommended?: boolean;
}

export const EVERMIND_RECIPES: EvermindRecipeMeta[] = [
  { id: 'coding', icon: '🧩', nameKey: 'recipeCodingName', descKey: 'recipeCodingDesc', teacher: 'coding', recommended: true },
  { id: 'assistant', icon: '💬', nameKey: 'recipeAssistantName', descKey: 'recipeAssistantDesc', teacher: 'none' },
  { id: 'docs', icon: '📚', nameKey: 'recipeDocsName', descKey: 'recipeDocsDesc', teacher: 'none' },
  { id: 'seed-published', icon: '🌱', nameKey: 'recipeSeedName', descKey: 'recipeSeedDesc', teacher: 'none', needsSeedModel: true },
  { id: 'blank', icon: '⚙️', nameKey: 'recipeBlankName', descKey: 'recipeBlankDesc', teacher: 'none' },
];

export const DEFAULT_EVERMIND_RECIPE: EvermindRecipeId =
  EVERMIND_RECIPES.find((r) => r.recommended)?.id ?? 'coding';

export function getEvermindRecipe(id: EvermindRecipeId): EvermindRecipeMeta {
  return EVERMIND_RECIPES.find((r) => r.id === id) ?? EVERMIND_RECIPES[0];
}
