'use client';

import { useMemo, type CSSProperties, type MouseEvent } from 'react';
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

export interface AvatarFaceProps {
  /** Display name (derives initials + color). */
  name: string;
  /** Photo to show instead of the initials; falls back to initials when absent. */
  imageUrl?: string | null;
  /** Count badge (rendered as a small pill on the top-right). Omit for none. */
  count?: number;
  /** Visually highlight the face as selected/active. */
  active?: boolean;
  /** Diameter in px. Default 36. */
  size?: number;
  /** Override the deterministic color. */
  color?: string;
}

/**
 * The circular FACE — initials or photo, deterministic colour, optional count
 * badge — with no interaction of its own.
 *
 * It is split out from {@link Avatar} because two different controls need the
 * same picture: the roster's clickable avatar (a `<button>`), and the account
 * menu's trigger, which is itself a button carrying a face PLUS a chevron. A
 * button cannot nest inside a button, so the picture had to become something
 * neither owns.
 */
export function AvatarFace({
  name,
  imageUrl,
  count,
  active = false,
  size = 36,
  color,
}: AvatarFaceProps) {
  const bgColor = useMemo(() => color ?? avatarColor(name), [name, color]);
  const initials = useMemo(() => avatarInitials(name), [name]);

  const style: CSSProperties = {
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
    fontWeight: 600,
    fontSize: Math.max(9, Math.round(size * 0.36)),
    lineHeight: 1,
    flexShrink: 0,
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    overflow: count != null ? 'visible' : 'hidden',
  };

  return (
    <span style={style} aria-hidden="true">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        initials
      )}
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
    </span>
  );
}

export interface AvatarProps extends AvatarFaceProps {
  /** Click handler. */
  onClick?: (e: MouseEvent) => void;
  /** Tooltip / aria-label override. Auto-generated from name + count when omitted. */
  title?: string;
}

/**
 * Circular avatar showing a person's initials, with optional count badge and
 * active/highlighted styling. Used by TeamMemberAvatarFilter and anywhere a
 * compact person/agent representation is needed.
 */
export function Avatar({ onClick, title, ...face }: AvatarProps) {
  const { name, count } = face;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `${name}${count != null ? ` (${count} task${count !== 1 ? 's' : ''})` : ''}`}
      aria-label={title ?? `${name}${count != null ? `, ${count} tasks` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: onClick ? 'pointer' : 'default',
        outline: 'none',
        fontFamily: 'inherit',
        lineHeight: 1,
      }}
    >
      <AvatarFace {...face} />
    </button>
  );
}
