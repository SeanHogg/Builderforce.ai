'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ToastProvider';
import { faultMessage } from '@/lib/apiClient';
const MIN_LENGTH = 8;

/**
 * "Set a password" for an account that signed up through a provider and has none.
 * Decides its own visibility: renders nothing once the account has a password, so
 * any surface can mount it without a guard of its own.
 */
export default function SetPasswordPanel() {
  const t = useTranslations('security.setPassword');
  const { user, setPassword } = useAuth();
  const toast = useToast();
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.hasPassword !== false) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_LENGTH) { setError(t('tooShort', { min: MIN_LENGTH })); return; }
    if (password !== confirm) { setError(t('mismatch')); return; }
    setBusy(true);
    setError(null);
    try {
      await setPassword(password);
      toast.success(t('done'));
    } catch (e) {
      setError(faultMessage(e, t('failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ marginBottom: 16 }} aria-labelledby="set-password-title">
      <h3 id="set-password-title" style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('title')}</h3>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '4px 0 12px' }}>{t('subtitle')}</p>
      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', fontSize: 'var(--font-size-field-label)', color: 'var(--text-secondary)' }}>
          {t('password')}
          <input className="input" type="password" autoComplete="new-password" minLength={MIN_LENGTH} required value={password} onChange={(e) => setPasswordValue(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', fontSize: 'var(--font-size-field-label)', color: 'var(--text-secondary)' }}>
          {t('confirm')}
          <input className="input" type="password" autoComplete="new-password" minLength={MIN_LENGTH} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? t('saving') : t('save')}</button>
      </form>
      {error && <p role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--danger)', margin: '8px 0 0' }}>{error}</p>}
    </section>
  );
}
