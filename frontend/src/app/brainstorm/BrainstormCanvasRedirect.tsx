'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';
import { startCreationSession } from '@/lib/canvas/startCreationSession';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { UpgradeModal } from '@/components/UpgradeModal';

/**
 * Compatibility adapter for `/brainstorm`: Brain conversations now live on
 * Creation Canvas. This one cannot be a server `retiredRoute()` — the
 * destination is not a function of the URL, it has to OPEN a canvas session
 * first, which needs the visitor's session.
 */
export function BrainstormCanvasRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authReady, isAuthenticated, hasTenant } = useAuth();
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  useEffect(() => {
    // Wait for the stored session, as `/create/new` does: before it is read, everyone looks
    // signed out, and a signed-in builder would be handed a guest board.
    if (!authReady) return undefined;
    let cancelled = false;
    const chatId = Number(searchParams.get('chat')) || null;
    const prompt = searchParams.get('prompt')?.trim() || '';

    const open = async () => {
      if (chatId && hasTenant) {
        const result = await creationSessionsApi.openResource('chat', chatId);
        if (!cancelled) router.replace(openedBoardHref(result));
        return;
      }
      if (prompt) {
        // THE one start-a-session use case (`lib/canvas/startCreationSession.ts`).
        const { sessionId } = await startCreationSession({ prompt, isAuthenticated, hasTenant, surface: 'brain' });
        if (!cancelled) router.replace(openedBoardHref({ sessionId }));
        return;
      }
      if (!cancelled) router.replace('/create/new');
    };

    void open().catch((error: unknown) => {
      if (cancelled) return;
      // A plan limit is the one failure worth a stop: say why, with the way up, as
      // `/create/new` and the dashboard do. Anything else lands in the library.
      if (isPlanLimitError(error)) setPlanError(error);
      else router.replace('/create');
    });
    return () => { cancelled = true; };
  }, [authReady, hasTenant, isAuthenticated, router, searchParams]);

  return <UpgradeModal error={planError} onClose={() => { setPlanError(null); router.replace('/create'); }} />;
}
