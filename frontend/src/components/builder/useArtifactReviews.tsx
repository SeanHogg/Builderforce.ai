// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useCallback, useState, type ReactNode } from 'react';
import { savePrd, saveTasks } from '@/lib/brain';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { PrdReviewModal, TasksReviewModal } from '@/components/ArtifactReviewModals';

interface TasksDraft {
  titles: string[];
  descriptions: string[];
}

/**
 * Confirm-before-save for what the Brain's `generate_prd` / `generate_tasks`
 * tools produce — parity with the message-action button path, so nothing an
 * agent writes into the project's specs or backlog saves unreviewed.
 *
 * `requestPrd` / `requestTasks` resolve `true` once the person saved, `false`
 * when they cancelled; `modals` is the review dialog to render.
 */
export function useArtifactReviews(projectId: number): {
  requestPrd: (prd: string) => Promise<boolean>;
  requestTasks: (draft: TasksDraft) => Promise<boolean>;
  modals: ReactNode;
} {
  const errorMessage = useErrorMessage();
  const [prdReview, setPrdReview] = useState<{ prd: string; resolve: (saved: boolean) => void } | null>(null);
  const [tasksReview, setTasksReview] = useState<(TasksDraft & { resolve: (saved: boolean) => void }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPrd = useCallback((prd: string) => new Promise<boolean>((resolve) => {
    setError(null);
    setPrdReview({ prd, resolve });
  }), []);
  const requestTasks = useCallback((draft: TasksDraft) => new Promise<boolean>((resolve) => {
    setError(null);
    setTasksReview({ ...draft, resolve });
  }), []);

  const confirm = useCallback(async (save: () => Promise<unknown>, settle: () => void) => {
    setSaving(true);
    setError(null);
    try {
      await save();
      settle();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [errorMessage]);

  const modals = (
    <>
      {prdReview && (
        <PrdReviewModal
          prd={prdReview.prd}
          onCancel={() => { prdReview.resolve(false); setPrdReview(null); setError(null); }}
          onConfirm={() => confirm(() => savePrd(projectId, prdReview.prd), () => { prdReview.resolve(true); setPrdReview(null); })}
          saving={saving}
          error={error}
        />
      )}
      {tasksReview && (
        <TasksReviewModal
          titles={tasksReview.titles}
          descriptions={tasksReview.descriptions}
          onCancel={() => { tasksReview.resolve(false); setTasksReview(null); setError(null); }}
          onConfirm={() => confirm(
            () => saveTasks(projectId, { titles: tasksReview.titles, descriptions: tasksReview.descriptions }),
            () => { tasksReview.resolve(true); setTasksReview(null); },
          )}
          saving={saving}
          error={error}
        />
      )}
    </>
  );

  return { requestPrd, requestTasks, modals };
}
