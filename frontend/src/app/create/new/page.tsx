'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { getActiveGuestRoom } from '@/lib/guestRoomApi';
import { GuestRoomJoinCard } from '@/components/guest/GuestRoomJoinCard';

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
  const { isAuthenticated, hasTenant } = useAuth();
  const started = useRef(false);
  const [message, setMessage] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState('');
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
      setInitialPrompt(params.get('prompt')?.trim().slice(0, 4_000) || '');
    } catch {
      code = null; // no URL access — fall through to the ordinary new-canvas path
    }
    // Already in this room (a reload, or a second visit) — straight to the board.
    setInviteCode(code && code !== getActiveGuestRoom() ? code : null);
    setCheckedInvite(true);
  }, []);

  useEffect(() => {
    if (!checkedInvite || inviteCode || started.current) return;
    started.current = true;
    setMessage(t('creatingCanvas'));
    if (!isAuthenticated || !hasTenant) {
      router.replace(`/create/${startGuestCreationSession(initialPrompt)}`);
      return;
    }
    void creationSessionsApi.create({ title: initialPrompt ? 'Build an LLM' : 'Untitled session', ...(initialPrompt ? { initialPrompt } : {}) })
      .then(({ session }) => router.replace(`/create/${session.id}`))
      .catch(() => {
        setMessage(t('startingOnDevice'));
        router.replace(`/create/${startGuestCreationSession(initialPrompt)}`);
      });
  }, [checkedInvite, hasTenant, initialPrompt, inviteCode, isAuthenticated, router, t]);

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
