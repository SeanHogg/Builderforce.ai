'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AUTH_API_URL, getStoredWebToken } from '@/lib/auth';

type Mode = 'device' | 'key';
type Phase =
  | 'loading'
  | 'need-login'
  | 'confirm' // device: awaiting approve/deny
  | 'working'
  | 'approved' // device approved
  | 'denied'
  | 'key-ready' // key minted, show copy
  | 'error';

function ActivateInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = (searchParams.get('code') ?? '').trim();
  const mode: Mode = code ? 'device' : 'key';

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = getStoredWebToken();
    if (!token) {
      setPhase('need-login');
      return;
    }
    setPhase(mode === 'device' ? 'confirm' : 'loading');
  }, [mode]);

  function goLogin() {
    const back = mode === 'device' ? `/activate?code=${code}` : '/activate';
    router.push(`/login?redirect=${encodeURIComponent(back)}`);
  }

  async function decide(decision: 'approve' | 'deny') {
    const token = getStoredWebToken();
    if (!token) return setPhase('need-login');
    setPhase('working');
    try {
      const res = await fetch(`${AUTH_API_URL}/api/auth/device/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_code: code, decision }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(humanError(b.error, res.status, decision));
        setPhase('error');
        return;
      }
      setPhase(decision === 'approve' ? 'approved' : 'denied');
    } catch {
      setError('Network error. Please try again.');
      setPhase('error');
    }
  }

  async function createKey() {
    const token = getStoredWebToken();
    if (!token) return setPhase('need-login');
    setPhase('working');
    try {
      const res = await fetch(`${AUTH_API_URL}/api/auth/editor-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(humanError(b.error, res.status));
        setPhase('error');
        return;
      }
      const b = (await res.json()) as { access_key?: string };
      if (!b.access_key) {
        setError('No key returned. Please try again.');
        setPhase('error');
        return;
      }
      setKey(b.access_key);
      setPhase('key-ready');
    } catch {
      setError('Network error. Please try again.');
      setPhase('error');
    }
  }

  // Auto-create the key once when in key-mode and authenticated.
  useEffect(() => {
    if (mode === 'key' && phase === 'loading' && getStoredWebToken()) void createKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase]);

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Connect your editor</h1>

        {phase === 'loading' && <p style={styles.muted}>Loading…</p>}
        {phase === 'working' && <p style={styles.muted}>Working…</p>}

        {phase === 'need-login' && (
          <>
            <p style={styles.muted}>Sign in to connect your editor.</p>
            <button style={styles.primary} onClick={goLogin}>Sign in</button>
          </>
        )}

        {phase === 'confirm' && (
          <>
            <p style={styles.muted}>
              Your editor is requesting access. Confirm this code matches what VS Code shows:
            </p>
            <div style={styles.code}>{code}</div>
            <div style={styles.row}>
              <button style={styles.primary} onClick={() => decide('approve')}>Approve</button>
              <button style={styles.secondary} onClick={() => decide('deny')}>Deny</button>
            </div>
          </>
        )}

        {phase === 'approved' && (
          <p style={styles.ok}>✓ Approved. Return to VS Code — it will finish signing in automatically.</p>
        )}
        {phase === 'denied' && <p style={styles.muted}>Request denied. You can close this tab.</p>}

        {phase === 'key-ready' && (
          <>
            <p style={styles.muted}>
              Here is your editor key. Copy it and paste it into VS Code:
            </p>
            <div style={styles.keyBox}>
              <code style={styles.keyText}>{key}</code>
            </div>
            <button style={styles.primary} onClick={copyKey}>{copied ? '✓ Copied' : 'Copy key'}</button>
            <p style={styles.fine}>Keep this key secret. You can revoke it anytime in Settings → API Keys.</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <p style={styles.err}>{error}</p>
            {mode === 'key' && (
              <button style={styles.secondary} onClick={() => setPhase('loading')}>Try again</button>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function humanError(code: string | undefined, status: number, decision?: 'approve' | 'deny'): string {
  if (code === 'no_tenant') return 'Your account has no workspace yet. Create one, then try again.';
  if (code === 'already_resolved') return 'This code was already used or has expired. Re-run sign-in from your editor.';
  if (decision) return `Could not ${decision} the device (${status}).`;
  return `Could not create a key (${status}).`;
}

export default function ActivatePage() {
  return (
    <Suspense
      fallback={
        <main style={styles.wrap}>
          <div style={styles.card}>
            <p style={styles.muted}>Loading…</p>
          </div>
        </main>
      }
    >
      <ActivateInner />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { maxWidth: 460, width: '100%', padding: 28, borderRadius: 12, border: '1px solid var(--border-subtle, #2a2f3a)', background: 'var(--bg-surface, #11151f)' },
  h1: { margin: '0 0 12px', fontSize: 22 },
  muted: { color: 'var(--text-secondary, #9aa4b2)', lineHeight: 1.5, margin: '0 0 16px' },
  code: { fontFamily: 'monospace', fontSize: 28, letterSpacing: 2, textAlign: 'center', padding: '12px 0', margin: '0 0 20px', color: 'var(--text-primary, #f0f4ff)' },
  keyBox: { padding: '12px 14px', margin: '0 0 14px', borderRadius: 8, background: 'var(--bg-deep, #0b1220)', border: '1px solid var(--border-subtle, #2a2f3a)', overflowWrap: 'anywhere' },
  keyText: { fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary, #f0f4ff)' },
  row: { display: 'flex', gap: 12 },
  primary: { padding: '10px 16px', borderRadius: 8, border: 'none', background: 'var(--accent, #ff6a3d)', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  secondary: { padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border-subtle, #2a2f3a)', background: 'transparent', color: 'var(--text-primary, #f0f4ff)', cursor: 'pointer' },
  ok: { color: 'var(--text-primary, #f0f4ff)', lineHeight: 1.5 },
  err: { color: '#f87171', lineHeight: 1.5, margin: '0 0 14px' },
  fine: { color: 'var(--text-muted, #6b7280)', fontSize: 12, margin: '14px 0 0', lineHeight: 1.5 },
};
