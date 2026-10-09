// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { faultMessage } from '@/lib/apiClient';
import { startCreationSession } from '@/lib/canvas/startCreationSession';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { studioSessionPath } from '@/lib/studio/studioHost';

/**
 * Turn a Studio prompt into a creation session and open it through the Studio lens.
 *
 * No sign-in, no workspace: the SAME session every other door opens
 * (`lib/canvas/startCreationSession.ts`) — a server session for someone with a workspace,
 * a `local-<uuid>` board for everyone else — at `/studio/<id>`, where the canvas creates
 * the app and runs the prompt as its first turn (`lib/canvasLens.ts`).
 *
 * WAITS FOR `authReady`, for the reason `/create/new` does: until the stored session has
 * been read off the device, `hasTenant` is false for EVERYONE, and acting on it would hand
 * a signed-in builder a throwaway guest board instead of a session in their workspace. A
 * press that lands before then is queued and runs the moment the session is known.
 *
 * A plan limit is not an error line: it comes back as `planError`, for the page's
 * `UpgradeModal`, exactly as the canvas route shows it.
 */
export function useStartStudioSession(failedMessage: string) {
  const router = useRouter();
  const { authReady, isAuthenticated, hasTenant } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);
  /** A prompt sent before the session was known — run once `authReady` arrives. */
  const queuedRef = useRef<string | null>(null);

  const run = useCallback(async (prompt: string) => {
    try {
      const { sessionId } = await startCreationSession({ prompt, isAuthenticated, hasTenant, surface: 'studio' });
      router.push(studioSessionPath(sessionId));
    } catch (cause) {
      if (isPlanLimitError(cause)) setPlanError(cause);
      else setError(faultMessage(cause, failedMessage));
      setBusy(false);
    }
  }, [failedMessage, hasTenant, isAuthenticated, router]);

  const start = useCallback((prompt: string) => {
    setBusy(true);
    setError(null);
    if (authReady) { void run(prompt); return; }
    queuedRef.current = prompt;
  }, [authReady, run]);

  useEffect(() => {
    const queued = queuedRef.current;
    if (!authReady || queued === null) return;
    queuedRef.current = null;
    void run(queued);
  }, [authReady, run]);

  const clearPlanError = useCallback(() => setPlanError(null), []);

  return { start, busy, error, planError, clearPlanError };
}
