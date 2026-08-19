'use client';

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { observeResizeOnAnimationFrame } from '@/lib/observeResize';
import { useOptionalLiveSession, type LiveMember } from '@/lib/live/LiveSessionContext';
import styles from './LiveBar.module.css';

/**
 * The room, at shell level — a DOCK, not an overlay.
 *
 * It renders BELOW everything and outlives every navigation, which is the whole
 * point: the call is not a feature of the board, it is a feature of the session.
 * Self-gating — no call, no dock — so no consumer needs a `showLiveBar` prop.
 *
 * ── WHY IT MEASURES ITSELF ───────────────────────────────────────────────────
 * This was a `position: fixed` bar at `bottom: 0` with `z-index: 60`, plus a
 * filmstrip floating above it at `bottom: 58px`, and it published NOTHING. Every
 * other piece of floating chrome in the canvas is measured and reserved through
 * `useChromeSpace` — the composer, the command bar, the top row — precisely so
 * that nothing is ever drawn over anything. The live bar was the one piece that
 * never joined that system, so going live printed the bar over the board's own
 * toolbar (32 of its 40 pixels) and dropped the self-view camera tile on top of
 * the Brain composer.
 *
 * So the dock publishes its real height as `--live-dock-space` on the document
 * root, and `.app-frame` subtracts that band from the shell (see `globals.css`).
 * The shell gets shorter; everything inside it — the canvas, its absolutely
 * positioned chrome, the Brain panel — reserves the band for free rather than
 * each learning the dock's height separately. One producer, one consumer.
 *
 * ── WHY THE FACES ARE INSIDE IT ──────────────────────────────────────────────
 * A second floating element is a second thing to collide with. The tiles are a
 * row in the dock, so there is exactly one live surface and its footprint is the
 * number the shell reserves.
 *
 * ── WHY THERE IS NO "START CALL" IN HERE ─────────────────────────────────────
 * There was: the dock had a dormant state — a start button and a line of
 * explanation — so that starting and operating a call happened in one place. It
 * bought that at a price the rest of the app does not pay: a measured band of
 * every window, on every canvas, for a call almost nobody was about to make, and
 * a control that lived somewhere no other canvas action does.
 *
 * Starting one is a session ACTION now (`lib/canvasSessionActions.ts`, id
 * `call`), which puts it in the same bar as undo, share and publish, on every
 * surface, in both auth states. This dock is the call's own chrome and exists
 * only while there IS a call — so nothing is reserved until something is
 * happening, and the withdrawal of the bar's call button (see its handler in
 * `CreationCanvas`) is what keeps exactly one control on screen at a time.
 *
 * Colours come from shell theme tokens, not the board's palette. The stage
 * declares its own light and dark ([[canvas-owns-its-palette]]); the dock is
 * shell-themed. Both read the toggle; neither owns the other's colours.
 */

