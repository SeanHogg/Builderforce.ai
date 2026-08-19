'use client';

/**
 * The CUSTOMER's view of an invoice — the page the link in the email opens.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `invoice.issue` was a gated act with no handler and, just as importantly, no
 * DOCUMENT: there was no rendered invoice, no delivery and nothing for a customer
 * to look at. An invoice that only exists inside the workspace that raised it is a
 * note to self.
 *
 * ── THE READER HAS NO ACCOUNT, AND NEVER WILL ───────────────────────────────
 * So the token in the link is the authorisation, exactly as it is for a signer and
 * a form recipient, and the row it resolves to reports its own tenant. Nothing on
 * this page asks who they are.
 *
 * ── WHAT HAPPENS AFTER THEY PAY ─────────────────────────────────────────────
 * The processor redirects back here with its session id, and this page hands that
 * id to `/settle` — which does not trust it: the server re-reads the session from
 * the processor and refuses one that names a different invoice. The webhook does
 * the same thing independently, so a customer who pays and closes the tab is
 * recorded anyway; both land on one ledger row because the reference is unique.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiRequest } from '@/lib/apiClient';

interface PublicInvoiceDocument {
  reference: string;
  customerName: string;
  currency: string;
  status: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  issuedAtISO: string | null;
  dueAtISO: string | null;
  ageingDays: number;
  notes: string | null;
  paymentLinkUrl: string | null;
  lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number }>;
}

export interface PublicInvoiceProps {
  reference: string;
}

const page: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: 'clamp(20px, 5vw, 48px)',
  color: 'var(--text-primary, #111827)',
  background: 'var(--surface-page, #ffffff)',
};

const card: React.CSSProperties = {
  border: '1px solid var(--border-subtle, #e5e7eb)',
  borderRadius: 'var(--radius-lg, 12px)',
  background: 'var(--bg-base, #ffffff)',
  padding: 'clamp(16px, 4vw, 28px)',
};

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 0',
  fontSize: 'var(--font-size-body, 14px)',
};

export function PublicInvoice({ reference }: PublicInvoiceProps) {
  const t = useTranslations('publicInvoice');
  const locale = useLocale();
  const [invoice, setInvoice] = useState<PublicInvoiceDocument | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);

  /** The token rides the query string, which is where the emailed link puts it.
   *  Read on every load rather than held in state: the processor's redirect
   *  returns to this same URL and the token has to survive it. */
  const token = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('t') ?? '';

  const load = useCallback(async () => {
    if (!token) { setError(t('missingToken')); setLoading(false); return; }
    try {
      const result = await apiRequest<{ invoice: PublicInvoiceDocument }>(`/api/public/invoices?t=${encodeURIComponent(token)}`);
      setInvoice(result.invoice);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => { void load(); }, [load]);

  // The redirect back from the processor. `paid=cancelled` is not a failure and
  // deliberately does nothing: the customer changed their mind, and telling them
  // off for it on their own invoice would be absurd.
  useEffect(() => {
    if (typeof window === 'undefined' || !token) return;
    const session = new URLSearchParams(window.location.search).get('paid');
    if (!session || session === 'cancelled') return;
    setSettling(true);
    void apiRequest('/api/public/invoices/settle', {
      method: 'POST',
      body: JSON.stringify({ token, checkoutSessionId: session }),
    })
      .catch(() => {
        // Silent by design. The WEBHOOK records this payment independently, so a
        // failure here is a slower confirmation and never a lost payment —
        // telling a customer who has just been charged that something went wrong
        // would be both alarming and untrue.
      })
      .finally(() => {
        setSettling(false);
        void load();
      });
  }, [load, token]);

  const money = (value: number, currency: string): string => {
    try {
      return value.toLocaleString(locale, { style: 'currency', currency });
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };

  if (loading) return <div style={page}><p>{t('loading')}</p></div>;
  if (error || !invoice) {
    return (
      <div style={page}>
        <div style={card}>
          <h1 style={{ fontSize: 'var(--font-size-page-title, 24px)', margin: '0 0 8px' }}>{t('unavailableTitle')}</h1>
          <p role="alert" style={{ margin: 0, color: 'var(--text-muted, #6b7280)' }}>{error || t('loadFailed')}</p>
        </div>
      </div>
    );
  }

  const settled = invoice.outstanding <= 0;

  return (
    <div style={page}>
      <div style={card}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 'var(--font-size-page-title, 24px)', margin: '0 0 4px' }}>
            {t('title', { reference: invoice.reference })}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted, #6b7280)', fontSize: 'var(--font-size-body, 14px)' }}>
            {t('billedTo', { customer: invoice.customerName })}
          </p>
        </header>

        <div style={{ display: 'grid', gap: 2, marginBottom: 18 }}>
          <div style={row}>
            <span style={{ color: 'var(--text-muted, #6b7280)' }}>{t('total')}</span>
            <strong>{money(invoice.amount, invoice.currency)}</strong>
          </div>
          {invoice.paidAmount > 0 && (
            <div style={row}>
              <span style={{ color: 'var(--text-muted, #6b7280)' }}>{t('paid')}</span>
              <span>{money(invoice.paidAmount, invoice.currency)}</span>
            </div>
          )}
          <div style={row}>
            <span style={{ color: 'var(--text-muted, #6b7280)' }}>{t('outstanding')}</span>
            <strong style={{ color: settled ? 'var(--text-primary, #111827)' : 'var(--coral-bright, #dc2626)' }}>
              {money(invoice.outstanding, invoice.currency)}
            </strong>
          </div>
          {invoice.dueAtISO && (
            <div style={row}>
              <span style={{ color: 'var(--text-muted, #6b7280)' }}>{t('due')}</span>
              <span>
                {invoice.dueAtISO.slice(0, 10)}
                {invoice.ageingDays > 0 && !settled ? ` · ${t('daysOverdue', { count: invoice.ageingDays })}` : ''}
              </span>
            </div>
          )}
        </div>

        {invoice.lines.length > 0 && (
          // Wide content scrolls inside its own container; the page never does.
          <div style={{ overflowX: 'auto', marginBottom: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-body, 14px)', minWidth: 420 }}>
              <thead>
                <tr>
                  {[t('colDescription'), t('colQuantity'), t('colUnit'), t('colAmount')].map((heading) => (
                    <th key={heading} style={{ textAlign: 'left', padding: '6px 10px 6px 0', color: 'var(--text-muted, #6b7280)', fontWeight: 600, whiteSpace: 'nowrap' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line, index) => (
                  <tr key={`${line.description}-${index}`} style={{ borderTop: '1px solid var(--border-subtle, #e5e7eb)' }}>
                    <td style={{ padding: '8px 10px 8px 0' }}>{line.description}</td>
                    <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{line.quantity}</td>
                    <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{money(line.unitAmount, invoice.currency)}</td>
                    <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>{money(line.amount, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {invoice.notes && (
          <p style={{ fontSize: 'var(--font-size-body, 14px)', color: 'var(--text-muted, #6b7280)', lineHeight: 1.55 }}>{invoice.notes}</p>
        )}

        {settled ? (
          <p style={{ fontSize: 'var(--font-size-body, 14px)', margin: 0 }}>{t('settled')}</p>
        ) : invoice.paymentLinkUrl ? (
          <a
            href={invoice.paymentLinkUrl}
            style={{
              display: 'inline-block',
              padding: '10px 18px',
              borderRadius: 'var(--radius-md, 8px)',
              background: 'var(--accent, #2563eb)',
              color: 'var(--text-on-accent, #ffffff)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            {settling ? t('confirming') : t('payNow', { amount: money(invoice.outstanding, invoice.currency) })}
          </a>
        ) : (
          // No merchant account on the issuing workspace. Saying so plainly beats
          // an absent button, which reads as a page that is broken.
          <p style={{ fontSize: 'var(--font-size-body, 14px)', color: 'var(--text-muted, #6b7280)', margin: 0 }}>{t('payByTransfer')}</p>
        )}
      </div>
    </div>
  );
}
