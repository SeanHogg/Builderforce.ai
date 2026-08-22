'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/canvasMoney';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

/**
 * What each thing costs — the same card the meter charges from.
 *
 * The server derives this from the published pricing document when the add-on is
 * live, so the figures here ARE the figures `debitComms` uses. That is the whole
 * point of showing it: a rate card assembled independently in the browser would
 * be a second price list, and a second price list is how a customer is quoted one
 * number and billed another.
 *
 * Three fraction digits, not two: a per-SMS price of 1.2¢ rendered as $0.01 is
 * wrong by 17% and looks precise while being so.
 */
export function PhoneRatesCard() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const { overview } = usePhone();

  if (!overview || overview.rates.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="phone-rates-heading">
      <h3 id="phone-rates-heading" className={styles.cardTitle}>{t('rates.title')}</h3>

      <ul className={styles.list}>
        {overview.rates.map((rate) => (
          <li key={rate.unit} className={styles.logRow}>
            <span className={styles.logLabel}>{t(`rates.unit.${rate.unit}`)}</span>
            <span className={styles.logMeta}>
              {formatCents(rate.cents, { locale, maximumFractionDigits: 3 })}
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.cardHint}>{t('rates.note')}</p>
    </section>
  );
}
