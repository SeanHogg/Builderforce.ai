'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredWebToken, resolveAndSelectTenant, requestMagicLink } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/safeRedirect';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import JsonLd from '@/components/JsonLd';
import OAuthButtons from '@/components/OAuthButtons';
import PasswordInput from '@/components/PasswordInput';
import EmailVerificationStep from '@/components/account/EmailVerificationStep';
import MarketingVisual from '@/components/account/MarketingVisual';
import { loginSchema } from '@/lib/structured-data';
import { LOGIN_MARKETING } from '@/lib/content';

export default function LoginPageClient() {
  const router = useRouter();
  const t = useTranslations('login');
  const searchParams = useSearchParams();
  const { login, isAuthenticated, hasTenant } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  // Set when an unverified account tries to sign in — swaps the form for the
  // email-OTP step (a fresh code is emailed by the login endpoint).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const finishAndRedirect = async () => {
    // Open-redirect guard (M5): only same-origin relative paths are honoured.
    const next = safeRedirectPath(searchParams.get('next'));
    const token = getStoredWebToken();
    if (!token) { router.push('/tenants'); return; }
    const selected = await resolveAndSelectTenant(token);
    if (selected) {
      window.location.href = next;
    } else {
      router.push('/tenants' + (next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''));
    }
  };

  // Redirect when already authenticated (e.g. landed on /login with valid session).
  // Do NOT redirect during form submission — handleSubmit does tenant resolution and redirect.
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    const next = safeRedirectPath(searchParams.get('next'));
    if (hasTenant) {
      router.replace(next);
      return;
    }
    // No tenant selected yet — try to auto-select before sending to /tenants
    const token = getStoredWebToken();
    if (!token) { router.replace('/tenants'); return; }
    resolveAndSelectTenant(token).then((selected) => {
      router.replace(selected ? next : '/tenants');
    });
  }, [isAuthenticated, hasTenant, isLoading, router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await login(email, password);
      if (res.needsVerification) {
        setPendingEmail(res.email);
        return;
      }
      await finishAndRedirect();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) { setError(t('enterEmailFirst')); return; }
    setError(null);
    setMagicLinkLoading(true);
    try {
      const next = safeRedirectPath(searchParams.get('next'));
      await requestMagicLink(email, next);
      setMagicLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('magicLinkFailed'));
    } finally {
      setMagicLinkLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 10,
    padding: '11px 14px',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    fontFamily: 'var(--font-body)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 6,
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };

  const focusIn = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--coral-bright)';
    e.currentTarget.style.boxShadow = '0 0 0 3px var(--surface-coral-soft)';
  };
  const focusOut = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'var(--border-subtle)';
    e.currentTarget.style.boxShadow = 'none';
  };

  const marketing = LOGIN_MARKETING;

  return (
    <>
    <JsonLd data={loginSchema()} />
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', position: 'relative', zIndex: 1 }}>
      {/* Nav */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
        backdropFilter: 'blur(16px)',
        padding: '0 24px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <Image src="/agentHost.png" alt="" width={28} height={28} style={{ filter: 'drop-shadow(0 0 8px var(--logo-glow))' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
              Builderforce.ai
            </span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggleButton />
            <Link href="/register" style={{
              padding: '7px 16px', borderRadius: 10,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff', textDecoration: 'none',
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.875rem',
            }}>
              {t('navSignUp')}
            </Link>
          </div>
        </div>
      </nav>

      {/* Split-panel layout: form left, marketing right */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', minHeight: 'calc(100vh - 60px)', alignItems: 'start' }} className="auth-split-grid">
        {/* LEFT PANEL — form */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 20px', minHeight: 'calc(100vh - 60px)' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
              {t('heading')}
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {t('subtitle')}
            </p>
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
            {[t('pillLora'), t('pillRegistry'), t('pillEval')].map(f => (
              <span key={f} style={{
                fontSize: '0.75rem', fontWeight: 600,
                background: 'var(--surface-coral-soft)',
                color: 'var(--coral-bright)',
                border: '1px solid var(--border-accent)',
                borderRadius: 999, padding: '4px 12px',
                fontFamily: 'var(--font-display)',
              }}>{f}</span>
            ))}
          </div>

          {pendingEmail ? (
            <EmailVerificationStep
              email={pendingEmail}
              onVerified={finishAndRedirect}
              onChangeEmail={() => setPendingEmail(null)}
            />
          ) : (
          <>
          {/* Glass card form */}
          <div style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 20,
            padding: '32px 28px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 16px 48px var(--shadow-coral-soft)',
          }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label htmlFor="email" style={labelStyle}>{t('emailLabel')}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  style={inputStyle}
                  required
                  onFocus={focusIn}
                  onBlur={focusOut}
                />
              </div>
              <div>
                <label htmlFor="password" style={labelStyle}>{t('passwordLabel')}</label>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={inputStyle}
                />
              </div>

              {error && (
                <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', borderRadius: 10, padding: '10px 14px', fontSize: '0.875rem' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !email || !password}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: '13px',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: isLoading ? 'wait' : 'pointer',
                  opacity: (isLoading || !email || !password) ? 0.5 : 1,
                  transition: 'opacity 0.2s, transform 0.2s, box-shadow 0.2s',
                  boxShadow: '0 6px 20px var(--shadow-coral-mid)',
                  letterSpacing: '0.02em',
                }}
              >
                {isLoading ? t('signingIn') : t('submit')}
              </button>
            </form>

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
          </div>
          </>
          )}

          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 20 }}>
            {t('noAccount')}{' '}
            <Link href="/register" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
              {t('signUpLink')}
            </Link>
          </p>
        </div>
        </div>

        {/* RIGHT PANEL — marketing banner (hidden on mobile via CSS) */}
        <aside className="auth-marketing-panel" style={{
          display: 'none', /* overridden by media query */
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '48px 40px',
          background: 'var(--surface-card)',
          borderLeft: '1px solid var(--border-subtle)',
        }}>
          <div className="auth-marketing-content">
            <span style={{
              display: 'inline-block', marginBottom: 12,
              fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)',
              border: '1px solid var(--border-accent)', borderRadius: 999, padding: '4px 12px',
              fontFamily: 'var(--font-display)',
            }}>{marketing.eyebrow}</span>

            <MarketingVisual variant="standard" />

            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
              {marketing.heading}
            </h2>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
              {marketing.intro}
            </p>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
              {marketing.stats.map(s => (
                <div key={s.label} style={{ padding: '14px 12px', background: 'var(--bg-elevated)', borderRadius: 12, textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--coral-bright)' }}>{s.value}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Value-prop bullets */}
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {marketing.bullets.map(b => (
                <li key={b.title} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0, lineHeight: 1.4 }} aria-hidden>{b.icon}</span>
                  <span><strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{b.title}</strong> — {b.desc}</span>
                </li>
              ))}
            </ul>

            {/* Comparison quote */}
            <blockquote style={{ margin: '0 0 24px', padding: '14px 18px', borderLeft: '3px solid var(--coral-bright)', background: 'var(--bg-elevated)', borderRadius: '0 10px 10px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              &ldquo;{marketing.quote}&rdquo;
            </blockquote>

            {/* FAQ section for GEO citability */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {t('commonQuestions')}
              </h3>
              {marketing.faq.map(faq => (
                <details key={faq.question} style={{ marginBottom: 8 }}>
                  <summary style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>{faq.question}</summary>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 4, paddingLeft: 12 }}>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </aside>

        </div>
      </div>

      {/* Split-panel responsive styles */}
      <style>{`
        @media (min-width: 900px) {
          .auth-split-grid { grid-template-columns: 1fr 1fr !important; }
          .auth-marketing-panel { display: flex !important; }
        }
        .auth-marketing-content { animation: authMarketingFade 0.35s ease; }
        @keyframes authMarketingFade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-marketing-content { animation: none; }
        }
      `}</style>
    </div>
    </>
  );
}
