import { useEffect, useState } from 'react';
import type { AuthedFetch } from './authedFetch';
import type { ChatDiagnosticsMeter } from '@seanhogg/builderforce-brain-embedded';
import { post } from './vscodeBridge';
import { cachedPlanSnapshot, fetchPlanSnapshot, invalidatePlanSnapshot, type PlanSnapshot } from './planSnapshot';

// The plan snapshot + its shared cache live in `./planSnapshot` (React-free, so the
// headless probe can read the same one). Re-exported here because every existing
// caller imports them from this module.
export { fetchPlanSnapshot, invalidatePlanSnapshot };
export type { PlanSnapshot };

/**
 * The tenant's account tier, and the ONE place the VSIX decides where an "upgrade"
 * click lands.
 *
 * The chat used to be silent about WHO the user is to the platform. A free-plan
 * member with a small allowance and no card looks, from inside the panel,
 * identical to a broken install — right up until a turn dies on a 402 telling
 * them to "add a card in Settings ▸ Billing", a place the panel never offered to
 * open. This module supplies both halves: a persistent tier chip in the header,
 * and the shared navigation the chip and the error banner both use, so they can
 * never send the user somewhere different for the same problem.
 */

/**
 * Where an upgrade-ish click goes. `/pricing` IS the billing console in the web
 * app — it renders the Current Plan card, subscription state and the upgrade
 * forms — so both destinations live there, distinguished by the deep-link param
 * the page already understands (`?upgrade=pro` pre-opens the upgrade form, the
 * same link the web app's own PremiumModelUnlock uses).
 *
 * There is deliberately no `/settings?tab=billing`: that route does not exist,
 * and sending someone to a page that can't fix their problem is worse than the
 * error message that at least named it.
 */
export type UpgradeTarget = 'pricing' | 'billing';

const UPGRADE_PATHS: Record<UpgradeTarget, string> = {
  pricing: '/pricing?upgrade=pro',
  billing: '/pricing',
};

/**
 * Open the web app at the page that actually fixes the block. The host owns the
 * browser (and the web base URL), so this goes over the bridge — see the
 * `open.web` case in `brainWebview.ts`.
 */
export function openUpgrade(target: UpgradeTarget): void {
  post('open.web', { path: UPGRADE_PATHS[target] });
}

/** Subscribe a component to the shared plan snapshot. */
export function usePlanSnapshot(apiReq: AuthedFetch): PlanSnapshot | null {
  const [plan, setPlan] = useState<PlanSnapshot | null>(cachedPlanSnapshot());
  useEffect(() => {
    let alive = true;
    void fetchPlanSnapshot(apiReq).then((p) => { if (alive) setPlan(p); });
    return () => { alive = false; };
  }, [apiReq]);
  return plan;
}

/**
 * Is this workspace on a PAID tier? The one predicate, so no surface invents its
 * own answer.
 *
 * It reads the shared `/api/consumption` snapshot — the authoritative plan source,
 * and the only one that also carries the allowance meters. The alternative reading
 * (off `GET /llm/v1/models`) is a trap twice over: its `premium` field is the
 * superadmin OVERRIDE flag rather than "has a paid plan", and its `effectivePlan`
 * silently degrades to `'free'` when auth fails — so a transient blip downgrades
 * the UI instead of surfacing an error.
 *
 * Fails CLOSED (false) when the plan can't be read: showing paid-only options to
 * someone who can't use them is the worse error.
 */
export async function fetchIsPaidPlan(apiReq: AuthedFetch): Promise<boolean> {
  const plan = await fetchPlanSnapshot(apiReq);
  return plan != null && plan.plan.effective !== 'free';
}

/** The AI-token meter — the allowance a chat turn actually spends. */
function tokenMeter(plan: PlanSnapshot | null): ChatDiagnosticsMeter | null {
  return plan?.meters.find((m) => m.key === 'ai_tokens') ?? null;
}

/** Title-case a plan key for display ('free' → 'Free'). */
function planLabel(key: string): string {
  return key.replace(/^./, (ch) => ch.toUpperCase());
}

/**
 * The account-tier chip in the chat header. Self-gating and self-navigating: it
 * fetches its own plan, renders nothing until it knows one (never a misleading
 * "Free" while loading), and clicking it opens the page that changes the tier.
 *
 * A paid plan still shows — knowing you're on Pro is the reassurance half of the
 * same question — but only the free tier gets the call-to-action styling and the
 * remaining-allowance readout, because only there does the number gate anything.
 */
export function PlanBadge({
  apiReq,
  t,
}: {
  apiReq: AuthedFetch;
  t: (key: string, fallback: string) => string;
}) {
  const plan = usePlanSnapshot(apiReq);
  if (!plan) return null;

  const tier = plan.plan.effective;
  // Same rule as `fetchIsPaidPlan` — inverted here because the chip is written
  // around the free case. One definition of "paid", one of "free".
  const isFree = tier === 'free';
  const meter = tokenMeter(plan);
  // "Available tokens" only means something on a metered plan; an unlimited or
  // absent meter shows the tier alone rather than a fake number.
  const remaining = meter && !meter.unlimited && meter.remaining >= 0 ? meter.remaining : null;
  const exhausted = remaining !== null && remaining <= 0;

  const label = planLabel(tier);
  const title = isFree
    ? t(
        'app.planFreeHint',
        'You are on the Free plan — chats run on the included BuilderForce models. Click to see plans and upgrade.',
      )
    : t('app.planPaidHint', 'Your workspace is on the {plan} plan. Click to manage your plan.').replace(
        '{plan}',
        label,
      );

  // Free + out of allowance is the one state that must read as a problem; free
  // with headroom is informational, and a paid plan is neutral. All three are
  // editor-theme tokens, so the chip is legible in light AND dark themes.
  const tone = exhausted
    ? 'var(--bf-error)'
    : isFree
      ? 'var(--bf-accent)'
      : 'var(--bf-text-muted)';

  return (
    <button
      type="button"
      className="bf-plan-badge"
      data-tier={isFree ? 'free' : 'paid'}
      title={title}
      aria-label={title}
      onClick={() => {
        invalidatePlanSnapshot();
        openUpgrade(isFree ? 'pricing' : 'billing');
      }}
      style={{ color: tone, borderColor: tone }}
    >
      <span>{label}</span>
      {remaining !== null && (
        <span className="bf-plan-badge__meter">
          {exhausted
            ? t('app.planNoTokens', 'no tokens left')
            : t('app.planTokensLeft', '{count} tokens left').replace(
                '{count}',
                remaining.toLocaleString(),
              )}
        </span>
      )}
      {isFree && <span aria-hidden className="bf-plan-badge__cta">{t('app.upgrade', 'Upgrade')}</span>}
    </button>
  );
}
