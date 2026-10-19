'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, faultMessage } from '@/lib/apiClient';

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
  const [shelf, setShelf] = useState<AcademyShelf | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const shelf = await apiRequest<AcademyShelf>('/api/creation-listings/academy');
    if (!shelf.ok) {
      setShelf({ ok: false, courses: [] });
      setError(shelf.detail ?? shelf.reason ?? 'No business stage is set on this workspace');
      return;
    }
    setShelf(shelf);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => setError(faultMessage(err, 'Could not load stage courses')));
  }, [load]);

  async function run(label: string, work: () => Promise<unknown>) {
    setError(null);
    setMessage(null);
    try {
      const result = await work();
      setMessage(typeof result === 'object' && result ? `${label}: ${JSON.stringify(result)}` : label);
      await load().catch(() => undefined);
    } catch (err) {
      setError(faultMessage(err, 'Request failed'));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Stage learning</h1>
        <p className="text-sm text-neutral-600">
          Courses and the starter toolkit for your company&apos;s business stage
          {shelf?.stage ? ` (${shelf.stage.replaceAll('_', ' ')})` : ''}.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-700 break-all">{message}</p>}

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-neutral-900 px-3 py-2 text-sm text-white"
          onClick={() => void run('Toolkit installed', () => apiRequest('/api/creation-listings/stage-toolkit/install', { method: 'POST' }))}
        >
          Install stage toolkit
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Courses for this stage</h2>
        {!shelf?.courses || shelf.courses.length === 0 ? (
          <p className="text-sm text-neutral-500">No published courses for this stage yet.</p>
        ) : (
          <ul className="divide-y rounded border">
            {shelf.courses?.map((course) => (
              <li key={course.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{course.name}</p>
                  {course.summary && <p className="text-xs text-neutral-600">{course.summary}</p>}
                </div>
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() =>
                    void run(`Enrolled in ${course.name}`, () =>
                      apiRequest('/api/creation-listings/academy/enrol', {
                        method: 'POST',
                        body: JSON.stringify({ listingId: course.id }),
                      }),
                    )
                  }
                >
                  Enrol
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
