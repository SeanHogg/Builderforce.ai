'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useLocale, useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { formatCents } from '@/lib/canvasMoney';
import { fetchPhoneCalls, type CallLogRow } from '@/lib/phoneApi';
import { useLogFeed } from './useLogFeed';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

const load = () => fetchPhoneCalls(50);

/** Statuses this surface has words for — see the note in {@link SmsLogList}. */
const KNOWN_STATUS = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled', 'ringing']);

/**
 * Calls in and out, with what each one cost.
 *
 * The unanswered ones are here too. "We rang them three times and nobody picked
 * up" is frequently the answer somebody came to this log for, and a list that
 * only showed connected calls would make those attempts look like they never
 * happened.
 */
export function CallLogList() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const fmt = useFormat();
  const { overview } = usePhone();
  const { rows, error } = useLogFeed<CallLogRow>(load);

  if (!overview) return null;

  const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

  return (
    <section className={styles.card} aria-labelledby="phone-calls-heading">
      <h3 id="phone-calls-heading" className={styles.cardTitle}>{t('calls.title')}</h3>

      {rows.length === 0 && !error ? (
        <p className={styles.empty}>{t('calls.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {rows.map((row) => (
            <div key={row.id} className={styles.logRow}>
              <span className={styles.logLabel}>
                <span className={row.direction === 'inbound' ? styles.logIn : styles.logOut}>
                  {row.direction === 'inbound' ? t('calls.from', { number: row.counterparty }) : t('calls.to', { number: row.counterparty })}
                </span>
                {' — '}
                {KNOWN_STATUS.has(row.status) ? t(`calls.status.${row.status}`) : row.status}
              </span>
              <span className={styles.logMeta}>
                {row.durationSeconds > 0 && `${t('calls.minutes', { count: minutes(row.durationSeconds) })} · `}
                {row.costCents > 0 && `${formatCents(row.costCents, { locale })} · `}
                {fmt.dateTime(row.occurredAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
