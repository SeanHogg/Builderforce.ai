'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useLocale, useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { formatCents } from '@/lib/canvasMoney';
import { fetchPhoneStatement, type CommsLedgerRow } from '@/lib/phoneApi';
import { useLogFeed } from './useLogFeed';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

const load = () => fetchPhoneStatement(50);

/**
 * Where the credit went — the ledger, projected.
 *
 * This is the card that makes a metered product defensible. Every other surface
 * here says what the phone DID; this one says what it COST, movement by movement,
 * from the same rows the balance is summed from. A balance without the movements
 * behind it is a number a customer has to take on faith, and the first time they
 * do not, there is nothing to show them.
 *
 * Grants and spends are signed rather than colour-coded alone, because a colour
 * is not a fact and a statement read in greyscale still has to be correct.
 */
export function CommsStatementList() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const fmt = useFormat();
  const { overview } = usePhone();
  const { rows, error } = useLogFeed<CommsLedgerRow>(load);

  if (!overview) return null;

  return (
    <section className={styles.card} aria-labelledby="phone-statement-heading">
      <h3 id="phone-statement-heading" className={styles.cardTitle}>{t('statement.title')}</h3>

      {rows.length === 0 && !error ? (
        <p className={styles.empty}>{t('statement.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {rows.map((row) => (
            <div key={row.id} className={styles.logRow}>
              <span className={styles.logLabel}>{row.memo ?? row.kind}</span>
              <span className={`${styles.logMeta} ${row.cents > 0 ? styles.logIn : styles.logOut}`}>
                {row.cents > 0 ? '+' : '−'}{formatCents(Math.abs(row.cents), { locale })}
                {' · '}{fmt.date(row.occurredAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
