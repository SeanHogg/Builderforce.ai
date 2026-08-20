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
 * ── WHY IT SHARES THE SIGNER'S STYLESHEET ───────────────────────────────────
 * A signer, a diligence reader and a paying customer are the same visitor: no
 * account, a token in the link, and whatever theme their machine happens to be in.
 * `SignerConsole.module.css` already answers that for the first two, so this page
 * uses it rather than describing the page a third time. It shipped with an inline
 * style object instead, and that was the only literal hex left in the frontend —
 * a colour that renders identically in both themes, which is the defect
 * `check:design-scale` exists to catch.
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
import { apiRequest, getApiBaseUrl } from '@/lib/apiClient';
import styles from '../signature/SignerConsole.module.css';
import { useFormat } from "@/i18n/useFormat";

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

/**
 * No props. The reference is a path segment so the processor has a return
 * address to redirect to, but this component never reads it: the token resolves
 * the row, and the row reports its own reference. Taking it as a prop implied a
 * second source for the same fact.
 */
export function PublicInvoice() {
  const fmt = useFormat();
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
      return fmt.number(value, { style: 'currency', currency });
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };

  if (loading) {
    return <main className={styles.page}><div className={styles.sheet}><p className={styles.notice}>{t('loading')}</p></div></main>;
  }

  if (error || !invoice) {
    return (
      <main className={styles.page}>
        <div className={styles.sheet}>
          <h1 className={styles.title}>{t('unavailableTitle')}</h1>
          <p role="alert" className={styles.error}>{error || t('loadFailed')}</p>
        </div>
      </main>
    );
  }

  const settled = invoice.outstanding <= 0;

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <h1 className={styles.title}>{t('title', { reference: invoice.reference })}</h1>
        <p className={styles.addressed}>{t('billedTo', { customer: invoice.customerName })}</p>

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>{t('total')}</span>
            <strong>{money(invoice.amount, invoice.currency)}</strong>
          </div>
          {invoice.paidAmount > 0 && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryKey}>{t('paid')}</span>
              <span>{money(invoice.paidAmount, invoice.currency)}</span>
            </div>
          )}
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>{t('outstanding')}</span>
            <strong className={settled ? styles.summarySettled : styles.summaryDue}>
              {money(invoice.outstanding, invoice.currency)}
            </strong>
          </div>
          {invoice.dueAtISO && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryKey}>{t('due')}</span>
              <span>
                {invoice.dueAtISO.slice(0, 10)}
                {invoice.ageingDays > 0 && !settled ? ` · ${t('daysOverdue', { count: invoice.ageingDays })}` : ''}
              </span>
            </div>
          )}
        </div>

        {invoice.lines.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.lineTable}>
              <thead>
                <tr>
                  {[t('colDescription'), t('colQuantity'), t('colUnit'), t('colAmount')].map((heading) => (
                    <th key={heading}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line, index) => (
                  <tr key={`${line.description}-${index}`}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.unitAmount, invoice.currency)}</td>
                    <td>{money(line.amount, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {invoice.notes && <p className={styles.notes}>{invoice.notes}</p>}

        {settled ? (
          <p className={styles.notice}>{t('settled')}</p>
        ) : invoice.paymentLinkUrl ? null : (
          // No merchant account on the issuing workspace. Saying so plainly beats
          // an absent button, which reads as a page that is broken.
          <p className={styles.notice}>{t('payByTransfer')}</p>
        )}

        <div className={styles.invoiceActions}>
          {!settled && invoice.paymentLinkUrl && (
            <a href={invoice.paymentLinkUrl} className={styles.payLink}>
              {settling ? t('confirming') : t('payNow', { amount: money(invoice.outstanding, invoice.currency) })}
            </a>
          )}
          {/* Offered whatever the state, including settled: a paid invoice is the
              one a customer's accounts department most often comes back for.
              Server-rendered bytes rather than a print dialog — see
              `application/finance/invoicePdf.ts` for why that distinction matters. */}
          <a href={`${getApiBaseUrl()}/api/public/invoices/pdf?t=${encodeURIComponent(token)}`} className={styles.downloadLink}>
            {t('downloadPdf')}
          </a>
        </div>
      </div>
    </main>
  );
}
