'use client';

/**
 * `/sales` — the Sales Hub.
 *
 * ── WHAT CHANGED, AND WHY ────────────────────────────────────────────────────
 * `/sales` used to be a LAUNCHER: it provisioned a workspace, seeded a canvas and
 * redirected to `/create/<id>`. That made the "Sales Hub" menu item a door with
 * nothing behind it — clicking it from the canvas took you to the canvas. The
 * launcher moved to `/sales/canvas` (where a post-sign-in landing belongs) and
 * this route became the hub itself: a destination that opens as a slide-out panel
 * OVER the board, because everything in it — a referral link to copy, a lead to
 * check, a payout to chase — is something you consult without leaving what you
 * were doing. `workbenchPolicy` classifies it; nothing here asks to be a panel.
 *
 * Six sub-views, as tabs across the top through the one `DestinationIndex`:
 *   Overview  — the referral links, and the numbers that say how they are doing.
 *   Leads     — who signed up through them, and who converted.
 *   Reports   — the CRO report, week / month / quarter / YTD.
 *   Payouts   — earned, paid, available, and where the money goes.
 *   Inbox     — the connected mailbox, so an opportunity in email is in the hub.
 *   Kit       — the deck and the marketing assets to send.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { DestinationIndex, type IndexItem } from '@/components/shell/DestinationIndex';
import { Button } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { PayoutConnections } from '@/components/payouts/PayoutConnections';
import { SalesReportView } from '@/components/sales/SalesReportView';
import { InboxClient } from '@/app/inbox/InboxClient';
import { MEDIA_KIT } from '@/lib/content';
import {
  usePublishReferenceChrome,
  usePublishReferenceSelect,
  useReferenceRailActive,
} from '@/lib/referenceChrome';
import {
  salesApi,
  type SalesLead,
  type SalesReport,
  type SalesReportWindow,
} from '@/lib/salesApi';
import type { PayoutBalance, PayoutRecord } from '@/lib/payoutsApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  marginBottom: 16,
};

const captionStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 10px',
};

/** The public link an associate shares. Built from the browser's own origin so a
 *  preview deployment hands out a preview link rather than a production one. */
function referralUrl(code: string | null): string | null {
  if (!code) return null;
  const origin = typeof window === 'undefined' ? 'https://builderforce.ai' : window.location.origin;
  return `${origin}/register?ref=${code}`;
}

/** A shareable link with its copy control. Two of them on this page and nothing
 *  like it elsewhere, so it is local rather than a component nobody else imports. */
function ShareLink({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--font-size-field-label)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <code style={{
          flex: '1 1 260px', minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap',
          padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)',
        }}>{value ?? '—'}</code>
        {value && <CopyButton getText={() => value} ariaLabel={label} compact />}
      </div>
      <small style={{ display: 'block', marginTop: 6, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{hint}</small>
    </div>
  );
}

