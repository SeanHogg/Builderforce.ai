'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, TextField } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { faultMessage } from '@/lib/apiClient';

/**
 * Email + password, with the emailed-code step an unverified account owes. The
 * session it ends in is set through `AuthContext`, so whoever is watching
 * `isAuthenticated` (the sign-in dialog) sees it at once.
 */
export function EmailSignInForm({ onBack }: { onBack: () => void }) {
  const t = useTranslations('signInDialog');
  const { login, verifyEmail } = useAuth();
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(faultMessage(cause, t('failed')));
    } finally {
      setBusy(false);
    }
  };

  const signIn = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await login(email.trim(), password);
      if (result.needsVerification) setPendingEmail(result.email);
    });
  };

  const verify = (event: FormEvent) => {
    event.preventDefault();
    if (!pendingEmail) return;
    void run(() => verifyEmail(pendingEmail, code.trim(), true));
  };

  if (pendingEmail) {
    return (
      <form onSubmit={verify} style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('verifyLead', { email: pendingEmail })}
        </p>
        <TextField id={`${id}-code`} label={t('codeLabel')} value={code} onChange={(e) => setCode(e.target.value)}
          inputMode="numeric" autoComplete="one-time-code" required autoFocus error={error ?? undefined} />
        <Button type="submit" variant="primary" block loading={busy}>{t('verify')}</Button>
        <Button type="button" variant="ghost" block onClick={() => setPendingEmail(null)}>{t('back')}</Button>
      </form>
    );
  }

  return (
    <form onSubmit={signIn} style={{ display: 'grid', gap: 12 }}>
      <TextField id={`${id}-email`} label={t('emailLabel')} type="email" autoComplete="email" required autoFocus
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField id={`${id}-password`} label={t('passwordLabel')} type="password" autoComplete="current-password" required
        value={password} onChange={(e) => setPassword(e.target.value)} error={error ?? undefined} />
      <Button type="submit" variant="primary" block loading={busy}>{t('submit')}</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 'var(--font-size-small)' }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 0, padding: 0, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          {t('back')}
        </button>
        <Link href="/register" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>{t('createAccount')}</Link>
      </div>
    </form>
  );
}
