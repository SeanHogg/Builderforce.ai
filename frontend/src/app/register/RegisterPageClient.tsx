'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import JsonLd from '@/components/JsonLd';
import OAuthButtons from '@/components/OAuthButtons';
import PasswordInput from '@/components/PasswordInput';
import { registerSchema } from '@/lib/structured-data';
import { REGISTER_MARKETING } from '@/lib/content';

/**
 * Decorative, theme-aware SVG shown at the top of the marketing panel. Two
 * variants: `standard` renders an agent-workforce graph (a hub delegating to
 * trained specialists); `freelancer` renders a for-hire talent card. Both use
 * theme tokens so they read in light and dark, and scale to their container.
 */
function MarketingVisual({ variant }: { variant: 'standard' | 'freelancer' }) {
  const wrap: React.CSSProperties = {
    width: '100%',
    borderRadius: 16,
    marginBottom: 24,
    padding: '20px 20px 8px',
    background: 'linear-gradient(135deg, var(--surface-coral-soft), transparent 70%)',
    border: '1px solid var(--border-subtle)',
    overflow: 'hidden',
  };
  if (variant === 'freelancer') {
    return (
      <div style={wrap} aria-hidden>
        <svg viewBox="0 0 320 150" width="100%" role="presentation" style={{ display: 'block' }}>
          {/* Profile card */}
          <rect x="18" y="18" width="284" height="114" rx="14" fill="var(--bg-elevated)" stroke="var(--border-subtle)" />
          {/* Avatar */}
          <circle cx="56" cy="52" r="20" fill="var(--coral-bright)" opacity="0.9" />
          <circle cx="56" cy="46" r="7" fill="var(--bg-elevated)" />
          <path d="M42 64c2-8 26-8 28 0" fill="var(--bg-elevated)" />
          {/* Name + rate */}
          <rect x="88" y="40" width="90" height="9" rx="4.5" fill="var(--text-primary)" opacity="0.85" />
          <rect x="88" y="56" width="58" height="7" rx="3.5" fill="var(--text-muted)" opacity="0.7" />
          <rect x="214" y="38" width="72" height="26" rx="13" fill="var(--surface-coral-soft)" stroke="var(--coral-bright)" />
          <text x="250" y="55" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--coral-bright)" fontFamily="var(--font-display)">$95/hr</text>
          {/* Skill chips */}
          {[0, 1, 2].map((i) => (
            <rect key={i} x={40 + i * 76} y="92" width="64" height="20" rx="10" fill="var(--surface-card)" stroke="var(--border-subtle)" />
          ))}
          <circle cx="52" cy="102" r="3" fill="var(--coral-bright)" />
          <circle cx="128" cy="102" r="3" fill="var(--coral-bright)" />
          <circle cx="204" cy="102" r="3" fill="var(--coral-bright)" />
          {/* Play badge (hired.video résumé) */}
          <circle cx="278" cy="102" r="14" fill="var(--coral-bright)" />
          <path d="M274 96l8 6-8 6z" fill="#fff" />
        </svg>
      </div>
    );
  }
  return (
    <div style={wrap} aria-hidden>
      <svg viewBox="0 0 320 150" width="100%" role="presentation" style={{ display: 'block' }}>
        {/* Connectors hub → specialists */}
        {[[70, 40], [70, 110], [250, 40], [250, 110]].map(([x, y], i) => (
          <line key={i} x1="160" y1="75" x2={x} y2={y} stroke="var(--coral-bright)" strokeWidth="1.5" opacity="0.4" />
        ))}
        {/* Specialist nodes */}
        {[[70, 40, '🧠'], [70, 110, '🔁'], [250, 40, '🧪'], [250, 110, '▦']].map(([x, y, icon], i) => (
          <g key={i}>
            <circle cx={x as number} cy={y as number} r="20" fill="var(--bg-elevated)" stroke="var(--border-subtle)" />
            <text x={x as number} y={(y as number) + 6} textAnchor="middle" fontSize="16">{icon as string}</text>
          </g>
        ))}
        {/* Central hub (your agent) */}
        <circle cx="160" cy="75" r="30" fill="var(--coral-bright)" opacity="0.15" />
        <circle cx="160" cy="75" r="24" fill="var(--coral-bright)" />
        <text x="160" y="81" textAnchor="middle" fontSize="20">🚀</text>
      </svg>
    </div>
  );
}

