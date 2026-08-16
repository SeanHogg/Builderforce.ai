'use client';

import { ControlButton, Controls, MiniMap, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import { useCallback, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useCanvas3DControls } from './canvas3dControls';
import { canvasNodeFootprint, graphLayerRanks } from './canvasGraph';
import styles from './CanvasCommands.module.css';

/*
 * The canvas icon set.
 *
 * Every canvas surface — the desktop command rail, the phone action rail, the
 * session bar — draws from THIS set, on one 16×16 grid with one stroke weight.
 * The phone rail used to spell its commands with Unicode glyphs (⌗ ⌘ ◱ ⤓), which
 * a phone font renders at whatever size and weight it likes (and often not at
 * all), so the two real icons next to them looked like a different toolbar.
 */
export function MinimapIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2 10.5 5.5 7l2.3 2.2L11 5.7l3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>;
}

export function CleanLayoutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.75" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="1.75" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.3 1.3" />
  </svg>;
}

export function ThreeDIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.4 14 4.6v6.8L8 14.6 2 11.4V4.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2 4.6 8 7.9l6-3.3M8 7.9v6.7" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** The conversation surface: a speech bubble. Drawn on the same 16×16 grid as every
 *  other rail command so the surface switcher reads as one control, not three fonts. */
export function ChatSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4.1a1.6 1.6 0 0 1 1.6-1.6h8.8A1.6 1.6 0 0 1 14 4.1v5.3a1.6 1.6 0 0 1-1.6 1.6H6.6L3.4 13.6v-2.6a1.6 1.6 0 0 1-1.4-1.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M5.2 6.1h5.6M5.2 8.4h3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>;
}

/** The flat board: two connected nodes. The counterpart to `ThreeDIcon` — same objects,
 *  read on a plane instead of in a space. */
export function GraphSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2" width="5.4" height="4" rx=".9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="9.1" y="10" width="5.4" height="4" rx=".9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M6.9 4h3.4a1.5 1.5 0 0 1 1.5 1.5V10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** The app surface: a window with a play mark in it. Deliberately NOT a bare triangle —
 *  a play glyph beside "Board" and "3D space" reads as "start something", and this tab
 *  answers the same question they do: what am I looking at. The frame is the answer. */
export function AppSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M1.6 5.6h12.8" stroke="currentColor" strokeWidth="1.1" />
    <path d="M6.6 7.9v3.2l2.9-1.6z" fill="currentColor" />
  </svg>;
}

export function DepthIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.6 14.4 5 8 8.4 1.6 5z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2.4 8.2 8 11.1l5.6-2.9M2.4 11.4 8 14.3l5.6-2.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** Marquee-select: a dashed selection box with a pointer at its corner — the gesture the
 *  toggle hands the primary drag to, drawn as the gesture rather than as a cursor. */
export function MarqueeSelectIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="1.6" width="9.6" height="9.6" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" />
    <path d="M8.4 7.6 14.4 10l-2.5.9-.9 2.5z" fill="currentColor" stroke="currentColor" strokeWidth=".9" strokeLinejoin="round" />
  </svg>;
}

export function LayerGuidesIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.7 14.2 5 8 8.3 1.8 5z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2.4 8.6 8 11.6l5.6-3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.6 1.4" strokeLinejoin="round" />
  </svg>;
}

export function DropToLayersIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.6v6.2m0 0L5.7 5.6M8 7.8l2.3-2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 9.6 14.2 12.6 8 15.6 1.8 12.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>;
}

export function ZoomInIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

export function ZoomOutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

export function ResetViewIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Frame the whole board — the phone rail's counterpart to React Flow's fit-view. */
export function FitViewIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 5.6V2.6h3M11 2.6h3v3M14 10.4v3h-3M5 13.4H2v-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="5.9" y="6.1" width="4.2" height="3.8" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.15" />
  </svg>;
}

/** Take the canvas full screen. */
export function FullscreenIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.2 6V2.2h3.8M10 2.2h3.8V6M13.8 10v3.8H10M6 13.8H2.2V10" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Leave full screen — the same corners, folded inwards. */
export function ExitFullscreenIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.2 2.4v3.8H2.4M9.8 2.4v3.8h3.8M13.6 9.8H9.8v3.8M6.2 13.6V9.8H2.4" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The stacked-sheets glyph for a canvas that publishes a file library. */
export function CanvasFilesIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.4 2.2h4l2.4 2.4v7a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1v-8.4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M9.2 2.4v2.4h2.4M6.4 8.2h3.2M6.4 10.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Connected cloud storage — a cloud over a folder, so it reads as "files that
 * are not on this machine" rather than as the session's own file library. */
