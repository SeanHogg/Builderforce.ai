'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CreationCanvas } from '@/components/creation-canvas/CreationCanvas';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { creationGraphFromSnapshot, isLocalCreationSession, readLocalCreationSession, removeLocalCreationSession } from '@/lib/creationSessions';

export default function CreationSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
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
        const created = await creationSessionsApi.create({ title: snapshot.title, initialPrompt: snapshot.initialPrompt });
        const graph = creationGraphFromSnapshot(snapshot);
        await creationSessionsApi.saveGraph(created.session.id, { ...graph, expectedRevision: created.session.revision });
        removeLocalCreationSession(sessionId);
        router.replace(`/create/${created.session.id}`);
      } catch (error) {
        claiming.current = false;
        setClaimError(error instanceof Error ? error.message : 'Could not save this session yet');
      }
    })();
  }, [hasTenant, isAuthenticated, local, router, sessionId]);

  return <>
    {claimError && <div role="alert" style={{ position: 'fixed', zIndex: 100, top: 76, left: '50%', transform: 'translateX(-50%)', padding: '10px 14px', borderRadius: 10, background: '#fff1f0', color: '#a61d24', boxShadow: '0 6px 22px #19233a22' }}>{claimError}</div>}
    <CreationCanvas sessionId={sessionId} persistence={local ? 'local' : 'server'} initialFocusId={searchParams.get('focus')} />
  </>;
}
