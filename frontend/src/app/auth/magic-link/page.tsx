'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { AUTH_API_URL, persistSession } from '@/lib/auth';
import type { AuthUser } from '@/lib/types';

export default function MagicLinkVerifyPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  // Derive initial state from URL so no synchronous setState inside the effect
  const [status, setStatus] = useState<'loading' | 'error'>(!token ? 'error' : 'loading');
  const [errorMsg, setErrorMsg] = useState<string>(
    !token ? 'No token found in the link. Please request a new one.' : ''
  );

  useEffect(() => {
    if (!token) return;

    fetch(`${AUTH_API_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`)
      .then((res) => res.json() as Promise<{ token?: string; user?: AuthUser; redirect?: string; error?: string }>)
      .then((data) => {
        if (!data.token || !data.user) {
          throw new Error(data.error ?? 'Invalid or expired magic link.');
        }
        persistSession(data.token, data.user);
        window.location.href = data.redirect || '/dashboard';
      })
      .catch((err: unknown) => {
        setErrorMsg(
          err instanceof Error ? err.message : 'This magic link is invalid or has expired.',
        );
        setStatus('error');
      });
  }, [searchParams]);

  if (status === 'error') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 20,
            padding: '40px 32px',
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Image
            src="/claw.png"
            alt=""
            width={48}
            height={48}
            style={{ marginBottom: 16, opacity: 0.5 }}
          />
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            Link expired or invalid
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
            {errorMsg}
          </p>
          <a
            href="/login"
            style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              borderRadius: 10,
              padding: '10px 24px',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <Image
          src="/claw.png"
          alt=""
          width={56}
          height={56}
          style={{
            filter: 'drop-shadow(0 0 16px var(--logo-glow))',
            animation: 'float 4s ease-in-out infinite',
            marginBottom: 16,
          }}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Verifying your magic link…
        </p>
      </div>
    </div>
  );
}
