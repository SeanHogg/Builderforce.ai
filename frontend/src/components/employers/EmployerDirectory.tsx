'use client';

// Required directive — see the note in `RatingStars`.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/AuthContext';
import { fetchEmployers, type EmployerCard } from '@/lib/employersApi';
import { RatingStars } from './RatingStars';
import styles from './employers.module.css';

/**
 * Employers, and what they score.
 *
 * Self-gating on a tenant session, so it takes no `canShow` prop.
 *
 * ── SELECTION IS THE CALLER'S ────────────────────────────────────────────────
 * `onSelect` is the ONE prop, because the directory is drawn in two places that
 * do different things with a click — the employers page opens a panel beside it,
 * and a canvas card opens the employer as its own object. Owning the navigation
 * here would force one of those to fight it.
 *
 * ── THE SEARCH GOES TO THE SERVER ────────────────────────────────────────────
 * Filtering the fetched page in memory searches only what happened to be on it,
 * so an employer past the limit is invisible to the search that would find it.
 * Debounced, or it is a request per keystroke.
 */
export function EmployerDirectory({
  selectedId,
  onSelect,
}: {
  selectedId?: number | null;
  onSelect?: (employer: EmployerCard) => void;
}) {
  const t = useTranslations('employers');
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;

  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<EmployerCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback((q: string) => {
    setLoading(true);
    fetchEmployers(q)
      .then((next) => { setRows(next); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('directory.failed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (!hasTenant) return;
    const timer = setTimeout(() => load(query.trim()), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [hasTenant, query, load]);

  if (!hasTenant) return null;

  return (
    <section className={styles.card} aria-labelledby="employer-directory-heading">
      <h3 id="employer-directory-heading" className={styles.cardTitle}>{t('directory.title')}</h3>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="employer-search">{t('directory.search')}</label>
        <input
          id="employer-search" className={styles.input} type="search"
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t('directory.searchPlaceholder')}
        />
      </div>

      {rows.length === 0 && !loading && !error ? (
        <p className={styles.empty}>{query ? t('directory.noMatches') : t('directory.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={styles.row}
              aria-current={selectedId === row.id ? 'true' : undefined}
              onClick={() => onSelect?.(row)}
            >
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{row.name}</span>
                <span className={styles.rowNote}>
                  {[row.sector, row.country].filter(Boolean).join(' · ') || t('directory.noDetail')}
                </span>
              </span>
              <span className={styles.rowMeta}>
                {row.rating.average === null ? (
                  <span className={styles.rowNote}>{t('summary.unrated')}</span>
                ) : (
                  <>
                    <RatingStars value={row.rating.average} />
                    <span className={styles.rowNote}>
                      {row.rating.average.toFixed(1)} · {t('summary.count', { count: row.rating.count })}
                    </span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
