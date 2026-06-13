'use client';

import type { ReactNode, CSSProperties, KeyboardEvent } from 'react';
import { AgentTypePill, type AgentPillKind } from '@/components/AgentTypePill';

/**
 * The single card shell shared by every entry in the Workforce directory — a
 * human teammate, a pending invite, a cloud agent, a marketplace hire, or a
 * remote host. One layout so people and agents read as one workforce; the only
 * thing that varies is the type pill, the body, and the footer actions.
 *
 * Header: avatar + name/subtitle on the left; type pill + optional status
 * badges on the right. Body fills the middle. Footer (when present) is the
 * action row, divided by a top border. {@link AgentCard} and {@link MemberCard}
 * both render through this so they stay pixel-consistent.
 */

const cardStyle: CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden',
};

export function WorkforceCard({
  avatar,
  name,
  subtitle,
  pill,
  badges,
  body,
  footer,
  onClick,
}: {
  /** Emoji (agents) or an initial badge (people). */
  avatar: ReactNode;
  name: string;
  subtitle?: string;
  pill: { kind: AgentPillKind; label?: string };
  /** Optional status chips shown right of the type pill (published / MFA / etc). */
  badges?: ReactNode;
  /** Middle content — bio + skills + pills for agents; meta for people. */
  body?: ReactNode;
  /** Action row, separated by a top border. Omit for a static card. */
  footer?: ReactNode;
  /** Makes the whole card a button (remote hosts open a panel on click). */
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      className="card"
      style={{ ...cardStyle, ...(clickable ? { cursor: 'pointer' } : null) }}
      {...(clickable
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
            },
          }
        : null)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {avatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            {subtitle && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <AgentTypePill kind={pill.kind} label={pill.label} />
          {badges}
        </div>
      </div>

      {body}

      {footer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {footer}
        </div>
      )}
    </div>
  );
}

/** Square initial-badge avatar for people (matches the old MembersView avatar). */
export function InitialAvatar({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      style={{
        width: 36, height: 36, borderRadius: 10, background: 'var(--bg-base)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color: 'var(--coral-bright)', flexShrink: 0,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}
