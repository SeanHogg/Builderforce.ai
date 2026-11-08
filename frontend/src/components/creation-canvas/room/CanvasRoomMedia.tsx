/*
 * No `'use client'` on purpose: mounted only by `CanvasRoomSurface`, which is reached
 * through `CreationCanvas` (already a client boundary).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { useCanvasLiveRoom } from '@/lib/live/useCanvasLiveRoom';
import { VideoGrid } from '@/components/video/VideoGrid';
import { CallConnectionNotice } from '@/components/live/CallConnectionNotice';
import styles from './CanvasRoomMedia.module.css';

/**
 * Voice and video IN the room.
 *
 * Not a second call stack: the room is the canvas, and the canvas already has ONE
 * call — the shell's live session (`useCanvasLiveRoom` decides the room key
 * `canvas:<sessionId>` and whether this visitor may open it; `useMediaRoom` carries the
 * WebRTC over the shared signaling relay + ICE endpoint, or the guest transport on a
 * shared free board). This panel is a second control + gallery over that same
 * session, so the dock and the room can never be on different calls.
 *
 * Joining is an explicit act, with audio or with video; nothing is requested from the browser until the visitor
 * presses Join. Self-gating: renders nothing where there is no live session provider
 * (the VS Code webview) or no room to open.
 */
export function CanvasRoomMedia() {
  const t = useTranslations('creationCanvas.surface.room.media');
  const tLive = useTranslations('liveBar');
  const session = useOptionalLiveSession();
  const room = useCanvasLiveRoom();
  const [focusedId, setFocusedId] = useState<string | null>(null);

  if (!session || !room) return null;
  // Controls for a call only when it IS this canvas's call: a meeting or another board's
  // call running in the shell must not be presented (or controlled) as this room's.
  if (!room.here) {
    if (!room.canStart) return null;
    return (
      <div className={`${styles.dock} ${styles.join}`} role="group" aria-label={t('region')}>
        <button type="button" className={styles.button} onClick={() => room.start({ audioOnly: true })}>{t('joinAudio')}</button>
        <button type="button" className={styles.button} onClick={() => room.start()}>{t('joinVideo')}</button>
      </div>
    );
  }

  const self = session.members.find((member) => member.isSelf);
  return (
    <div className={styles.dock} role="group" aria-label={t('region')}>
      {session.connected ? null : <span className={styles.notice}><CallConnectionNotice /></span>}
      {session.mediaError && <p className={styles.error} role="alert">{tLive('mediaUnavailable')}</p>}
      <div className={styles.grid}>
        <VideoGrid
          self={{ name: self?.displayName || tLive('you'), ref: 'self', stream: session.localStream, camOn: session.camOn, micOn: session.micOn }}
          tiles={session.tiles}
          compact
          focusedId={focusedId}
          onSelect={setFocusedId}
          captions={session.captions}
          speaking={session.speaking}
        />
      </div>
      <div className={styles.controls}>
        <button type="button" onClick={session.toggleMic} aria-pressed={session.micOn} className={session.micOn ? styles.button : `${styles.button} ${styles.off}`}>
          {session.micOn ? tLive('mic') : tLive('micOff')}
        </button>
        <button type="button" onClick={session.toggleCam} aria-pressed={session.camOn} className={session.camOn ? styles.button : `${styles.button} ${styles.off}`}>
          {session.camOn ? tLive('camera') : tLive('cameraOff')}
        </button>
        <button type="button" onClick={room.leave} className={`${styles.button} ${styles.leave}`}>{tLive('leave')}</button>
      </div>
    </div>
  );
}