export default function SalesHubClient() {
  const t = useTranslations('salesHub');
  const locale = useLocale();
  const router = useRouter();
  const sub = useSearchParams().get('sub') ?? '';

  const [codes, setCodes] = useState<{ referralCode: string | null; salesCode: string | null; sessionId: string | null }>({ referralCode: null, salesCode: null, sessionId: null });
  const [report, setReport] = useState<SalesReport | null>(null);
  const [window_, setWindow] = useState<SalesReportWindow>('month');
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [balance, setBalance] = useState<PayoutBalance | null>(null);
  const [payoutHistory, setPayoutHistory] = useState<PayoutRecord[]>([]);
  const [error, setError] = useState('');

  const money = useCallback(
    (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100),
    [locale],
  );
  const date = useCallback(
    (iso: string) => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale],
  );

  // The identity of the hub (codes + which canvas is theirs) is needed by every
  // sub-view, so it loads once rather than per tab.
  useEffect(() => {
    salesApi.canvas()
      .then((result) => setCodes({ referralCode: result.referralCode, salesCode: result.salesCode, sessionId: result.sessionId }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('loadFailed')));
  }, [t]);

  useEffect(() => {
    salesApi.report().then(({ report: row }) => setReport(row)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (sub !== 'leads') return;
    salesApi.leads(window_).then((result) => setLeads(result.leads)).catch(() => undefined);
  }, [sub, window_]);

  const loadPayouts = useCallback(() => {
    salesApi.payouts().then((result) => { setBalance(result.balance); setPayoutHistory(result.payouts); }).catch(() => undefined);
  }, []);
  useEffect(() => { if (sub === 'payouts' || sub === '') loadPayouts(); }, [loadPayouts, sub]);

  const subTabs: IndexItem[] = [
    { id: '', label: t('tab.overview'), icon: '🎯', href: '/sales' },
    { id: 'leads', label: t('tab.leads'), icon: '👥', href: '/sales?sub=leads' },
    { id: 'reports', label: t('tab.reports'), icon: '📈', href: '/sales?sub=reports' },
    { id: 'payouts', label: t('tab.payouts'), icon: '🏦', href: '/sales?sub=payouts' },
    { id: 'inbox', label: t('tab.inbox'), icon: '✉️', href: '/sales?sub=inbox' },
    { id: 'kit', label: t('tab.kit'), icon: '🗂', href: '/sales?sub=kit' },
  ];

  // The hub names ITSELF in the panel, exactly as `/dashboard` does. Neither is a
  // nav group for every account — the rail row exists only in `SALES_NAV_GROUPS`,
  // and the footer's "Sell Builderforce" hands ANY signed-in person here — so
  // without this the panel header read "Panel" for everyone but an associate.
  // Its six sub-views become the index rail; they are VIEWS rather than anchors
  // (one is in the DOM at a time), so the rail switches instead of scrolling.
  usePublishReferenceChrome({
    title: t('title'),
    sections: subTabs.map(({ id, label }) => ({ id, label })),
    activeId: sub,
  });
  usePublishReferenceSelect((id) => router.push(id ? `/sales?sub=${id}` : '/sales'));
  // In the panel the rail IS this bar, so rendering it inline would be the same
  // six choices twice. Standalone there is no rail and it is the only switcher.
  const railHasTabs = useReferenceRailActive();

  const referral = referralUrl(codes.referralCode);
  const sales = referralUrl(codes.salesCode);

  const renderOverview = () => (
    <>
      <div style={cardStyle}>
        <p style={captionStyle}>{t('linksTitle')}</p>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>{t('linksIntro')}</p>
        <div style={{ display: 'grid', gap: 14 }}>
          <ShareLink label={t('referralLink')} value={referral} hint={t('referralLinkHint')} />
          <ShareLink label={t('salesLink')} value={sales} hint={t('salesLinkHint')} />
        </div>
      </div>

      {/* The board is the work; the hub is the read-out. So the hub points AT it
          rather than trying to be a second copy of it. */}
      <div style={cardStyle}>
        <p style={captionStyle}>{t('canvasTitle')}</p>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>{t('canvasIntro')}</p>
        <Button size="sm" variant="primary" onClick={() => router.push(codes.sessionId ? `/create/${codes.sessionId}` : '/sales/canvas')}>
          {t('openCanvas')}
        </Button>
      </div>

      {balance && (
        <div style={cardStyle}>
          <p style={captionStyle}>{t('balanceTitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 12 }}>
            {[
              { label: t('earned'), value: money(balance.earnedCents) },
              { label: t('paid'), value: money(balance.paidCents) },
              { label: t('available'), value: money(balance.availableCents) },
            ].map((tile) => (
              <div key={tile.label}>
                <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>{tile.value}</div>
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{tile.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report && <SalesReportView report={report} window={window_} onWindowChange={setWindow} />}
    </>
  );

  const renderLeads = () => (
    <div style={cardStyle}>
      <p style={captionStyle}>{t('leadsTitle')}</p>
      {leads.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0 }}>{t('leadsEmpty')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-body)', minWidth: 480 }}>
            <thead>
              <tr>
                {[t('colSignedUp'), t('colSource'), t('colStatus'), t('colPlan'), t('colCommission')].map((heading, index) => (
                  <th key={heading} style={{ textAlign: index > 2 ? 'right' : 'left', padding: '6px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{date(lead.signedUpAt)}</td>
                  <td style={{ padding: '8px 10px 8px 0' }}>{t(`source.${lead.attributionType === 'sales' ? 'sales' : 'referral'}`)}</td>
                  <td style={{ padding: '8px 10px 8px 0', color: lead.convertedAt ? 'var(--success)' : 'var(--text-muted)' }}>
                    {lead.convertedAt ? t('converted') : t('signedUp')}
                  </td>
                  <td style={{ padding: '8px 10px 8px 0', textAlign: 'right' }}>{lead.plan ?? '—'}</td>
                  <td style={{ padding: '8px 10px 8px 0', textAlign: 'right', fontWeight: 650 }}>{lead.commissionCents == null ? '—' : money(lead.commissionCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderPayouts = () => (
    <>
      {balance && (
        <div style={cardStyle}>
          <p style={captionStyle}>{t('balanceTitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 12 }}>
            {[
              { label: t('earned'), value: money(balance.earnedCents) },
              { label: t('paid'), value: money(balance.paidCents) },
              { label: t('available'), value: money(balance.availableCents) },
            ].map((tile) => (
              <div key={tile.label}>
                <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>{tile.value}</div>
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{tile.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={cardStyle}>
        <p style={captionStyle}>{t('destinationsTitle')}</p>
        {/* The SAME component `/billing/payouts` and `/settings/integrations`
            render — connecting a bank account means one thing in this product. */}
        <PayoutConnections returnTo="/sales?sub=payouts" onChanged={loadPayouts} />
      </div>
      <div style={cardStyle}>
        <p style={captionStyle}>{t('payoutHistoryTitle')}</p>
        {payoutHistory.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0 }}>{t('noPayouts')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-body)', minWidth: 380 }}>
              <tbody>
                {payoutHistory.map((payout) => (
                  <tr key={payout.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{date(payout.occurredAtISO)}</td>
                    <td style={{ padding: '8px 10px 8px 0', fontWeight: 650 }}>{money(payout.amountCents)}</td>
                    <td style={{ padding: '8px 10px 8px 0' }}>{payout.provider}</td>
                    <td style={{ padding: '8px 10px 8px 0', textAlign: 'right' }}>{payout.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  const renderKit = () => (
    <div style={cardStyle}>
      <p style={captionStyle}>{t('kitTitle')}</p>
      <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>{t('kitIntro')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
        {/* MEDIA_KIT is the same single source `/media` renders, so a new asset
            appears in the hub without anyone remembering to add it twice. */}
        {MEDIA_KIT.assets.map((asset) => (
          <a
            key={asset.key}
            href={asset.href}
            download
            style={{
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 14,
              textDecoration: 'none', color: 'var(--text-primary)', background: 'var(--bg-elevated)',
              display: 'flex', flexDirection: 'column', gap: 4, minHeight: 44,
            }}
          >
            <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--coral-bright)', fontWeight: 700 }}>{asset.format}</span>
            <strong style={{ fontSize: 'var(--font-size-body)' }}>{t(`kitAsset.${asset.key}`)}</strong>
            <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{asset.size}</span>
          </a>
        ))}
      </div>
      <p style={{ marginTop: 14 }}>
        <Link href="/media" style={{ fontSize: 'var(--font-size-body)', color: 'var(--coral-bright)', fontWeight: 650 }}>{t('kitAll')} →</Link>
      </p>
    </div>
  );

  return (
    <PageContainer width="full" style={{ padding: '24px 28px' }}>
      <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{t('title')}</h1>
      <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 18px' }}>{t('intro')}</p>
      {!railHasTabs && <DestinationIndex items={subTabs} activeId={sub} ariaLabel={t('subnavLabel')} />}
      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', marginBottom: 14 }}>{error}</p>}
      {sub === 'leads' ? renderLeads()
        : sub === 'reports' ? (report ? <SalesReportView report={report} window={window_} onWindowChange={setWindow} /> : <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)' }}>{t('loading')}</p>)
          : sub === 'payouts' ? renderPayouts()
            // The whole webmail client, in the hub — an opportunity that arrives
            // by email is a sales opportunity, and making the associate leave to
            // read it is what put the pipeline in two places.
            : sub === 'inbox' ? <InboxClient />
              : sub === 'kit' ? renderKit()
                : renderOverview()}
    </PageContainer>
  );
}
