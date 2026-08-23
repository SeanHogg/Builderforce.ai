'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import {
  learningApi,
  type LearningCourse, type LearningPathDetail, type PathProgress,
} from '@/lib/learningApi';
import { PathProgressMeter } from './PathProgressMeter';
import styles from './learning.module.css';

/**
 * One path: the courses it sequences, in order, and what a learner has done with it.
 *
 * ── THE ORDER IS SAVED WHOLE ────────────────────────────────────────────────
 * Moving a course up or down edits LOCAL state, and one "save order" call
 * replaces the whole sequence — which is what the server's `setPathCourses`
 * takes, and why. Three endpoints that each move one edge is how two people
 * reordering the same curriculum produce an order neither of them chose.
 *
 * ── IT OWNS ITS OWN DATA ────────────────────────────────────────────────────
 * Given a path id it fetches the path, the course picker and the viewer's
 * progress itself, so it can be dropped onto a canvas card or a dashboard with no
 * edits. `onChanged` is the one outbound signal, for a sibling list that shows a
 * status or a course count this panel just changed.
 */
export function PathDetailPanel({
  pathId,
  onChanged,
}: {
  pathId: number;
  onChanged?: () => void;
}) {
  const t = useTranslations('learning');

  const [path, setPath] = useState<LearningPathDetail | null>(null);
  const [catalogue, setCatalogue] = useState<LearningCourse[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [progress, setProgress] = useState<PathProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([learningApi.path(pathId), learningApi.courses()])
      .then(([detail, courses]) => {
        setPath(detail.path);
        setOrder(detail.path.courses.map((c) => c.id));
        setCatalogue(courses.courses);
        setError('');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('detail.failed')));
  }, [pathId, t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // A 403 here is the ordinary answer for somebody reading a path they are not
    // enrolled in, so it clears the meter rather than raising an error.
    learningApi.progress(pathId)
      .then((res) => setProgress(res.progress))
      .catch(() => setProgress(null));
  }, [pathId]);

  const byId = useMemo(
    () => new Map([...catalogue, ...(path?.courses ?? [])].map((c) => [c.id, c])),
    [catalogue, path],
  );

  const available = useMemo(
    () => catalogue.filter((c) => !order.includes(c.id)),
    [catalogue, order],
  );

  const dirty = useMemo(
    () => order.join(',') !== (path?.courses ?? []).map((c) => c.id).join(','),
    [order, path],
  );

  const move = (index: number, delta: number) => {
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const run = (work: Promise<unknown>, fallback: string) => {
    setBusy(true);
    work
      .then(() => { setError(''); load(); onChanged?.(); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : fallback))
      .finally(() => setBusy(false));
  };

  const enroll = () => {
    setBusy(true);
    learningApi.enroll(pathId)
      .then((res) => { setProgress(res.progress); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('detail.enrollFailed')))
      .finally(() => setBusy(false));
  };

  if (!path) {
    return (
      <section className={styles.card}>
        <p className={error ? styles.error : styles.empty}>{error || t('common.loading')}</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="path-detail-heading">
      <h3 id="path-detail-heading" className={styles.cardTitle}>{path.title}</h3>
      {path.summary && <p className={styles.cardHint}>{path.summary}</p>}

      {progress && <PathProgressMeter progress={progress} />}

      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={enroll} disabled={busy}>
          {t('detail.enroll')}
        </button>
        <RoleGate capability="learning.manage">
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => run(
              learningApi.setPathStatus(pathId, path.status === 'published' ? 'retired' : 'published'),
              t('detail.statusFailed'),
            )}
          >
            {path.status === 'published' ? t('detail.retire') : t('detail.publish')}
          </button>
        </RoleGate>
      </div>

      <h4 className={styles.cardTitle}>{t('detail.sequence')}</h4>
      {order.length === 0 ? (
        <p className={styles.empty}>{t('detail.noCourses')}</p>
      ) : (
        <div className={styles.scroller}>
          {order.map((courseId, index) => (
            <div key={courseId} className={styles.orderRow}>
              <span className={styles.orderIndex}>{index + 1}</span>
              <span className={styles.orderTitle}>{byId.get(courseId)?.title ?? t('detail.unknownCourse')}</span>
              <RoleGate capability="learning.manage" silent>
                <span className={styles.orderControls}>
                  <button
                    type="button" className={styles.iconButton} disabled={index === 0}
                    aria-label={t('detail.moveUp')} onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button" className={styles.iconButton} disabled={index === order.length - 1}
                    aria-label={t('detail.moveDown')} onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button" className={styles.iconButton}
                    aria-label={t('detail.remove')}
                    onClick={() => setOrder((c) => c.filter((id) => id !== courseId))}
                  >
                    ×
                  </button>
                </span>
              </RoleGate>
            </div>
          ))}
        </div>
      )}

      <RoleGate capability="learning.manage" variant="block">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="add-course">{t('detail.addCourse')}</label>
          <select
            id="add-course"
            className={styles.select}
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (Number.isInteger(id) && id > 0) setOrder((current) => [...current, id]);
            }}
          >
            <option value="">{t('detail.addCoursePlaceholder')}</option>
            {available.map((course) => (
              <option key={course.id} value={course.id}>{course.title}</option>
            ))}
          </select>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={busy || !dirty}
            onClick={() => run(learningApi.setPathCourses(pathId, order), t('detail.orderFailed'))}
          >
            {busy ? t('common.saving') : t('detail.saveOrder')}
          </button>
          {dirty && <span className={styles.cardHint}>{t('detail.unsaved')}</span>}
        </div>
      </RoleGate>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
