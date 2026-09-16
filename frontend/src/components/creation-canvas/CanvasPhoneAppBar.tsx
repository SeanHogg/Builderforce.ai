// No 'use client' directive: rendered only by `CreationCanvas`, which already declares
// the boundary — the same reason `CanvasSessionActions` and `PhaseModalitySelector`
// each state at the top of themselves.
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasMenuSheet } from './CanvasMenuSheet';
import { PhaseModalitySelector } from './PhaseModalitySelector';
import { memberAvatarClass, memberInitials } from './rosterAvatar';
import styles from './CreationCanvas.module.css';

/**
 * `/create/<id>` ON A PHONE IS AN APP SCREEN, and this is its app bar.
 *
 * ── THE DEFECT IT CLOSES ─────────────────────────────────────────────────────────
 * A phone opening a canvas got the MARKETING HEADER — a brand lockup, a theme
 * toggle, Sign in and a green "Keep your work" — 56px of the top of the screen
 * belonging to the website rather than to the board, above a canvas that then had
 * nothing of its own up there at all. The session's name, its phase, who was in it
 * and the way back to the library were each either absent or floating over the work.
 * Below all that sat the persistent `MobileBottomNav`, so a 640px-tall viewport spent
 * ~110px on chrome that said nothing about this canvas.
 *
 * The shell now stands its header down on a stage route (`AppShell`,
 * `data-phone-chrome="stage"`) and the canvas draws this instead: 52px, and every
 * pixel about THIS session. The bottom nav stays exactly where it was — leaving is
 * always one tap, which is the whole reason it is not replaced by a back button.
 *
 * ── WHAT IS ON IT AND WHY ────────────────────────────────────────────────────────
 * BACK is the way to the canvas LIBRARY, and it is absent when the host has not given
 * one: inside the VS Code webview there is no `/create` to go back to, and a button
 * that navigates nowhere is worse than no button.
 *
 * TITLE + STAGE is one control, not two. The stage is the session's own phase, drawn
 * in the arc's hue and named with the arc's word (`nav.stage.*` — the rail's copy, not
 * a second translation of it), and pressing the pair opens the phase stepper in a
 * sheet. The desktop draws that stepper as a floating card at the top of the board;
 * a phone has nowhere to float it, and a stage you can read but not change is a label.
 *
 * ROSTER is who is here, capped at two faces plus a count. It was drawn over the
 * composer on a phone — avatars floating on top of the box you type in — because the
 * command bar it belongs to has no room at that width. Here it is beside the name of
 * the thing those people are in.
 *
 * ••• is the board's own errands, and it is the ONE host of that sheet at this width:
 * the command bar is not drawn on a phone, so the host hands `boardMenu` here instead
 * of there. Two hosts, one body, never both mounted (`usePhoneViewport`).
 */
export interface CanvasPhoneAppBarFace {
  userId: string;
  displayName: string | null;
}

export interface CanvasPhoneAppBarProps {
  /** The session's name — the same string the desktop chrome and the library use. */
  title: string;
  /** Which phase of the session's own methodology this is. */
  phase: CanvasPhase;
  onPhaseChange: (phase: CanvasPhase) => void;
  /** The surface being read, so the phase sheet's own tabs agree with the strip. */
  surface: CanvasSurfaceId;
  onSurfaceChange: (surface: CanvasSurfaceId) => void;
  /** Who is in this session right now. Two faces are drawn; the rest become "+N". */
  roster: readonly CanvasPhoneAppBarFace[];
  /** Open the invite sheet. Absent while the session cannot be shared. */
  onOpenRoster?: () => void;
  /** The invite sheet itself, anchored against the chip that opens it. */
  inviteMenu?: ReactNode;
  /** The ••• trigger and its sheet. See the header for why it moves here on a phone. */
  boardMenu?: ReactNode;
  /** Back to the canvas library. Absent in an embedding host that has no library. */
  onBack?: () => void;
  /** Publishes `--canvas-top-chrome-space`; the band everything below must clear. */
  hostRef?: (node: HTMLElement | null) => void;
}

/** Faces drawn before the count takes over. Two is what fits beside a name at 320px. */
const VISIBLE_FACES = 2;

export function CanvasPhoneAppBar({
  title,
  phase,
  onPhaseChange,
  surface,
  onSurfaceChange,
  roster,
  onOpenRoster,
  inviteMenu,
  boardMenu,
  onBack,
  hostRef,
}: CanvasPhoneAppBarProps) {
  const t = useTranslations('creationCanvas');
  const tn = useTranslations('nav');
  const [phaseOpen, setPhaseOpen] = useState(false);
  const faces = roster.slice(0, VISIBLE_FACES);
  const overflow = Math.max(0, roster.length - faces.length);

  return (
    <div ref={hostRef} className={styles.canvasAppBar} data-testid="canvas-app-bar">
      {onBack && <button
        type="button"
        className={styles.canvasAppBarButton}
        data-testid="canvas-app-bar-back"
        aria-label={t('backToLibrary')}
        title={t('backToLibrary')}
        onClick={onBack}
      ><span aria-hidden>‹</span></button>}

      {/* ONE control for the name and the stage — see the header for why they are not
          two. It reports the sheet it owns, so nothing else has to explain where the
          stepper came from. */}
      <button
        type="button"
        className={styles.canvasAppBarTitle}
        data-testid="canvas-app-bar-stage"
        aria-haspopup="dialog"
        aria-expanded={phaseOpen}
        onClick={() => setPhaseOpen((open) => !open)}
      >
        <strong>{title}</strong>
        <span className={styles.canvasAppBarStage} data-stage={phase}>
          <i aria-hidden />
          {tn(`stage.${phase}` as 'stage.idea')}
        </span>
      </button>

      {!!roster.length && <span className={styles.canvasAppBarRoster}>
        <button
          type="button"
          className={styles.canvasAppBarFaces}
          data-testid="canvas-app-bar-roster"
          aria-label={t('rosterChip', { count: roster.length })}
          title={t('rosterChip', { count: roster.length })}
          disabled={!onOpenRoster}
          onClick={() => onOpenRoster?.()}
        >
          {faces.map((member, index) => <i
            key={member.userId}
            aria-hidden
            className={memberAvatarClass(index, { pink: styles.avatarPink, orange: styles.avatarOrange, green: styles.avatarGreen })}
          >{memberInitials(member.displayName)}</i>)}
          {overflow > 0 && <b aria-hidden>{`+${overflow}`}</b>}
        </button>
        {inviteMenu}
      </span>}

      {boardMenu}

      {/* The phase stepper, in a sheet, because a phone has nowhere to float the card
          the desktop uses. `PhaseModalitySelector` is rendered whole rather than
          re-cut: the surface row inside it is the same decision the strip below makes,
          and two components for one widget is how the two rows drift apart. */}
      {phaseOpen && <CanvasMenuSheet
        title={t('sessionStage')}
        testId="canvas-stage-sheet"
        // Always a sheet: this bar only exists at phone width, so there is no popover
        // form of it to fall back to.
        placement="sheet"
        onClose={() => setPhaseOpen(false)}
      >
        <PhaseModalitySelector
          phase={phase}
          onPhaseChange={(next) => { onPhaseChange(next); setPhaseOpen(false); }}
          surface={surface}
          onSurfaceChange={(next) => { onSurfaceChange(next); setPhaseOpen(false); }}
        />
      </CanvasMenuSheet>}
    </div>
  );
}
