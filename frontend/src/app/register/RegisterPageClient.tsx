'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import OAuthButtons from '@/components/OAuthButtons';
import PasswordInput from '@/components/PasswordInput';
import AccountTypeChooser from '@/components/account/AccountTypeChooser';
import EmailVerificationStep from '@/components/account/EmailVerificationStep';
import { readIntent, resumeIntent } from '@/lib/auth';
import { getRetainedDiscountCode, retainDiscountCode } from '@/lib/discountCode';
import { useLegalDocs } from '@/components/legal/useLegalDocs';
import LegalDocModal, { type LegalDocType } from '@/components/legal/LegalDocModal';
import { AuthShell } from '@/components/account/AuthShell';
import {
  AuthErrorBanner, AuthFormCard, AuthSubmitButton,
  authFocusIn, authFocusOut, authInputStyle, authLabelStyle,
} from '@/components/account/AuthFormParts';
import { useAuthAttempt } from '@/components/account/useAuthAttempt';
export default function RegisterPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tr = useTranslations('register');
  const { register, isAuthenticated } = useAuth();
  const { legal } = useLegalDocs();
  const [legalModalType, setLegalDocType] = useState<LegalDocType | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [ageAttested, setAgeAttested] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const initialType = searchParams.get('role') === 'sales' ? 'sales' : 'standard';
  const [accountType, setAccountType] = useState<'standard' | 'freelancer' | 'sales'>(initialType);
  const { error, setError, attempt, isBusy } = useAuthAttempt();
  const isLoading = isBusy('register');
  // Set once the account is created but its email needs verifying — swaps the form
  // for the code-entry step.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailDeliveryFailed, setEmailDeliveryFailed] = useState(false);

  // Right-hand marketing panel follows the Build/Hired chooser — unless the person
  // arrived to LIST A STARTUP (`?intent=startup`, from the marketplace door or the
  // runway calculator), in which case a standard account gets the founder's panel.
  const startupIntent = searchParams.get('intent') === 'startup' && accountType === 'standard';
  const panel = startupIntent ? 'startup' : accountType;

  // Freelancers land on their for-hire profile (the restricted gig shell); standard
  // accounts go to the builder dashboard.
  // `resumeIntent` folds `?intent=` into the destination, so the intent survives
  // verification and the workspace picker that only carry `next`.
  const requestedDestination = resumeIntent(readIntent(searchParams));
  const destination = accountType === 'freelancer' ? '/freelancer/profile' : accountType === 'sales' ? '/sales' : requestedDestination;

  useEffect(() => {
    if (isAuthenticated) router.replace(destination);
  }, [destination, isAuthenticated, router]);

  useEffect(() => {
    const captured = searchParams.get('discountcode') ?? getRetainedDiscountCode();
    if (captured) {
      setDiscountCode(captured.toUpperCase());
      retainDiscountCode(captured);
    }
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError(tr('passwordsMismatch')); return; }
    return attempt('register', async () => {
      const referralCode = searchParams.get('ref')?.trim() || undefined;
      const res = await register(email, password, name.trim() || undefined, agreeToTerms, accountType, referralCode, ageAttested);
      if (res.needsVerification) {
        setPendingEmail(res.email);
        setEmailDeliveryFailed(res.emailDeliveryFailed === true);
      } else {
        router.push(destination);
      }
    }, tr('registrationFailed'));
  };

  const submitDisabled = isLoading || !email || !password || !confirmPassword || !agreeToTerms || !ageAttested;

  return (
    <AuthShell
      navAction={
        <Link href="/login" style={{
          padding: '7px 16px', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-card)',
          color: 'var(--text-primary)', textDecoration: 'none',
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.875rem',
          backdropFilter: 'blur(8px)',
        }}>
          {tr('navSignIn')}
        </Link>
      }
      heading={tr('heading')}
      subtitle={tr('subtitle')}
      pills={[tr('pillLora'), tr('pillRegistry'), tr('pillEval')]}
      panel={panel}
      visual={accountType}
      panelKey={accountType}
      faqHeading={tr('commonQuestions')}
      footer={<>
        {tr('haveAccount')}{' '}
        <Link href="/login" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
          {tr('signInLink')}
        </Link>
      </>}
      overlay={<LegalDocModal type={legalModalType} legal={legal} onClose={() => setLegalDocType(null)} />}
    >
          {/* Email-verification step — shown after the account is created; the user
              enters the emailed 6-digit code to activate the account and sign in. */}
          {pendingEmail ? (
            <EmailVerificationStep
              email={pendingEmail}
              onVerified={() => router.push(destination)}
              onChangeEmail={() => setPendingEmail(null)}
              initialDeliveryFailed={emailDeliveryFailed}
            />
          ) : (
          <>
          <AuthFormCard>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Account type — a freelancer gets the restricted for-hire shell
                  (Profile / Find Work / Timecard); a builder gets the full app. */}
              <div>
                <label style={authLabelStyle}>{tr('want')}</label>
                <AccountTypeChooser value={accountType} onChange={setAccountType} />
              </div>
              <div>
                <label htmlFor="name" style={authLabelStyle}>
                  {tr('nameLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{tr('nameOptional')}</span>
                </label>
                <input id="name" type="text" autoComplete="name" autoFocus
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder={tr('namePlaceholder')} style={authInputStyle}
                  onFocus={authFocusIn} onBlur={authFocusOut}
                />
              </div>
              <div>
                <label htmlFor="email" style={authLabelStyle}>{tr('emailLabel')}</label>
                <input id="email" type="email" autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" style={authInputStyle}
                  required onFocus={authFocusIn} onBlur={authFocusOut}
                />
              </div>
              <div>
                <label htmlFor="discountCode" style={authLabelStyle}>{tr('discountCodeLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{tr('nameOptional')}</span></label>
                <input id="discountCode" type="text" autoComplete="off"
                  value={discountCode} onChange={e => { setDiscountCode(e.target.value.toUpperCase()); retainDiscountCode(e.target.value); }}
                  placeholder="ANNUAL50" style={authInputStyle} onFocus={authFocusIn} onBlur={authFocusOut}
                />
                {discountCode && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--coral-bright)' }}>{tr('discountCodeSaved')}</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label htmlFor="password" style={authLabelStyle}>{tr('passwordLabel')}</label>
                  <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={tr('passwordPlaceholder')}
                    required
                    minLength={8}
                    style={authInputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="confirm" style={authLabelStyle}>{tr('confirmLabel')}</label>
                  <PasswordInput
                    id="confirm"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={authInputStyle}
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={agreeToTerms}
                  onChange={e => setAgreeToTerms(e.target.checked)}
                  style={{ marginTop: 3, accentColor: 'var(--coral-bright)' }}
                />
                <span>
                  {tr.rich('terms', {
                    terms: chunks => (
                      <a
                        href="#terms-of-use"
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          setLegalDocType('terms');
                        }}
                        style={{ color: 'inherit', textDecoration: 'underline' }}
                      >
                        {chunks}
                      </a>
                    ),
                    privacy: chunks => (
                      <a
                        href="#privacy-policy"
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          setLegalDocType('privacy');
                        }}
                        style={{ color: 'inherit', textDecoration: 'underline' }}
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={ageAttested} onChange={e => setAgeAttested(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--coral-bright)' }} />
                <span>{tr('ageAttestation')}</span>
              </label>

              <AuthErrorBanner message={error} />

              <AuthSubmitButton disabled={submitDisabled} busy={isLoading}>
                {isLoading ? tr('creating') : tr('submit')}
              </AuthSubmitButton>
            </form>

            <OAuthButtons />
          </AuthFormCard>
          </>
          )}

    </AuthShell>
  );
}
