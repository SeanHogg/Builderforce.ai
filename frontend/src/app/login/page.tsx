'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredWebToken, getMyTenants, getTenantToken, persistTenantSession, getDefaultTenantId } from '@/lib/auth';
import type { Tenant } from '@/lib/types';
import { ThemeToggleButton } from '@/app/ThemeProvider';

/** getMyTenants now returns Tenant[] directly; kept for backward compat if raw API used. */
function tenantsFromResponse(data: unknown): Tenant[] {
  if (Array.isArray(data)) {
    return data.map((t: { id?: unknown; name?: string; slug?: string }) => ({
      id: String(t.id),
      name: t.name ?? '',
      slug: t.slug,
    }));
  }
  type TenantItem = { id?: unknown; name?: string; slug?: string };
  const arr = (data as { tenants?: TenantItem[] })?.tenants;
  if (!Array.isArray(arr)) return [];
  return arr.map((t: TenantItem) => ({
    id: String(t.id),
    name: t.name ?? '',
    slug: t.slug,
  }));
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, hasTenant } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect when already authenticated (e.g. landed on /login with valid session).
  // Do NOT redirect during form submission — handleSubmit does tenant resolution and redirect.
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const next = searchParams.get('next') || (hasTenant ? '/dashboard' : '/tenants');
      router.replace(next);
    }
  }, [isAuthenticated, hasTenant, isLoading, router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(email, password);
      const next = searchParams.get('next') || '/dashboard';
      const token = getStoredWebToken();
      if (!token) {
        router.push(hasTenant ? next : '/tenants' + (next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''));
        return;
      }
      const raw = await getMyTenants(token);
      const tenants = tenantsFromResponse(raw);
      if (tenants.length === 1) {
        const res = await getTenantToken(token, tenants[0].id);
        persistTenantSession(res.token, tenants[0]);
        window.location.href = next;
        return;
      }
      if (tenants.length === 0) {
        router.push('/tenants' + (next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''));
        return;
      }
      // 2+ tenants: check for default tenant and auto-select if it matches
      const defaultId = getDefaultTenantId();
      const defaultTenant = defaultId ? tenants.find((t) => String(t.id) === defaultId) : null;
      if (defaultTenant) {
        const res = await getTenantToken(token, defaultTenant.id);
        persistTenantSession(res.token, defaultTenant);
        window.location.href = next;
        return;
      }
      router.push('/tenants' + (next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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

  return (
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
            <Image src="/claw.png" alt="" width={28} height={28} style={{ filter: 'drop-shadow(0 0 8px var(--logo-glow))' }} />
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
              Sign up free
            </Link>
          </div>
        </div>
      </nav>

      {/* Centred card — scrollable on small viewports */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 20px', minHeight: 'calc(100vh - 60px)' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {/* Logo + heading */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <Image src="/claw.png" alt="" width={56} height={56} style={{ filter: 'drop-shadow(0 0 16px var(--logo-glow))', animation: 'float 4s ease-in-out infinite', marginBottom: 16 }} />
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
              Welcome back
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Sign in to your Builderforce.ai account
            </p>
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
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label htmlFor="email" style={labelStyle}>Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={inputStyle}
                  required
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--surface-coral-soft)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div>
                <label htmlFor="password" style={labelStyle}>Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={inputStyle}
                  required
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--surface-coral-soft)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none'; }}
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
                {isLoading ? 'Signing in…' : 'Sign In →'}
              </button>
            </form>
          </div>

          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 20 }}>
            Don&apos;t have an account?{' '}
            <Link href="/register" style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 600 }}>
              Sign up free
            </Link>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
