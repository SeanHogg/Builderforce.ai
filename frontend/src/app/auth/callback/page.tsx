'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { AUTH_API_URL, persistSession } from '@/lib/auth';
import type { AuthUser } from '@/lib/types';

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: 'Authentication failed: missing parameters.',
  invalid_state: 'Authentication failed: invalid or expired state. Please try again.',
  auth_failed: 'Authentication failed with the provider. Please try again.',
  no_email: 'Your provider account has no verified email address.',
  account_not_found: 'Account not found or has been disabled.',
  provider_unavailable: 'This sign-in provider is not currently available.',
};

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const redirect = searchParams.get('redirect') || '/dashboard';
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(ERROR_MESSAGES[errorParam] ?? 'An unexpected error occurred. Please try again.');
      return;
    }

    if (!token) {
      setError('No token received from provider.');
      return;
    }

    // Fetch the user profile using the new token, then persist session
    fetch(`${AUTH_API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load profile');
        return res.json() as Promise<AuthUser>;
      })
      .then((user) => {
        persistSession(token, user);
        window.location.href = redirect;
      })
      .catch(() => {
        setError('Failed to load your account profile. Please try signing in again.');
      });
  }, [searchParams, router]);

  if (error) {
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
            Sign-in failed
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
            {error}
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Signing you in…</p>
      </div>
    </div>
  );
}
