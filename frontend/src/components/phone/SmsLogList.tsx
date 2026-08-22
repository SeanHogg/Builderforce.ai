'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { fetchPhoneMessages, type SmsThreadRow } from '@/lib/phoneApi';
import { useLogFeed } from './useLogFeed';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

const load = () => fetchPhoneMessages(50);

/**
 * The statuses this surface has words for. next-intl THROWS on a missing key, so a
 * status the server grows tomorrow must not reach `t()` — it falls through to the
 * raw value, which is ugly and legible, rather than blanking the whole card.
 */
const KNOWN_STATUS = new Set(['queued', 'sent', 'delivered', 'bounced', 'failed']);

/**
 * Messages, both directions, newest first.
 *
 * One list rather than a sent list and a received list: a conversation read as
 * two separate columns is not a conversation, and the question somebody actually
 * has ("what has this number been saying?") is answered only by the merged view.
 *
 * A `bounced` row is shown with its status rather than filtered out — a message
 * that failed to deliver is the single most important row in the log, and hiding
 * it is how a workspace concludes the platform never sent it.
 */
export function SmsLogList() {
  const t = useTranslations('phone');
  const fmt = useFormat();
  const { overview } = usePhone();
  const { rows, error } = useLogFeed<SmsThreadRow>(load);

  if (!overview) return null;

  return (
    <section className={styles.card} aria-labelledby="phone-messages-heading">
      <h3 id="phone-messages-heading" className={styles.cardTitle}>{t('messages.title')}</h3>

      {rows.length === 0 && !error ? (
        <p className={styles.empty}>{t('messages.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {rows.map((row) => (
            <div key={row.id} className={styles.logRow}>
              <span className={styles.logLabel}>
                <span className={row.direction === 'inbound' ? styles.logIn : styles.logOut}>
                  {row.direction === 'inbound' ? t('messages.from', { number: row.counterparty }) : t('messages.to', { number: row.counterparty })}
                </span>
                {' — '}
                {row.body}
              </span>
              <span className={styles.logMeta}>
                {KNOWN_STATUS.has(row.status) ? t(`messages.status.${row.status}`) : row.status}
                {' · '}{fmt.dateTime(row.occurredAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
