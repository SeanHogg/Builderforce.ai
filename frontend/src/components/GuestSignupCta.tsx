'use client';

import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { registerHref, signInHref } from '@/lib/auth';
import styles from './GuestSignupCta.module.css';

/**
 * THE guest conversion call-to-action — "create a free account / sign in".
 *
 * Every surface an anonymous visitor can reach ends the same way: the free
 * allowance runs out, or the next action needs a tenant, and the only thing the
 * visitor can DO about it is take an account. That pair of buttons — and the
 * destinations behind them, which must carry `next` so the visitor lands back on
 * the canvas or conversation they were in — was written out by hand on the guest
 * Brain wall, on the kill-switch panel, and in the canvas account gate. Meanwhile
 * the Creation Canvas, the one place a guest actually hits the wall mid-sentence,
 * offered no button at all: it printed "Sign up free to keep going" as prose and
 * stopped.
 *
 * It decides its own visibility from the prompt it is given, so a surface mounts it
 * unconditionally and never re-derives whether this visitor is blocked. The SENTENCE
 * stays with the surface: each one already says why in its own vocabulary (the
 * canvas transcript records the refused turn; the guest panel distinguishes a solo
 * allowance from a room's), and a default here would only compete with it.
 */
export interface GuestSignupPrompt {
  /** Where authentication should return the visitor to (their canvas, their room). */
  next?: string;
  /** Telemetry for the surface that offered the CTA; fired on the sign-up click. */
  onAccept?: () => void;
}

export interface GuestSignupCtaProps {
  /** `null` ⇒ nothing is blocked and nothing renders. */
  prompt: GuestSignupPrompt | null;
  /** Overrides the default lead line. */
  title?: string;
  /** The surface's own explanation of what ran out. Omitted when the surface has
   *  ALREADY said it — the canvas transcript ends with the refusal itself. */
  body?: string;
  /** `wall` (default) is the full block; `actions` is the button row alone, for a
   *  surface that supplies its own heading and copy. */
  layout?: 'wall' | 'actions';
}

export function GuestSignupCta({ prompt, title, body, layout = 'wall' }: GuestSignupCtaProps) {
  const t = useTranslations('common');
  if (!prompt) return null;

  const { next, onAccept } = prompt;
  const actions = (
    <div className={styles.actions}>
      <ButtonLink href={registerHref(next)} variant="primary" size="sm" onClick={onAccept}>
        {t('createFreeAccount')}
      </ButtonLink>
      <ButtonLink href={signInHref(next)} variant="secondary" size="sm">
        {t('signIn')}
      </ButtonLink>
    </div>
  );
  if (layout === 'actions') return actions;

  return (
    <div className={styles.wall}>
      <span className={styles.mark} aria-hidden><Icon source="🚀" size={18} /></span>
      <strong className={styles.title}>{title ?? t('guestSignupTitle')}</strong>
      {body ? <p className={styles.body}>{body}</p> : null}
      {actions}
    </div>
  );
}
