'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/AuthContext';
import { learningApi, type CourseGate } from '@/lib/learningApi';
import styles from './learning.module.css';

/**
 * Every course, with this learner's locks on it.
 *
 * ── ONE CALL, NOT ONE PER CARD ──────────────────────────────────────────────
 * `learningApi.gates()` returns the whole catalogue already gated, because the
 * server computes it from one edge load and one completion read. Asking "is this
 * one unlocked" per card is the N+1 that gets slower exactly as a curriculum gets
 * richer, and it is the reason the endpoint exists in that shape.
 *
 * ── A LOCK NAMES WHAT BLOCKS IT ─────────────────────────────────────────────
 * `blockedBy` carries the outstanding prerequisites, so the card says WHICH
 * course to take first rather than only that something is missing. A catalogue
 * that says "locked" and nothing else is a dead end.
 *
 * `onSelect` is optional: the prerequisite editor beside it wants to know which
 * course is being looked at, and a standalone catalogue does not.
 */
export function CourseCatalogue({
  selectedId,
  onSelect,
}: {
  selectedId?: number | null;
  onSelect?: (gate: CourseGate) => void;
}) {
  const t = useTranslations('learning');
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;

  const [gates, setGates] = useState<CourseGate[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    learningApi.gates()
      .then((res) => { setGates(res.gates); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('catalogue.failed')));
  }, [t]);

  useEffect(() => {
    if (!hasTenant) return;
    load();
  }, [hasTenant, load]);

  const complete = (courseId: number) => {
    setBusyId(courseId);
    learningApi.completeCourse(courseId)
      .then(() => { setError(''); load(); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('catalogue.completeFailed')))
      .finally(() => setBusyId(null));
  };

  if (!hasTenant) return null;

  return (
    <section className={styles.card} aria-labelledby="course-catalogue-heading">
      <h3 id="course-catalogue-heading" className={styles.cardTitle}>{t('catalogue.title')}</h3>
      <p className={styles.cardHint}>{t('catalogue.intro')}</p>

      {gates.length === 0 ? (
        <p className={styles.empty}>{t('catalogue.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {gates.map((gate) => (
            <div
              key={gate.courseId}
              className={`${styles.row} ${styles.rowStatic}`}
              aria-current={selectedId === gate.courseId ? 'true' : undefined}
            >
              <button
                type="button"
                className={styles.rowBody}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', cursor: onSelect ? 'pointer' : 'default' }}
                onClick={() => onSelect?.(gate)}
              >
                <span className={styles.rowTitle}>{gate.title}</span>
                <span className={styles.rowNote}>
                  {gate.unlocked
                    ? t('catalogue.open')
                    : t('catalogue.blockedBy', { courses: gate.blockedBy.map((b) => b.title).join(', ') })}
                </span>
              </button>
              <span className={styles.rowMeta}>
                <span className={gate.unlocked ? `${styles.badge} ${styles.badgeOk}` : `${styles.badge} ${styles.badgeWarn}`}>
                  {gate.unlocked ? t('catalogue.unlocked') : t('catalogue.locked')}
                </span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={!gate.unlocked || busyId === gate.courseId}
                  onClick={() => complete(gate.courseId)}
                >
                  {t('catalogue.markComplete')}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
