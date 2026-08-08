'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { useAuth } from '@/lib/AuthContext';
import { isLocalCreationSession } from '@/lib/creationSessions';
import { claimLocalDraft, rememberLastCanvas } from '@/lib/pendingWork';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { readModelComparison } from '@/lib/modelComparisonRequest';

export default function CreationSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const t = useTranslations('creationCanvas');
  const claiming = useRef(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const local = isLocalCreationSession(sessionId);
  const canvas = useOptionalActiveCanvas();
  const focusId = searchParams.get('focus');
  const shareOpen = searchParams.get('share') === '1';
  const present = searchParams.get('present') === '1';
  const modelComparisonIds = useMemo(() => readModelComparison(searchParams), [searchParams]);

  // THE ROUTE NO LONGER OWNS THE BOARD. It says which board belongs on the stage
  // and the shell keeps that board mounted, so opening a page (or coming back)
  // does not tear down the canvas, its in-flight Brain turn, or the presence
  // poll. The marketing shell has no stage, so an anonymous board still renders
  // here — `stageHosted` is derived, never reported late, so exactly one of the
  // two paths ever mounts a canvas.
  const stageHosted = canvas?.stageHosted ?? false;
  const registerCanvas = canvas?.open;
  useEffect(() => {
    if (!stageHosted || !registerCanvas) return;
    registerCanvas({ sessionId, persistence: local ? 'local' : 'server', focusId, shareOpen, present, modelComparisonIds });
  }, [focusId, local, modelComparisonIds, present, registerCanvas, sessionId, shareOpen, stageHosted]);

  // Claiming itself lives in `lib/pendingWork` — this route and the shell-level
  // <ResumeWorkBridge> both call the same coalesced function, so whichever gets
  // there first does the work and the other joins its promise. Two copies of this
  // effect is how the same board got claimed twice.
  useEffect(() => {
    if (!local || !isAuthenticated || !hasTenant || claiming.current) return;
    claiming.current = true;
    void claimLocalDraft(sessionId)
      .then((claimed) => {
        if (claimed) router.replace(`/create/${claimed.sessionId}`);
        else claiming.current = false;
      })
      .catch((error: unknown) => {
        claiming.current = false;
        setClaimError(error instanceof Error ? error.message : t('noticeClaimFailed'));
      });
  }, [hasTenant, isAuthenticated, local, router, sessionId, t]);

  // A durable canvas the person is looking at IS "what I was working on" — the
  // switcher and the shell read this back so returning never depends on them
  // remembering a name.
  useEffect(() => {
    if (local || !hasTenant) return;
    rememberLastCanvas(sessionId, document.title || sessionId);
  }, [hasTenant, local, sessionId]);

  return <>
    {/* Theme tokens, not literals: this rides on the guest→sign-in path, which
        renders in whichever theme the visitor arrived from. */}
    {claimError && <div role="alert" style={{ position: 'fixed', zIndex: 100, top: 76, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--error, #e0736f)', boxShadow: '0 6px 22px var(--shadow-coral-soft)' }}>{claimError}</div>}
    {!stageHosted && <CreationCanvas sessionId={sessionId} persistence={local ? 'local' : 'server'} initialFocusId={focusId} initialShareOpen={shareOpen} initialPresent={present} initialModelComparisonIds={modelComparisonIds} />}
  </>;
}
