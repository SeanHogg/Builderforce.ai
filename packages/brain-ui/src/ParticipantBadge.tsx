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

/**
 * The "→ recipients" badge on a directed user turn: who it was put to. One recipient
 * reads "→ [avatar] Name"; a group turn stacks up to `max` avatars and names them,
 * with "+N" for the rest (the full list is in the tooltip). Renders nothing for a
 * BRAIN turn.
 */
export function RecipientsBadge({ recipients, max = 3, size = 15 }: { recipients: readonly DirectedRecipient[]; max?: number; size?: number }) {
  if (recipients.length === 0) return null;
  const shown = recipients.slice(0, max);
  const extra = recipients.length - shown.length;
  const overlap = Math.round(size * 0.3);
  return (
    <span title={recipients.map((r) => r.name).join(', ')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, opacity: 0.9 }}>
      <span aria-hidden style={{ opacity: 0.6 }}>→</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}>
        {shown.map((r, i) => (
          <Avatar
            key={`${r.kind}:${r.ref}`}
            name={r.name}
            kind={r.kind}
            size={size}
            // Overlapped avatars get a ring in the transcript surface's colour so each
            // disc stays distinct against its neighbour, in either theme.
            style={i > 0 ? { marginLeft: -overlap, boxShadow: '0 0 0 1.5px var(--bf-surface, #1b1b1b)' } : undefined}
          />
        ))}
      </span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shown.map((r) => r.name).join(', ')}{extra > 0 ? ` +${extra}` : ''}
      </span>
    </span>
  );
}
