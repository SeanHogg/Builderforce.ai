'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { purchaseNumber, searchAvailableNumbers, type AvailableNumber } from '@/lib/phoneApi';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

/**
 * Finding and buying a line.
 *
 * ── A SEARCH RESULT IS NOT A RESERVATION ─────────────────────────────────────
 * The carrier hands a number to whoever buys first and refuses everyone else, so
 * a purchase can fail on a number this list is still showing. The server answers
 * that case with its own reason (`number_taken`) rather than a generic error, and
 * this panel responds by dropping the row and telling the operator to pick
 * another — which is the only useful thing to do, and is very different from the
 * response to a credit shortfall.
 *
 * ── SELF-GATING ON THE SUBSCRIPTION ──────────────────────────────────────────
 * Provisioning is refused server-side without an active add-on, so showing the
 * search to a workspace that has not bought it would be an invitation to a 403.
 * The panel hides itself instead — the same self-gating rule every card here
 * follows, decided from the shared snapshot rather than from a passed-in prop.
 */
export function NumberSearchPanel() {
  const t = useTranslations('phone');
  const { overview, refresh } = usePhone();
  const [areaCode, setAreaCode] = useState('');
  const [contains, setContains] = useState('');
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  if (!overview?.plan.active) return null;

  const search = async () => {
    setSearching(true);
    setError('');
    try {
      setResults(await searchAvailableNumbers({ areaCode: areaCode || undefined, contains: contains || undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('search.failed'));
    } finally {
      setSearching(false);
    }
  };

  const buy = async (e164: string) => {
    setBusy(e164);
    setError('');
    try {
      await purchaseNumber(e164);
      setResults((rows) => rows?.filter((row) => row.e164 !== e164) ?? null);
      await refresh();
    } catch (cause) {
      const reason = (cause as { reason?: string }).reason;
      if (reason === 'number_taken') {
        // Somebody else bought it between the search and the click. Drop the row
        // so the operator cannot try the same dead number twice.
        setResults((rows) => rows?.filter((row) => row.e164 !== e164) ?? null);
        setError(t('search.taken'));
      } else {
        setError(cause instanceof Error ? cause.message : t('search.buyFailed'));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="phone-search-heading">
      <h3 id="phone-search-heading" className={styles.cardTitle}>{t('search.title')}</h3>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone-area-code">{t('search.areaCode')}</label>
          <input
            id="phone-area-code" className={styles.input} inputMode="numeric"
            value={areaCode} onChange={(e) => setAreaCode(e.target.value)}
            placeholder={t('search.areaCodePlaceholder')}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone-contains">{t('search.contains')}</label>
          <input
            id="phone-contains" className={styles.input}
            value={contains} onChange={(e) => setContains(e.target.value)}
            placeholder={t('search.containsPlaceholder')}
          />
        </div>
      </div>

      <button type="button" className={styles.button} disabled={searching} onClick={() => void search()}>
        {searching ? t('search.searching') : t('search.action')}
      </button>

      {results !== null && results.length === 0 && !searching && (
        <p className={styles.empty}>{t('search.noResults')}</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className={styles.list}>
          {results.map((row) => (
            <li key={row.e164} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>{row.friendlyName}</span>
                <span className={styles.rowNote}>
                  {[row.locality, row.region].filter(Boolean).join(', ') || row.e164}
                </span>
              </div>
              <button
                type="button" className={styles.button}
                disabled={busy !== null}
                onClick={() => void buy(row.e164)}
              >
                {busy === row.e164 ? t('search.buying') : t('search.buy')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
