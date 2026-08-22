'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { formatCents } from '@/lib/canvasMoney';
import { releaseNumber } from '@/lib/phoneApi';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

/**
 * The lines this workspace holds.
 *
 * ── RELEASING IS THE ONE IRREVERSIBLE ACTION ON THIS SURFACE ─────────────────
 * A released number goes back to the carrier's pool and cannot be reclaimed —
 * not by paying more, not by asking. So it is the one thing here that goes
 * through the shared confirm, and the confirmation names the number rather than
 * saying "this number", because the whole failure mode is releasing the wrong
 * one from a list where every row looks alike.
 *
 * ── SUSPENDED IS SHOWN, NOT HIDDEN ───────────────────────────────────────────
 * A number suspended for a credit shortfall still exists, still costs the
 * platform, and comes back on its own when the balance recovers. Hiding it would
 * make it look released — which is the one thing it is not.
 */
export function PhoneNumbersCard() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const confirm = useConfirm();
  const { overview, refresh } = usePhone();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  if (!overview) return null;

  const release = async (id: number, e164: string) => {
    const ok = await confirm({
      title: t('numbers.releaseTitle'),
      message: t('numbers.releaseMessage', { number: e164 }),
      confirmLabel: t('numbers.releaseAction'),
      destructive: true,
    });
    if (!ok) return;

    setBusyId(id);
    setError('');
    try {
      await releaseNumber(id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('numbers.releaseFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="phone-numbers-heading">
      <h3 id="phone-numbers-heading" className={styles.cardTitle}>{t('numbers.title')}</h3>

      {overview.numbers.length === 0 ? (
        <p className={styles.empty}>{t('numbers.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {overview.numbers.map((number, index) => {
            const included = overview.plan.active && index < overview.plan.includedNumbers;
            return (
              <li key={number.id} className={styles.row}>
                <div className={styles.rowBody}>
                  <span className={styles.rowTitle}>{number.e164}</span>
                  <span className={styles.rowNote}>
                    {included
                      ? t('numbers.included')
                      : t('numbers.monthly', { amount: formatCents(number.monthlyCents, { locale }) })}
                    {number.status === 'suspended' && ` · ${t('numbers.suspended')}`}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busyId !== null}
                  onClick={() => void release(number.id, number.e164)}
                >
                  {t('numbers.release')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
