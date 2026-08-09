'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { isLocalCreationSession } from '@/lib/creationSessions';
import { claimLocalDraft, rememberLastCanvas } from '@/lib/pendingWork';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { readModelComparison } from '@/lib/modelComparisonRequest';

const BUILD_TICKET_KINDS = new Set(['portfolio', 'objective', 'initiative', 'roadmap', 'spec', 'epic', 'gap', 'task']);

function buildTicket(raw: string | null): { kind: string; ref: string } | null {
  if (!raw) return null;
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  const ref = raw.slice(separator + 1);
  return ref && BUILD_TICKET_KINDS.has(kind) ? { kind, ref } : null;
}

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
  const buildOpen = searchParams.get('build') === '1';
  const buildChatId = Number(searchParams.get('chat')) || null;
  const buildTicketValue = searchParams.get('ticket');
  const buildTicketLink = useMemo(() => buildTicket(buildTicketValue), [buildTicketValue]);
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
    registerCanvas({ sessionId, persistence: local ? 'local' : 'server', focusId, shareOpen, buildOpen, buildChatId, buildTicket: buildTicketLink, prompt, present, modelComparisonIds });
  }, [buildChatId, buildOpen, buildTicketLink, focusId, local, modelComparisonIds, present, prompt, registerCanvas, sessionId, shareOpen]);

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
    {claimError && <div role="alert" style={{ position: 'fixed', zIndex: 100, top: 76, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--error)', boxShadow: '0 6px 22px var(--shadow-coral-soft)' }}>{claimError}</div>}
  </>;
}
