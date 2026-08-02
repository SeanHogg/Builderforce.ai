'use client';

import { useEffect, useState } from 'react';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { useAuth } from '@/lib/AuthContext';

const replaceLocation = (path: string) => window.location.replace(path);

export default function InvitationAcceptClient({ token, navigate = replaceLocation }: { token: string; navigate?: (path: string) => void }) {
  const { isAuthenticated, fetchTenants, selectTenant, logout } = useAuth();
  const [status, setStatus] = useState(isAuthenticated ? 'Joining this Creation Session…' : 'Sign in with the invited email to join this Session.');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      setStatus('This invitation link is invalid.');
      return;
    }
    if (!isAuthenticated) {
      setStatus('Sign in with the invited email to join this Session.');
      return;
    }
    setStatus('Joining this Creation Session…');
    setFailed(false);
    void creationSessionsApi.invitations.acceptWithAccount(token).then(async ({ sessionId, tenantId }) => {
      const tenants = await fetchTenants();
      const invitedTenant = tenants.find((tenant) => Number(tenant.id) === tenantId);
      if (!invitedTenant) throw new Error('The invited workspace is not available to this account.');
      await selectTenant(invitedTenant);
      navigate(`/create/${sessionId}`);
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'This invitation could not be accepted.');
      setFailed(true);
    });
  }, [fetchTenants, isAuthenticated, navigate, selectTenant, token]);

  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-sans)', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
    <section aria-live="polite" style={{ width: 'min(460px, calc(100% - 32px))', padding: 28, border: '1px solid var(--border-subtle)', borderRadius: 16, background: 'var(--bg-elevated)', textAlign: 'center' }}>
      <div aria-hidden="true" style={{ fontSize: 30 }}>✦</div>
      <h1>Join Creation Session</h1>
      <p>{status}</p>
      {!isAuthenticated && <a href={`/login?next=${encodeURIComponent(`/create/invitations/${token}`)}`}>Sign in with the invited email</a>}
      {isAuthenticated && failed && <button type="button" onClick={() => { logout(); navigate(`/login?next=${encodeURIComponent(`/create/invitations/${token}`)}`); }}>Use another account</button>}
    </section>
  </main>;
}
