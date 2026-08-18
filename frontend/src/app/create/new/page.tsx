'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { getActiveGuestRoom } from '@/lib/guestRoomApi';
import { GuestRoomJoinCard } from '@/components/guest/GuestRoomJoinCard';
import { modelComparisonCanvasHref, readModelComparison } from '@/lib/modelComparisonRequest';
import { CANVAS_PROMPT_MAX } from '@/lib/canvasIntent';

export const runtime = 'edge';

/**
 * "Make me a canvas" — and, with `?room=`, the landing point for a SHARED free
 * canvas invite.
 *
 * An invitee arriving on a room link has no session of their own yet, so they
 * join the room first and are then routed onto a fresh local canvas, which
 * hydrates its board from that room. The board lives in the room; the session id
 * stays per-browser, which is what keeps this from needing a second id scheme.
 */
export default function NewCreationSessionPage() {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const { authReady, isAuthenticated, hasTenant } = useAuth();
  const started = useRef(false);
  const [message, setMessage] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [modelComparisonIds, setModelComparisonIds] = useState<string[]>([]);
  const [checkedInvite, setCheckedInvite] = useState(false);

  // Read the invite BEFORE deciding what this page is: a room link must not be
  // consumed by the ordinary "create a canvas and redirect" path below.
  useEffect(() => {
    let code: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      code = params.get('room')?.trim() || null;
      // Blog and product CTAs can start a real generated canvas. Keep the prompt
      // through this redirect rather than leaving the learner on a blank board.
      // Same ceiling the LINK BUILDER clamps to (`lib/canvasIntent`). Two
      // numbers here would mean a URL whose tail is silently dropped, and a
      // truncated prompt reads as a complete instruction that happens to be wrong.
      setInitialPrompt(params.get('prompt')?.trim().slice(0, CANVAS_PROMPT_MAX) || '');
      setModelComparisonIds(readModelComparison(params));
    } catch {
      code = null; // no URL access — fall through to the ordinary new-canvas path
    }
    // Already in this room (a reload, or a second visit) — straight to the board.
    setInviteCode(code && code !== getActiveGuestRoom() ? code : null);
    setCheckedInvite(true);
  }, []);

  useEffect(() => {
    // `authReady` is load-bearing here, not defensive: until the stored session
    // has been read off the device `isAuthenticated` is false for EVERYONE, and
    // acting on it would hand a signed-in builder a throwaway local guest board
    // instead of the server session their workspace expects.
    if (!authReady || !checkedInvite || inviteCode || started.current) return;
    started.current = true;
    setMessage(t('creatingCanvas'));
    if (!isAuthenticated || !hasTenant) {
      const id = startGuestCreationSession(initialPrompt);
      router.replace(modelComparisonCanvasHref(id, modelComparisonIds));
      return;
    }
    void creationSessionsApi.create({ title: initialPrompt.trim().slice(0, 80) || 'Untitled session', ...(initialPrompt ? { initialPrompt } : {}) })
      .then(({ session }) => {
        router.replace(modelComparisonCanvasHref(session.id, modelComparisonIds));
      })
      .catch(() => {
        setMessage(t('startingOnDevice'));
        const id = startGuestCreationSession(initialPrompt);
        router.replace(modelComparisonCanvasHref(id, modelComparisonIds));
      });
  }, [authReady, checkedInvite, hasTenant, initialPrompt, inviteCode, isAuthenticated, modelComparisonIds, router, t]);

  if (inviteCode) {
    return (
      <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <GuestRoomJoinCard
          code={inviteCode}
          blurb={t('sharedJoinBlurb')}
          onJoined={() => router.replace(`/create/${startGuestCreationSession('')}`)}
        />
      </main>
    );
  }

  return <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>{message}</main>;
}
