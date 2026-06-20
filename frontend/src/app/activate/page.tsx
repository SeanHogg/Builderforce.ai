'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AUTH_API_URL, getStoredWebToken } from '@/lib/auth';

type Phase = 'loading' | 'need-login' | 'confirm' | 'approving' | 'approved' | 'denied' | 'error';

function ActivateInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = (searchParams.get('code') ?? '').trim();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!code) {
      setError('No device code in the link. Re-open the sign-in from your editor.');
      setPhase('error');
      return;
    }
    const token = getStoredWebToken();
    setPhase(token ? 'confirm' : 'need-login');
  }, [code]);

  async function decide(decision: 'approve' | 'deny') {
    const token = getStoredWebToken();
    if (!token) {
      setPhase('need-login');
      return;
    }
    setPhase('approving');
    try {
      const res = await fetch(`${AUTH_API_URL}/api/auth/device/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_code: code, decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === 'no_tenant'
            ? 'Your account has no workspace yet. Create one, then try again.'
            : body.error === 'already_resolved'
              ? 'This code was already used or has expired.'
              : `Could not ${decision} the device (${res.status}).`,
        );
        setPhase('error');
        return;
      }
      setPhase(decision === 'approve' ? 'approved' : 'denied');
    } catch {
      setError('Network error. Please try again.');
      setPhase('error');
    }
  }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Connect your editor</h1>

        {phase === 'loading' && <p style={styles.muted}>Loading…</p>}

        {phase === 'need-login' && (
          <>
            <p style={styles.muted}>Sign in to approve this device.</p>
            <button
              style={styles.primary}
              onClick={() => router.push(`/login?redirect=${encodeURIComponent(`/activate?code=${code}`)}`)}
            >
              Sign in
            </button>
          </>
        )}

        {phase === 'confirm' && (
          <>
            <p style={styles.muted}>
              A device is requesting access to BuilderForce on your behalf. Confirm the code matches
              what your editor shows:
            </p>
            <div style={styles.code}>{code}</div>
            <div style={styles.row}>
              <button style={styles.primary} onClick={() => decide('approve')}>
                Approve
              </button>
              <button style={styles.secondary} onClick={() => decide('deny')}>
                Deny
              </button>
            </div>
          </>
        )}

        {phase === 'approving' && <p style={styles.muted}>Working…</p>}

        {phase === 'approved' && (
          <p style={styles.ok}>✓ Device approved. Return to your editor — it will finish signing in.</p>
        )}

        {phase === 'denied' && <p style={styles.muted}>Device denied. You can close this tab.</p>}

        {phase === 'error' && <p style={styles.err}>{error}</p>}
      </div>
    </main>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={<main style={styles.wrap}><div style={styles.card}><p style={styles.muted}>Loading…</p></div></main>}>
      <ActivateInner />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { maxWidth: 440, width: '100%', padding: 28, borderRadius: 12, border: '1px solid var(--border-subtle, #2a2f3a)', background: 'var(--bg-surface, #11151f)' },
  h1: { margin: '0 0 12px', fontSize: 22 },
  muted: { color: 'var(--text-secondary, #9aa4b2)', lineHeight: 1.5, margin: '0 0 16px' },
  code: { fontFamily: 'monospace', fontSize: 28, letterSpacing: 2, textAlign: 'center', padding: '12px 0', margin: '0 0 20px', color: 'var(--text-primary, #f0f4ff)' },
  row: { display: 'flex', gap: 12 },
  primary: { flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: 'var(--accent, #ff6a3d)', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  secondary: { flex: 1, padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border-subtle, #2a2f3a)', background: 'transparent', color: 'var(--text-primary, #f0f4ff)', cursor: 'pointer' },
  ok: { color: 'var(--text-primary, #f0f4ff)', lineHeight: 1.5 },
  err: { color: '#f87171', lineHeight: 1.5 },
};
