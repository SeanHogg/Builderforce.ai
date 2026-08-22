'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { redeemReward } from '@/lib/pointsApi';
import { usePoints } from '@/lib/usePoints';
import styles from './points.module.css';

/**
 * What the points buy, and the one button that spends them.
 *
 * ── AFFORDABILITY AND AVAILABILITY ARE DIFFERENT REFUSALS ────────────────────
 * A reward the person cannot yet afford is shown with the shortfall, because
 * that is the thing worth aiming at. A reward this build cannot DELIVER is shown
 * as unavailable — the server derives `available` from whether a fulfilment
 * adapter exists, so this cannot advertise a reward the redeem call would refuse.
 * Conflating the two would tell somebody to keep earning toward something that
 * will never be deliverable.
 *
 * ── WHY SPENDING CONFIRMS ────────────────────────────────────────────────────
 * It is irreversible from the user's side once fulfilled, so it goes through the
 * shared confirm rather than firing on a single click.
 */
export function RewardShelf() {
  const t = useTranslations('points');
  const confirm = useConfirm();
  const { summary, refresh } = usePoints();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!summary || summary.rewards.length === 0) return null;

  const spend = async (skuId: string, label: string, cost: number) => {
    const ok = await confirm({
      title: t('rewards.confirmTitle'),
      message: t('rewards.confirmMessage', { label, points: cost.toLocaleString() }),
      confirmLabel: t('rewards.confirmAction'),
    });
    if (!ok) return;

    setBusyId(skuId);
    setError('');
    try {
      await redeemReward(skuId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('rewards.failed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="points-rewards-heading">
      <h3 id="points-rewards-heading" className={styles.cardTitle}>{t('rewards.title')}</h3>

      <ul className={styles.rewardList}>
        {summary.rewards.map((reward) => {
          const short = reward.pointsCost - summary.balance;
          const affordable = short <= 0;
          const spendable = affordable && reward.available && !summary.suspended;

          return (
            <li key={reward.id} className={styles.reward}>
              <div className={styles.rewardBody}>
                <span className={styles.rewardLabel}>{reward.label}</span>
                <span className={styles.rewardCost}>
                  {t('rewards.cost', { points: reward.pointsCost.toLocaleString() })}
                </span>
                {!reward.available && (
                  <span className={styles.rewardNote}>{t('rewards.unavailable')}</span>
                )}
                {reward.available && !affordable && (
                  <span className={styles.rewardNote}>
                    {t('rewards.short', { points: short.toLocaleString() })}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={styles.rewardButton}
                disabled={!spendable || busyId !== null}
                onClick={() => void spend(reward.id, reward.label, reward.pointsCost)}
              >
                {busyId === reward.id ? t('rewards.redeeming') : t('rewards.redeem')}
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
