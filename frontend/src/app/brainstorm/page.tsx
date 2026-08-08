'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrainPanel } from '@/components/brain/BrainPanel';
import { takePendingPrompt } from '@/lib/brain';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';

/**
 * Brain Storm — the full-page Brain. It renders the exact same <BrainPanel>
 * (and therefore the same logic + UI) as the global docked drawer; only the
 * `variant` chrome differs. Deep links: ?chat= selects a chat, ?project= scopes
 * the project filter (the global TopBar scope, adopted by ProjectScopeProvider),
 * ?prompt= auto-sends a one-shot prompt (the dashboard "What should we build?"
 * input routes here).
 */
export default function BrainstormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasTenant } = useAuth();
  const chatIdParam = searchParams.get('chat');
  const initialChatId = chatIdParam ? (Number(chatIdParam) || null) : null;
  const creationNav = process.env.NEXT_PUBLIC_CREATION_SESSIONS_NAV !== 'false';
  const legacyPrompt = searchParams.get('prompt')?.trim() || '';
  const shouldAdapt = creationNav;
  const [adapterFailed, setAdapterFailed] = useState(false);

  useEffect(() => {
    if (!shouldAdapt) return;
    let stopped = false;
    const open = async () => {
      if (initialChatId && hasTenant) {
        const result = await creationSessionsApi.openResource('chat', initialChatId);
        if (!stopped) router.replace(`/create/${result.sessionId}?focus=${result.objectId}&from=brainstorm`);
        return;
      }
      if (legacyPrompt) {
        if (hasTenant) {
          const result = await creationSessionsApi.create({ title: legacyPrompt.slice(0, 80), initialPrompt: legacyPrompt });
          if (!stopped) router.replace(`/create/${result.session.id}?from=brainstorm`);
        } else {
          const localId = startGuestCreationSession(legacyPrompt, { surface: 'brain' });
          if (!stopped) router.replace(`/create/${localId}?from=brainstorm`);
        }
        return;
      }
      if (!stopped) router.replace('/create/new?from=brainstorm');
    };
    void open().catch(() => { if (!stopped) setAdapterFailed(true); });
    return () => { stopped = true; };
  }, [hasTenant, initialChatId, legacyPrompt, router, shouldAdapt]);

  // Capture ?prompt= exactly once on mount, then strip it from the URL so a
  // refresh doesn't replay the prompt into a fresh chat. BrainPanel auto-sends
  // it (ref-guarded) and creates+selects a chat on demand.
  const [initialPrompt, setInitialPrompt] = useState(() => searchParams.get('prompt') ?? undefined);
  useEffect(() => {
    if (shouldAdapt) return;
    if (!searchParams.get('prompt')) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('prompt');
    const qs = params.toString();
    router.replace(qs ? `/brainstorm?${qs}` : '/brainstorm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router, shouldAdapt]);

  // Fallback: a landing-page prompt captured pre-auth (localStorage, not the URL)
  // is replayed here when the user lands directly on /brainstorm after signing in.
  // FloatingBrain deliberately skips it on this route, so the page owns the
  // one-shot consume. Ref-guarded so `takePendingPrompt` (which reads+clears
  // storage) runs at most once even under StrictMode's double-invoke; skipped
  // when an explicit ?prompt= already supplied the prompt. [1509]
  const pendingConsumedRef = useRef(false);
  useEffect(() => {
    if (!hasTenant || pendingConsumedRef.current) return;
    pendingConsumedRef.current = true;
    if (initialPrompt) return; // ?prompt= already drives the auto-send
    const p = takePendingPrompt();
    if (p) setInitialPrompt(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTenant]);

  if (shouldAdapt && !adapterFailed) return <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Opening your creation canvas…</div>;

  return (
    <>
    <BrainPanel
      variant="page"
      initialChatId={initialChatId}
      initialPrompt={initialPrompt}
    />
    {adapterFailed && <div role="status" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 20, padding: 12, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>Canvas migration was unavailable. Brain remains open so your deep link still works.</div>}
    </>
  );
}
