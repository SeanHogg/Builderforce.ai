'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
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
import { getRetainedDiscountCode, retainDiscountCode } from '@/lib/discountCode';
import styles from './pricing.module.css';
import { fetchPublicPricing, type PublicPricingContract, type PublicPricingPlan } from '@/lib/publicPricing';
import { NAV_GROUPS } from '@/lib/navGroups';
import { isNavigationFeatureId } from '@/lib/navigationFeatures';
import { useCart } from '@/lib/CartContext';

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

function PlanBadge({ plan }: { plan: Plan }) {
  const t = useTranslations('planBadge.tier');
  const labels: Record<Plan, string> = { free: t('free'), pro: t('pro'), teams: t('teams') };
  return <span className={styles.planBadge} data-plan={plan}>{labels[plan]}</span>;
}

function CheckIcon({ checked }: { checked: boolean }) {
  return <span className={checked ? styles.check : styles.dash}>{checked ? '✓' : '—'}</span>;
};

/**
 * Per-plan call-to-action: "Current plan" when active, an upgrade button for a
 * higher tier, or nothing for the Free base tier. Decides its own visibility so
 * the column header and the table footer stay in sync from one definition.
 */
function PlanCta({ plan, effectivePlan, onUpgrade, isAnon, label, href }: {
  plan: Plan;
  effectivePlan: Plan;
  onUpgrade: (target: 'pro' | 'teams') => void;
  isAnon?: boolean;
  label?: string;
  href?: string;
}) {
  const t = useTranslations('pricing');
  const tierT = useTranslations('planBadge.tier');
  const planName = plan === 'teams' ? tierT('teams') : tierT('pro');
  // An anonymous visitor has no subscription, so never label a column as their
  // "Current plan"; the free column links them to sign-up instead.
  if (!isAnon && plan === effectivePlan) {
    return <span className={styles.statusText}>{t('ctaCurrentPlan')}</span>;
  }
  if (plan === 'free') {
    if (isAnon) {
      return (
        <a href={href ?? '/register'} className={styles.planButton} data-plan="free">
          {label ?? t('ctaGetStarted')}
        </a>
      );
    }
    return null; // Free is the base tier — downgrade lives in the Current Plan card.
  }
  if (isAnon && label && href) {
    return <a href={href} className={styles.planButton} data-plan={plan}>{label}</a>;
  }
  return (
    <button type="button" onClick={() => onUpgrade(plan)} className={styles.planButton} data-plan={plan}>
      {isAnon ? t('ctaGet', { plan: planName }) : t('ctaUpgradeTo', { plan: planName })}
    </button>
  );
}

