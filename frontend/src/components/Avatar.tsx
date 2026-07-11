'use client';

import { useMemo, type MouseEvent } from 'react';

/**
 * Generate a deterministic color from a name string.
 * Used to give each team member/agent a consistent avatar background.
 */
export function avatarColor(name: string | null | undefined): string {
  const colors = [
    '#f4726e', '#fb923c', '#fbbf24', '#a3e635', '#34d399',
    '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9',
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
export function avatarInitials(name: string | null | undefined): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const s = parts[0];
    return s.length >= 2 ? s.slice(0, 2).toUpperCase() : s.toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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
        color: active ? '#fff' : 'var(--text-secondary)',
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
            background: 'var(--coral-bright, #f4726e)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
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