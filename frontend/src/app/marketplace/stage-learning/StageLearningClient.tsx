'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiRequest } from '@/lib/apiClient';
import { useErrorMessage } from '@/i18n/useErrorMessage';

interface StageCourse {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  stages: readonly string[];
  courseId: number | null;
}

interface AcademyShelf {
  ok: boolean;
  stage?: string;
  courses?: StageCourse[];
  reason?: string;
  detail?: string;
}

/**
 * Stage-scoped learning (epic #2545 A3/A4).
 *
 * The shelf is `GET /api/creation-listings/academy` — courses tagged with the
 * founder's `companies.business_stage`. Enrol and toolkit install are the
 * marketplace actions beside that shelf, not a second catalogue.
 */
export function StageLearningClient() {
  const t = useTranslations('marketplace.stageLearning');
  const errorMessage = useErrorMessage();
  const [shelf, setShelf] = useState<AcademyShelf | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiRequest<AcademyShelf>('/api/creation-listings/academy').then((next) => {
      if (cancelled) return;
      if (!next.ok) {
        setShelf({ ok: false, courses: [] });
        setError(t('noStage'));
        return;
      }
      setShelf(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(errorMessage(err));
    });
    return () => { cancelled = true; };
  }, [reloadKey, t, errorMessage]);

  async function run(label: string, work: () => Promise<unknown>) {
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(label);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('title')}</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {shelf?.stage ? t('introWithStage', { stage: shelf.stage.replaceAll('_', ' ') }) : t('intro')}
        </p>
      </header>

      {error && <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p>}
      {message && <p role="status" className="text-sm text-[var(--success-text)]">{message}</p>}

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-[44px] rounded bg-[var(--accent)] px-3 py-2 text-sm text-[var(--text-on-accent)]"
          onClick={() => void run(t('toolkitInstalled'), () => apiRequest('/api/creation-listings/stage-toolkit/install', { method: 'POST' }))}
        >
          {t('installToolkit')}
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">{t('coursesHeading')}</h2>
        {!shelf?.courses || shelf.courses.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">{t('noCourses')}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-[var(--surface-card)]">
            {shelf.courses.map((course) => (
              <li key={course.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{course.name}</p>
                  {course.summary && <p className="text-xs text-[var(--text-secondary)]">{course.summary}</p>}
                </div>
                <button
                  type="button"
                  className="min-h-[44px] rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-primary)]"
                  onClick={() =>
                    void run(t('enrolled', { name: course.name }), () =>
                      apiRequest('/api/creation-listings/academy/enrol', {
                        method: 'POST',
                        body: JSON.stringify({ listingId: course.id }),
                      }),
                    )
                  }
                >
                  {t('enrol')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
