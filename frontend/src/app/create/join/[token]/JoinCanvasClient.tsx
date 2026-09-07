'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { Button, ButtonLink, Surface } from '@/components/ui';
import { canvasJoinApi, type CanvasInviteLinkRole, type CanvasJoinTarget } from '@/lib/builderforceApi';
import { useAuth } from '@/lib/AuthContext';
import { registerHref, signInHref } from '@/lib/auth';
import { faultText } from '@/lib/apiClient';

const replaceLocation = (path: string) => window.location.replace(path);

/**
 * TAKING a canvas invite link — including by the person who does not want an account.
 *
 * ── WHY THIS SCREEN EXISTS AT ALL ────────────────────────────────────────────────
 * The addressed invitation already had a landing page, and it can only ever say one
 * thing: sign in as the address this was sent to. A LINK is the opposite kind of
 * invitation — it does not know who is holding it — so the landing page has to make an
 * offer rather than issue an instruction, and the offer has to lead with the option
 * that costs nothing. "Join without an account" is the primary control on this page on
 * purpose: it is the whole promise of the link, and burying it under a sign-in form
 * would make the link a sign-up wall with extra steps.
 *
 * ── THE THREE STATES, AND WHY NONE OF THEM IS A REDIRECT ─────────────────────────
 * Signed in: one button that seats the account you are already using. Signed out: a
 * name field and the guest button, with sign-in offered beside it. Either way the page
 * says WHAT is being joined and WHAT access it grants before anything is claimed —
 * `preview` deliberately spends no use of the link, so reading this page can never burn
 * a single-use invitation that nobody accepted.
 *
 * The name is asked for, not generated, because the guest becomes a face on somebody
 * else's board: a cursor labelled "Guest 4" is worse for the OWNER than for the person
 * typing.
 */
export default function JoinCanvasClient({ token, navigate = replaceLocation }: {
  token: string;
  navigate?: (path: string) => void;
}) {
  const t = useTranslations('canvasJoin');
  const { authReady, isAuthenticated, user, adoptIssuedSession, fetchTenants, selectTenant } = useAuth();
  const [target, setTarget] = useState<CanvasJoinTarget | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    canvasJoinApi.preview(token)
      .then((result) => { if (live) setTarget(result); })
      .catch((error) => {
        if (!live) return;
        setStatus(faultText(error, t('invalid')));
        setFailed(true);
      });
    return () => { live = false; };
  }, [t, token]);

  useEffect(() => {
    if (user?.name && !displayName) setDisplayName(user.name);
  }, [displayName, user?.name]);

  const joinAsGuest = useCallback(() => {
    setBusy(true);
    setStatus(t('joining'));
    setFailed(false);
    canvasJoinApi.joinAsGuest(token, displayName)
      .then(async (result) => {
        await adoptIssuedSession(result.token, {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          accountType: result.user.accountType,
          accountTypeSelected: true,
          hasPassword: false,
        }, result.tenantId);
        navigate(`/create/${result.sessionId}`);
      })
      .catch((error) => {
        setStatus(faultText(error, t('failed')));
        setFailed(true);
        setBusy(false);
      });
  }, [adoptIssuedSession, displayName, navigate, t, token]);

  const joinWithAccount = useCallback(() => {
    setBusy(true);
    setStatus(t('joining'));
    setFailed(false);
    canvasJoinApi.joinWithAccount(token)
      .then(async (result) => {
        // The link names the destination workspace, so the tab's currently selected
        // workspace is not the one to trust — select the one the board is actually in.
        const tenants = await fetchTenants();
        const invited = tenants.find((tenant) => Number(tenant.id) === result.tenantId);
        if (!invited) throw new Error(t('workspaceUnavailable'));
        await selectTenant(invited);
        navigate(`/create/${result.sessionId}`);
      })
      .catch((error) => {
        setStatus(faultText(error, t('failed')));
        setFailed(true);
        setBusy(false);
      });
  }, [fetchTenants, navigate, selectTenant, t, token]);

  const accessLine = (role: CanvasInviteLinkRole) =>
    role === 'viewer' ? t('accessViewer') : role === 'commenter' ? t('accessCommenter') : t('accessEditor');

  return (
    <main style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
      <Surface
        tone="raised"
        padding="lg"
        aria-live="polite"
        style={{ width: 'min(460px, 100%)', textAlign: 'center', display: 'grid', gap: 'var(--space-4)', justifyItems: 'center' }}
      >
        <div aria-hidden="true" style={{ fontSize: 'var(--font-size-section)', color: 'var(--coral-bright)' }}><Icon source="✦" size="1em" /></div>

        {/* The role, not the size: `.ui-text-page-title` carries family, size, weight
            and tracking together, so this heading is the SAME page title the rest of
            the product uses rather than a fourth hand-typed approximation of one. */}
        <h1 className="ui-text-page-title" style={{ margin: 0, color: 'var(--text-primary)' }}>
          {target ? t('invitedTo', { title: target.title }) : t('title')}
        </h1>

        {target && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{accessLine(target.role)}</p>}
        {status && <p style={{ margin: 0, color: failed ? 'var(--danger)' : 'var(--text-secondary)' }}>{status}</p>}
        {!target && !failed && !status && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}

        {target && authReady && isAuthenticated && (
          <Button variant="primary" disabled={busy} onClick={joinWithAccount}>
            {t('joinAsMember', { name: user?.name || user?.email || '' })}
          </Button>
        )}

        {target && authReady && !isAuthenticated && (
          <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'stretch', width: '100%' }}>
            <label style={{ display: 'grid', gap: 4, textAlign: 'left', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {t('nameLabel')}
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t('namePlaceholder')}
                maxLength={40}
                style={{
                  padding: '8px 10px', fontSize: 'var(--font-size-small)', fontFamily: 'inherit',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-base)', color: 'var(--text-primary)',
                }}
              />
            </label>
            <Button variant="primary" disabled={busy} onClick={joinAsGuest}>{t('joinAsGuest')}</Button>
            <p style={{ margin: 0, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>{t('guestNote')}</p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
              <ButtonLink href={signInHref(`/create/join/${token}`)} variant="secondary">{t('signInInstead')}</ButtonLink>
              <ButtonLink href={registerHref(`/create/join/${token}`)} variant="secondary">{t('createAccount')}</ButtonLink>
            </div>
          </div>
        )}
      </Surface>
    </main>
  );
}
