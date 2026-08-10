'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';

/** Compatibility adapter: Brain conversations now live on Creation Canvas. */
function BrainstormCanvasRedirect() {
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

export default function BrainstormCompatibilityPage() {
  return <Suspense fallback={null}><BrainstormCanvasRedirect /></Suspense>;
}
