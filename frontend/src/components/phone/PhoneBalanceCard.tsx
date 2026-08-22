'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/canvasMoney';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

/**
 * What is left, what the subscription grants, and whether the line is live.
 *
 * Self-gating: it reads the shared snapshot itself and returns null when there is
 * no tenant session. That is why it takes no props — a `canShow` boolean or a
 * passed-in overview would put the decision in every consumer, and the second
 * consumer would get it wrong.
 *
 * ── PLAN STATUS AND BALANCE ARE TWO DIFFERENT PROBLEMS ───────────────────────
 * `past_due` with a healthy balance and `active` with an empty one look nothing
 * alike to the person trying to send a message, and the fix for each is the
 * other one's non-fix. So the pill states the SUBSCRIPTION and the figure states
 * the CREDIT, and neither is allowed to stand in for the other.
 */
export function PhoneBalanceCard() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const { overview } = usePhone();

  if (!overview) return null;

  const { plan, balanceCents } = overview;
  const pill = plan.active ? styles.pillActive
    : plan.status === 'past_due' ? styles.pillWarn
      : styles.pillMuted;

  return (
    <section className={styles.card} aria-labelledby="phone-balance-heading">
      <h3 id="phone-balance-heading" className={styles.cardTitle}>{t('balance.title')}</h3>

      <span className={`${styles.pill} ${pill}`}>
        {t(`plan.${plan.active ? 'active' : plan.status === 'past_due' ? 'pastDue' : 'inactive'}`)}
      </span>

      <p className={styles.balance}>
        <span className={styles.balanceValue}>{formatCents(balanceCents, { locale })}</span>
        <span className={styles.balanceUnit}>{t('balance.unit')}</span>
      </p>

      {plan.allowanceCents > 0 && (
        <p className={styles.cardHint}>
          {t('balance.allowance', { amount: formatCents(plan.allowanceCents, { locale }) })}
        </p>
      )}

      {plan.active && plan.includedNumbers > 0 && (
        <p className={styles.cardHint}>{t('balance.includedNumbers', { count: plan.includedNumbers })}</p>
      )}

      {plan.active && balanceCents <= 0 && (
        <p className={styles.error} role="status">{t('balance.empty')}</p>
      )}
    </section>
  );
}
