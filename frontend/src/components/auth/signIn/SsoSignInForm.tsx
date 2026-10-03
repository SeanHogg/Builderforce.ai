// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, TextField } from '@/components/ui';
import { ssoDiscoveryApi } from '@/lib/builderforceApi';
import { faultMessage } from '@/lib/apiClient';

/**
 * Single sign-on: the work address decides the institution, and the sign-in runs
 * at its identity provider (through `onStart`, which opens the pop-up).
 */
export function SsoSignInForm({ onStart, onBack }: { onStart: (email: string) => void; onBack: () => void }) {
  const t = useTranslations('signInDialog');
  const id = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const found = await ssoDiscoveryApi.discover(email.trim());
      if (found.sso) onStart(email);
      else setError(t('ssoNotFound'));
    } catch (cause) {
      setError(faultMessage(cause, t('failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => { void submit(e); }} style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('ssoLead')}</p>
      <TextField id={`${id}-email`} label={t('emailLabel')} type="email" autoComplete="email" required autoFocus
        value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} />
      <Button type="submit" variant="primary" block loading={busy}>{t('ssoContinue')}</Button>
      <Button type="button" variant="ghost" block onClick={onBack}>{t('back')}</Button>
    </form>
  );
}
