import type { ReactNode } from 'react';
import { canvasChromeShows } from '@/lib/canvasChrome';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasPhase } from '@/lib/canvasPhases';
import { CanvasPhoneAppBar } from '../CanvasPhoneAppBar';
import { CanvasSurfaceStrip } from '../CanvasSurfaceStrip';
import { CanvasSessionPill } from '../CanvasSessionPill';
import { PhaseModalitySelector } from '../PhaseModalitySelector';
import type { CanvasSessionActionHandler } from '../CanvasSessionActions';
import type { useCanvasBrainSurface } from '../hooks/useCanvasBrainSurface';
import styles from '../CreationCanvas.module.css';

export interface CanvasTopChromeProps {
  phoneViewport: boolean;
  /** Publishes `--canvas-top-chrome-space` — handed to whichever of the two chromes is drawn. */
  topChromeRef: (node: HTMLElement | null) => void;
  title: string;
  phase: CanvasPhase;
  setPhase: (phase: CanvasPhase) => void;
  surface: CanvasSurfaceId;
  setSurface: (surface: CanvasSurfaceId) => void;
  collapsed: boolean;
  roster: ReturnType<typeof useCanvasBrainSurface>['rosterMembers'];
  /** The share action — the phone's roster chip opens it when it is offered. */
  share: CanvasSessionActionHandler;
  /** Handed to the phone app bar only on a phone — one host at a time for each sheet. */
  inviteMenu: ReactNode;
  boardMenu: ReactNode;
  onExitToLibrary?: () => void;
  notice: string;
}

/**
 * THE FLOATING CHROME's top line.
 *
 * No chrome band: the board takes the whole shell and each piece floats over it
 * in the region `lib/canvasChrome.ts` gives it — is the work safe (top left), how
 * it is READ and which phase it is in (top centre), and what you DO to it,
 * including how work LEAVES it (the one bar, bottom centre). A phone replaces the
 * top two with its own app bar; see below.
 */
export function CanvasTopChrome({ phoneViewport, topChromeRef, title, phase, setPhase, surface, setSurface, collapsed, roster, share, inviteMenu, boardMenu, onExitToLibrary, notice }: CanvasTopChromeProps) {
  return <>
      {/* THE PHONE'S APP CHROME — a 52px canvas app bar over a worded surface strip,
          drawn in place of the shell's header on a stage route (`AppShell`,
          `data-phone-chrome="stage"`). Stands down above 767px, where the floating cards
          below are the chrome instead. See `CanvasPhoneAppBar` for what is on it.

          The ref measures the bar AND the strip together — everything below has to clear
          both — and exactly one of this wrapper and the desktop card is ever handed it,
          because the other is `display:none` and a hidden box measures zero. */}
      <div
        ref={phoneViewport ? topChromeRef : undefined}
        className={styles.canvasPhoneChrome}
      >
        <CanvasPhoneAppBar
          title={title}
          phase={phase}
          onPhaseChange={setPhase}
          surface={surface}
          onSurfaceChange={setSurface}
          roster={roster}
          {...(share.available === false || share.disabled
            ? {}
            : { onOpenRoster: share.run })}
          // ONE host at a time for each sheet: handing them to both chromes and hiding
          // one would put two copies of each in the document.
          {...(phoneViewport ? { inviteMenu, boardMenu } : {})}
          {...(onExitToLibrary ? { onBack: onExitToLibrary } : {})}
        />
        <CanvasSurfaceStrip surface={surface} onChange={setSurface} />
      </div>
      <CanvasSessionPill notice={notice} />
      {/* Which PHASE this session is in and which surface reads it — ON the canvas
          rather than in a bar across it, fused into one widget (`PhaseModalitySelector`).
          THE DESKTOP'S copy: a phone gets the surface half as a worded strip under its
          own app bar, and the phase half inside a sheet that bar opens — the SAME
          component, so the two rows cannot drift apart. The stylesheet keeps exactly one
          of the two chromes on screen.

          Measured for `--canvas-top-chrome-space` at desktop widths, where this card is
          the taller of the two things on the top line; on a phone the app-bar wrapper
          above is measured instead, because this one is `display:none` there and a
          hidden box measures zero. */}
      {canvasChromeShows('surfaces', collapsed) && <div ref={phoneViewport ? undefined : topChromeRef} className={`${styles.floatCard} ${styles.surfaceChips}`}>
        <PhaseModalitySelector phase={phase} onPhaseChange={setPhase} surface={surface} onSurfaceChange={setSurface} />
      </div>}
  </>;
}
