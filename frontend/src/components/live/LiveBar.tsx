'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useOptionalLiveSession, type LiveMember } from '@/lib/live/LiveSessionContext';
import styles from './LiveBar.module.css';

/**
 * The room, at shell level.
 *
 * It renders BELOW everything and outlives every navigation, which is the whole
 * point: the call is not a feature of the board, it is a feature of the session.
 * Self-gating — no room, no bar — so no consumer needs a `showLiveBar` prop.
 *
 * Colours come from shell theme tokens, not the board's palette. The stage
 * declares its own light and dark ([[canvas-owns-its-palette]]); the bar, rail
 * and dock are shell-themed. Both read the toggle; neither owns the other's
 * colours.
 */

function initials(member: LiveMember): string {
  const source = member.displayName?.trim() || '';
  if (!source) return '??';
  return source.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

/** One camera tile. A `<video>` needs its stream attached imperatively. */
function Tile({ stream, label, self, sharing }: { stream: MediaStream; label: string; self?: boolean; sharing?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return (
    <div className={`${styles.tile}${self ? ` ${styles.tileSelf}` : ''}`}>
      {/* Muted is not a preference here: playing your own microphone back is a
          feedback loop, and an unmuted remote tile is handled by the audio
          element the media room already owns. */}
      <video ref={ref} autoPlay playsInline muted={self} className={styles.tileVideo} />
      <span className={styles.tileLabel}>{sharing ? `🖥 ${label}` : label}</span>
    </div>
  );
}

export function LiveBar() {
  const live = useOptionalLiveSession();
  const t = useTranslations('liveBar');

  if (!live?.live || !live.room) return null;

  const following = live.members.filter((member) => !member.isSelf && member.userId === live.followingUserId).length;
  const onCall = live.members.filter((member) => member.onCall);
  const cameras = live.tiles.filter((tile) => tile.camOn || tile.sharing);

  return (
    <>
      {/* The filmstrip floats over whatever surface is on screen — the board, a
          docked page, settings. It is deliberately not inside the stage: a call
          that only shows faces on the canvas is the bug this design removes. */}
      {(live.camOn || cameras.length > 0) && (
        <div className={styles.film} aria-label={t('cameras')}>
          {live.localStream && live.camOn && <Tile stream={live.localStream} label={t('you')} self />}
          {cameras.map((tile) => (
            <Tile key={tile.peerId} stream={tile.stream} label={tile.name} sharing={tile.sharing} />
          ))}
        </div>
      )}

      <div className={styles.bar} role="region" aria-label={t('region')}>
        <span className={styles.pulse} aria-hidden="true" />
        <span className={styles.who}>
          {onCall.slice(0, 5).map((member) => (
            <span
              key={member.userId}
              className={`${styles.avatar}${member.isSelf ? ` ${styles.avatarSelf}` : ''}`}
              data-cam={member.camOn ? '1' : '0'}
              title={member.isSelf ? t('you') : member.displayName || t('member')}
            >
              {member.isSelf ? t('youShort') : initials(member)}
            </span>
          ))}
          {onCall.length > 5 && <span className={styles.more}>+{onCall.length - 5}</span>}
        </span>

        {live.room.href ? (
          <Link href={live.room.href} className={styles.anchor} title={live.room.scopeLabel}>
            {live.room.label}
          </Link>
        ) : (
          <span className={styles.anchor}>{live.room.label}</span>
        )}

        <button type="button" className={styles.ctl} data-on={live.micOn ? '1' : '0'} onClick={live.toggleMic} aria-pressed={live.micOn}>
          <span aria-hidden="true">🎤</span>{live.micOn ? t('mic') : t('micOff')}
        </button>
        <button type="button" className={styles.ctl} data-on={live.camOn ? '1' : '0'} onClick={live.toggleCam} aria-pressed={live.camOn}>
          <span aria-hidden="true">📷</span>{live.camOn ? t('camera') : t('cameraOff')}
        </button>
        {/* Self-gating on browser support: a control that can only ever fail is
            worse than an absent one. */}
        {live.canShare && (
          <button
            type="button"
            className={styles.ctl}
            data-on={live.sharing ? '1' : '0'}
            onClick={() => void live.toggleShare()}
            aria-pressed={live.sharing}
          >
            <span aria-hidden="true">🖥</span>{live.sharing ? t('stopPresenting') : t('presentScreen')}
          </button>
        )}
        {live.canRecord && (
          <button
            type="button"
            className={styles.ctl}
            data-on={live.recording ? '1' : '0'}
            onClick={live.toggleRecording}
            aria-pressed={live.recording}
            disabled={live.recordingSaving}
          >
            <span aria-hidden="true">●</span>{live.recording ? t('stopRecording') : live.recordingSaving ? t('savingRecording') : t('record')}
          </button>
        )}
        <button
          type="button"
          className={styles.ctl}
          data-on={live.presentMode ? '1' : '0'}
          onClick={() => live.setPresentMode(!live.presentMode)}
          aria-pressed={live.presentMode}
        >
          <span aria-hidden="true">▶</span>{live.presentMode ? t('exitPresentation') : t('present')}
        </button>

        <span className={styles.grow} />

        {following > 0 && <span className={styles.followPill}>{t('following', { count: following })}</span>}
        {live.shareError && <span className={styles.error} role="status">{t(`shareError.${live.shareError}`)}</span>}
        {live.mediaError && !live.shareError && <span className={styles.error} role="status">{t('mediaUnavailable')}</span>}
        {live.recordingError && <span className={styles.error} role="status">{t('recordingFailed')}</span>}
        {!live.connected && <span className={styles.error} role="status">{t('connecting')}</span>}

        <button type="button" className={`${styles.ctl} ${styles.leave}`} onClick={live.leave}>
          {t('leave')}
        </button>
      </div>
    </>
  );
}
