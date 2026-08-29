'use client';

import { Icon } from '@/components/ui/Icon';
import React from 'react';
import { useTranslations } from 'next-intl';
import { usePermission, type Capability } from '@/lib/rbac';
import { GateHint } from '@/components/ui/GateHint';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';
import { GuestGateNotice } from '@/components/guest/GuestGateNotice';

/**
 * Gate an action or section on a workspace capability.
 *
 * Product rule: we DO NOT hide features behind roles — we render them disabled
 * and indicate the role required. So when the current user lacks the capability,
 * this component still shows `children`, but inert (clicks blocked, dimmed) with
 * a "Requires <Role> role" hint. The server-side requireRole() gate is the real
 * authority; this is the honest UX signal so users can see what exists and know
 * who to ask for access.
 *
 * It decides its own state from {@link usePermission} — consumers never pass a
 * `canX` boolean.
 *
 *   <RoleGate capability="members.invite">
 *     <button onClick={invite}>Invite</button>
 *   </RoleGate>
 *
 * variant="block" dims a whole panel/section with a centered hint instead of
 * wrapping a single inline control.
 *
 * SESSION PRE-EMPTS ROLE. `useRole()` reads `undefined` for a signed-out
 * visitor, so every capability check fails for them regardless of which one it
 * is — and "Requires Manager role" is a lie about the fix: no role upgrade in an
 * account they don't have will ever satisfy it. A role hint is meaningless
 * before there is an account to hold a role, so a guest sees the SAME
 * "create an account" notice {@link SessionGate} already shows everywhere else
 * (via the shared {@link GuestGateNotice}), never the role text. Signed-in
 * people below the required role still get the honest role hint.
 */
export interface RoleGateProps {
  capability: Capability;
  children: React.ReactNode;
  /** 'inline' (default) wraps one interactive control; 'block' dims a section. */
  variant?: 'inline' | 'block';
  /** Suppress the lock/role hint (still disables). */
  silent?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function RoleGate({ capability, children, variant = 'inline', silent = false, className, style }: RoleGateProps) {
  const { allowed, required } = usePermission(capability);
  const t = useTranslations('common');
  const tGuest = useTranslations('guest');
  const { ready, signedIn } = useSampleWorkspace();
  if (allowed) return <>{children}</>;

  // A guest has no role to be missing — the fix is an account, not a promotion.
  // Checked before the role hint below so the two never contradict each other.
  if (ready && !signedIn) {
    return (
      <GuestGateNotice reason={tGuest('gate.reason.account')} variant={variant} silent={silent} className={className} style={style}>
        {children}
      </GuestGateNotice>
    );
  }

  // Localized via an ICU select on the role key rather than interpolating the
  // English ROLE_LABEL — "Requires {label} role" is not a sentence shape that
  // survives translation (German needs the role in quotes and a different verb,
  // Chinese drops the article entirely), so each locale owns the whole phrase.
  const hint = t('requiresRoleHint', { role: required });

  if (variant === 'block') {
    return (
      <div className={className} style={{ position: 'relative', ...style }} aria-disabled title={hint}>
        <div style={{ opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.4)', userSelect: 'none' }}>
          {children}
        </div>
        {!silent && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <GateHint>{hint}</GateHint>
          </div>
        )}
      </div>
    );
  }

  // inline — swallow clicks at capture so the underlying handler never fires.
  return (
    <span
      className={className}
      title={hint}
      aria-disabled
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'not-allowed', opacity: 0.55, ...style }}
    >
      <span style={{ pointerEvents: 'none', display: 'inline-flex', alignItems: 'center' }}>{children}</span>
      {!silent && <span aria-hidden style={{ fontSize: 'var(--font-size-field-label)', lineHeight: 1 }}><Icon source="🔒" size="1em" /></span>}
    </span>
  );
}
