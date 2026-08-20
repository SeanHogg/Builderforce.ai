// No 'use client' directive: `BillingClient.tsx` is the only thing that renders
// this and already carries one, so the boundary genuinely begins there.

/**
 * THE collections worklist — what `notify` mode produces, made actionable.
 *
 * ── WHY THIS HAD TO EXIST ────────────────────────────────────────────────────
 * The ladder defaults to `notify`: the nightly sweep records the rung that has
 * come due and deliberately sends nothing, because a sweep that emails a tenant's
 * own customers unattended is an agent acting outside the building on a threshold
 * nobody re-read. That is the right default and it is only half a feature — a
 * queue nobody can see is the same defect as no queue, and it is exactly the one
 * `invoice.collection`'s hint names: "collections work with no record is
 * collections work that gets done twice or not at all."
 *
 * ── WHY THE LADDER IS SHOWN BESIDE IT ───────────────────────────────────────
 * Because the decision this screen actually asks for is whether to keep chasing by
 * hand or hand the ladder the keys, and nobody delegates a process they cannot
 * read. The rungs are declared as DATA in `collectionsLadder.ts`, so this is that
 * one list rendered — not a second description of it that drifts the first time
 * the cadence is re-tuned.
 *
 * ── ONE SEND PATH ───────────────────────────────────────────────────────────
 * The button calls the same `chase` act the sweep calls, with the same step, so a
 * rung sent from here and a rung sent by an `auto` workspace land on the same row.
 * The unique `(tenant, invoice, step)` index means a double-click is one chase.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useFormat } from '@/i18n/useFormat';
import {
  chaseInvoice,
  collectionLadder,
  collectionWorklist,
  type LadderRung,
  type WorklistEntry,
} from '@/lib/founderOpsApi';

export interface CollectionsWorklistProps {
  /** Told when a chase was sent, so the receivables list beside this can refresh. */
  onChased?: () => void;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '10px 0',
  borderTop: '1px solid var(--border-subtle)',
  fontSize: 'var(--font-size-body)',
};

export function CollectionsWorklist({ onChased }: CollectionsWorklistProps) {
  const t = useTranslations('collections');
  const fmt = useFormat();
  const [worklist, setWorklist] = useState<WorklistEntry[]>([]);
  const [ladder, setLadder] = useState<LadderRung[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // Both in parallel: they are independent reads and the ladder is a constant,
      // so serialising them would double the wait for no ordering anybody needs.
      const [due, rungs] = await Promise.all([collectionWorklist(), collectionLadder()]);
      setWorklist(due);
      setLadder(rungs);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const send = async (entry: WorklistEntry) => {
    setBusy(`${entry.invoiceRef}:${entry.step}`);
    try {
      await chaseInvoice(entry.invoiceRef, { step: entry.step, stepLabel: entry.stepLabel, channel: 'email' });
      await load();
      onChased?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sendFailed'));
    } finally {
      setBusy('');
    }
  };

  const money = (amount: string, paid: string, currency: string): string => {
    const outstanding = Number(amount) - Number(paid);
    try {
      return fmt.number(outstanding, { style: 'currency', currency });
    } catch {
      return `${outstanding.toFixed(2)} ${currency}`;
    }
  };

  if (loading) return <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0 }}>{t('loading')}</p>;

  return (
    <>
      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', margin: '0 0 10px' }}>{error}</p>}

      {worklist.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>{t('empty')}</p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {worklist.map((entry) => (
            <div key={`${entry.invoiceRef}:${entry.step}`} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {t('due', { reference: entry.invoiceRef, customer: entry.customerName })}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {t('dueDetail', {
                    step: entry.stepLabel,
                    amount: money(entry.amount, entry.paidAmount, entry.currency),
                  })}
                </div>
              </div>
              {/* An `internal` rung reaches nobody outside the workspace — it is a
                  job for a person here, so there is no "send" to offer. */}
              {entry.channel === 'email' ? (
                <Button onClick={() => void send(entry)} disabled={busy !== ''}>
                  {busy === `${entry.invoiceRef}:${entry.step}` ? t('sending') : t('send')}
                </Button>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>{t('needsAPerson')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>
          {t('ladderTitle')}
        </summary>
        <ul style={{ margin: '10px 0 0', paddingInlineStart: 20, fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          {ladder.map((rung) => (
            <li key={rung.step}>
              {rung.atDays < 0
                ? t('rungBefore', { label: rung.label, days: Math.abs(rung.atDays) })
                : t('rungAfter', { label: rung.label, days: rung.atDays })}
              {rung.channel === 'internal' ? ` — ${t('needsAPerson')}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
