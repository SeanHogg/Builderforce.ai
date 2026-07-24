'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AUTH_API_URL, getStoredTenantToken } from '@/lib/auth';
import JsonLd from '@/components/JsonLd';
import PageContainer from '@/components/PageContainer';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { PremiumModelUnlock } from '@/components/llm/PremiumModelUnlock';
import { CardOnFile } from '@/components/llm/CardOnFile';
import { pricingSchema } from '@/lib/structured-data';

type Plan = 'free' | 'pro' | 'teams';

interface Subscription {
  plan: Plan;
  effectivePlan: Plan;
  billingStatus: string;
  billingCycle: 'monthly' | 'yearly' | null;
  billingEmail: string | null;
  billingPaymentBrand: string | null;
  billingPaymentLast4: string | null;
  billingUpdatedAt: string | null;
  seatCount: number | null;
  pricing: {
    pro: { monthly: number; yearly: number; yearlySavingsPercent: number };
    teams: { perSeatMonthly: number; perSeatYearly: number; yearlySavingsPercent: number; minimumSeats: number };
    managedAgentHost: { perAgentHostMonthly: number };
  };
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 24,
};

// Non-translatable plan/feature matrix (entitlement booleans). Row LABELS come
// from the `pricing.planFeatures` catalog array, paired by index — keep the two
// the same length and order.
const PLAN_FEATURE_FLAGS: { free: boolean; pro: boolean; teams: boolean }[] = [
  { free: true,  pro: true,  teams: true  },
  { free: true,  pro: false, teams: false },
  { free: false, pro: true,  teams: false },
  { free: false, pro: false, teams: true  },
  { free: true,  pro: false, teams: false },
  { free: false, pro: true,  teams: true  },
  { free: true,  pro: false, teams: false },
  { free: false, pro: true,  teams: false },
  { free: false, pro: false, teams: true  },
  { free: false, pro: true,  teams: true  },
  { free: false, pro: true,  teams: true  },
  { free: false, pro: true,  teams: true  },
  { free: false, pro: true,  teams: true  },
  { free: false, pro: false, teams: true  },
  { free: false, pro: false, teams: true  },
  { free: false, pro: true,  teams: true  },
  { free: true,  pro: false, teams: false },
];

function PlanBadge({ plan }: { plan: Plan }) {
  const colors: Record<Plan, { bg: string; color: string; label: string }> = {
    free:  { bg: 'var(--bg-elevated)', color: 'var(--text-muted)', label: 'Free' },
    pro:   { bg: 'var(--surface-coral-soft, rgba(244,114,94,0.15))', color: 'var(--coral-bright, #f4726e)', label: 'Pro' },
    teams: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa', label: 'Teams' },
  };
  const { bg, color, label } = colors[plan];
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', background: bg, color }}>
      {label}
    </span>
  );
}

function CheckIcon({ checked, color }: { checked: boolean; color: string }) {
  return (
    <span style={{ color: checked ? color : 'var(--text-muted)', fontWeight: 700, fontSize: 14 }}>
      {checked ? '✓' : '—'}
    </span>
  );
}

const PLAN_ACCENT: Record<Plan, string> = {
  free: 'var(--text-secondary)',
  pro: 'var(--coral-bright, #f4726e)',
  teams: '#60a5fa',
};

/**
 * Per-plan call-to-action: "Current plan" when active, an upgrade button for a
 * higher tier, or nothing for the Free base tier. Decides its own visibility so
 * the column header and the table footer stay in sync from one definition.
 */
function PlanCta({ plan, effectivePlan, onUpgrade, isAnon }: {
  plan: Plan;
  effectivePlan: Plan;
  onUpgrade: (target: 'pro' | 'teams') => void;
  isAnon?: boolean;
}) {
  const t = useTranslations('pricing');
  const planName = plan === 'teams' ? 'Teams' : 'Pro';
  // An anonymous visitor has no subscription, so never label a column as their
  // "Current plan"; the free column links them to sign-up instead.
  if (!isAnon && plan === effectivePlan) {
    return <span style={{ fontSize: 12, color: PLAN_ACCENT[plan], fontWeight: 600 }}>{t('ctaCurrentPlan')}</span>;
  }
  if (plan === 'free') {
    if (isAnon) {
      return (
        <a href="/register" style={{ fontSize: 12, color: PLAN_ACCENT.free, fontWeight: 600, textDecoration: 'none' }}>
          {t('ctaGetStarted')}
        </a>
      );
    }
    return null; // Free is the base tier — downgrade lives in the Current Plan card.
  }
  return (
    <button type="button" onClick={() => onUpgrade(plan)}
      style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: PLAN_ACCENT[plan], color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
      {isAnon ? t('ctaGet', { plan: planName }) : t('ctaUpgradeTo', { plan: planName })}
    </button>
  );
}