export function CanvasDriveIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.4 12.4V5.1a.9.9 0 0 1 .9-.9h2.9l1.2 1.4h4.3a.9.9 0 0 1 .9.9v5.9a.9.9 0 0 1-.9.9H3.3a.9.9 0 0 1-.9-.9Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M6.5 10.6a1.5 1.5 0 0 1 .3-2.97 2.1 2.1 0 0 1 4 .55 1.3 1.3 0 0 1-.3 2.42Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** An imported whiteboard: a board with sticky notes on it, and an arrow bringing
 *  one across. Deliberately NOT a Miro logo — the glyph names what the panel does
 *  (bring a board over) rather than borrowing another company's mark. */
export function CanvasMiroIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.8" y="2.6" width="7.4" height="10.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M3.9 5.2h3.2M3.9 7.6h3.2M3.9 10h1.8" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M11 8h3.3m-1.5-1.6L14.4 8l-1.6 1.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Connected social accounts: a share node — one source, several destinations,
 *  which is exactly what the panel behind it does. */
export function CanvasSocialIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="11.6" cy="3.6" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="4.2" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="11.6" cy="12.4" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6 7 9.9 4.7M6 9l3.9 2.3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>;
}

/** Paid media: rising delivery plus the money that bought it. Deliberately unlike
 *  {@link CanvasSocialIcon}'s share graph — the two sit next to each other on the rail
 *  and "post something" and "spend something" must not look like the same button. */
export function CanvasAdsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 13.5h12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <rect x="3" y="9" width="2.6" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="6.7" y="6.5" width="2.6" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="10.4" y="3.5" width="2.6" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

/* ── Session-bar commands ─────────────────────────────────────────────────────────
   The session bar used to spell these six with Unicode (`↶ ↷ ↗ ⚠ ••• ▾`), which is the
   same mistake the phone rail made and worse in two places: `↗` is the universal
   "opens somewhere else" arrow and was standing in for a SCORECARD, and `⚠` drew a
   standing warning triangle for a diagnostics report that is usually clean. Both said
   something untrue about the button under them, at whatever weight the OS font chose.
   Drawn here on the same grid as the rest of the set. */

/** Step back through the canvas's own history. */
export function UndoIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.1 6.4h6.3a3.6 3.6 0 0 1 0 7.2H6.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.8 3.5 2.9 6.4l2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The same arc, mirrored — so the pair reads as one control with two directions. */
export function RedoIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M12.9 6.4H6.6a3.6 3.6 0 0 0 0 7.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.2 3.5l2.9 2.9-2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The outcome scorecard: measured bars with the trend drawn over them. It names a
 *  READING of this session, which is why it is not an arrow leaving the page. */
export function OutcomeMetricsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 13.6h12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M4.1 13.6v-3.4M8 13.6V7.4M11.9 13.6V9.1" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    <path d="M3.4 6.6 7.2 3.4l2.4 2 3.1-2.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.7 1.4" />
  </svg>;
}

/** Diagnostics: a trace being read, not an alarm being raised. The report is usually
 *  clean, and a permanent warning triangle for a clean report is an alarm nobody reads. */
export function DiagnosticsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M3.4 8.6h2.2l1.3-2.9 1.6 5 1.1-2.1h2.9" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Everything else this session can do. */
export function MoreActionsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.4" cy="8" r="1.25" fill="currentColor" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    <circle cx="12.6" cy="8" r="1.25" fill="currentColor" />
  </svg>;
}

/** Bring somebody in: a person with a plus. Deliberately NOT the share-node graph
 *  {@link CanvasSocialIcon} draws — that one publishes to accounts, this one invites
 *  a human onto this board, and the two must not look like the same button. */
export function ShareCanvasIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="6.2" cy="5.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M1.8 13.8a4.4 4.4 0 0 1 8.8 0" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M12.6 5.4v4.2M14.7 7.5h-4.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** Send it out: a box with something leaving the top of it. Distinct from
 *  {@link ShareCanvasIcon}, which brings a person IN to this board — this one puts the
 *  work somewhere strangers can reach, and the two are opposite directions on purpose. */
