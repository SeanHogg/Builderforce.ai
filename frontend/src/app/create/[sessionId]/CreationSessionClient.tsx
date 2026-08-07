'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { creationGraphFromSnapshot, isLocalCreationSession, readLocalCreationSession, removeLocalCreationSession } from '@/lib/creationSessions';

export default function CreationSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const t = useTranslations('creationCanvas');
  const claiming = useRef(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const local = isLocalCreationSession(sessionId);

  useEffect(() => {
    if (!local || !isAuthenticated || !hasTenant || claiming.current) return;
    const snapshot = readLocalCreationSession(sessionId);
    if (!snapshot) return;
    claiming.current = true;
    void (async () => {
      try {
        const graph = creationGraphFromSnapshot(snapshot);
        const created = await creationSessionsApi.claim({ clientSessionId: sessionId, title: snapshot.title, initialPrompt: snapshot.initialPrompt, timeline: snapshot.timeline, ...graph });
        removeLocalCreationSession(sessionId);
        router.replace(`/create/${created.session.id}`);
      } catch (error) {
        claiming.current = false;
        setClaimError(error instanceof Error ? error.message : t('noticeClaimFailed'));
      }
    })();
  }, [hasTenant, isAuthenticated, local, router, sessionId]);

  return <>
    {/* Theme tokens, not literals: this rides on the guest→sign-in path, which
        renders in whichever theme the visitor arrived from. */}
    {claimError && <div role="alert" style={{ position: 'fixed', zIndex: 100, top: 76, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--error, #e0736f)', boxShadow: '0 6px 22px var(--shadow-coral-soft)' }}>{claimError}</div>}
    <CreationCanvas sessionId={sessionId} persistence={local ? 'local' : 'server'} initialFocusId={searchParams.get('focus')} initialShareOpen={searchParams.get('share') === '1'} initialPresent={searchParams.get('present') === '1'} />
  </>;
}
