'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { isLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { claimLocalDraft, rememberLastCanvas } from '@/lib/pendingWork';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { readModelComparison } from '@/lib/modelComparisonRequest';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { UpgradeModal } from '@/components/UpgradeModal';
import { faultMessage } from '@/lib/apiClient';
import { canvasLensSessionPath, type CanvasLens } from '@/lib/canvasLens';
import { canvasSurfaceDefinition, isCanvasSurfaceId, type CanvasSurfaceId } from '@/lib/canvasSurfaces';

/**
 * The board surface an ENTRY asked for — `?surface=<id>`, accepted only for a BOARD-scoped
 * surface (an object surface needs the object it is about, which a URL does not carry).
 * `?build=1` is the legacy spelling of `surface=app`, kept because published deep links
 * still carry it.
 */
function entrySurface(params: { get: (name: string) => string | null }): CanvasSurfaceId | null {
  const asked = params.get('surface');
  if (isCanvasSurfaceId(asked) && canvasSurfaceDefinition(asked).scope === 'board') return asked;
  return params.get('build') === '1' ? 'app' : null;
}

/**
 * The route half of a board: `/create/<id>` (lens `canvas`) and `/studio/<id>` (lens
 * `studio`) both render THIS, so the two are one board seen two ways rather than two
 * pages. See `lib/canvasLens.ts`.
 */
export default function CreationSessionClient({ sessionId, lens = 'canvas' }: { sessionId: string; lens?: CanvasLens }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const t = useTranslations('creationCanvas');
  const claiming = useRef(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);
  const local = isLocalCreationSession(sessionId);
  const canvas = useOptionalActiveCanvas();
  const focusId = searchParams.get('focus');
  const shareOpen = searchParams.get('share') === '1';
  const surface = entrySurface(searchParams);
  const prompt = searchParams.get('prompt');
  const present = searchParams.get('present') === '1';
  const modelComparisonIds = useMemo(() => readModelComparison(searchParams), [searchParams]);

  // THE ROUTE NO LONGER OWNS THE BOARD. It says which board belongs on the stage
  // and the shell keeps that board mounted, so opening a page (or coming back)
  // does not tear down the canvas, its in-flight Brain turn, or the presence
  // poll.
  //
  // There is no longer a second path. The anonymous board used to render itself
  // here because the marketing shell had no stage; it now gets the same operator
  // shell a signed-in board does, so the ONE stage hosts every canvas and this
  // route only ever registers.
  const registerCanvas = canvas?.open;
  useEffect(() => {
    if (!registerCanvas) return;
    registerCanvas({ sessionId, persistence: local ? 'local' : 'server', focusId, shareOpen, lens, surface, prompt, present, modelComparisonIds });
  }, [focusId, lens, local, modelComparisonIds, present, prompt, registerCanvas, sessionId, shareOpen, surface]);

  // Claiming itself lives in `lib/pendingWork` — this route and the shell-level
  // <ResumeWorkBridge> both call the same coalesced function, so whichever gets
  // there first does the work and the other joins its promise. Two copies of this
  // effect is how the same board got claimed twice.
  useEffect(() => {
    if (!local || !isAuthenticated || !hasTenant || claiming.current) return;
    claiming.current = true;
    void claimLocalDraft(sessionId)
      .then((claimed) => {
        // The SAME lens for the claimed id, with the entry surface kept: a guest who
        // started in Studio and signed in stays in Studio on the saved board.
        if (claimed) router.replace(canvasLensSessionPath(lens, claimed.sessionId, { surface }));
        else claiming.current = false;
      })
      .catch((error: unknown) => {
        claiming.current = false;
        if (isPlanLimitError(error)) {
          setPlanError(error);
          return;
        }
        setClaimError(faultMessage(error, t('noticeClaimFailed')));
      });
  }, [hasTenant, isAuthenticated, lens, local, router, sessionId, surface, t]);

  // A durable canvas the person is looking at IS "what I was working on" — the
  // switcher and the shell read this back so returning never depends on them
  // remembering a name.
  useEffect(() => {
    if (local || !hasTenant) return;
    rememberLastCanvas(sessionId, document.title || sessionId);
  }, [hasTenant, local, sessionId]);

  return <>
    <UpgradeModal
      error={planError}
      onClose={() => setPlanError(null)}
    />
    {/* Theme tokens, not literals: this rides on the guest→sign-in path, which
        renders in whichever theme the visitor arrived from. */}
    {claimError && <div role="alert" style={{ position: 'fixed', zIndex: 100, top: 76, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--error)', boxShadow: '0 6px 22px var(--shadow-coral-soft)' }}>{claimError}</div>}
  </>;
}
