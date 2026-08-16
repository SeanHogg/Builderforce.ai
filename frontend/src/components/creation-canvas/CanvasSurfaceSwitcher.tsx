'use client';

import { useTranslations } from 'next-intl';
import {
  AppSurfaceIcon,
  ChatSurfaceIcon,
  GraphSurfaceIcon,
  ThreeDIcon,
} from '@/components/canvas/CanvasCommands';
import {
  boardCanvasSurfaces,
  DEFAULT_CANVAS_SURFACE,
  type CanvasSurfaceId,
} from '@/lib/canvasSurfaces';
import styles from './CreationCanvas.module.css';

/**
 * The ONE control that picks the canvas surface.
 *
 * The board used to carry a single 3D toggle, duplicated between the desktop command
 * rail and the phone-sized action stack. Adding a second runtime by adding a second
 * toggle beside it would have given one decision two controls that can disagree — press
 * "chat" while 3D is lit and neither button can say what you are looking at. So the
 * decision is a list of surfaces with exactly one pressed, rendered once here and placed
 * in both chromes.
 *
 * Pressing the surface you are already on returns you to the board. That is what keeps
 * the 3D command a TOGGLE — the behaviour the rail has always had — without the registry
 * needing to know that 3D is special.
 *
 * ── WHY THIS IS NO LONGER ON THE COMMAND RAIL ────────────────────────────────────
 * It used to render as three React Flow `ControlButton`s inside the zoom rail, which put
 * "change what this canvas IS" among zoom-in, fit-view, arrange, files and outline at the
 * same size, weight and colour, with nothing marking the three as a set and nothing
 * showing which was lit. The surface decision is not a navigation command — it is the
 * answer to "what am I looking at" — so on a desktop it belongs in the session header,
 * with WORDS. A glyph can say "zoom"; only a label can say "Chat".
 *
 * The phone keeps the compact stack: its header is already down to a title and a save
 * button by 860px, so the labelled segment has nowhere to go and the board's own control
 * column is where every other view command already lives. The two variants therefore
 * differ only in button chrome — which surfaces exist, what they are called, which one is
 * lit and what a press does are decided ONCE, above the split.
 */

/** Only the board-scoped surfaces reach the switcher, so only they need a glyph. */
const SURFACE_ICON: Record<string, () => React.JSX.Element> = {
  chat: ChatSurfaceIcon,
  graph: GraphSurfaceIcon,
  scene3d: ThreeDIcon,
  app: AppSurfaceIcon,
};

/**
 * The glyph, or nothing.
 *
 * This lookup used to be read straight into `<Glyph />`, which meant a board surface
 * added to the registry WITHOUT a matching entry above did not degrade — it threw, and
 * took the whole session bar with it. The registry's own "adding a surface" instructions
 * list three steps and this was a silent fourth, so the failure was reachable by
 * following the documentation. A surface with no glyph now draws its label alone on the
 * desktop and its first letter on a phone, which is legible, pressable and obviously
 * unfinished — the three things a crash is not.
 */
function surfaceGlyph(id: string, label: string): React.JSX.Element {
  const Glyph = SURFACE_ICON[id];
  return Glyph ? <Glyph /> : <span aria-hidden>{label.slice(0, 1)}</span>;
}

export interface CanvasSurfaceSwitcherProps {
  surface: CanvasSurfaceId;
  onChange: (surface: CanvasSurfaceId) => void;
  /** `header` = the desktop session bar; `mobile` = the phone-sized action stack. */
  variant: 'header' | 'mobile';
}

export function CanvasSurfaceSwitcher({ surface, onChange, variant }: CanvasSurfaceSwitcherProps) {
  const t = useTranslations('creationCanvas');
  // The contents are decided by the registry, not filtered here: an object-scoped surface
  // has no answer to "press this with nothing selected", so it is never offered.
  const ordered = boardCanvasSurfaces();

  const tabs = ordered.map((def) => {
    const pressed = surface === def.id;
    // A pressed surface hands the board back. Without it the lit command is inert, and
    // the only way out of 3D would be to know that "board" is where you came from.
    const press = () => onChange(pressed ? DEFAULT_CANVAS_SURFACE : def.id);
    // Stable accessible name — it names the surface, not the current state, so it does
    // not change under a screen reader when the mode flips.
    const label = t(`surface.${def.id}.label` as 'surface.chat.label');
    const title = pressed
      ? t(`surface.${def.id}.active` as 'surface.chat.active')
      : t(`surface.${def.id}.enter` as 'surface.chat.enter');

    if (variant === 'mobile') {
      return <button
        key={def.id}
        type="button"
        className={styles.surfaceSwitcherButton}
        onClick={press}
        aria-pressed={pressed}
        aria-label={label}
        title={title}
      >{surfaceGlyph(def.id, label)}</button>;
    }

    // The label is drawn, not just announced: `aria-label` still carries it so the
    // accessible name survives the narrow-viewport rule that hides the text.
    return <button
      key={def.id}
      type="button"
      className={styles.surfaceTab}
      onClick={press}
      aria-pressed={pressed}
      aria-label={label}
      title={title}
    >{surfaceGlyph(def.id, label)}<span>{label}</span></button>;
  });

  if (variant === 'mobile') return <>{tabs}</>;

  return <div className={styles.surfaceTabs} role="group" aria-label={t('surface.switcher')}>{tabs}</div>;
}
