'use client';

import { useEffect, useState } from 'react';
import { creationSessionsApi } from '@/lib/builderforceApi';

export default function InvitationAcceptClient({ token }: { token: string }) {
  const [status, setStatus] = useState('Joining this Creation Session…');

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      setStatus('This invitation link is invalid.');
      return;
    }
    void creationSessionsApi.invitations.accept(token).then(({ sessionId }) => {
      window.location.replace(`/create/${sessionId}`);
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'This invitation could not be accepted.');
    });
  }, [token]);

  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-sans)', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
    <section aria-live="polite" style={{ width: 'min(460px, calc(100% - 32px))', padding: 28, border: '1px solid var(--border-subtle)', borderRadius: 16, background: 'var(--bg-elevated)', textAlign: 'center' }}>
      <div aria-hidden="true" style={{ fontSize: 30 }}>✦</div>
      <h1>Join Creation Session</h1>
      <p>{status}</p>
      {status !== 'Joining this Creation Session…' && <a href={`/login?next=${encodeURIComponent(`/create/invitations/${token}`)}`}>Sign in with the invited email</a>}
    </section>
  </main>;
}
