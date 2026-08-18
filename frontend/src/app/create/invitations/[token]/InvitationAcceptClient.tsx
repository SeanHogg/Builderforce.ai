'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import { Button, ButtonLink, Surface } from '@/components/ui';

const replaceLocation = (path: string) => window.location.replace(path);

/**
 * Accepting a Creation Session invitation.
 *
 * This screen was written for a signed-out recipient — it renders its own "sign
 * in with the invited email" branch — but as a default app route the shell used
 * to swap it for the generic marketing teaser, so the branch never rendered and
 * an invite link was a dead end for exactly the person it was sent to. It is now
 * one of the routes an anonymous visitor gets the real shell for
 * (`GUEST_APP_PATTERNS`), which is also why its copy is localized rather than
 * the hardcoded English it shipped with.
 */
export default function InvitationAcceptClient({ token, navigate = replaceLocation }: { token: string; navigate?: (path: string) => void }) {
  const t = useTranslations('creationInvitation');
  const { authReady, isAuthenticated, fetchTenants, selectTenant, logout } = useAuth();
  const [status, setStatus] = useState(isAuthenticated ? t('joining') : t('signInPrompt'));
  const [failed, setFailed] = useState(false);
  const back = signInHref(`/create/invitations/${token}`);

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      setStatus(t('invalidLink'));
      return;
    }
    // Don't ask an already-signed-in invitee to sign in during the frame before
    // the stored session has been read (see `authReady`).
    if (!authReady) return;
    if (!isAuthenticated) {
      setStatus(t('signInPrompt'));
      return;
    }
    setStatus(t('joining'));
    setFailed(false);
    void creationSessionsApi.invitations.acceptWithAccount(token).then(async ({ sessionId, tenantId }) => {
      const tenants = await fetchTenants();
      const invitedTenant = tenants.find((tenant) => Number(tenant.id) === tenantId);
      if (!invitedTenant) throw new Error(t('workspaceUnavailable'));
      await selectTenant(invitedTenant);
      navigate(`/create/${sessionId}`);
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : t('notAccepted'));
      setFailed(true);
    });
  }, [authReady, fetchTenants, isAuthenticated, navigate, selectTenant, t, token]);

  return <main style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
    <Surface tone="raised" padding="lg" aria-live="polite" style={{ width: 'min(460px, 100%)', textAlign: 'center', display: 'grid', gap: 'var(--space-4)', justifyItems: 'center' }}>
      <div aria-hidden="true" style={{ fontSize: '1.9rem', color: 'var(--coral-bright)' }}><Icon source="✦" size="1em" /></div>
      <h1 style={{ margin: 0, font: '700 clamp(1.25rem, 2.6vw, 1.62rem)/1.15 var(--font-display)', letterSpacing: '-.022em', color: 'var(--text-primary)' }}>{t('title')}</h1>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{status}</p>
      {!isAuthenticated && <ButtonLink href={back} variant="primary">{t('signInLink')}</ButtonLink>}
      {isAuthenticated && failed && (
        <Button variant="secondary" onClick={() => { logout(); navigate(back); }}>
          {t('useAnotherAccount')}
        </Button>
      )}
    </Surface>
  </main>;
}
