'use client';

// The directive is REQUIRED here, not incidental to whichever page mounts this
// today. Sourcing cards are built to be dropped onto canvas surfaces and into
// embedded apps as well as the hiring console, and several of those hosts are
// Server Components — a card that relies on an ancestor having already opened
// the client boundary cannot be dropped into one without an edit.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { useOptionalAuth } from '@/lib/AuthContext';
import { fetchSourcedListings, type SourcedJobListing } from '@/lib/sourcingApi';
import styles from './sourcing.module.css';

/**
 * What the feeds brought in.
 *
 * Self-gating: no tenant session, no card. That is why it takes no props — a
 * `canShow` boolean would put the decision in every consumer and the second
 * consumer would get it wrong.
 *
 * ── THE SEARCH IS THE SERVER'S, NOT THE BROWSER'S ────────────────────────────
 * Filtering the fetched page in memory would search only the rows that happened
 * to be on it and silently miss everything past the limit — the failure mode
 * where a listing exists, the operator searches for it, and the product says it
 * does not. The query goes to the server, whose answer is cached per query.
 *
 * Debounced because it is a request per keystroke otherwise.
 */
export function SourcedJobsList() {
  const t = useTranslations('sourcing');
  const fmt = useFormat();
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;

  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SourcedJobListing[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback((q: string) => {
    setLoading(true);
    fetchSourcedListings(q)
      .then((next) => { setRows(next); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('listings.failed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (!hasTenant) return;
    const timer = setTimeout(() => load(query.trim()), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [hasTenant, query, load]);

  if (!hasTenant) return null;

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-labelledby="sourced-jobs-heading">
      <h3 id="sourced-jobs-heading" className={styles.cardTitle}>{t('listings.title')}</h3>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sourced-jobs-search">{t('listings.search')}</label>
        <input
          id="sourced-jobs-search" className={styles.input} type="search"
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t('listings.searchPlaceholder')}
        />
      </div>

      {rows.length === 0 && !loading && !error ? (
        <p className={styles.empty}>{query ? t('listings.noMatches') : t('listings.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {rows.map((row) => (
            <article key={row.id} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>
                  {row.url ? (
                    // `noopener` is not optional on a link to a scraped third-party
                    // page: without it the opened tab can reach back through
                    // `window.opener` and navigate this one.
                    <a className={styles.rowLink} href={row.url} target="_blank" rel="noopener noreferrer nofollow">
                      {row.title}
                    </a>
                  ) : row.title}
                </span>
                <span className={styles.rowNote}>
                  {[row.company, row.location, row.jobType].filter(Boolean).join(' · ')}
                </span>
              </div>
              <span className={styles.rowNote}>{fmt.date(row.seenAt)}</span>
            </article>
          ))}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
