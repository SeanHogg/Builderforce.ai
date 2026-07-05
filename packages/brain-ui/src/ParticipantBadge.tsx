import React from 'react';
import type { DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';

/**
 * Participant avatars — the shared way a chat renders WHO a participant is.
 *
 * A BuilderForce chat is multi-party (the BRAIN + invited agents/humans). Wherever
 * a participant appears — the "→ recipient" badge on a directed message, the
 * composer's recipient chip — it shows a compact colored avatar of their initials
 * so the roster reads at a glance. Presentational and dependency-free; the colored
 * disc reads in BOTH light and dark themes (fixed palette + white text), so it
 * needs no theme tokens.
 */

/** Up to two initials from a display name (e.g. "Bob Developer" → "BD"). */
export function initialsOf(name: string): string {
  const words = name.trim().replace(/[()[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// A small, WCAG-friendly palette; every colour carries white text at ≥4.5:1.
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#0891b2', '#059669', '#4f46e5'];

/** Deterministic colour for a name, so the same participant is always the same hue. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export interface AvatarProps {
  name: string;
  /** 'human' gets a round disc; 'agent' a rounded square, so the two read apart. */
  kind?: DirectedRecipient['kind'];
  /** Diameter in px (default 18). */
  size?: number;
  title?: string;
  style?: React.CSSProperties;
}

/** A single participant avatar: initials on a deterministic coloured disc/tile. */
export function Avatar({ name, kind = 'agent', size = 18, title, style }: AvatarProps) {
  return (
    <span
      aria-hidden
      title={title ?? name}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, flex: `0 0 ${size}px`,
        borderRadius: kind === 'human' ? '50%' : Math.round(size * 0.3),
        background: avatarColor(name), color: '#fff',
        fontSize: Math.max(8, Math.round(size * 0.44)), fontWeight: 700, lineHeight: 1,
        letterSpacing: '-0.02em', userSelect: 'none', ...style,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Avatar + name — the "→ recipient" badge shown on a directed message / composer chip. */
export function ParticipantBadge({ recipient, prefix, size = 16 }: { recipient: DirectedRecipient; prefix?: string; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, opacity: 0.95 }}>
      {prefix ? <span aria-hidden style={{ opacity: 0.7 }}>{prefix}</span> : null}
      <Avatar name={recipient.name} kind={recipient.kind} size={size} />
      <span>{recipient.name}</span>
    </span>
  );
}
