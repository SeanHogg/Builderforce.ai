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
 * open. This module supplies both halves: a persistent tier chip in the composer
 * footer, and the shared navigation the chip and the error banner both use, so
 * they can never send the user somewhere different for the same problem.
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
 * `open.web` case in `builderforcePanel.ts`.
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

/** Human label for a `/api/consumption` meter key. */
function meterLabel(key: string, t: (key: string, fallback: string) => string): string {
  switch (key) {
    case 'ai_tokens': return t('app.meterAiTokens', 'AI tokens');
    case 'ingestion': return t('app.meterIngestion', 'Ingestion');
    case 'error_events': return t('app.meterErrorEvents', 'Error events');
    case 'outbound_fetches': return t('app.meterOutboundFetches', 'Outbound fetches');
    case 'cloud_runs': return t('app.meterCloudRuns', 'Cloud runs');
    default: return key.replace(/_/g, ' ');
  }
}

/** Compact "in 22m" / "in 6d" for a future ISO timestamp. */
function formatReset(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return tNow();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function tNow(): string {
  return 'now';
}

/**
 * Full account + usage readout for the `/` menu's Status tab. Same snapshot as
 * {@link PlanBadge}, but lists every meter (not just AI tokens) the way an
 * account panel does — plan, billing status, period reset, and a bar per meter.
 */
export function AccountStatusPanel({
  apiReq,
  t,
}: {
  apiReq: AuthedFetch;
  t: (key: string, fallback: string) => string;
}) {
  const plan = usePlanSnapshot(apiReq);
  if (!plan) {
    return <div className="bf-pmenu__desc">{t('app.statusLoading', 'Loading account…')}</div>;
  }

  const tier = plan.plan.effective;
  const isFree = tier === 'free';
  const label = planLabel(tier);
  const billing = plan.plan.billingStatus;
  const reset = formatReset(plan.period?.resetsAt);

  return (
    <div className="bf-acct">
      <div className="bf-pmenu__group">{t('app.account', 'Account')}</div>
      <div className="bf-acct__row">
        <span className="bf-acct__k">{t('app.plan', 'Plan')}</span>
        <span className="bf-acct__v">
          {label}
          {billing && billing !== 'active' && billing !== 'none' ? ` · ${billing}` : ''}
        </span>
      </div>
      {reset && (
        <div className="bf-acct__row">
          <span className="bf-acct__k">{t('app.resets', 'Resets')}</span>
          <span className="bf-acct__v">{reset}</span>
        </div>
      )}

      <div className="bf-pmenu__group">{t('app.usage', 'Usage')}</div>
      {(plan.meters ?? []).length === 0 && (
        <div className="bf-pmenu__desc">{t('app.usageEmpty', 'No usage meters for this plan.')}</div>
      )}
      {(plan.meters ?? []).map((m) => {
        const pct = m.unlimited ? null : Math.max(0, Math.min(100, Math.round(m.percentUsed)));
        return (
          <div key={m.key} className="bf-acct__meter">
            <div className="bf-acct__row bf-acct__row--flush">
              <span className="bf-acct__k">{meterLabel(m.key, t)}</span>
              <span className="bf-acct__v">
                {m.unlimited ? t('app.unlimited', 'Unlimited') : `${pct}%`}
              </span>
            </div>
            {pct != null && (
              <div className="bf-acct__bar" aria-hidden="true">
                <div className="bf-acct__bar-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
            {!m.unlimited && (
              <div className="bf-acct__meta">
                {m.used.toLocaleString()} / {m.limit.toLocaleString()}
                {m.unit && m.unit !== 'count' ? ` ${m.unit}` : ''}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="bf-pmenu__item"
        onClick={() => {
          invalidatePlanSnapshot();
          openUpgrade(isFree ? 'pricing' : 'billing');
        }}
      >
        <span className="bf-pmenu__lbl">
          {isFree ? t('app.upgrade', 'Upgrade') : t('app.managePlan', 'Manage plan')}
        </span>
      </button>
    </div>
  );
}

/**
 * The account-tier chip. Self-gating and self-navigating: it
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
