'use client';

/**
 * `/billing` — the workspace's own billing console.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Settings' "Billing" tab pointed at `/pricing`, and `/pricing` is a MARKETING
 * page: it compares plans to somebody deciding whether to buy. A signed-in
 * customer clicking "Billing" is not deciding whether to buy — they are asking
 * "what am I on, what card is it charging, where is my money going, and what has
 * been paid out". Those are different questions and the plan-comparison grid
 * answers none of them, so they get their own destination. `/pricing` keeps the
 * comparison and this links to it, which is the correct direction: a console
 * links out to the brochure, not the other way round.
 *
 * Two sub-views, each its OWN ROUTE (`/billing`, `/billing/payouts`) rather than
 * a `?sub=` param, because both are things a person is sent a link to — "add your
 * bank details" is an email somebody receives — and a query param is a worse URL
 * to paste. Rendered through the one `DestinationIndex`, so the tabs sit across
 * the top exactly like every other nested sub-menu:
 *   - Account (`/billing`)          — plan, cycle, seats, billing email, card.
 *   - Payouts (`/billing/payouts`)  — where money goes OUT, and what has gone.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { DestinationIndex, type IndexItem } from '@/components/shell/DestinationIndex';
import { Button } from '@/components/ui';
import { RoleGate } from '@/components/RoleGate';
import { PayoutConnections } from '@/components/payouts/PayoutConnections';
import { getStoredTenant } from '@/lib/auth';
import { billingApi, type BillingSubscription } from '@/lib/billingApi';
import { cardValidationApi, type CardValidationState } from '@/lib/builderforceApi';
import { payoutsApi, type PayoutRecord } from '@/lib/payoutsApi';
import { useLocale } from 'next-intl';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
  marginBottom: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14,
};

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0',
};

export type BillingView = 'account' | 'payouts';

export default function BillingClient({ view = 'account' }: { view?: BillingView }) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const tenant = getStoredTenant();
  const tenantId = tenant?.id ?? null;

  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [card, setCard] = useState<CardValidationState | null>(null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [paidCents, setPaidCents] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const money = useCallback(
    (cents: number, currency = 'USD') =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100),
    [locale],
  );
  const date = useCallback(
    (iso: string) => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale],
  );

  useEffect(() => {
    if (tenantId == null) return;
    // Both reads are independent, so they go out together rather than in series.
    void Promise.allSettled([billingApi.subscription(tenantId), cardValidationApi.get(tenantId)])
      .then(([subResult, cardResult]) => {
        if (subResult.status === 'fulfilled') setSubscription(subResult.value);
        else setError(subResult.reason instanceof Error ? subResult.reason.message : t('loadFailed'));
        if (cardResult.status === 'fulfilled') setCard(cardResult.value);
      });
  }, [t, tenantId]);

  const loadPayouts = useCallback(async () => {
    try {
      const result = await payoutsApi.history();
      setPayouts(result.payouts);
      setPaidCents(result.paidCents);
    } catch { /* the destinations still render; history is additive */ }
  }, []);

  useEffect(() => { if (view === 'payouts') void loadPayouts(); }, [loadPayouts, view]);

  const startCardValidation = async () => {
    if (tenantId == null) return;
    setBusy(true); setError('');
    try {
      const result = await cardValidationApi.start(tenantId, {
        successUrl: `${window.location.origin}/billing?card=1`,
        cancelUrl: `${window.location.origin}/billing`,
      });
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else setCard(await cardValidationApi.get(tenantId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('cardFailed'));
    } finally {
      setBusy(false);
    }
  };

  const subTabs: IndexItem[] = [
    { id: 'account', label: t('accountTab'), icon: '💳', href: '/billing' },
    { id: 'payouts', label: t('payoutsTab'), icon: '🏦', href: '/billing/payouts' },
  ];

  const renderAccount = () => (
    <>
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('planTitle')}</div>
        {subscription ? (
          <div style={{ display: 'grid', gap: 2 }}>
            {[
              { label: t('plan'), value: t(`planName.${subscription.effectivePlan}`) },
              { label: t('status'), value: subscription.billingStatus },
              { label: t('cycle'), value: subscription.billingCycle ? t(`cycle.${subscription.billingCycle}`) : t('none') },
              { label: t('seats'), value: subscription.seatCount == null ? t('none') : String(subscription.seatCount) },
              { label: t('billingEmail'), value: subscription.billingEmail ?? t('none') },
            ].map(({ label, value }) => (
              <div key={label} style={rowStyle}>
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ color: 'var(--text-primary)' }}>{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{tenantId == null ? t('noWorkspace') : t('loading')}</p>
        )}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* The brochure is a LINK from the console, never the console itself. */}
          <Link
            href="/pricing"
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, minHeight: 34, display: 'inline-flex', alignItems: 'center',
              background: 'var(--surface-interactive)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', textDecoration: 'none',
            }}
          >
            {t('comparePlans')} →
          </Link>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>{t('paymentMethodTitle')}</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>{t('paymentMethodIntro')}</p>
        {card?.validated ? (
          <div style={rowStyle}>
            <span style={{ color: 'var(--text-muted)' }}>{t('cardOnFile')}</span>
            <span style={{ color: 'var(--text-primary)' }}>{card.brand ?? t('card')} •••• {card.last4 ?? '····'}</span>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('noCard')}</p>
        )}
        <RoleGate capability="billing.manage">
          <Button size="sm" variant={card?.validated ? 'ghost' : 'primary'} loading={busy} onClick={() => void startCardValidation()}>
            {card?.validated ? t('replaceCard') : t('addCard')}
          </Button>
        </RoleGate>
      </div>
    </>
  );

  const renderPayouts = () => (
    <>
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('destinationsTitle')}</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>{t('destinationsIntro')}</p>
        <PayoutConnections returnTo="/billing/payouts" onChanged={() => void loadPayouts()} />
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>{t('historyTitle')}</div>
        <div style={{ ...rowStyle, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10, marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('totalPaid')}</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{money(paidCents)}</span>
        </div>
        {payouts.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('noPayouts')}</p>
        ) : (
          // Wide content scrolls inside its own container; the page never does.
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead>
                <tr>
                  {[t('colDate'), t('colAmount'), t('colProvider'), t('colStatus')].map((heading) => (
                    <th key={heading} style={{ textAlign: 'left', padding: '6px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{date(payout.occurredAtISO)}</td>
                    <td style={{ padding: '8px 10px 8px 0', color: 'var(--text-primary)', fontWeight: 600 }}>{money(payout.amountCents)}</td>
                    <td style={{ padding: '8px 10px 8px 0' }}>{payout.provider}</td>
                    <td style={{ padding: '8px 10px 8px 0' }}>{payout.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{t('title')}</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>{t('intro')}</p>
      <DestinationIndex items={subTabs} activeId={view} ariaLabel={t('subnavLabel')} />
      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 13, marginBottom: 14 }}>{error}</p>}
      {view === 'payouts' ? renderPayouts() : renderAccount()}
    </PageContainer>
  );
}