export function PublishCanvasIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.4 9.9v2.7a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4V9.9" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M8 10.6V2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M5.1 5.1 8 2.2l2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Fold the session bar down to what the canvas IS DOING. A chevron INTO the row it
 *  collapses, so the direction says where the controls go rather than merely that
 *  something happens. Its opposite is {@link ExpandBarIcon}. */
export function CollapseBarIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.8 4.2 6 8l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 3.4v9.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** Bring the folded controls back. */
export function ExpandBarIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.2 4.2 10 8l-3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 3.4v9.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** The menu-opens marker on a worded button. Replaces the `▾` character, which the
 *  session bar drew at a different size and colour to everything beside it. */
export function DisclosureIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.4 6.3 3.6 3.6 3.6-3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Open the object palette. The board's create action, and now the first command on the
 *  phone's single board rail rather than a `+` character floating on its own.
 *
 *  The plus is INSIDE a card, and that is the whole point: on the rail this button sits
 *  directly above zoom-in, which is a bare plus. Two identical strokes stacked on one
 *  toolbar is a toolbar with one command drawn twice, so this one says what it adds. */
export function AddObjectIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 5.6v5.2M5.4 8.2h5.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>;
}

/** Put the palette away — the same rail slot, folded back. */
export function ClosePaletteIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.8 3.9 5.7 8l4.1 4.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The universal-access glyph used by every canvas that publishes a text outline. */
export function AccessibleOutlineIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="3.9" r="1.15" fill="currentColor" />
    <path d="M4.6 6.1 8 6.9l3.4-.8M8 6.9v3.1l-1.5 3M8 10h1.4l1.5 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/**
 * A rail command that is ON or OFF, lit while it is on.
 *
 * Every mode on the rail — 3D, the mini map, the accessible outline — needs the
 * same two things: `aria-pressed` for assistive tech, and a visible lit state so
 * a sighted user can tell at a glance which view they are in. Both live here so
 * a new mode cannot ship with one and not the other.
 */
export function CanvasRailToggle({ pressed, onClick, label, activeTitle, inactiveTitle, children }: {
  pressed: boolean;
  onClick: () => void;
  /** Stable accessible name — it must not change when the mode flips. */
  label: string;
  /** Tooltip while the mode is on, and while it is off. Both fall back to `label`. */
  activeTitle?: string;
  inactiveTitle?: string;
  children: ReactNode;
}) {
  return <ControlButton
    className={styles.railToggle}
    onClick={onClick}
    aria-label={label}
    aria-pressed={pressed}
    title={(pressed ? activeTitle : inactiveTitle) ?? label}
  >{children}</ControlButton>;
}

type CanvasCommandsProps = {
  minimapOpen: boolean;
  setMinimapOpen: Dispatch<SetStateAction<boolean>>;
  onCleanLayout: () => void;
  showInteractive?: boolean;
  minimapNodeColor?: string | ((node: Node) => string);
  minimapMaskColor?: string;
  minimapStyle?: CSSProperties;
  /**
   * Extra `<ControlButton>`s appended to the rail (e.g. the accessible outline).
   * Canvas-specific commands belong on the SAME rail as zoom/fit rather than
   * floating separately, so there is one place to look for a canvas control.
   */
  extraControls?: ReactNode;
  /**
   * Supplied by canvases that can render themselves in 3D. The control appears
   * only when a canvas can actually honour it, so the rail never offers a view
   * that does not exist — the component decides its own visibility rather than
   * every caller repeating the same condition.
   */
  onToggleThreeD?: () => void;
  threeDActive?: boolean;
};

/**
 * The common command rail and dismissible mini map used by every spatial canvas.
 *
 * The mini map is a map OF the flat board, so it — and the button that opens it —
 * stand down while a canvas is being read in 3D: the scene is the map at that
 * point, and a stale top-down thumbnail would describe a view nobody is looking
 * at. For the same reason the flat zoom, fit and lock commands hand over to the
 * scene's own depth, zoom and reset while 3D is on. This is the ONLY command bar
 * a canvas has in either view, so a mode never has to grow a toolbar of its own.
 *
 * Both are pinned to the bottom corners of the board, so a canvas that lets a
 * full-height panel claim an edge (the Brain dock) must say so by setting
 * `--canvas-reserved-left` / `--canvas-reserved-right` to that panel's width —
 * see `.boardChrome` in the stylesheet. Without it the rail is painted over and
 * the board loses every control it has.
 */
