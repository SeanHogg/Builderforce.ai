'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { usePermission, type Capability } from '@/lib/rbac';

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

const lockPillStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 999,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', boxShadow: '0 1px 6px rgba(0,0,0,0.14)',
};

export function RoleGate({ capability, children, variant = 'inline', silent = false, className, style }: RoleGateProps) {
  const { allowed, required } = usePermission(capability);
  const t = useTranslations('common');
  if (allowed) return <>{children}</>;

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
            <span style={lockPillStyle}>🔒 {hint}</span>
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
      {!silent && <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>🔒</span>}
    </span>
  );
}
