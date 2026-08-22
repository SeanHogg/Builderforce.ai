'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';

/**
 * Compatibility adapter for `/brainstorm`: Brain conversations now live on
 * Creation Canvas. This one cannot be a server `retiredRoute()` — the
 * destination is not a function of the URL, it has to OPEN a canvas session
 * first, which needs the visitor's session.
 */
export function BrainstormCanvasRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasTenant } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const chatId = Number(searchParams.get('chat')) || null;
    const prompt = searchParams.get('prompt')?.trim() || '';

    const open = async () => {
      if (chatId && hasTenant) {
        const result = await creationSessionsApi.openResource('chat', chatId);
        if (!cancelled) router.replace(`/create/${result.sessionId}?focus=${result.objectId}`);
        return;
      }
      if (prompt) {
        if (hasTenant) {
          const result = await creationSessionsApi.create({ title: prompt.slice(0, 80), initialPrompt: prompt });
          if (!cancelled) router.replace(`/create/${result.session.id}`);
        } else {
          const sessionId = startGuestCreationSession(prompt, { surface: 'brain' });
          if (!cancelled) router.replace(`/create/${sessionId}`);
        }
        return;
      }
      if (!cancelled) router.replace('/create/new');
    };

    void open().catch(() => {
      if (!cancelled) router.replace('/create');
    });
    return () => { cancelled = true; };
  }, [hasTenant, router, searchParams]);

  return null;
}
