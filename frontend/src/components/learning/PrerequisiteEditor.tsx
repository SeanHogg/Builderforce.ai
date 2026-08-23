'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import {
  learningApi, type CourseInPath, type CoursePrerequisite, type LearningCourse,
} from '@/lib/learningApi';
import styles from './learning.module.css';

/**
 * What a course requires before a learner may start it.
 *
 * ── PREREQUISITES ARE NOT THE PATH'S ORDER ──────────────────────────────────
 * Deliberately a separate surface from the sequence in `PathDetailPanel`. A path
 * says what order the courses are DISPLAYED in; a prerequisite says what must be
 * FINISHED first, and the two are genuinely different facts — the same course is
 * third in one path and first in another, while its prerequisite is the same in
 * both. Editing them in one control would force them to agree.
 *
 * The server refuses an edge that would close a loop, so this does not try to
 * pre-empt one: it renders the refusal, which names the course that caused it.
 */
export function PrerequisiteEditor({ courseId }: { courseId: number }) {
  const t = useTranslations('learning');

  const [prerequisites, setPrerequisites] = useState<CoursePrerequisite[]>([]);
  const [catalogue, setCatalogue] = useState<LearningCourse[]>([]);
  const [paths, setPaths] = useState<CourseInPath[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      learningApi.prerequisites(courseId),
      learningApi.courses(),
      learningApi.pathsFor(courseId),
    ])
      .then(([required, courses, inPaths]) => {
        setPrerequisites(required.prerequisites);
        setCatalogue(courses.courses);
        setPaths(inPaths.paths);
        setError('');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('prerequisites.failed')));
  }, [courseId, t]);

  useEffect(() => { load(); }, [load]);

  const available = useMemo(() => {
    const taken = new Set(prerequisites.map((p) => p.courseId));
    return catalogue.filter((c) => c.id !== courseId && !taken.has(c.id));
  }, [catalogue, prerequisites, courseId]);

  const run = (work: Promise<unknown>, fallback: string) => {
    setBusy(true);
    work
      .then(() => { setError(''); load(); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : fallback))
      .finally(() => setBusy(false));
  };

  return (
    <section className={styles.card} aria-labelledby="prerequisites-heading">
      <h3 id="prerequisites-heading" className={styles.cardTitle}>{t('prerequisites.title')}</h3>
      <p className={styles.cardHint}>{t('prerequisites.intro')}</p>

      {prerequisites.length === 0 ? (
        <p className={styles.empty}>{t('prerequisites.empty')}</p>
      ) : (
        <div className={styles.scroller}>
          {prerequisites.map((prerequisite) => (
            <div key={prerequisite.courseId} className={styles.orderRow}>
              <span className={styles.orderTitle}>{prerequisite.title}</span>
              <RoleGate capability="learning.manage" silent>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('prerequisites.remove')}
                  disabled={busy}
                  onClick={() => run(
                    learningApi.removePrerequisite(courseId, prerequisite.courseId),
                    t('prerequisites.removeFailed'),
                  )}
                >
                  ×
                </button>
              </RoleGate>
            </div>
          ))}
        </div>
      )}

      <RoleGate capability="learning.manage" variant="block">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="add-prerequisite">{t('prerequisites.add')}</label>
          <select
            id="add-prerequisite"
            className={styles.select}
            value=""
            disabled={busy}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (Number.isInteger(id) && id > 0) {
                run(learningApi.addPrerequisite(courseId, id), t('prerequisites.addFailed'));
              }
            }}
          >
            <option value="">{t('prerequisites.addPlaceholder')}</option>
            {available.map((course) => (
              <option key={course.id} value={course.id}>{course.title}</option>
            ))}
          </select>
        </div>
      </RoleGate>

      {paths.length > 0 && (
        <p className={styles.cardHint}>
          {t('prerequisites.inPaths', { paths: paths.map((p) => p.title ?? '').filter(Boolean).join(', ') })}
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
