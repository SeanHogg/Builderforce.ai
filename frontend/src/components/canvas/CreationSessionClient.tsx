'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { isLocalCreationSession } from '@/domains/canvas/domain/boardSnapshot';
import { legacyBoardId } from '@/domains/canvas/infrastructure/localFirst/boardRecords';
import { BOARD_PLAN_LIMIT_CODE } from '@/domains/canvas/infrastructure/localFirst/boardSyncOutcome';
import { bindLocalBoard, rememberLastCanvas } from '@/lib/pendingWork';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { StudioSyncIndicator } from '@/components/studio/StudioSyncStatus';
import { BoardConflictsPanel } from './BoardConflictsPanel';
import { useBoardConflicts } from './useBoardConflicts';
import { useBoardSyncOutcome } from './useBoardSyncOutcome';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { readModelComparison } from '@/lib/modelComparisonRequest';
import { PlanLimitError } from '@/lib/planLimitError';
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
  const { isAuthenticated, hasTenant, authReady } = useAuth();
  const t = useTranslations('creationCanvas');
  const boundFor = useRef<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const planDismissed = dismissedFor === sessionId;
  // A board of an older build is named `local-<uuid>` in a bookmark or a pointer; it is the same
  // board under its plain id (the legacy import re-keyed it once), so the URL is swapped, not kept.
  const legacy = isLocalCreationSession(sessionId);
  // The board has a server behind it when someone is in a workspace: the same board either way,
  // opened from this device first. Decided once the stored session has been read.
  const inWorkspace = isAuthenticated && hasTenant;
  const persistence = inWorkspace ? 'server' : 'local';
  const canvas = useOptionalActiveCanvas();
  const focusId = searchParams.get('focus');
  const shareOpen = searchParams.get('share') === '1';
  const surface = entrySurface(searchParams);
  const prompt = searchParams.get('prompt');
  const present = searchParams.get('present') === '1';
  const modelComparisonIds = useMemo(() => readModelComparison(searchParams), [searchParams]);

  useEffect(() => {
    if (legacy) router.replace(canvasLensSessionPath(lens, legacyBoardId(sessionId), { surface }));
  }, [legacy, lens, router, sessionId, surface]);

  // THE ROUTE NO LONGER OWNS THE BOARD. It says which board belongs on the stage
  // and the shell keeps that board mounted, so opening a page (or coming back)
  // does not tear down the canvas, its in-flight Brain turn, or the presence
  // poll.
  //
  // There is no longer a second path. The anonymous board used to render itself
  // here because the marketing shell had no stage; it now gets the same operator
  // shell a signed-in board does, so the ONE stage hosts every canvas and this
  // route only ever registers. Registration waits for the stored session: until
  // it is read, `isAuthenticated` is false for everyone and the board would open
  // as a guest's and then be torn down and reopened as the workspace's.
  const registerCanvas = canvas?.open;
  useEffect(() => {
    if (!registerCanvas || !authReady || legacy) return;
    registerCanvas({ sessionId, persistence, focusId, shareOpen, lens, surface, prompt, present, modelComparisonIds });
  }, [authReady, focusId, legacy, lens, modelComparisonIds, persistence, present, prompt, registerCanvas, sessionId, shareOpen, surface]);

  // Binding a board built before sign-in to the workspace lives in `lib/pendingWork` — this route and
  // the shell-level <ResumeWorkBridge> both call the same coalesced function, so whichever gets there
  // first does the work and the other joins its promise. It is not an HTTP claim: the board's records
  // are re-snapshotted to the workspace in one transaction and the sync driver sends them. The board
  // keeps its id, so there is no URL to swap; a no-op for a board that is already bound.
  useEffect(() => {
    if (legacy || !inWorkspace || boundFor.current === sessionId) return;
    boundFor.current = sessionId;
    void bindLocalBoard(sessionId).catch((error: unknown) => {
      boundFor.current = null;
      reportLocalFirstFailure('CreationSessionClient.bind', error);
      setClaimError(faultMessage(error, t('noticeClaimFailed')));
    });
  }, [inWorkspace, legacy, sessionId, t]);

  // A durable canvas the person is looking at IS "what I was working on" — the switcher and the shell
  // read this back so returning never depends on them remembering a name. It points at a board once
  // the SERVER has accepted it (the store has its mapping), never at one that is only on its way.
  const { planLimited } = useBoardSyncOutcome(sessionId, inWorkspace && !legacy, (acceptedId) => {
    rememberLastCanvas(acceptedId, document.title || acceptedId);
  });
  // The workspace refused this board for its plan: it stays on the device, and the upgrade path is offered from the receipt.
  const planError = useMemo(
    () => (planLimited && !planDismissed ? new PlanLimitError({ error: t('noticePlanLimitBoard'), code: BOARD_PLAN_LIMIT_CODE, upgradeRequired: true }) : null),
    [planDismissed, planLimited, t],
  );
  const { conflicts, resolve } = useBoardConflicts(sessionId, !legacy);

  return <>
    <UpgradeModal
      error={planError}
      onClose={() => setDismissedFor(sessionId)}
    />
    {/* Where this device's work stands with the server, and the one notice when two writers touched the same object. */}
    <div style={{ position: 'fixed', zIndex: 60, top: 76, right: 12, maxWidth: 'calc(100vw - 24px)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}><StudioSyncIndicator /></div>
      <div style={{ pointerEvents: 'auto' }}><BoardConflictsPanel conflicts={conflicts} resolve={resolve} /></div>
    </div>
    {/* Theme tokens, not literals: this rides on the guest→sign-in path, which
        renders in whichever theme the visitor arrived from. */}
    {claimError && <div role="alert" style={{ position: 'fixed', zIndex: 100, top: 76, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--error)', boxShadow: '0 6px 22px var(--shadow-coral-soft)' }}>{claimError}</div>}
  </>;
}
