'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredWebToken, readIntent, registerHref, resumeIntent, workspaceChoiceHref } from '@/lib/auth';
import { getSsoStartUrl, resolveAndSelectTenant, requestMagicLink } from '@/lib/auth/credentials';
import { isPasskeyCancellation, isPasskeySupported } from '@/lib/passkeys';
import { Icon } from '@/components/ui/Icon';
import OAuthButtons from '@/components/OAuthButtons';
import PasswordInput from '@/components/PasswordInput';
import EmailVerificationStep from '@/components/account/EmailVerificationStep';
import { AuthShell } from '@/components/account/AuthShell';
import {
  AuthErrorBanner, AuthFormCard, AuthSubmitButton,
  authFocusIn, authFocusOut, authInputStyle, authLabelStyle,
} from '@/components/account/AuthFormParts';
import { useAuthAttempt } from '@/components/account/useAuthAttempt';
import { ssoDiscoveryApi } from '@/lib/builderforceApi';
export default function LoginPageClient() {
  const router = useRouter();
  const t = useTranslations('login');
  const searchParams = useSearchParams();
  const { login, loginWithPasskey, isAuthenticated, hasTenant } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, setError, attempt, isBusy } = useAuthAttempt();
  const isLoading = isBusy('password');
  const passkeyLoading = isBusy('passkey');
  const magicLinkLoading = isBusy('magicLink');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  // Resolved on the client only: `isPasskeySupported()` reads `window`, and a
  // button rendered on the server that then disappears is a layout shift on the
  // one screen where a shift reads as something going wrong.
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  // Set when an unverified account tries to sign in — swaps the form for the
  // email-OTP step (a fresh code is emailed by the login endpoint).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailDeliveryFailed, setEmailDeliveryFailed] = useState(false);
  /** The institution this address signs in through, when it has one. */
  const [ssoLabel, setSsoLabel] = useState<string | null>(null);

  /**
   * Does this address belong to an institution with single sign-on?
   *
   * Asked as the address is typed, debounced, so the password field can be
   * replaced by "Continue with <institution>" before somebody types a password
   * their organisation does not hold. Failure is SILENT and falls back to the
   * password form: a discovery call that cannot be made must never be the reason
   * a person cannot sign in.
   */
  useEffect(() => {
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) { setSsoLabel(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      ssoDiscoveryApi.discover(address)
        .then((result) => { if (!cancelled) setSsoLabel(result.sso ? (result.label ?? address.split('@')[1]!) : null); })
        .catch(() => { if (!cancelled) setSsoLabel(null); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [email]);

  /**
   * A failed federated sign-in comes back as `?error=`. Surfaced verbatim
   * because the API's messages are written for the person reading them — "the
   * identity provider released no email address" is actionable and
   * "sso_failed" is not.
   */
  useEffect(() => {
    const reason = searchParams.get('error');
    if (reason) setError(reason.replace(/_/g, ' '));
  }, [searchParams]);

  const finishAndRedirect = async () => {
    // Open-redirect guard (M5): only same-origin relative paths are honoured.
    const next = resumeIntent(readIntent(searchParams));
    const token = getStoredWebToken();
    if (!token) { router.push('/tenants'); return; }
    const selected = await resolveAndSelectTenant(token);
    if (selected) {
      window.location.href = next;
    } else {
      router.push('/tenants' + (next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''));
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPasskeyAvailable(isPasskeySupported());
  }, []);

  // Redirect when already authenticated (e.g. landed on /login with valid session).
  // Do NOT redirect during form submission — handleSubmit does tenant resolution and redirect.
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    const next = resumeIntent(readIntent(searchParams));
    if (hasTenant) {
      router.replace(next);
      return;
    }
    // No tenant selected yet — try to auto-select before sending to /tenants
    const token = getStoredWebToken();
    if (!token) { router.replace('/tenants'); return; }
    resolveAndSelectTenant(token).then((selected) => {
      router.replace(selected ? next : workspaceChoiceHref({ next }));
    });
  }, [isAuthenticated, hasTenant, isLoading, router, searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    return attempt('password', async () => {
      const res = await login(email, password);
      if (res.needsVerification) {
        setPendingEmail(res.email);
        setEmailDeliveryFailed(res.emailDeliveryFailed === true);
        return;
      }
      await finishAndRedirect();
    }, t('loginFailed'));
  };

  /**
   * Sign in with a passkey. Deliberately offered with NO email: a discoverable
   * credential names the account itself, so asking for an email first would add a
   * step the credential makes unnecessary. When the field happens to be filled we
   * pass it, which narrows the browser's prompt to that account's keys.
   */
  // Dismissing the system prompt is a choice, not a failure to report.
  const handlePasskey = () => attempt('passkey', async () => {
    await loginWithPasskey(email || undefined);
    await finishAndRedirect();
  }, t('passkeyFailed'), isPasskeyCancellation);

  const handleMagicLink = () => {
    if (!email) { setError(t('enterEmailFirst')); return; }
    return attempt('magicLink', async () => {
      const next = resumeIntent(readIntent(searchParams));
      await requestMagicLink(email, next);
      setMagicLinkSent(true);
    }, t('magicLinkFailed'));
  };

  const signUpHref = registerHref(searchParams.get('next') ? resumeIntent(readIntent(searchParams)) : '', searchParams.get('intent') ?? undefined);

  return (
    <AuthShell
      navAction={
        <Link href={signUpHref} style={{
          padding: '7px 16px', borderRadius: 'var(--radius-lg)',
          background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
          color: 'var(--text-on-accent)', textDecoration: 'none',
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.875rem',
        }}>
          {t('navSignUp')}
        </Link>
      }
      heading={t('heading')}
      subtitle={t('subtitle')}
      pills={[t('pillLora'), t('pillRegistry'), t('pillEval')]}
      panel="login"
      visual="standard"
      faqHeading={t('commonQuestions')}
      footer={<>
        {t('noAccount')}{' '}
        <Link href={signUpHref} style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
          {t('signUpLink')}
        </Link>
      </>}
    >
          {pendingEmail ? (
            <EmailVerificationStep
              email={pendingEmail}
              onVerified={finishAndRedirect}
              onChangeEmail={() => setPendingEmail(null)}
              initialDeliveryFailed={emailDeliveryFailed}
            />
          ) : (
          <>
          <AuthFormCard>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label htmlFor="email" style={authLabelStyle}>{t('emailLabel')}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  style={authInputStyle}
                  required
                  onFocus={authFocusIn}
                  onBlur={authFocusOut}
                />
              </div>
              {ssoLabel && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a
                    href={getSsoStartUrl(email, resumeIntent(readIntent(searchParams)))}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      textAlign: 'center',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)',
                      padding: '13px',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      textDecoration: 'none',
                    }}
                  >
                    {t('continueWithSso', { organisation: ssoLabel })}
                  </a>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                    {t('ssoHint')}
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="password" style={authLabelStyle}>{t('passwordLabel')}</label>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={authInputStyle}
                />
              </div>

              <AuthErrorBanner message={error} />

              <AuthSubmitButton disabled={isLoading || !email || !password} busy={isLoading}>
                {isLoading ? t('signingIn') : t('submit')}
              </AuthSubmitButton>
            </form>

            {passkeyAvailable && (
              <button
                type="button"
                onClick={handlePasskey}
                disabled={passkeyLoading}
                style={{
                  width: '100%',
                  marginTop: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '12px',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: passkeyLoading ? 'wait' : 'pointer',
                  opacity: passkeyLoading ? 0.6 : 1,
                }}
              >
                <Icon name="key" size={16} />
                {passkeyLoading ? t('passkeySigningIn') : t('passkeySubmit')}
              </button>
            )}

            <OAuthButtons />

            {/* Magic link */}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              {magicLinkSent ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--coral-bright)', fontWeight: 600 }}>
                  {t('magicLinkSent')}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleMagicLink}
                  disabled={magicLinkLoading}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    opacity: magicLinkLoading ? 0.5 : 1,
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {magicLinkLoading ? t('sending') : t('magicLinkButton')}
                </button>
              )}
            </div>
          </AuthFormCard>
          </>
          )}

    </AuthShell>
  );
}
