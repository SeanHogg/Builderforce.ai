'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { ThemeToggleButton } from '@/app/ThemeProvider';

export default function RegisterPage() {
  const router = useRouter();
  const { register, isAuthenticated } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) router.replace('/tenants');
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError(null);
    setIsLoading(true);
    try {
      await register(email, password, name.trim() || undefined);
      router.push('/tenants');
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', position: 'relative', zIndex: 1 }}>
      {/* Nav */}
      <nav style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
        backdropFilter: 'blur(16px)',
        padding: '0 24px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <Image src="/claw.png" alt="" width={28} height={28} style={{ filter: 'drop-shadow(0 0 8px var(--logo-glow))' }} />
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

      {/* Centred card */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 20px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <Image src="/claw.png" alt="" width={56} height={56} style={{ filter: 'drop-shadow(0 0 16px var(--logo-glow))', marginBottom: 16 }} />
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
                  <input id="password" type="password" autoComplete="new-password"
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 chars" style={inputStyle}
                    required minLength={8} onFocus={focusIn} onBlur={focusOut}
                  />
                </div>
                <div>
                  <label htmlFor="confirm" style={labelStyle}>Confirm</label>
                  <input id="confirm" type="password" autoComplete="new-password"
                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••" style={inputStyle}
                    required onFocus={focusIn} onBlur={focusOut}
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
          </div>

          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 20 }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
