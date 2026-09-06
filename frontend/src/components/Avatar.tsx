'use client';

import { useMemo, type MouseEvent } from 'react';
import { initialsOf } from '@/lib/initials';

/**
 * Generate a deterministic color from a name string.
 * Used to give each team member/agent a consistent avatar background.
 */
export function avatarColor(name: string): string {
  // Ten distinct categorical identities, all tokens: an avatar drawn from a
  // fixed literal is the same hue on paper as on slate, so half the wheel used
  // to wash out in light mode. The ORDER is the contract — a name must keep its
  // colour — so entries are replaced in place, never reordered.
  const colors = [
    'var(--red-bright)', 'var(--orange-bright)', 'var(--amber-bright)', 'var(--yellow-bright)',
    'var(--emerald-bright)', 'var(--teal-bright)', 'var(--cyan-bright)', 'var(--indigo-bright)',
    'var(--violet-bright)', 'var(--pink-bright)',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Extract initials from a name (up to 2 characters).
 * "John Doe" → "JD", "Alice" → "AL", "" → "?"
 */
export const avatarInitials = (name: string): string => initialsOf(name);

export interface AvatarProps {
  /** Display name (derives initials + color). */
  name: string;
  /** Task count badge (rendered as a small pill on the top-right). */
  count?: number;
  /** Visually highlight the avatar as selected/active. */
  active?: boolean;
  /** Click handler. */
  onClick?: (e: MouseEvent) => void;
  /** Diameter in px. Default 36. */
  size?: number;
  /** Override the deterministic color. */
  color?: string;
  /** Tooltip / aria-label override. Auto-generated from name + count when omitted. */
  title?: string;
}

/**
 * Circular avatar showing a person's initials, with optional count badge and
 * active/highlighted styling. Used by TeamMemberAvatarFilter and anywhere a
 * compact person/agent representation is needed.
 */
export function Avatar({
  name,
  count,
  active = false,
  onClick,
  size = 36,
  color,
  title,
}: AvatarProps) {
  const bgColor = useMemo(() => color ?? avatarColor(name), [name, color]);
  const initials = useMemo(() => avatarInitials(name), [name]);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `${name}${count != null ? ` (${count} task${count !== 1 ? 's' : ''})` : ''}`}
      aria-label={title ?? `${name}${count != null ? `, ${count} tasks` : ''}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: active ? bgColor : 'var(--bg-elevated)',
        color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
        border: `2px solid ${active ? bgColor : 'var(--border-subtle)'}`,
        cursor: onClick ? 'pointer' : 'default',
        fontWeight: 600,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        lineHeight: 1,
        flexShrink: 0,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        outline: 'none',
        padding: 0,
        fontFamily: 'inherit',
      }}
    >
      {initials}
      {count != null && (
        <span
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            background: 'var(--coral-bright)',
            color: 'var(--text-on-accent)',
            fontSize: 9,
            fontWeight: 700,
            minWidth: 16,
            height: 16,
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            lineHeight: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}