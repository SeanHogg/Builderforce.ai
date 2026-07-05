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
 * when the participant is muted; a speaking cue is left to the grid.
 */
export function VideoTile({
  name, stream, camOn, micOn, isSelf = false, labelYou,
}: {
  name: string;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  isSelf?: boolean;
  /** Localized "You" label for the self tile. */
  labelYou?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const accent = accentFor(name);
  const showVideo = camOn && !!stream && stream.getVideoTracks().some((t) => t.enabled);

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '4 / 3',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 0,
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
              width: 56, height: 56, borderRadius: '50%',
              background: accent, color: 'var(--bg-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 20,
            }}
          >
            {initials(name)}
          </div>
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
