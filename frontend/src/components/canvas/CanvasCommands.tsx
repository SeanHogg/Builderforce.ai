'use client';

import { ControlButton, Controls, MiniMap, type Edge, type Node } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import { useCanvas3DControls } from './canvas3dControls';
import { canvasNodeFootprint, graphLayerRanks } from './canvasGraph';
import styles from './CanvasCommands.module.css';

function MinimapIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2 10.5 5.5 7l2.3 2.2L11 5.7l3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>;
}

function CleanLayoutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.75" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="1.75" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.3 1.3" />
  </svg>;
}

function ThreeDIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.4 14 4.6v6.8L8 14.6 2 11.4V4.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2 4.6 8 7.9l6-3.3M8 7.9v6.7" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

function DepthIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.6 14.4 5 8 8.4 1.6 5z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2.4 8.2 8 11.1l5.6-2.9M2.4 11.4 8 14.3l5.6-2.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

function ZoomInIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

function ZoomOutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

function ResetViewIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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
 * Deterministically spaces nodes into graph layers, or a compact grid when there
 * are no connections. Shares its layering with the 3D view (see `canvasGraph`),
 * so arranging the board and tilting it tell the same story about dependencies.
 */
export function cleanCanvasLayout<T extends Node>(nodes: T[], edges: Edge[]): T[] {
  if (nodes.length < 2) return nodes;
  const horizontalGap = 88;
  const verticalGap = 64;
  const { ranks, connected } = graphLayerRanks(nodes, edges);

  if (!connected) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
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
  let x = 0;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [, layerNodes] of orderedLayers) {
    let y = 0;
    let layerWidth = 0;
    for (const node of layerNodes) {
      const size = canvasNodeFootprint(node);
      positions.set(node.id, { x, y });
      y += size.height + verticalGap;
      layerWidth = Math.max(layerWidth, size.width);
    }
    x += layerWidth + horizontalGap;
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
