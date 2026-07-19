import { useEffect, useState } from 'react';
import type { AuthedFetch } from './authedFetch';
import type { ChatDiagnosticsMeter } from '@seanhogg/builderforce-brain-embedded';
import { post } from './vscodeBridge';

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

/** `GET /api/consumption` — plan + month-to-date allowance per metered resource.
 *  Open to any tenant-scoped JWT (no role gate), so the VSIX token can read it. */
export interface PlanSnapshot {
  period: { start: string; resetsAt: string };
  plan: { effective: string; billingStatus: string };
  meters: ChatDiagnosticsMeter[];
}

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

/**
 * Read-through cache for the plan snapshot. Every mounted surface (the header
 * chip, the diagnostics copy) shares ONE fetch rather than each hitting the
 * endpoint: the plan changes on a billing event, not per render. The server
 * caches it for 60s, so this mirrors that TTL and invalidates by simply expiring.
 */
const PLAN_TTL_MS = 60_000;
let planCache: { ts: number; data: PlanSnapshot | null } | null = null;
let planInFlight: Promise<PlanSnapshot | null> | null = null;

export function fetchPlanSnapshot(apiReq: AuthedFetch, forceRefresh = false): Promise<PlanSnapshot | null> {
  if (!forceRefresh && planCache && Date.now() - planCache.ts < PLAN_TTL_MS) {
    return Promise.resolve(planCache.data);
  }
  // Coalesce concurrent callers (header chip + a diagnostics copy in the same tick)
  // onto a single request.
  if (!forceRefresh && planInFlight) return planInFlight;
  planInFlight = apiReq<PlanSnapshot>('/api/consumption')
    .then((data) => {
      planCache = { ts: Date.now(), data };
      return data;
    })
    .catch(() => {
      // A failed read must not pin a "no plan" answer for a minute — leave the
      // cache alone so the next mount retries.
      return null;
    })
    .finally(() => {
      planInFlight = null;
    });
  return planInFlight;
}

/** Drop the cached plan so the next read re-fetches — call after an upgrade click,
 *  since the user may come back on a different tier. */
export function invalidatePlanSnapshot(): void {
  planCache = null;
}

/** Subscribe a component to the shared plan snapshot. */
export function usePlanSnapshot(apiReq: AuthedFetch): PlanSnapshot | null {
  const [plan, setPlan] = useState<PlanSnapshot | null>(planCache?.data ?? null);
  useEffect(() => {
    let alive = true;
    void fetchPlanSnapshot(apiReq).then((p) => { if (alive) setPlan(p); });
    return () => { alive = false; };
  }, [apiReq]);
  return plan;
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
