/**
 * WHAT THE USER IS TOLD RAN THEIR TURN — the one rule, shared by every surface.
 *
 * A turn served by BuilderForce's own routed pool IS the product the user signed up
 * for: "Builderforce Free" or "Builderforce PRO". Which upstream model the cascade
 * happened to land on (`minimaxai/minimax-m3`, `@cf/zai-org/glm-4.7-flash`, …) is an
 * implementation detail of that product — it changes per turn, per vendor outage, per
 * cooldown, and the user on a routed plan has no control over it. Naming it in the UI
 * only ever raises a question they cannot act on ("why did I get Minimax?").
 *
 * The id is NOT hidden from us. It still rides every `llm_usage_log` row, every
 * execution trace, the provenance metadata on the message, and the "Copy diagnostics"
 * report — the places where WE need to know exactly which model served a turn. This
 * module governs the DISPLAY layer only.
 *
 * It is shown to the user in exactly the two cases where the choice is theirs:
 *   • the turn ran on their OWN connected account (BYO) — it is their model, on their
 *     key, and naming it is the whole point of connecting it; or
 *   • they are entitled to pick a model at all (a paid plan, or a connected provider),
 *     in which case the catalog is theirs to browse and pin.
 *
 * Everyone else — the free plan and the anonymous canvas — sees the product name.
 *
 * Lives in brain-embedded (not a UI package) because four surfaces have to agree on
 * it: the shared `/` composer menu, the per-reply provenance chip in the transcript,
 * the VS Code host's `Change model` QuickPick, and the public `/models` catalog page.
 */

import type { ProvenanceAccount } from './provenance';

/** The two BuilderForce routing products. A turn with no explicit pin runs on one of
 *  them, and that PRODUCT is what the user sees named. */
export type RoutedProduct = 'free' | 'pro';

/**
 * The user-facing names of our two routing products. THE single source — the composer
 * menu, the provenance chip and the public `/models` catalog all read these, so the
 * product can never be called three different things in three places.
 *
 * Brand tokens, deliberately NOT localized (see the i18n rule for brand names).
 */
export const BUILDERFORCE_PRODUCT_NAME: Readonly<Record<RoutedProduct, string>> = {
  free: 'Builderforce Free',
  pro: 'Builderforce PRO',
};

/**
 * What this viewer is allowed to see about model identity.
 *
 * `product`   — which routing product funds their unpinned turns.
 * `canChoose` — may they pick a model at all (paid plan OR a connected provider)?
 *               This is the SAME gate the gateway enforces on a strict pin, so the
 *               label a user reads and the choice they are offered agree by construction.
 */
export interface ModelIdentityContext {
  product: RoutedProduct;
  canChoose: boolean;
}

/**
 * The safe default: a free, choice-less viewer. Deliberately the FALLBACK for a host
 * that has not wired an identity yet, so the failure mode of forgetting is "masked",
 * never "leaked". A host that is wired always passes its own.
 */
export const DEFAULT_MODEL_IDENTITY: ModelIdentityContext = { product: 'free', canChoose: false };

/** The product name for this viewer — "Builderforce Free" / "Builderforce PRO". */
export function productModelName(identity: ModelIdentityContext | null | undefined): string {
  return BUILDERFORCE_PRODUCT_NAME[(identity ?? DEFAULT_MODEL_IDENTITY).product];
}

/** Which product a plan funds. One mapping, so "paid ⇒ PRO" is not re-decided per host. */
export function productForPlan(isPaid: boolean): RoutedProduct {
  return isPaid ? 'pro' : 'free';
}

/**
 * Refs that name something the USER configured rather than a catalog model: a project's
 * own learned Evermind head, or a saved workspace LLM config. These are never masked —
 * masking them would hide a thing the user themselves created and named.
 */
const USER_CONFIGURED_PREFIXES = ['project_evermind:', 'tenant_model:'] as const;

/** True when `model` is a user-configured ref (Evermind head / saved LLM config)
 *  rather than an upstream catalog id. */
export function isUserConfiguredModelRef(model: string | null | undefined): boolean {
  return typeof model === 'string' && USER_CONFIGURED_PREFIXES.some((p) => model.startsWith(p));
}

/**
 * THE decision: may this viewer be shown the raw model id, or do they get the product
 * name? See the module header for the rule. `account` is the turn's provenance account
 * when known — a turn served by the tenant's OWN connected account always names its
 * model, because that model is the thing they connected.
 */
export function revealsModelId(
  identity: ModelIdentityContext | null | undefined,
  account?: ProvenanceAccount,
): boolean {
  if (account === 'own') return true;
  return (identity ?? DEFAULT_MODEL_IDENTITY).canChoose;
}

/**
 * The name to PUT ON SCREEN for `model`. Returns the model id when this viewer owns the
 * choice (see {@link revealsModelId}) or when the ref names something they configured
 * themselves; otherwise the routing product's name.
 *
 * Every surface that renders a model to a user goes through this — the composer menu,
 * the provenance chip, the QuickPick — so a masked plan cannot leak an upstream id
 * through whichever surface was written last.
 */
export function displayModelName(
  model: string | null | undefined,
  identity: ModelIdentityContext | null | undefined,
  opts?: { account?: ProvenanceAccount },
): string {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return productModelName(identity);
  if (isUserConfiguredModelRef(id)) return id;
  return revealsModelId(identity, opts?.account) ? id : productModelName(identity);
}
