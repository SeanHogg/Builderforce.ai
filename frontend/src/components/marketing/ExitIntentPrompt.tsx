import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { subscribeToNewsletter } from '@/lib/newsletterApi';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import styles from './ExitIntentPrompt.module.css';

const STORAGE_KEY = 'bf-exit-intent-dismissed';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;

type SubmissionStatus = 'idle' | 'sending' | 'submitted' | 'error';

function isCoolingDown(now = Date.now()): boolean {
  try {
    const dismissedAt = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10);
    return Number.isFinite(dismissedAt) && now - dismissedAt < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function beginCooldown(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in privacy modes. The prompt still works for
    // this page view; it simply cannot remember the dismissal.
  }
}

/**
 * One app-wide, anonymous-only exit-intent prompt.
 *
 * Desktop intent is a pointer leaving through the browser's top edge. On touch
 * devices, hiding the document opens the prompt for when the visitor returns.
 * A dismissal or successful subscription suppresses it for seven days.
 */
export function ExitIntentPrompt() {
  const t = useTranslations('exitIntent');
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const shownThisPage = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    beginCooldown();
    setOpen(false);
  }, []);

  useModalDismiss(open, close);

  const show = useCallback(() => {
    if (isAuthenticated || shownThisPage.current || isCoolingDown()) return;
    shownThisPage.current = true;
    setOpen(true);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      return;
    }

    const onMouseLeave = (event: MouseEvent) => {
      if (event.clientY <= 5) show();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') show();
    };

    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isAuthenticated, show]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    emailRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;
    setStatus('sending');
    try {
      await subscribeToNewsletter(normalizedEmail, 'exit-intent');
      beginCooldown();
      setStatus('submitted');
    } catch {
      setStatus('error');
    }
  }

  if (!open || isAuthenticated) return null;

  const prompt = (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-intent-title"
        aria-describedby="exit-intent-description"
      >
        <button className={styles.close} type="button" onClick={close} aria-label={t('closeAria')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>

        <div className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z" /></svg>
        </div>
        <span className={styles.badge}>{t('badge')}</span>
        <h2 id="exit-intent-title" className={styles.title}>{t('title')}</h2>
        <p id="exit-intent-description" className={styles.description}>{t('description')}</p>

        {status === 'submitted' ? (
          <div className={styles.success} role="status">
            <strong>{t('successTitle')}</strong>
            <span>{t('successDescription')}</span>
            <button type="button" className={styles.secondaryButton} onClick={close}>{t('close')}</button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.inputWrap}>
              <span className={styles.srOnly}>{t('emailAria')}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 6l8 6 8-6" /></svg>
              <input
                ref={emailRef}
                type="email"
                required
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                disabled={status === 'sending'}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  if (status === 'error') setStatus('idle');
                }}
              />
            </label>
            <button className={styles.submit} type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? t('submitting') : t('submit')}
            </button>
            {status === 'error' && <p className={styles.error} role="alert">{t('error')}</p>}
            <p className={styles.privacy}>{t('privacy')}</p>
          </form>
        )}
      </section>
    </div>
  );

  return createPortal(prompt, document.body);
}