export function CanvasCommands({
  minimapOpen,
  setMinimapOpen,
  onCleanLayout,
  showInteractive = true,
  minimapNodeColor,
  minimapMaskColor,
  minimapStyle,
  extraControls,
  onToggleThreeD,
  threeDActive = false,
}: CanvasCommandsProps) {
  const t = useTranslations('canvasCommands');
  // Published by the scene while it is on screen; null in the flat view.
  const threeD = useCanvas3DControls();
  return <>
    <Controls
      position="bottom-left"
      className={styles.boardChrome}
      showZoom={!threeDActive}
      showFitView={!threeDActive}
      showInteractive={showInteractive && !threeDActive}
    >
      <ControlButton onClick={onCleanLayout} aria-label={t('cleanLayout')} title={t('cleanLayout')}>
        <CleanLayoutIcon />
      </ControlButton>
      {onToggleThreeD && <CanvasRailToggle
        pressed={threeDActive}
        onClick={onToggleThreeD}
        label={t('threeD.toggle')}
        activeTitle={t('threeD.exit')}
        inactiveTitle={t('threeD.enter')}
      >
        <ThreeDIcon />
      </CanvasRailToggle>}
      {threeDActive && threeD && <>
        <CanvasRailToggle
          pressed={threeD.depthMode !== 'flow'}
          onClick={threeD.toggleDepth}
          label={t('threeD.depthGroup')}
          activeTitle={t('threeD.depthGroupActive')}
          inactiveTitle={t('threeD.depthGroupInactive')}
        >
          <DepthIcon />
        </CanvasRailToggle>
        <CanvasRailToggle
          pressed={threeD.layersVisible}
          onClick={threeD.toggleLayers}
          label={t('threeD.layerGuides')}
          activeTitle={t('threeD.layerGuidesActive')}
          inactiveTitle={t('threeD.layerGuidesInactive')}
        >
          <LayerGuidesIcon />
        </CanvasRailToggle>
        {threeD.dropToLayers && <ControlButton onClick={threeD.dropToLayers} aria-label={t('threeD.dropToLayers')} title={t('threeD.dropToLayers')}>
          <DropToLayersIcon />
        </ControlButton>}
        <ControlButton onClick={threeD.zoomIn} aria-label={t('threeD.zoomIn')} title={t('threeD.zoomIn')}>
          <ZoomInIcon />
        </ControlButton>
        <ControlButton onClick={threeD.zoomOut} aria-label={t('threeD.zoomOut')} title={t('threeD.zoomOut')}>
          <ZoomOutIcon />
        </ControlButton>
        <ControlButton onClick={threeD.resetView} aria-label={t('threeD.reset')} title={t('threeD.reset')}>
          <ResetViewIcon />
        </ControlButton>
      </>}
      {!threeDActive && <CanvasRailToggle
        pressed={minimapOpen}
        onClick={() => setMinimapOpen((open) => !open)}
        label={t('toggleMiniMap')}
        activeTitle={t('hideMiniMap')}
        inactiveTitle={t('showMiniMap')}
      >
        <MinimapIcon />
      </CanvasRailToggle>}
      {extraControls}
    </Controls>
    {minimapOpen && !threeDActive && <>
      <MiniMap
        position="bottom-right"
        className={styles.boardChrome}
        pannable
        zoomable
        nodeColor={minimapNodeColor}
        maskColor={minimapMaskColor}
        style={minimapStyle}
      />
      <button type="button" className={styles.minimapClose} onClick={() => setMinimapOpen(false)} aria-label={t('closeMiniMap')} title={t('closeMiniMap')}>×</button>
    </>}
  </>;
}

/**
 * Which way a board's dependency layers run: across a wide board, DOWN a tall
 * one. A phone is the tall one — a layered graph laid out left-to-right there is
 * several screens wide before the first fit, which is what made "arrange" hand
 * back a board you then had to go looking for.
 */
export type CanvasLayoutOrientation = 'horizontal' | 'vertical';

/** The orientation a board of this shape should be arranged for. */
export function canvasLayoutOrientation(width: number, height: number): CanvasLayoutOrientation {
  // Only a decisively tall board turns the graph; a near-square one keeps the
  // left-to-right reading order that matches the arrows drawn between nodes.
  return width > 0 && height > width * 1.15 ? 'vertical' : 'horizontal';
}

