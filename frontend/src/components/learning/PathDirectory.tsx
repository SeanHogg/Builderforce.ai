'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/AuthContext';
import { RoleGate } from '@/components/RoleGate';
import { learningApi, type LearningPathSummary } from '@/lib/learningApi';
import styles from './learning.module.css';

/**
 * The learning paths in this workspace, and the box that adds one.
 *
 * Self-gating on a tenant session, so it takes no `canShow` prop, and the create
 * form is wrapped in <RoleGate> rather than hidden — a viewer should be able to
 * SEE that curricula can be authored and know who to ask.
 *
 * ── SELECTION IS THE CALLER'S ───────────────────────────────────────────────
 * `onSelect` is the only outbound prop: the page opens a detail panel beside the
 * list, and a canvas card would open the path as its own object. Owning that
 * navigation here would force one of the two to fight it.
 *
 * `reloadToken` lets a sibling that CHANGED a path (published it, reordered it)
 * ask for a refresh without this component exposing its loader — the list stays
 * the owner of its own data.
 */
export function PathDirectory({
  selectedId,
  onSelect,
  reloadToken = 0,
}: {
  selectedId?: number | null;
  onSelect?: (path: LearningPathSummary) => void;
  reloadToken?: number;
}) {
  const t = useTranslations('learning');
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;

  const [paths, setPaths] = useState<LearningPathSummary[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    learningApi.paths()
      .then((res) => { setPaths(res.paths); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('paths.failed')));
  }, [t]);

  useEffect(() => {
    if (!hasTenant) return;
    load();
  }, [hasTenant, load, reloadToken]);

  const create = useCallback(() => {
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    learningApi.createPath({ title: name })
      .then((res) => {
        setTitle('');
        setError('');
        setPaths((rows) => [...rows, res.path].sort((a, b) => a.title.localeCompare(b.title)));
        onSelect?.(res.path);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('paths.createFailed')))
      .finally(() => setBusy(false));
  }, [title, onSelect, t]);

  if (!hasTenant) return null;

  return (
    <section className={styles.card} aria-labelledby="learning-paths-heading">
      <h3 id="learning-paths-heading" className={styles.cardTitle}>{t('paths.title')}</h3>
      <p className={styles.cardHint}>{t('paths.intro')}</p>

      {paths.length === 0 ? (
        <p className={styles.empty}>{t('paths.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {paths.map((path) => (
            <button
              key={path.id}
              type="button"
              className={styles.row}
              aria-current={selectedId === path.id ? 'true' : undefined}
              onClick={() => onSelect?.(path)}
            >
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{path.title}</span>
                <span className={styles.rowNote}>
                  {t('paths.courseCount', { count: path.courseCount })}
                </span>
              </span>
              <span className={styles.rowMeta}>
                <span className={path.status === 'published' ? `${styles.badge} ${styles.badgeOk}` : styles.badge}>
                  {t(`status.${path.status}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <RoleGate capability="learning.manage" variant="block">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-path-title">{t('paths.newLabel')}</label>
          <input
            id="new-path-title"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('paths.newPlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={create}
            disabled={busy || !title.trim()}
          >
            {busy ? t('common.saving') : t('paths.create')}
          </button>
        </div>
      </RoleGate>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