function initials(member: LiveMember): string {
  const source = member.displayName?.trim() || '';
  if (!source) return '??';
  return source.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

/** One camera tile. A `<video>` needs its stream attached imperatively. */
function Tile({ stream, label, self, sharing, speaking }: {
  stream: MediaStream;
  label: string;
  self?: boolean;
  sharing?: boolean;
  speaking?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return (
    <div className={styles.tile} data-self={self ? '1' : '0'} data-speaking={speaking ? '1' : '0'}>
      {/* Muted is not a preference here: playing your own microphone back is a
          feedback loop, and an unmuted remote tile is handled by the audio
          element the media room already owns. */}
      <video ref={ref} autoPlay playsInline muted={self} className={styles.tileVideo} />
      <span className={styles.tileLabel} data-sharing={sharing ? '1' : '0'}>{label}</span>
    </div>
  );
}

/** A person on the call with no video to show — an initial, not an empty box. */
function AvatarTile({ label, micOn }: { label: string; micOn: boolean }) {
  return (
    <div className={styles.tile} data-avatar="1">
      <span className={styles.tileInitials}>{label}</span>
      {!micOn && <span className={styles.tileMuted} aria-hidden="true"><Icon source="🔇" size="1em" /></span>}
    </div>
  );
}

export function LiveBar() {
  const live = useOptionalLiveSession();
  const t = useTranslations('liveBar');
  const [collapsed, setCollapsed] = useState(false);
  const [dock, setDock] = useState<HTMLElement | null>(null);

  // The band this dock owns, published for the shell to subtract. Measured for
  // the same reason `useChromeSpace` measures: the dock's height is not one
  // number — it is the live dock, the collapsed pill, and a phone's two rows —
  // and every literal guess at it has been wrong. It is zero whenever there is no
  // call, because then there is no dock to measure.
  useEffect(() => {
    const root = document.documentElement;
    if (!dock) {
      root.style.setProperty('--live-dock-space', '0px');
      return () => root.style.removeProperty('--live-dock-space');
    }
    const publish = () => {
      root.style.setProperty('--live-dock-space', `${Math.round(dock.getBoundingClientRect().height)}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--live-dock-space');
    const stop = observeResizeOnAnimationFrame(dock, publish);
    return () => { stop(); root.style.removeProperty('--live-dock-space'); };
  }, [dock]);

  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);

  // No call: no dock, and the effect above publishes a zero band, so an idle session
  // reserves not one pixel of the window.
  if (!live?.live || !live.room) return null;

  const following = live.members.filter((member) => !member.isSelf && member.userId === live.followingUserId).length;
  const onCall = live.members.filter((member) => member.onCall);
  const cameras = live.tiles.filter((tile) => tile.camOn || tile.sharing);
  // Everyone on the call who is NOT publishing video still gets a tile, so the
  // roster and the filmstrip are one row rather than two counts that disagree.
  const silent = onCall.filter((member) => !member.isSelf && !cameras.some((tile) => tile.ref === member.userId));

  if (collapsed) {
    return (
      <div ref={setDock} className={styles.dock} data-state="collapsed" role="region" aria-label={t('region')}>
        <span className={styles.pulse} aria-hidden="true" />
        <span className={styles.count}>{t('onCall', { count: onCall.length })}</span>
        <button type="button" className={styles.fold} onClick={toggleCollapsed} aria-expanded={false}>
          <span aria-hidden="true"><Icon source="⌃" size="1em" /></span>
          <span className={styles.srOnly}>{t('expand')}</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={setDock} className={styles.dock} data-state="live" role="region" aria-label={t('region')}>
      <div className={styles.identity}>
        <span className={styles.identityLine}>
          <span className={styles.pulse} aria-hidden="true" />
          {live.room.href ? (
            <Link href={live.room.href} className={styles.anchor} title={live.room.scopeLabel}>
              {live.room.label}
            </Link>
          ) : (
            <span className={styles.anchor}>{live.room.label}</span>
          )}
        </span>
        <span className={styles.count}>{t('onCall', { count: onCall.length })}</span>
      </div>

      <span className={styles.rule} aria-hidden="true" />

      <div className={styles.film} aria-label={t('cameras')}>
        {live.localStream && live.camOn && <Tile stream={live.localStream} label={t('you')} self />}
        {!live.camOn && <AvatarTile label={t('youShort')} micOn={live.micOn} />}
        {cameras.map((tile) => (
          <Tile
            key={tile.peerId}
            stream={tile.stream}
            label={tile.name}
            sharing={tile.sharing}
            speaking={live.speaking.has(tile.ref)}
          />
        ))}
        {silent.map((member) => (
          <AvatarTile key={member.userId} label={initials(member)} micOn={member.micOn} />
        ))}
      </div>

      <span className={styles.grow} />

      {following > 0 && <span className={styles.leadPill}>{t('leading', { count: following })}</span>}
      {live.shareError && <span className={styles.error} role="status">{t(`shareError.${live.shareError}`)}</span>}
      {live.mediaError && !live.shareError && <span className={styles.error} role="status">{t('mediaUnavailable')}</span>}
      {live.recordingError && <span className={styles.error} role="status">{t('recordingFailed')}</span>}
      {!live.connected && <span className={styles.error} role="status">{t('connecting')}</span>}

      {/* Two troughs, the way the canvas command bar groups its clusters: the
          trough is what says "these belong together", which loose buttons in a
          row cannot say however carefully they are ordered. */}
      <span className={styles.trough}>
        <button type="button" className={styles.ctl} data-on={live.micOn ? '1' : '0'} onClick={live.toggleMic} aria-pressed={live.micOn}>
          <span aria-hidden="true"><Icon source="🎤" size="1em" /></span>{live.micOn ? t('mic') : t('micOff')}
        </button>
        <button type="button" className={styles.ctl} data-on={live.camOn ? '1' : '0'} onClick={live.toggleCam} aria-pressed={live.camOn}>
          <span aria-hidden="true"><Icon source="📷" size="1em" /></span>{live.camOn ? t('camera') : t('cameraOff')}
        </button>
      </span>

      <span className={styles.trough}>
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
            <span aria-hidden="true"><Icon source="🖥" size="1em" /></span>{live.sharing ? t('stopSharing') : t('shareScreen')}
          </button>
        )}
        <button
          type="button"
          className={styles.ctl}
          data-on={live.presentMode ? '1' : '0'}
          onClick={() => live.setPresentMode(!live.presentMode)}
          aria-pressed={live.presentMode}
        >
          <span aria-hidden="true"><Icon source="👁" size="1em" /></span>{live.presentMode ? t('stopLeading') : t('followMe')}
        </button>
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
      </span>

      <button type="button" className={`${styles.ctl} ${styles.leave}`} onClick={live.leave}>
        {t('leave')}
      </button>
      <button type="button" className={styles.fold} onClick={toggleCollapsed} aria-expanded>
        <span aria-hidden="true"><Icon source="⌄" size="1em" /></span>
        <span className={styles.srOnly}>{t('collapse')}</span>
      </button>
    </div>
  );
}