/**
 * Deterministically spaces nodes into graph layers, or a compact grid when there
 * are no connections. Shares its layering with the 3D view (see `canvasGraph`),
 * so arranging the board and tilting it tell the same story about dependencies.
 *
 * `orientation` is the axis the LAYERS advance on; nodes within a layer always
 * spread along the other one. Callers get it from `canvasLayoutOrientation` (or
 * from `useCanvasCleanLayout`, which measures the board for them).
 */
export function cleanCanvasLayout<T extends Node>(nodes: T[], edges: Edge[], orientation: CanvasLayoutOrientation = 'horizontal'): T[] {
  if (nodes.length < 2) return nodes;
  const horizontalGap = 88;
  const verticalGap = 64;
  const vertical = orientation === 'vertical';
  const { ranks, connected } = graphLayerRanks(nodes, edges);

  if (!connected) {
    // A square-ish grid on a wide board; a narrow one on a tall board, so the
    // block of unconnected objects runs down the screen rather than off it.
    const square = Math.sqrt(nodes.length);
    const columns = Math.max(1, vertical ? Math.round(square / 1.6) : Math.ceil(square));
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights: number[] = [];
    nodes.forEach((node, index) => {
      const size = canvasNodeFootprint(node);
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnWidths[column] = Math.max(columnWidths[column], size.width);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height);
    });
    const xs = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, width) => sum + width + horizontalGap, 0));
    const ys = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height + verticalGap, 0));
    return nodes.map((node, index) => ({ ...node, position: { x: xs[index % columns], y: ys[Math.floor(index / columns)] } }));
  }

  const layers = new Map<number, T[]>();
  for (const node of nodes) layers.set(ranks.get(node.id) ?? 0, [...(layers.get(ranks.get(node.id) ?? 0) ?? []), node]);
  const orderedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  // `cross` walks the axis the layers advance on, `along` the axis they spread on.
  let cross = 0;
  for (const [, layerNodes] of orderedLayers) {
    let along = 0;
    let thickness = 0;
    for (const node of layerNodes) {
      const size = canvasNodeFootprint(node);
      positions.set(node.id, vertical ? { x: along, y: cross } : { x: cross, y: along });
      along += vertical ? size.width + horizontalGap : size.height + verticalGap;
      thickness = Math.max(thickness, vertical ? size.height : size.width);
    }
    cross += thickness + (vertical ? verticalGap : horizontalGap);
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}

/**
 * The zoom floor a FIT is allowed to reach, well below the floor a board sets for
 * pinching. A phone screen is a fraction of the width an arranged graph needs, and
 * a fit that stops at the pinch floor leaves most of the board off-screen — which
 * is not a fit, it is a crop. Pinching keeps the board's own (higher) floor so a
 * user cannot strand themselves in an unreadable view.
 */
export const CANVAS_FIT_MIN_ZOOM = 0.08;

/**
 * The arrange command every canvas puts on its rail: lay the objects out for the
 * shape of THIS board, then frame the result.
 *
 * All five canvases had hand-copied the same three lines, all of them measuring
 * nothing — so "arrange" meant "lay out for a wide screen" even on a phone, and
 * the fit that followed stopped at the board's pinch floor with the board still
 * running off the side. Measuring and framing belong with the layout, once.
 */
export function useCanvasCleanLayout<NodeType extends Node, EdgeType extends Edge>({
  boardRef,
  instanceRef,
  setNodes,
  edges,
  padding = 0.18,
  maxZoom = 1,
}: {
  /** The element the board is drawn in — its shape decides which way the graph runs. */
  boardRef: { readonly current: HTMLElement | null };
  instanceRef: { readonly current: ReactFlowInstance<NodeType, EdgeType> | null };
  setNodes: Dispatch<SetStateAction<NodeType[]>>;
  /** Omit for a board with no connections — it lays out as a grid either way. */
  edges?: EdgeType[];
  padding?: number;
  maxZoom?: number;
}): () => void {
  return useCallback(() => {
    const box = boardRef.current?.getBoundingClientRect();
    const orientation = canvasLayoutOrientation(
      box?.width ?? (typeof window === 'undefined' ? 0 : window.innerWidth),
      box?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight),
    );
    setNodes((current) => cleanCanvasLayout(current, edges ?? [], orientation));
    // Next frame: the fit has to read the positions we just set.
    window.setTimeout(() => void instanceRef.current?.fitView({ padding, maxZoom, minZoom: CANVAS_FIT_MIN_ZOOM, duration: 320 }), 0);
  }, [boardRef, instanceRef, setNodes, edges, padding, maxZoom]);
}