export default function PricingPageClient() {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const tierT = useTranslations('planBadge.tier');
  const navT = useTranslations('nav');
  const confirm = useConfirm();
  const { tenant } = useAuth();
  const { addItem, hasItem, openCart } = useCart();
  const searchParams = useSearchParams();
  const tenantId = tenant?.id != null ? Number(tenant.id) : null;
  const selectedModuleIds = Array.from(new Set(
    (searchParams?.get('features') ?? '').split(',').filter(isNavigationFeatureId),
  ));
  const selectedModuleLabels = selectedModuleIds.map((id) => {
    const group = NAV_GROUPS.find((candidate) => candidate.id === id);
    return group ? navT(group.labelKey) : id;
  });

  const [sub, setSub] = useState<Subscription | null>(null);
  const [publicPricing, setPublicPricing] = useState<PublicPricingContract | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upgradeTarget, setUpgradeTarget] = useState<'pro' | 'teams' | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [billingEmail, setBillingEmail] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [seats, setSeats] = useState(1); // Clamped once the public entitlement contract loads.
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

  useEffect(() => {
    let active = true;
    fetchPublicPricing()
      .then((contract) => { if (active) setPublicPricing(contract); })
      .catch((cause) => {
        if (active) setError(t('errorPricingContract', { reason: cause instanceof Error ? cause.message : String(cause) }));
      });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    if (searchParams?.get('success') === '1') {
      setDiscountCode('');
      retainDiscountCode('');
      return;
    }
    const captured = searchParams?.get('discountcode') ?? getRetainedDiscountCode();
    if (captured) {
      setDiscountCode(captured.toUpperCase());
      setBillingCycle('yearly');
      retainDiscountCode(captured);
    }
  }, [searchParams]);

  // Deep link: /pricing?upgrade=pro|teams pre-opens the upgrade form for a
  // signed-in tenant; an anonymous visitor is sent to register first (the
  // checkout is tenant-scoped, so there's nothing to open without a tenant).
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

  const pricing = publicPricing?.pricing ?? sub?.pricing;
  const proMonthly  = pricing?.pro.monthly;
  const proYearly   = pricing?.pro.yearly;
  const teamMonthly = pricing?.teams.perSeatMonthly;
  const teamYearly  = pricing?.teams.perSeatYearly;
  // Teams is volume-priced below Pro per seat, earned by a seat-block minimum.
  // Surfacing the minimum is what keeps the lower per-seat price from reading as
  // a typo; the seat input and checkout both clamp to it.
  const teamMinSeats = pricing?.teams.minimumSeats ?? 1;

  // Keep the seat count at or above the volume minimum whenever it's known —
  // covers both the initial load and a plan-pricing refresh.
  useEffect(() => {
    setSeats((s) => (s < teamMinSeats ? teamMinSeats : s));
  }, [teamMinSeats]);

  const upgradePrice = upgradeTarget === 'teams'
    ? (billingCycle === 'yearly' ? (teamYearly ?? 0) * seats : (teamMonthly ?? 0) * seats)
    : (billingCycle === 'yearly' ? (proYearly ?? 0) : (proMonthly ?? 0));

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
    if (!pricing) { setUpgradeError(t('pricingUnavailable')); return; }
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
          ...(discountCode.trim() && { discountCode: discountCode.trim() }),
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

  const teamsCostNote = upgradeTarget === 'teams' && teamMonthly != null && teamYearly != null
    ? billingCycle === 'yearly'
      ? t('teamsCostNoteYear', { perSeat: teamYearly, total: teamYearly * seats })
      : t('teamsCostNoteMonth', { perSeat: teamMonthly, total: teamMonthly * seats })
    : null;

  const configuredPlans = publicPricing?.plans ?? [];
  const planById = (id: Plan): PublicPricingPlan | undefined => configuredPlans.find((plan) => plan.id === id);
  const comparisonFeatures = Array.from(new Set(configuredPlans.flatMap((plan) => [...plan.features, ...plan.excluded])));
  const formatPrice = (price: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: publicPricing?.currency ?? 'USD', maximumFractionDigits: 0 }).format(price);
  const formatAddonPrice = (price: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: publicPricing?.currency ?? 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);

  return (
    <>
    <JsonLd data={pricingSchema(publicPricing ?? undefined)} />
    <PageContainer width="full" style={{ padding: 0 }}>
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{t('planComparison')}</p>
          <h1>{isAnon ? t('titleAnon') : t('titleConsole')}</h1>
          <p className={styles.lede}>{isAnon ? t('subtitleAnon') : t('subtitleConsole')}</p>
        </div>
        <div className={styles.heroPanel}>
          <span className={styles.heroPanelLabel}>{planById('free')?.name ?? t('anonBannerTitle')}</span>
          <h2>{t('priceFree')}</h2>
          <p>{planById('free')?.description ?? t('anonBannerDesc')}</p>
          <a href={planById('free')?.ctaHref ?? '/register'} className={styles.primaryButton}>{planById('free')?.ctaLabel ?? t('anonBannerCta')}</a>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.notice}>{t('loading')}</div>
      ) : (
        <div className={styles.content}>
          {!isAnon && (
          <>
          {selectedModuleLabels.length > 0 && (
            <div className={styles.accountCard}>
              <div className={styles.accountCardBody}>
                <div className={styles.accountCardTitle}>{t('enabledModulesTitle', { count: selectedModuleLabels.length })}</div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{t('enabledModulesDescription')}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {selectedModuleLabels.map((label) => (
                    <span key={label} style={{ padding: '4px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', fontSize: 11 }}>{label}</span>
                  ))}
                </div>
              </div>
              <Link href="/settings?sub=features" className={styles.secondaryButton}>{t('manageEnabledModules')}</Link>
            </div>
          )}
          {/* Current plan */}
          <div className={styles.accountCard}>
            <div className={styles.accountCardBody}>
              <div className={styles.accountCardTitle}>
                <span>{t('currentPlan')}</span>
                <PlanBadge plan={sub?.plan ?? 'free'} />
                {sub?.billingStatus && sub.billingStatus !== 'active' && sub.billingStatus !== 'none' && (
                  <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>({sub.billingStatus})</span>
                )}
              </div>
              {effectivePlan !== 'free' && sub && (
                <div className={styles.accountDetails}>
                  {sub.billingCycle && (
                    <div className={styles.accountDetail}>
                      <span>{t('fieldBillingCycle')}</span>
                      <span>{sub.billingCycle === 'yearly' ? t('cycleYearlyCap') : t('cycleMonthlyCap')}</span>
                    </div>
                  )}
                  {sub.seatCount != null && (
                    <div className={styles.accountDetail}>
                      <span>{t('fieldSeats')}</span>
                      <span>{sub.seatCount}</span>
                    </div>
                  )}
                  {sub.billingEmail && (
                    <div className={styles.accountDetail}>
                      <span>{t('fieldBillingEmail')}</span>
                      <span>{sub.billingEmail}</span>
                    </div>
                  )}
                  {sub.billingPaymentBrand && sub.billingPaymentLast4 && (
                    <div className={styles.accountDetail}>
                      <span>{t('fieldPaymentMethod')}</span>
                      <span style={{ textTransform: 'capitalize' }}>{sub.billingPaymentBrand} ···· {sub.billingPaymentLast4}</span>
                    </div>
                  )}
                  {sub.billingUpdatedAt && (
                    <div className={styles.accountDetail}>
                      <span>{t('fieldLastUpdated')}</span>
                      <span>{new Date(sub.billingUpdatedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {effectivePlan === 'free' || sub?.billingStatus !== 'active' ? (
              <button type="button" onClick={() => openUpgrade('pro')} className={styles.primaryButton}>
                {t('upgradePlan')}
              </button>
            ) : (
              <button type="button" onClick={handleDowngrade} disabled={downgrading}
                className={styles.secondaryButton}>
                {downgrading ? t('downgrading') : t('downgradeToFree')}
              </button>
            )}
          </div>

          {/* Billing details and card validation are independent of upgrades. Free
              tenants can add a funding instrument here for metered OpenRouter usage. */}
          <PremiumModelUnlock />

          {/* The after state: the card premium access actually rides on, and the
              only way to replace it. PremiumModelUnlock covers "no card yet"; this
              covers pending / validated / failed. Both self-gate, so exactly one
              renders for any given card status. */}
          <CardOnFile />
          </>
          )}

          <section className={styles.section}>
            <div className={styles.planGrid}>
              {configuredPlans.map((configured) => {
                const plan = configured.id;
                return (
                <article key={plan} className={styles.planCard} data-featured={plan === 'pro'}>
                  <div className={styles.planCardTop}>
                    <h3>{configured.name}</h3>
                    {effectivePlan === plan && !isAnon && <PlanBadge plan={plan} />}
                  </div>
                  <div className={styles.price}>
                    <span className={styles.priceAmount}>{formatPrice(configured.monthly)}</span>
                    {configured.monthly !== 0 && <span className={styles.priceSuffix}>{configured.priceSuffix}</span>}
                  </div>
                  <p className={styles.priceNote}>{configured.description}</p>
                  <ul className={styles.featureList}>
                    {configured.features.map((feature) => <li key={feature}>{feature}</li>)}
                    {configured.excluded.map((feature) => <li key={feature} style={{ opacity: 0.6 }}>— {feature}</li>)}
                  </ul>
                  <div className={styles.planCardAction}>
                    <PlanCta plan={plan} effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} label={configured.ctaLabel} href={configured.ctaHref} />
                  </div>
                </article>
              );})}
            </div>
          </section>

          {publicPricing?.businessPhone && (
            <section className={styles.phoneOffer} aria-labelledby="business-phone-title">
              <div className={styles.phoneOfferCopy}>
                <p className={styles.eyebrow}>{t('phone.eyebrow')}</p>
                <h2 id="business-phone-title">{t('phone.title')}</h2>
                <p>{t('phone.description')}</p>
                <ul className={styles.phoneFeatures}>
                  <li>{t('phone.dedicatedNumber')}</li><li>{t('phone.forwarding')}</li>
                  <li>{t('phone.allowance', { minutes: publicPricing.businessPhone.includedMinutes, sms: publicPricing.businessPhone.includedSms, mms: publicPricing.businessPhone.includedMms })}</li>
                </ul>
                <p className={styles.phoneOverages}>{t('phone.overages', { minute: publicPricing.businessPhone.overagePerMinute, sms: publicPricing.businessPhone.overagePerSms, mms: publicPricing.businessPhone.overagePerMms })}</p>
                <Link href="/crm/phone" className={styles.secondaryButton}>{t('phone.learnMore')}</Link>
              </div>
              <div className={styles.phonePriceCard}>
                <span>{t('phone.addonFor')}</span>
                <strong>{formatAddonPrice(publicPricing.businessPhone.monthly)}<small>{t('phone.perMonth')}</small></strong>
                <p>{t('phone.activation', { price: publicPricing.businessPhone.activation })}</p>
                <button type="button" className={styles.primaryButton} onClick={() => {
                  const id = 'service:business-phone';
                  if (!hasItem(id)) addItem({ id, type: 'service', slug: 'business-phone', name: t('phone.title'), price: publicPricing.businessPhone.monthly, setupFee: publicPricing.businessPhone.activation, pricingModel: 'subscription', priceUnit: t('phone.perMonth'), checkoutKind: 'business_phone', emoji: 'phone' });
                  else openCart();
                }}>{hasItem('service:business-phone') ? t('phone.viewCart') : t('phone.addToCart')}</button>
                <small>{t('phone.eligibility')}</small>
              </div>
            </section>
          )}

          {/* Upgrade checkout — a slide-out panel (opened by any upgrade CTA). Per the
              app convention only terminal/destructive confirms use a centered modal;
              everything else, this checkout included, uses SlideOutPanel. */}
          <SlideOutPanel
            open={upgradeTarget != null && !(sub?.billingStatus === 'active' && sub.plan === upgradeTarget)}
            onClose={() => { setUpgradeTarget(null); setUpgradeError(null); }}
            title={t('modalUpgradeTo', { plan: upgradeTarget === 'teams' ? tierT('teams') : tierT('pro') })}
            width="min(560px, 96vw)"
          >
            <div style={{ padding: 20 }}>
              <form onSubmit={handleUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelBillingCycle')}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['monthly', 'yearly'] as const).map((c) => {
                      const saving = upgradeTarget === 'teams'
                        ? t('saveCycle', { pct: pricing?.teams.yearlySavingsPercent ?? 0 })
                        : t('saveCycle', { pct: pricing?.pro.yearlySavingsPercent ?? 0 });
                      const cycleLabel = c === 'yearly' ? t('cycleYearly') : t('cycleMonthly');
                      return (
                        <button key={c} type="button" onClick={() => setBillingCycle(c)}
                          style={{ padding: '7px 16px', fontSize: 'var(--font-size-small)', fontWeight: 600, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: billingCycle === c ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)', color: billingCycle === c ? 'var(--coral-bright)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                          {c === 'yearly' ? t('cycleYearlyWithSaving', { cycle: cycleLabel, saving }) : cycleLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {upgradeTarget === 'teams' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelSeats')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="number" min={teamMinSeats} value={seats}
                        onChange={(e) => setSeats(Math.max(teamMinSeats, parseInt(e.target.value, 10) || teamMinSeats))}
                        style={{ width: 80, padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }} />
                      {teamsCostNote && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{teamsCostNote}</span>}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 6 }}>{t('teamsSeatMinimum', { min: teamMinSeats })}</div>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelBillingEmail')}</label>
                  <input type="email" required value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder={t('placeholderBillingEmail')}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxSizing: 'border-box' }} />
                </div>

                <div>
                  <label htmlFor="checkout-discount-code" style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('labelDiscountCode')}</label>
                  <input id="checkout-discount-code" type="text" value={discountCode}
                    onChange={(e) => { setDiscountCode(e.target.value.toUpperCase()); retainDiscountCode(e.target.value); }}
                    placeholder={t('placeholderDiscountCode')}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxSizing: 'border-box' }} />
                  {discountCode && <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--coral-bright)', marginTop: 6 }}>{t('discountVerificationNote')}</div>}
                </div>

                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
                  {t('redirectNote')}
                </div>

                <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
                  {pricing ? t('total', { price: upgradePrice, unit: billingCycle === 'yearly' ? t('unitYear') : t('unitMonth') }) : t('pricingUnavailable')}
                  {upgradeTarget === 'teams' && ` ${t('totalForSeats', { seats })}`}
                </div>

                {upgradeError && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--coral-bright)' }}>{upgradeError}</div>}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setUpgradeTarget(null); setUpgradeError(null); }}
                    style={{ padding: '8px 16px', fontSize: 'var(--font-size-small)', background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                    {t('cancel')}
                  </button>
                  <button type="submit" disabled={upgrading || !pricing}
                    style={{ padding: '8px 18px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: upgradeTarget === 'teams' ? 'var(--info)' : 'var(--coral-bright)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: upgrading ? 'wait' : 'pointer' }}>
                    {upgrading ? t('redirecting') : t('continueToPayment')}
                  </button>
                </div>
              </form>
            </div>
          </SlideOutPanel>

          {/* Plan comparison table */}
          <section className={styles.comparisonCard}>
            <div className={styles.comparisonTitle}>{t('planComparison')}</div>
            <div className={styles.tableScroll}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th>{t('colFeature')}</th>
                    <th>
                      {planById('free')?.name ?? tierT('free')}<br /><span style={{ fontWeight: 400, fontSize: 'var(--font-size-eyebrow)' }}>{t('priceFree')}</span>
                    </th>
                    <th>
                      {planById('pro')?.name ?? tierT('pro')}<br /><span style={{ fontWeight: 400, fontSize: 'var(--font-size-eyebrow)' }}>{proMonthly != null ? t('priceProMonthly', { price: proMonthly }) : '—'}</span>
                    </th>
                    <th>
                      {planById('teams')?.name ?? tierT('teams')}<br /><span style={{ fontWeight: 400, fontSize: 'var(--font-size-eyebrow)' }}>{teamMonthly != null ? t('priceTeamsMonthly', { price: teamMonthly }) : '—'}</span>
                      <br /><span style={{ fontWeight: 400, fontSize: 'var(--font-size-field-label)', color: 'var(--text-muted)' }}>{t('teamsVolumeNote', { min: teamMinSeats })}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((label) => {
                    return (
                    <tr key={label}>
                      <td>{label}</td>
                      <td><CheckIcon checked={planById('free')?.features.includes(label) === true} /></td>
                      <td><CheckIcon checked={planById('pro')?.features.includes(label) === true} /></td>
                      <td><CheckIcon checked={planById('teams')?.features.includes(label) === true} /></td>
                    </tr>
                  );})}
                </tbody>
                <tfoot>
                  <tr>
                    <td />
                    <td>
                      <PlanCta plan="free" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} label={planById('free')?.ctaLabel} href={planById('free')?.ctaHref} />
                    </td>
                    <td>
                      <PlanCta plan="pro" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} label={planById('pro')?.ctaLabel} href={planById('pro')?.ctaHref} />
                    </td>
                    <td>
                      <PlanCta plan="teams" effectivePlan={effectivePlan} onUpgrade={openUpgrade} isAnon={isAnon} label={planById('teams')?.ctaLabel} href={planById('teams')?.ctaHref} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className={styles.addon}>
              {t.rich('managedAddon', {
                price: pricing?.managedAgentHost.perAgentHostMonthly ?? '—',
                b: (c) => <strong>{c}</strong>,
              })}
            </p>
          </section>

        </div>
      )}
      {isAnon && <div className={styles.related}><RelatedArticles surface="pricing" heading={t('relatedHeading')} /></div>}
    </main>
    </PageContainer>
    </>
  );
}
