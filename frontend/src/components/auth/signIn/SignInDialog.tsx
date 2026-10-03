'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ModalOverlay } from '@/components/ui/ModalOverlay';
import { Button } from '@/components/ui';
import { EmailSignInForm } from './EmailSignInForm';
import { SsoSignInForm } from './SsoSignInForm';
import { useSignInPopup } from './useSignInPopup';

type View = 'choose' | 'email' | 'sso';

const PROVIDERS = [
  { provider: 'google', mark: 'G', labelKey: 'google' },
  { provider: 'github', mark: '⌥', labelKey: 'github' },
] as const;

/**
 * The sign-in pop-up: providers, email and password, or single sign-on, over the
 * page the visitor was already on. Rendering it is the caller's (`open`); closing
 * it once signed in is too, since the caller is the one watching the session.
 *
 * `returnPath` is where a sign-in lands if the browser blocks the provider pop-up
 * and it has to run in this tab instead.
 */
export function SignInDialog({ open, onDismiss, returnPath }: { open: boolean; onDismiss: () => void; returnPath: string }) {
  const t = useTranslations('signInDialog');
  const [view, setView] = useState<View>('choose');
  const [waiting, setWaiting] = useState(false);
  const { signInWithProvider, signInWithSso } = useSignInPopup(returnPath);

  const dismiss = () => {
    setView('choose');
    setWaiting(false);
    onDismiss();
  };

  return (
    <ModalOverlay open={open} onDismiss={dismiss} labelledBy="sign-in-dialog-title">
      <div
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          padding: 'clamp(24px, 5vw, 40px)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-card, var(--bg-elevated))',
          color: 'var(--text-primary)',
          display: 'grid',
          gap: 20,
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('close')}
          style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, border: 0, background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-section)' }}
        >
          ×
        </button>
        <div style={{ textAlign: 'center', display: 'grid', gap: 10 }}>
          <span aria-hidden className="ui-text-page-title" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Builderforce</span>
          <h2 id="sign-in-dialog-title" style={{ margin: 0, fontSize: 'var(--font-size-body)', fontWeight: 500, color: 'var(--text-secondary)' }}>
            {t('lead')}
          </h2>
        </div>

        {view === 'email' && <EmailSignInForm onBack={() => setView('choose')} />}
        {view === 'sso' && (
          <SsoSignInForm onBack={() => setView('choose')} onStart={(email) => { setWaiting(true); signInWithSso(email); }} />
        )}
        {view === 'choose' && (
          <div style={{ display: 'grid', gap: 10 }}>
            {PROVIDERS.map(({ provider, mark, labelKey }) => (
              <ChoiceButton key={provider} mark={mark} onClick={() => { setWaiting(true); signInWithProvider(provider); }}>
                {t(labelKey)}
              </ChoiceButton>
            ))}
            <ChoiceButton onClick={() => setView('email')}>{t('email')}</ChoiceButton>
            <ChoiceButton onClick={() => setView('sso')}>{t('sso')}</ChoiceButton>
          </div>
        )}

        {waiting && (
          <p role="status" style={{ margin: 0, textAlign: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('waiting')}
          </p>
        )}

        <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {t.rich('terms', {
            terms: (chunks) => <Link href="/legal/terms" target="_blank" rel="noopener" style={{ color: 'var(--text-secondary)' }}>{chunks}</Link>,
            privacy: (chunks) => <Link href="/legal/privacy" target="_blank" rel="noopener" style={{ color: 'var(--text-secondary)' }}>{chunks}</Link>,
          })}
        </p>
      </div>
    </ModalOverlay>
  );
}

function ChoiceButton({ mark, onClick, children }: { mark?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="secondary" block onClick={onClick}>
      {mark && <span aria-hidden style={{ fontWeight: 700, marginRight: 8 }}>{mark}</span>}
      {children}
    </Button>
  );
}
