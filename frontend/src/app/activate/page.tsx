'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AUTH_API_URL, getStoredWebToken, signInHref } from '@/lib/auth';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

type Mode = 'device' | 'key';
type Phase =
  | 'loading'
  | 'redirecting' // no session — bouncing to /login and back
  | 'confirm' // device: awaiting approve/deny
  | 'working'
  | 'approved' // device approved
  | 'denied'
  | 'key-ready' // key minted, show copy
  | 'error';

function ActivateInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('activate');
  const code = (searchParams.get('code') ?? '').trim();
  const mode: Mode = code ? 'device' : 'key';

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  // 1500ms confirmation, owned by the shared hook (write + reset timer + unmount safety).
  const { copied, copy } = useCopyToClipboard(1500);

  // Signed-out visitors are sent straight to sign-in and returned here afterwards.
  // `next` is the param /login honours (a `redirect` param is ignored, which used to
  // drop the user on /dashboard and abandon the editor activation).
  useEffect(() => {
    const token = getStoredWebToken();
    if (!token) {
      setPhase('redirecting');
      const back = mode === 'device' ? `/activate?code=${encodeURIComponent(code)}` : '/activate';
      router.replace(signInHref(back));
      return;
    }
    setPhase(mode === 'device' ? 'confirm' : 'loading');
  }, [mode, code, router]);

  function humanError(errCode: string | undefined, status: number, decision?: 'approve' | 'deny'): string {
    if (errCode === 'no_tenant') return t('errorNoTenant');
    if (errCode === 'already_resolved') return t('errorAlreadyResolved');
    if (decision === 'approve') return t('errorApprove', { status });
    if (decision === 'deny') return t('errorDeny', { status });
    return t('errorCreateKey', { status });
  }

  async function decide(decision: 'approve' | 'deny') {
    const token = getStoredWebToken();
    if (!token) return setPhase('redirecting');
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
      setError(t('errorNetwork'));
      setPhase('error');
    }
  }

  async function createKey() {
    const token = getStoredWebToken();
    if (!token) return setPhase('redirecting');
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
        setError(t('errorNoKey'));
        setPhase('error');
        return;
      }
      setKey(b.access_key);
      setPhase('key-ready');
    } catch {
      setError(t('errorNetwork'));
      setPhase('error');
    }
  }

  // Auto-create the key once when in key-mode and authenticated.
  useEffect(() => {
    if (mode === 'key' && phase === 'loading' && getStoredWebToken()) void createKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase]);

  // Clipboard refusal stays silent as before — the key is on screen to select manually.
  function copyKey() { void copy(key); }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>{t('title')}</h1>

        {phase === 'loading' && <p style={styles.muted}>{t('loading')}</p>}
        {phase === 'working' && <p style={styles.muted}>{t('working')}</p>}
        {phase === 'redirecting' && <p style={styles.muted}>{t('redirecting')}</p>}

        {phase === 'confirm' && (
          <>
            <p style={styles.muted}>{t('confirmIntro')}</p>
            <div style={styles.code}>{code}</div>
            <div style={styles.row}>
              <button style={styles.primary} onClick={() => decide('approve')}>{t('approve')}</button>
              <button style={styles.secondary} onClick={() => decide('deny')}>{t('deny')}</button>
            </div>
          </>
        )}

        {phase === 'approved' && <p style={styles.ok}>{t('approved')}</p>}
        {phase === 'denied' && <p style={styles.muted}>{t('denied')}</p>}

        {phase === 'key-ready' && (
          <>
            <p style={styles.muted}>{t('keyIntro')}</p>
            <div style={styles.keyBox}>
              <code style={styles.keyText}>{key}</code>
            </div>
            <button style={styles.primary} onClick={copyKey}>{copied ? t('copied') : t('copyKey')}</button>
            <p style={styles.fine}>{t('keyFine')}</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <p style={styles.err}>{error}</p>
            {mode === 'key' && (
              <button style={styles.secondary} onClick={() => setPhase('loading')}>{t('tryAgain')}</button>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function ActivateFallback() {
  const t = useTranslations('activate');
  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <p style={styles.muted}>{t('loading')}</p>
      </div>
    </main>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={<ActivateFallback />}>
      <ActivateInner />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { maxWidth: 460, width: '100%', padding: 'clamp(20px, 5vw, 28px)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' },
  h1: { margin: '0 0 12px', fontSize: 'var(--font-size-page-title)', color: 'var(--text-primary, var(--text-primary))' },
  muted: { color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' },
  code: { fontFamily: 'monospace', fontSize: 'clamp(20px, 6vw, 28px)', letterSpacing: 2, textAlign: 'center', padding: '12px 0', margin: '0 0 20px', color: 'var(--text-primary, var(--text-primary))', overflowWrap: 'anywhere' },
  keyBox: { padding: '12px 14px', margin: '0 0 14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', overflowWrap: 'anywhere' },
  keyText: { fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-small)', color: 'var(--text-primary, var(--text-primary))' },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  primary: { padding: '10px 16px', minHeight: 44, borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)', color: 'var(--text-on-accent)', fontWeight: 600, cursor: 'pointer' },
  secondary: { padding: '10px 16px', minHeight: 44, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-primary, var(--text-primary))', cursor: 'pointer' },
  ok: { color: 'var(--text-primary, var(--text-primary))', lineHeight: 1.5 },
  err: { color: 'var(--error-text, var(--error))', lineHeight: 1.5, margin: '0 0 14px' },
  fine: { color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)', margin: '14px 0 0', lineHeight: 1.5 },
};
