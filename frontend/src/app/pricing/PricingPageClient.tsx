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
import { PremiumModelUnlock } from '@/components/llm/PremiumModelUnlock';
import { CardOnFile } from '@/components/llm/CardOnFile';
import { pricingSchema } from '@/lib/structured-data';
import { getRetainedDiscountCode, retainDiscountCode } from '@/lib/discountCode';
import styles from './pricing.module.css';
import { fetchPublicPricing, type PublicPricingContract, type PublicPricingPlan } from '@/lib/publicPricing';
import { NAV_GROUPS } from '@/lib/navGroups';
import { isNavigationFeatureId } from '@/lib/navigationFeatures';
import { useCart } from '@/lib/CartContext';
import { calculateSubscriptionLine } from '@/lib/subscriptionCart';

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
function PlanCta({ plan, effectivePlan, onUpgrade, isAnon, label, href, compact = false }: {
  plan: Plan;
  effectivePlan: Plan;
  onUpgrade: (target: 'pro' | 'teams') => void;
  isAnon?: boolean;
  label?: string;
  href?: string;
  compact?: boolean;
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
  const rank: Record<Plan, number> = { free: 0, pro: 1, teams: 2 };
  if (!isAnon && rank[plan] < rank[effectivePlan]) return null;
  return (
    <button type="button" onClick={() => onUpgrade(plan)} className={styles.planButton} data-plan={plan} data-compact={compact}>
      {isAnon ? (label ?? t('ctaGet', { plan: planName })) : t('ctaUpgradeTo', { plan: planName })}
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
  const { items, addItem, removeItem, hasItem, openCart } = useCart();
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

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [discountCode, setDiscountCode] = useState('');
  const [seats, setSeats] = useState(1); // Clamped once the public entitlement contract loads.
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
      items.filter((item) => item.checkoutKind === 'plan_subscription').forEach((item) => removeItem(item.id));
      return;
    }
    const captured = searchParams?.get('discountcode') ?? getRetainedDiscountCode();
    if (captured) {
      setDiscountCode(captured.toUpperCase());
      setBillingCycle('yearly');
      retainDiscountCode(captured);
    }
    // Cart mutation callbacks are stable; reacting to items here would re-run the
    // success cleanup for unrelated marketplace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const effectivePlan = sub?.effectivePlan ?? 'free';
  // Anonymous marketing visitor (no tenant) gets sales-tone copy; a signed-in
  // tenant gets the billing-console framing ("manage your subscription").
  const isAnon = tenantId == null;

  const pricing = publicPricing?.pricing ?? sub?.pricing;
  const proMonthly  = pricing?.pro.monthly;
  const proYearly   = pricing?.pro.yearly;
  const teamMonthly = pricing?.teams.perSeatMonthly;
  const teamYearly  = pricing?.teams.perSeatYearly;
  const displayedProPrice = billingCycle === 'yearly' ? proYearly : proMonthly;
  const displayedTeamUnitPrice = billingCycle === 'yearly' ? teamYearly : teamMonthly;
  // Teams is volume-priced below Pro per seat, earned by a seat-block minimum.
  // Surfacing the minimum is what keeps the lower per-seat price from reading as
  // a typo; the seat input and checkout both clamp to it.
  const teamMinSeats = pricing?.teams.minimumSeats ?? 1;

  // Keep the seat count at or above the volume minimum whenever it's known —
  // covers both the initial load and a plan-pricing refresh.
  useEffect(() => {
    setSeats((s) => (s < teamMinSeats ? teamMinSeats : s));
  }, [teamMinSeats]);

  const addPlanToCart = (target: 'pro' | 'teams') => {
    if (!pricing) return;
    const plan = planById(target);
    if (!plan) return;
    const { total } = calculateSubscriptionLine(plan, target, billingCycle, seats);
    items.filter((item) => item.checkoutKind === 'plan_subscription').forEach((item) => removeItem(item.id));
    addItem({
      id: `subscription:${target}`,
      type: 'service',
      slug: target,
      name: t('cartPlanName', { plan: plan.name }),
      price: total,
      pricingModel: 'subscription',
      priceUnit: billingCycle === 'yearly' ? t('cartPerYear') : t('cartPerMonth'),
      checkoutKind: 'plan_subscription',
      targetPlan: target,
      billingCycle,
      ...(target === 'teams' && { seats }),
      ...(discountCode.trim() && { discountCode: discountCode.trim() }),
      emoji: target === 'teams' ? 'people' : 'bolt',
    });
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

  const configuredPlans = publicPricing?.plans ?? [];
  const planById = (id: Plan): PublicPricingPlan | undefined => configuredPlans.find((plan) => plan.id === id);
  const comparisonFeatures = Array.from(new Set(configuredPlans.flatMap((plan) => [...plan.features, ...plan.excluded])));
  const formatPrice = (price: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: publicPricing?.currency ?? 'USD', maximumFractionDigits: 0 }).format(price);
  const formatAddonPrice = (price: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: publicPricing?.currency ?? 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);

  useEffect(() => {
    if (!publicPricing) return;
    const target = searchParams?.get('upgrade');
    if (target === 'pro' || target === 'teams') addPlanToCart(target);
    // A cart survives account creation in localStorage. Re-open it on the return
    // route so the newly authenticated buyer can confirm and continue to Stripe.
    if (searchParams?.get('checkout') === '1' && items.some((item) => item.checkoutKind === 'plan_subscription')) openCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicPricing, searchParams, tenantId]);

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
              <button type="button" onClick={() => addPlanToCart('pro')} className={styles.primaryButton}>
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
            <div className={styles.pricingControls}>
              <div>
                <strong>{t('billingFrequency')}</strong>
                <span>{billingCycle === 'yearly' ? t('annualSavingsSummary') : t('monthlyFlexibility')}</span>
              </div>
              <div className={styles.billingToggle} role="group" aria-label={t('billingFrequency')}>
                <button type="button" data-active={billingCycle === 'monthly'} onClick={() => setBillingCycle('monthly')}>{t('cycleMonthlyCap')}</button>
                <button type="button" data-active={billingCycle === 'yearly'} onClick={() => setBillingCycle('yearly')}>{t('cycleAnnualWithSavings')}</button>
              </div>
            </div>
            <div className={styles.planGrid}>
              {configuredPlans.map((configured) => {
                const plan = configured.id;
                const { unitPrice, total: displayedPrice } = calculateSubscriptionLine(configured, plan, billingCycle, seats);
                return (
                <article key={plan} className={styles.planCard} data-featured={plan === 'pro'}>
                  <div className={styles.planCardTop}>
                    <h3>{configured.name}</h3>
                    <PlanCta plan={plan} effectivePlan={effectivePlan} onUpgrade={addPlanToCart} isAnon={isAnon} label={configured.ctaLabel} href={configured.ctaHref} compact />
                  </div>
                  <div className={styles.price}>
                    <span className={styles.priceAmount}>{formatPrice(displayedPrice)}</span>
                    {displayedPrice !== 0 && <span className={styles.priceSuffix}>{billingCycle === 'yearly' ? t('perYear') : t('perMonth')}</span>}
                  </div>
                  {plan === 'teams' && (
                    <div className={styles.seatScale}>
                      <div className={styles.seatScaleHeader}>
                        <label htmlFor="teams-seat-count">{t('teamMembers')}</label>
                        <strong>{t('seatCount', { seats })}</strong>
                      </div>
                      <input id="teams-seat-count" type="range" min={teamMinSeats} max={50} step={1} value={seats} onChange={(event) => setSeats(Number(event.target.value))} />
                      <div className={styles.seatCalculation}>
                        {billingCycle === 'yearly'
                          ? t('teamsAnnualCalculation', { price: unitPrice, seats, total: displayedPrice })
                          : t('teamsMonthlyCalculation', { price: unitPrice, seats, total: displayedPrice })}
                      </div>
                    </div>
                  )}
                  {plan === 'pro' && billingCycle === 'yearly' && <p className={styles.savingsNote}>{t('planAnnualSaving', { pct: pricing?.pro.yearlySavingsPercent ?? 0 })}</p>}
                  {plan === 'teams' && billingCycle === 'yearly' && <p className={styles.savingsNote}>{t('planAnnualSaving', { pct: pricing?.teams.yearlySavingsPercent ?? 0 })}</p>}
                  <p className={styles.priceNote}>{configured.description}</p>
                  <ul className={styles.featureList}>
                    {configured.features.map((feature) => <li key={feature}>{feature}</li>)}
                    {configured.excluded.map((feature) => <li key={feature} style={{ opacity: 0.6 }}>— {feature}</li>)}
                  </ul>
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
                       {planById('pro')?.name ?? tierT('pro')}<br /><span style={{ fontWeight: 400, fontSize: 'var(--font-size-eyebrow)' }}>{displayedProPrice != null ? `${formatPrice(displayedProPrice)}${billingCycle === 'yearly' ? t('perYear') : t('perMonth')}` : '—'}</span>
                    </th>
                    <th>
                       {planById('teams')?.name ?? tierT('teams')}<br /><span style={{ fontWeight: 400, fontSize: 'var(--font-size-eyebrow)' }}>{displayedTeamUnitPrice != null ? `${formatPrice(displayedTeamUnitPrice)}${billingCycle === 'yearly' ? t('perSeatYear') : t('perSeatMonth')}` : '—'}</span>
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
                      <PlanCta plan="free" effectivePlan={effectivePlan} onUpgrade={addPlanToCart} isAnon={isAnon} label={planById('free')?.ctaLabel} href={planById('free')?.ctaHref} />
                    </td>
                    <td>
                      <PlanCta plan="pro" effectivePlan={effectivePlan} onUpgrade={addPlanToCart} isAnon={isAnon} label={planById('pro')?.ctaLabel} href={planById('pro')?.ctaHref} />
                    </td>
                    <td>
                      <PlanCta plan="teams" effectivePlan={effectivePlan} onUpgrade={addPlanToCart} isAnon={isAnon} label={planById('teams')?.ctaLabel} href={planById('teams')?.ctaHref} />
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
