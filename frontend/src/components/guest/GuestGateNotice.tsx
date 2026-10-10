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

export type GuestGateVariant = 'inline' | 'block' | 'stacked';

export interface GuestGateNoticeProps {
  /** Why the action is walled — already localized. */
  reason: string;
  /**
   * 'inline' wraps one control; 'block' dims a whole panel with a centered CTA;
   * 'stacked' wraps one PRIMARY control and puts the reason and the CTA under
   * it, for a buy button whose refusal must be legible before the click rather
   * than discovered in a tooltip.
   */
  variant: GuestGateVariant;
  /** Suppress the CTA/lock (still disables) — matches `RoleGate`'s `silent`. */
  silent?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function GuestGateNotice({ reason, variant, silent = false, children, className, style }: GuestGateNoticeProps) {
  const pathname = usePathname() || '/';

  if (variant === 'stacked') {
    return (
      <div className={className} style={{ display: 'grid', gap: 8, justifyItems: 'start', ...style }}>
        <InertControl reason={reason} showLock={!silent}>{children}</InertControl>
        {!silent && (
          <>
            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{reason}</p>
            <GateActions pathname={pathname} justify="flex-start" />
          </>
        )}
      </div>
    );
  }

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
            <GateActions pathname={pathname} justify="center" />
          </div>
        )}
      </div>
    );
  }

  return (
    <InertControl reason={reason} showLock={!silent} className={className} style={style}>
      {children}
    </InertControl>
  );
}

/** The wrapped control, rendered but refusing the click — the inline gate, and
 *  the top half of the stacked one. */
function InertControl({ reason, showLock, children, className, style }: {
  reason: string;
  showLock: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
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
      {showLock && <Icon source="lock" size={12} aria-hidden />}
    </span>
  );
}

/** The two ways past the wall — create an account, or sign in — returning to
 *  the page the visitor was on. One rendering for every variant that shows a CTA. */
function GateActions({ pathname, justify }: { pathname: string; justify: 'center' | 'flex-start' }) {
  const t = useTranslations('guest');
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: justify }}>
      <ButtonLink href={`/register?next=${encodeURIComponent(pathname)}`} variant="primary" size="sm">
        {t('gate.create')}
      </ButtonLink>
      <ButtonLink href={signInHref(pathname)} variant="secondary" size="sm">
        {t('gate.signIn')}
      </ButtonLink>
    </div>
  );
}
