'use client';

import { useCallback } from 'react';
import { useOptionalBrainContext } from '@seanhogg/builderforce-brain-embedded';

/**
 * Open a NEW Brain chat scoped to a project — the ONE way any surface (project
 * card, list row, details) launches the assistant for a specific project.
 *
 * Inside the app shell the Brain provider is present, so we start a fresh chat
 * (`setActiveChatId(null)`), point it at the project as `viewingProjectId` (the
 * co-pilot persona, not an IDE pin), optionally seed a one-shot prompt, and pop
 * the floating drawer. Outside the provider (SSR / isolated render / tests) we
 * fall back to the full-page `/brainstorm` route with the same scope.
 */
export function useOpenProjectChat(): (projectId: number, opts?: { prompt?: string }) => void {
  const brain = useOptionalBrainContext();
  return useCallback(
    (projectId: number, opts?: { prompt?: string }) => {
      if (brain) {
        brain.setActiveChatId(null);
        brain.setContext({ viewingProjectId: projectId, initialPrompt: opts?.prompt });
        brain.setOpen(true);
        return;
      }
      if (typeof window !== 'undefined') {
        const qs = new URLSearchParams({ project: String(projectId) });
        if (opts?.prompt) qs.set('prompt', opts.prompt);
        window.location.href = `/brainstorm?${qs.toString()}`;
      }
    },
    [brain],
  );
}