export default function RegisterPageClient() {
  const router = useRouter();
  const tr = useTranslations('register');
  const { register, isAuthenticated } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [accountType, setAccountType] = useState<'standard' | 'freelancer'>('standard');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Right-hand marketing panel follows the Build/Hired chooser.
  const marketing = REGISTER_MARKETING[accountType];

  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError(null);
    setIsLoading(true);
    try {
      await register(email, password, name.trim() || undefined, agreeToTerms, accountType);
      // Freelancers land on their for-hire profile (the restricted gig shell);
      // standard accounts go to the builder dashboard.
      router.push(accountType === 'freelancer' ? '/freelancer/profile' : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
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

  return (
    <>
    <JsonLd data={registerSchema()} />
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
            <Link href="/login" style={{
              padding: '7px 16px', borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-card)',
              color: 'var(--text-primary)', textDecoration: 'none',
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.875rem',
              backdropFilter: 'blur(8px)',
            }}>
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Split-panel layout: form left, marketing right */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', minHeight: 'calc(100vh - 60px)' }} className="auth-split-grid">
        {/* LEFT PANEL — form */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 20px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
              Create your account
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Start building custom AI agents — free forever
            </p>
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
            {['🧠 LoRA Training', '🤖 Agent Registry', '🔬 AI Evaluation'].map(f => (
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

          {/* Glass card form */}
          <div style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 20,
            padding: '32px 28px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 16px 48px var(--shadow-coral-soft)',
          }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Account type — a freelancer gets the restricted for-hire shell
                  (Profile / Find Work / Timecard); a builder gets the full app. */}
              <div>
                <label style={labelStyle}>{tr('want')}</label>
                <div role="radiogroup" aria-label={tr('accountTypeAria')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {([
                    { key: 'standard' as const, icon: '🚀', title: tr('buildTitle'), sub: tr('buildSub') },
                    { key: 'freelancer' as const, icon: '💼', title: tr('hireTitle'), sub: tr('hireSub') },
                  ]).map((opt) => {
                    const active = accountType === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setAccountType(opt.key)}
                        style={{
                          textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '12px 14px',
                          background: active ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${active ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                          boxShadow: active ? '0 0 0 3px var(--surface-coral-soft)' : 'none',
                          transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
                        }}
                      >
                        <div style={{ fontSize: '1.1rem', marginBottom: 4 }} aria-hidden>{opt.icon}</div>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{opt.title}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{opt.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label htmlFor="name" style={labelStyle}>
                  Name <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                </label>
                <input id="name" type="text" autoComplete="name" autoFocus
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="Jane Smith" style={inputStyle}
                  onFocus={focusIn} onBlur={focusOut}
                />
              </div>
              <div>
                <label htmlFor="email" style={labelStyle}>Email</label>
                <input id="email" type="email" autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" style={inputStyle}
                  required onFocus={focusIn} onBlur={focusOut}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label htmlFor="password" style={labelStyle}>Password</label>
                  <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 chars"
                    required
                    minLength={8}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="confirm" style={labelStyle}>Confirm</label>
                  <PasswordInput
                    id="confirm"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={inputStyle}
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
                <span>I agree to the Terms of Use and Privacy Policy (see footer links below)</span>
              </label>

              {error && (
                <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 10, padding: '10px 14px', fontSize: '0.875rem' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !email || !password || !confirmPassword || !agreeToTerms}
                style={{
                  width: '100%', marginTop: 4,
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff', border: 'none', borderRadius: 12, padding: '13px',
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.95rem',
                  cursor: isLoading ? 'wait' : 'pointer',
                  opacity: (isLoading || !email || !password || !confirmPassword || !agreeToTerms) ? 0.5 : 1,
                  transition: 'opacity 0.2s, box-shadow 0.2s',
                  boxShadow: '0 6px 20px var(--shadow-coral-mid)',
                  letterSpacing: '0.02em',
                }}
              >
                {isLoading ? 'Creating account…' : 'Create Account →'}
              </button>
            </form>

            <OAuthButtons />
          </div>

          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 20 }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
              Sign in
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
          {/* Keyed on accountType so switching Build/Hired re-mounts and fades in */}
          <div key={accountType} className="auth-marketing-content">
            <span style={{
              display: 'inline-block', marginBottom: 12,
              fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)',
              border: '1px solid var(--border-accent)', borderRadius: 999, padding: '4px 12px',
              fontFamily: 'var(--font-display)',
            }}>{marketing.eyebrow}</span>

            <MarketingVisual variant={accountType} />

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
                {tr('commonQuestions')}
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
