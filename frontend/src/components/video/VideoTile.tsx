'use client';

import { useEffect, useRef } from 'react';

/** Deterministic accent from a name (theme-token hues, readable in both themes). */
const HUES = ['var(--coral-bright)', 'var(--cyan-bright)', 'var(--violet-bright, #a78bfa)', 'var(--amber-bright, #fbbf24)', 'var(--emerald-bright, #34d399)'];
function accentFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * A single participant video/audio tile. Shows the live camera when on, else an
 * avatar disc. Self-tile is muted (no echo) and mirrored. A mic-off badge shows
 * when the participant is muted.
 *
 * Extras (meeting room): a live `caption` subtitle (browser speech-to-text or an
 * agent's spoken line), a `speaking` accent ring, a corner `badge` (e.g. AGENT),
 * and click-to-`onSelect` to spotlight/expand a tile. Agent tiles have no
 * MediaStream (agents have no browser) — they render as an avatar + caption.
 */
export function VideoTile({
  name, stream, camOn, micOn, isSelf = false, labelYou,
  caption, speaking = false, badge, expanded = false, selected = false, onSelect, expandLabel,
}: {
  name: string;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  isSelf?: boolean;
  /** Localized "You" label for the self tile. */
  labelYou?: string;
  /** Live caption / subtitle line (speech-to-text or an agent's spoken text). */
  caption?: string | null;
  /** Draw an accent ring while this participant is talking. */
  speaking?: boolean;
  /** Small corner pill (e.g. an "AGENT" tag). */
  badge?: string | null;
  /** Rendered as the large spotlight tile (bigger avatar, 16:9). */
  expanded?: boolean;
  /** This tile is the current spotlight. */
  selected?: boolean;
  /** Click handler → spotlight/unspotlight this tile. Makes the tile a button. */
  onSelect?: () => void;
  /** Localized aria-label/title for the expand affordance. */
  expandLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const accent = accentFor(name);
  const showVideo = camOn && !!stream && stream.getVideoTracks().some((t) => t.enabled);
  const avatarSize = expanded ? 96 : 56;

  const selectable = !!onSelect;

  return (
    <div
      {...(selectable ? {
        role: 'button', tabIndex: 0, 'aria-pressed': selected, title: expandLabel,
        onClick: onSelect,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect!(); } },
      } : {})}
      style={{
        position: 'relative',
        aspectRatio: expanded ? '16 / 9' : '4 / 3',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--bg-deep)',
        border: `1px solid ${speaking ? accent : 'var(--border-subtle)'}`,
        boxShadow: speaking ? `0 0 0 2px ${accent}` : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 0,
        cursor: selectable ? 'pointer' : undefined,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: isSelf ? 'scaleX(-1)' : undefined,
          display: showVideo ? 'block' : 'none',
        }}
      />
      {!showVideo && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: avatarSize, height: avatarSize, borderRadius: '50%',
              background: accent, color: 'var(--bg-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: expanded ? 34 : 20,
            }}
          >
            {initials(name)}
          </div>
        </div>
      )}

      {/* Agent (or role) badge — top-left */}
      {badge && (
        <span
          style={{
            position: 'absolute', left: 8, top: 8,
            fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
            color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '2px 7px', borderRadius: 6,
            pointerEvents: 'none',
          }}
        >
          {badge}
        </span>
      )}

      {/* Expand hint — top-right, only when the tile is selectable */}
      {selectable && (
        <span
          aria-hidden
          style={{
            position: 'absolute', right: 8, top: 8,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#fff',
            pointerEvents: 'none',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {selected
              ? <><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="M14 10l7-7" /><path d="M3 21l7-7" /></>
              : <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></>}
          </svg>
        </span>
      )}

      {/* Live caption / subtitle — sits above the name bar */}
      {caption && (
        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 34, pointerEvents: 'none' }}>
          <span
            style={{
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              fontSize: expanded ? 15 : 12, lineHeight: 1.35, color: '#fff',
              background: 'rgba(0,0,0,0.62)', padding: '4px 8px', borderRadius: 8,
            }}
          >
            {caption}
          </span>
        </div>
      )}

      {/* Name + mute badge */}
      <div
        style={{
          position: 'absolute', left: 8, bottom: 8, right: 8,
          display: 'flex', alignItems: 'center', gap: 6,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontSize: 12, fontWeight: 600, color: '#fff',
            background: 'rgba(0,0,0,0.55)', padding: '2px 8px', borderRadius: 6,
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {isSelf ? (labelYou ?? name) : name}
        </span>
        {!micOn && (
          <span
            aria-hidden
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: '50%', background: 'var(--error-bg, #7f1d1d)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
