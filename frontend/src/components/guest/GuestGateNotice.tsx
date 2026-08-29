'use client';

/**
 * The visible half of "this needs an account" — extracted from `SessionGate` so
 * `RoleGate` can show the SAME notice instead of inventing its own.
 *
 * Before this existed, a signed-out visitor who lacked a `Capability` saw
 * `RoleGate`'s "Requires <Role> role" hint — honest about the role check
 * (`useRole()` is `undefined` with no account) but wrong about the fix: no role
 * upgrade in an account they don't have will ever satisfy it. `SessionGate`
 * already said the correct thing for "you need an account" everywhere else; this
 * is that rendering, taking a `reason` string instead of deriving one from a
 * `GatedAction`, so a caller that already knows what to say (or has no verb that
 * fits one) can still use the identical CTA.
 */

import React from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { ButtonLink } from '@/components/ui';
import { GateHint } from '@/components/ui/GateHint';
import { signInHref } from '@/lib/auth';

export interface GuestGateNoticeProps {
  /** Why the action is walled — already localized. */
  reason: string;
  /** 'inline' wraps one control; 'block' dims a whole panel with a centered CTA. */
  variant: 'inline' | 'block';
  /** Suppress the CTA/lock (still disables) — matches `RoleGate`'s `silent`. */
  silent?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function GuestGateNotice({ reason, variant, silent = false, children, className, style }: GuestGateNoticeProps) {
  const t = useTranslations('guest');
  const pathname = usePathname() || '/';

  if (variant === 'block') {
    return (
      <div className={className} style={{ position: 'relative', ...style }} aria-disabled title={reason}>
        <div style={{ opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.4)', userSelect: 'none' }}>
          {children}
        </div>
        {!silent && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, textAlign: 'center',
          }}>
            <GateHint>{reason}</GateHint>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <ButtonLink href={`/register?next=${encodeURIComponent(pathname)}`} variant="primary" size="sm">
                {t('gate.create')}
              </ButtonLink>
              <ButtonLink href={signInHref(pathname)} variant="secondary" size="sm">
                {t('gate.signIn')}
              </ButtonLink>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <span
      className={className}
      title={reason}
      aria-disabled
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4,
        cursor: 'not-allowed', opacity: 0.55, ...style,
      }}
    >
      {children}
      {!silent && <Icon source="lock" size={12} aria-hidden />}
    </span>
  );
}