export default function PricingPageClient() {
  const t = useTranslations('pricing');
  const confirm = useConfirm();
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : null;

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upgradeTarget, setUpgradeTarget] = useState<'pro' | 'teams' | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [billingEmail, setBillingEmail] = useState('');
  const [seats, setSeats] = useState(5); // ≥ Teams volume minimum (server: PRICING.teams.minimumSeats)
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [downgrading, setDowngrading] = useState(false);

  const fetchSub = async () => {
    if (tenantId == null) return;
    setLoading(true);
    setError(null);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as Subscription;
      setSub(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSub(); }, [tenantId]);

  // Deep link: /pricing?upgrade=pro|teams pre-opens the upgrade form for a
  // signed-in tenant; an anonymous visitor is sent to register first (the
  // checkout is tenant-scoped, so there's nothing to open without a tenant).
  const searchParams = useSearchParams();
  useEffect(() => {
    const target = searchParams?.get('upgrade');
    if (target !== 'pro' && target !== 'teams') return;
    if (tenantId == null) {
      window.location.href = `/register?next=${encodeURIComponent(`/pricing?upgrade=${target}`)}`;
      return;
    }
    setUpgradeTarget(target);
  }, [searchParams, tenantId]);

  const effectivePlan = sub?.effectivePlan ?? 'free';
  // Anonymous marketing visitor (no tenant) gets sales-tone copy; a signed-in
  // tenant gets the billing-console framing ("manage your subscription").
  const isAnon = tenantId == null;

  const proMonthly  = sub?.pricing.pro.monthly ?? 29;
  const proYearly   = sub?.pricing.pro.yearly ?? 290;
  const teamMonthly = sub?.pricing.teams.perSeatMonthly ?? 20;
  const teamYearly  = sub?.pricing.teams.perSeatYearly ?? 192;
  // Teams is volume-priced below Pro per seat, earned by a seat-block minimum.
  // Surfacing the minimum is what keeps the lower per-seat price from reading as
  // a typo; the seat input and checkout both clamp to it.
  const teamMinSeats = sub?.pricing.teams.minimumSeats ?? 5;

  // Keep the seat count at or above the volume minimum whenever it's known —
  // covers both the initial load and a plan-pricing refresh.
  useEffect(() => {
    setSeats((s) => (s < teamMinSeats ? teamMinSeats : s));
  }, [teamMinSeats]);

  const upgradePrice = upgradeTarget === 'teams'
    ? (billingCycle === 'yearly' ? teamYearly * seats : teamMonthly * seats)
    : (billingCycle === 'yearly' ? proYearly : proMonthly);

  // Single entry point for every upgrade CTA (Current Plan card + comparison
  // table). With no tenant the checkout can't run, so route to register rather
  // than opening a modal whose submit would silently return.
  const openUpgrade = (target: 'pro' | 'teams') => {
    if (tenantId == null) {
      window.location.href = `/register?next=${encodeURIComponent(`/pricing?upgrade=${target}`)}`;
      return;
    }
    setUpgradeTarget(target);
    setUpgradeError(null);
  };

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || upgrading || !upgradeTarget) return;
    if (!billingEmail.trim()) { setUpgradeError(t('errorBillingEmailRequired')); return; }
    setUpgrading(true);
    setUpgradeError(null);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          targetPlan: upgradeTarget,
          billingCycle,
          billingEmail: billingEmail.trim(),
          ...(upgradeTarget === 'teams' && { seats }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `${res.status}`);
      }
      // Every checkout is hosted — Stripe always returns a URL to redirect to.
      const result = await res.json() as { checkoutUrl: string };
      window.location.href = result.checkoutUrl;
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : t('errorUpgradeFailed'));
    } finally {
      setUpgrading(false);
    }
  };

  const handleDowngrade = async () => {
    if (!tenantId || downgrading) return;
    if (!(await confirm({ message: t('downgradeConfirm'), destructive: false }))) return;
    setDowngrading(true);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/tenants/${tenantId}/subscription/free`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await fetchSub();
    } catch { /* noop */ }
    finally { setDowngrading(false); }
  };

  const teamsCostNote = upgradeTarget === 'teams'
    ? billingCycle === 'yearly'
      ? t('teamsCostNoteYear', { perSeat: teamYearly, total: teamYearly * seats })
      : t('teamsCostNoteMonth', { perSeat: teamMonthly, total: teamMonthly * seats })
    : null;

  return (
    <>
    <JsonLd data={pricingSchema()} />
    <PageContainer width="readable">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {isAnon ? t('titleAnon') : t('titleConsole')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
          {isAnon ? t('subtitleAnon') : t('subtitleConsole')}
        </p>
      </div>

      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Anonymous visitor: a sales-tone "get started" banner instead of the
              billing-console "Current Plan" card (they have no subscription). */}
          {isAnon ? (
            <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {t('anonBannerTitle')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('anonBannerDesc')}
                </div>
              </div>
              <a href="/register"
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 8, textDecoration: 'none' }}>
                {t('anonBannerCta')}
              </a>
            </div>
          ) : (
          <>
          {/* Current plan */}
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('currentPlan')}</div>
                <PlanBadge plan={sub?.plan ?? 'free'} />
                {sub?.billingStatus && sub.billingStatus !== 'active' && sub.billingStatus !== 'none' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({sub.billingStatus})</span>
                )}
              </div>
              {effectivePlan !== 'free' && sub && (
                <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  {sub.billingCycle && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>{t('fieldBillingCycle')}</span>
                      <span>{sub.billingCycle === 'yearly' ? t('cycleYearlyCap') : t('cycleMonthlyCap')}</span>
                    </div>
                  )}
                  {sub.seatCount != null && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>{t('fieldSeats')}</span>
                      <span>{sub.seatCount}</span>
                    </div>
                  )}
                  {sub.billingEmail && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>{t('fieldBillingEmail')}</span>
                      <span>{sub.billingEmail}</span>
                    </div>
                  )}
                  {sub.billingPaymentBrand && sub.billingPaymentLast4 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>{t('fieldPaymentMethod')}</span>
                      <span style={{ textTransform: 'capitalize' }}>{sub.billingPaymentBrand} ···· {sub.billingPaymentLast4}</span>
                    </div>
                  )}
                  {sub.billingUpdatedAt && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 130 }}>{t('fieldLastUpdated')}</span>
                      <span>{new Date(sub.billingUpdatedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {effectivePlan === 'free' ? (
              <button type="button" onClick={() => openUpgrade('pro')}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {t('upgradePlan')}
              </button>
            ) : (
              <button type="button" onClick={handleDowngrade} disabled={downgrading}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: downgrading ? 'wait' : 'pointer' }}>
                {downgrading ? t('downgrading') : t('downgradeToFree')}
              </button>
            )}
          </div>

          {/* Card validation, on the billing console rather than only beside a model
              picker. Premium access needs a paid plan AND a validated card, so a
              tenant told "add and validate a card" had nowhere to go — the control
              lived exclusively inside <ModelSelect>, which the VS Code extension and
              every non-model surface deep-link away from. Self-gating: renders
              nothing for an already-entitled tenant. */}
          <PremiumModelUnlock />

          {/* The after state: the card premium access actually rides on, and the
              only way to replace it. PremiumModelUnlock covers "no card yet"; this
              covers pending / validated / failed. Both self-gate, so exactly one
              renders for any given card status. */}
          <CardOnFile />
          </>
          )}

          {/* Upgrade checkout — a slide-out panel (opened by any upgrade CTA). Per the
              app convention only terminal/destructive confirms use a centered modal;
              everything else, this checkout included, uses SlideOutPanel. */}
          <SlideOutPanel
            open={upgradeTarget != null && effectivePlan !== upgradeTarget}
            onClose={() => { setUpgradeTarget(null); setUpgradeError(null); }}
            title={t('modalUpgradeTo', { plan: upgradeTarget === 'teams' ? 'Teams' : 'Pro' })}
            width="min(560px, 96vw)"
          >
            <div style={{ padding: 20 }}>
              <form onSubmit={handleUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelBillingCycle')}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['monthly', 'yearly'] as const).map((c) => {
                      const saving = upgradeTarget === 'teams'
                        ? t('saveCycle', { pct: sub?.pricing.teams.yearlySavingsPercent ?? 20 })
                        : t('saveCycle', { pct: sub?.pricing.pro.yearlySavingsPercent ?? 17 });
                      const cycleLabel = c === 'yearly' ? t('cycleYearly') : t('cycleMonthly');
                      return (
                        <button key={c} type="button" onClick={() => setBillingCycle(c)}
                          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border-subtle)', background: billingCycle === c ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)', color: billingCycle === c ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                          {c === 'yearly' ? t('cycleYearlyWithSaving', { cycle: cycleLabel, saving }) : cycleLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {upgradeTarget === 'teams' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelSeats')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="number" min={teamMinSeats} value={seats}
                        onChange={(e) => setSeats(Math.max(teamMinSeats, parseInt(e.target.value, 10) || teamMinSeats))}
                        style={{ width: 80, padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8 }} />
                      {teamsCostNote && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{teamsCostNote}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('teamsSeatMinimum', { min: teamMinSeats })}</div>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelBillingEmail')}</label>
                  <input type="email" required value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder={t('placeholderBillingEmail')}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, boxSizing: 'border-box' }} />
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  {t('redirectNote')}
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  {t('total', { price: upgradePrice, unit: billingCycle === 'yearly' ? t('unitYear') : t('unitMonth') })}
                  {upgradeTarget === 'teams' && ` ${t('totalForSeats', { seats })}`}
                </div>

                {upgradeError && <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)' }}>{upgradeError}</div>}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setUpgradeTarget(null); setUpgradeError(null); }}
                    style={{ padding: '8px 16px', fontSize: 13, background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                    {t('cancel')}
                  </button>
                  <button type="submit" disabled={upgrading}
                    style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, background: upgradeTarget === 'teams' ? '#60a5fa' : 'var(--coral-bright, #f4726e)', color: '#fff', border: 'none', borderRadius: 8, cursor: upgrading ? 'wait' : 'pointer' }}>
                    {upgrading ? t('redirecting') : t('continueToPayment')}
                  </button>
                </div>
              </form>
            </div>
          </SlideOutPanel>

          {/* Plan comparison table */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>{t('planComparison')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>{t('colFeature')}</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', minWidth: 90 }}>
                      Free<br /><span style={{ fontWeight: 400, fontSize: 11 }}>{t('priceFree')}</span>
                      <div style={{ marginTop: 8 }}><PlanCta plan="free" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} /></div>
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: 'var(--coral-bright, #f4726e)', borderBottom: '1px solid var(--border-subtle)', minWidth: 90 }}>
                      Pro<br /><span style={{ fontWeight: 400, fontSize: 11 }}>{t('priceProMonthly', { price: proMonthly })}</span>
                      <div style={{ marginTop: 8 }}><PlanCta plan="pro" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} /></div>
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: '#60a5fa', borderBottom: '1px solid var(--border-subtle)', minWidth: 110 }}>
                      Teams<br /><span style={{ fontWeight: 400, fontSize: 11 }}>{t('priceTeamsMonthly', { price: teamMonthly })}</span>
                      <br /><span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)' }}>{t('teamsVolumeNote', { min: teamMinSeats })}</span>
                      <div style={{ marginTop: 8 }}><PlanCta plan="teams" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} /></div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(t.raw('planFeatures') as string[]).map((label, i) => {
                    const flags = PLAN_FEATURE_FLAGS[i];
                    return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{label}</td>
                      <td style={{ textAlign: 'center', padding: '9px 12px' }}><CheckIcon checked={flags.free} color="var(--text-secondary)" /></td>
                      <td style={{ textAlign: 'center', padding: '9px 12px' }}><CheckIcon checked={flags.pro} color="var(--coral-bright, #f4726e)" /></td>
                      <td style={{ textAlign: 'center', padding: '9px 12px' }}><CheckIcon checked={flags.teams} color="#60a5fa" /></td>
                    </tr>
                  );})}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ padding: '14px 12px' }} />
                    <td style={{ textAlign: 'center', padding: '14px 12px' }}>
                      <PlanCta plan="free" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} />
                    </td>
                    <td style={{ textAlign: 'center', padding: '14px 12px' }}>
                      <PlanCta plan="pro" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} />
                    </td>
                    <td style={{ textAlign: 'center', padding: '14px 12px' }}>
                      <PlanCta plan="teams" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
              {t.rich('managedAddon', {
                price: sub?.pricing.managedAgentHost.perAgentHostMonthly ?? 49,
                b: (c) => <strong>{c}</strong>,
              })}
            </div>
          </div>

        </div>
      )}
      {isAnon && <RelatedArticles surface="pricing" heading={t('relatedHeading')} />}
    </PageContainer>
    </>
  );
}
