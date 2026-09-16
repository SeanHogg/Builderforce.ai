// No 'use client' directive: every host of this body sits inside the `CreationCanvas`
// client boundary already — the same reason `CanvasBarGroup` and `CanvasSessionActions`
// each state at the top of themselves.
import { useTranslations } from 'next-intl';
import {
  AccessibleOutlineIcon,
  CanvasAdsIcon,
  CanvasFilesIcon,
  CanvasMiroIcon,
  CanvasSocialIcon,
  CleanLayoutIcon,
  DepthIcon,
  DropToLayersIcon,
  FitViewIcon,
  LayerGuidesIcon,
  MarqueeSelectIcon,
  MinimapIcon,
  ResetViewIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@/components/canvas/CanvasCommands';
import type { Canvas3DControls } from '@/components/canvas/canvas3dControls';
import { Icon } from '@/components/ui/Icon';
import {
  CONNECTION_ENDS,
  CONNECTION_LINES,
  CONNECTION_ROUTERS,
  type ConnectionStyle,
} from '@/lib/canvasConnectionStyle';
import { CREATION_CONNECTION_KINDS, type CreationConnectionKind } from '@builderforce/creation-canvas-contract';
import styles from './CreationCanvas.module.css';

/**
 * THE BOARD MENU'S BODY — the board's own errands, in ONE place and TWO hosts.
 *
 * Everything in here is done to the BOARD rather than to the work: how you are
 * looking at it, what it is made of, where its history went, which connected account
 * it is pulling from. That is why the group it hangs under has a caption of its own
 * instead of a stage's — a control that answers no stage's question must not be given
 * a stage's name, which is how the old `Tools` shelf formed.
 *
 * ── WHY IT IS A COMPONENT NOW ────────────────────────────────────────────────────
 * It was ~70 lines inline in `CreationCanvas.tsx`, hung off the command bar's `Board`
 * group. A phone does not draw that bar at all (the composer's "+" is the command bar
 * at that width), so the sheet needed a second host — the canvas app bar's ••• — and
 * a second host is exactly where a body gets copied and then edited once. One body,
 * two hosts, no drift.
 *
 * ── WHY THE VIEW COMMANDS ARE IN HERE AND NOT IN A CORNER PILL ───────────────────
 * Zoom, fit, arrange, the mini map and the outline are not a stage of anything — they
 * move the viewport, they do not advance the work — so they cannot be captioned by
 * the arc, and a sixth caption invented for them is what the whole regroup was
 * undoing. The obvious alternative was a small floating pill in the bottom-right
 * corner, the way every drawing tool does it. It was rejected: a second floating panel
 * over one canvas is the exact thing the left-hand rail was deleted for.
 *
 * They are drawn as a TROUGH of glyphs rather than as menu rows, and pressing one does
 * NOT dismiss the sheet — zoom is a control you press repeatedly, and a menu that
 * closes under the second press is a menu you cannot zoom with. Everything that OPENS
 * something else dismisses, because a menu left over the panel it just opened is a
 * menu in the way. That split is why `onDismiss` is called by this body rather than
 * folded into each host callback: the rule belongs to the row, not to the errand.
 */

/** The side panels the board can put up. One at a time, so this is a value, not a set. */
export type CanvasDockPanel = 'files' | 'miro' | 'social' | 'ads' | 'outline';

export interface CanvasBoardMenuBodyProps {
  /**
   * Whether the flat React Flow board is what the reader is looking at. Two view
   * commands are about that board alone — a mini map is a map OF it, and pan-vs-marquee
   * is a decision about dragging on one — so they stand down elsewhere. Asked of the
   * surface registry by the host rather than re-derived from an id here.
   */
  showsBoard: boolean;
  /** How the viewport is moved. React Flow owns it, so the host owns what these do. */
  view: {
    onZoomIn: () => void;
    onZoomOut: () => void;
    /** Fit, or — while a scene is up — reset that scene's camera. */
    onFit: () => void;
    onArrange: () => void;
    minimapOpen: boolean;
    onToggleMinimap: () => void;
    /** True while dragging on the pane draws a marquee rather than panning. */
    marquee: boolean;
    onToggleGesture: () => void;
    /** What the SCENE adds while it is up. Null on every flat reading. */
    threeD: Canvas3DControls | null;
  };
  /** The one side panel that is up, and the way to change it. */
  panels: {
    open: CanvasDockPanel | null;
    onToggle: (panel: CanvasDockPanel) => void;
    /** False when this errand needs an account this board has not got. */
    allow: (source: string) => boolean;
  };
  /** Doors onto things this canvas can start or show. */
  create: {
    onTemplates: () => void;
    onConversation: () => void;
  };
  /** The session's own errands. `onMerge` is absent on a board that is not a branch. */
  session: {
    onHistory: () => void;
    onTutorial: () => void;
    hiddenShown: boolean;
    onToggleHidden: () => void;
    onBranch: () => void;
    onMerge?: () => void;
  };
  /**
   * TWO AXES, TWO CONTROLS. `kind` says what a connector MEANS — the board folds
   * `blocks` into a critical path and `verifies` into coverage, so it must never be
   * chosen for how it looks. `style` says how it is DRAWN, and it restyles whatever
   * edges are selected as well as arming the next draw.
   */
  connectors: {
    kind: CreationConnectionKind;
    onKindChange: (kind: CreationConnectionKind) => void;
    style: ConnectionStyle;
    onStyleChange: (patch: Partial<ConnectionStyle>) => void;
  };
  /** Close the sheet this body is in. Called by the rows that open something else. */
  onDismiss: () => void;
}

export function CanvasBoardMenuBody({
  showsBoard,
  view,
  panels,
  create,
  session,
  connectors,
  onDismiss,
}: CanvasBoardMenuBodyProps) {
  const t = useTranslations('creationCanvas');
  const tCommands = useTranslations('canvasCommands');
  const tFiles = useTranslations('creationCanvas.files');
  const tMiro = useTranslations('creationCanvas.miro');
  const tSocial = useTranslations('creationCanvas.social');
  const tAds = useTranslations('canvas.ads');
  const threeD = view.threeD;

  return <>
    {/* HOW YOU ARE LOOKING AT IT. */}
    <span className={styles.moreMenuHeading}>{t('barGroup.view')}</span>
    <div className={styles.moreMenuTools} role="group" aria-label={t('canvasViewControls')}>
      <button type="button" className={styles.sessionActionButton} onClick={view.onZoomIn} aria-label={t('zoomIn')} title={t('zoomIn')}><ZoomInIcon /></button>
      <button type="button" className={styles.sessionActionButton} onClick={view.onZoomOut} aria-label={t('zoomOut')} title={t('zoomOut')}><ZoomOutIcon /></button>
      <button type="button" className={styles.sessionActionButton} onClick={view.onFit} aria-label={threeD ? tCommands('threeD.reset') : t('fitCanvas')} title={threeD ? tCommands('threeD.reset') : t('fitCanvas')}>{threeD ? <ResetViewIcon /> : <FitViewIcon />}</button>
      <button type="button" className={styles.sessionActionButton} onClick={view.onArrange} aria-label={t('arrangeObjects')} title={t('arrangeObjects')}><CleanLayoutIcon /></button>
      {/* WHAT THE BOARD ALONE HAS — see `showsBoard` above. */}
      {showsBoard && <>
        <button type="button" className={styles.sessionActionButton} onClick={view.onToggleMinimap} aria-pressed={view.minimapOpen} aria-label={view.minimapOpen ? tCommands('hideMiniMap') : tCommands('showMiniMap')} title={view.minimapOpen ? tCommands('hideMiniMap') : tCommands('showMiniMap')}><MinimapIcon /></button>
        <button type="button" className={styles.sessionActionButton} onClick={view.onToggleGesture} aria-pressed={view.marquee} aria-label={t('canvasGestureToggle')} title={view.marquee ? t('canvasGestureSelectActive') : t('canvasGesturePanActive')}><MarqueeSelectIcon /></button>
      </>}
      {/* WHAT THE SCENE ADDS while it is up. These were the last commands living on the
          bottom-left rail; with the rail gone they are contributed here, beside the zoom
          and reset that already switch to the scene's own camera. */}
      {threeD && <>
        <button type="button" className={styles.sessionActionButton} onClick={threeD.toggleDepth} aria-pressed={threeD.depthMode !== 'flow'} aria-label={tCommands('threeD.depthGroup')} title={threeD.depthMode !== 'flow' ? tCommands('threeD.depthGroupActive') : tCommands('threeD.depthGroupInactive')}><DepthIcon /></button>
        <button type="button" className={styles.sessionActionButton} onClick={threeD.toggleLayers} aria-pressed={threeD.layersVisible} aria-label={tCommands('threeD.layerGuides')} title={threeD.layersVisible ? tCommands('threeD.layerGuidesActive') : tCommands('threeD.layerGuidesInactive')}><LayerGuidesIcon /></button>
        {threeD.dropToLayers && <button type="button" className={styles.sessionActionButton} onClick={threeD.dropToLayers} aria-label={tCommands('threeD.dropToLayers')} title={tCommands('threeD.dropToLayers')}><DropToLayersIcon /></button>}
      </>}
      {/* WHAT EVERY SURFACE HAS. This canvas's files and its readable outline are about
          the SESSION, not about which way it is being read. */}
      <button type="button" className={styles.sessionActionButton} onClick={() => panels.onToggle('files')} aria-pressed={panels.open === 'files'} aria-label={tFiles('title')} title={tFiles('title')}><CanvasFilesIcon /></button>
      <button type="button" className={styles.sessionActionButton} onClick={() => panels.onToggle('outline')} aria-pressed={panels.open === 'outline'} aria-label={t('canvasOutline')} title={t('canvasOutline')}><AccessibleOutlineIcon /></button>
    </div>

    <span className={styles.moreMenuHeading}>{t('createAndView')}</span>
    <button onClick={() => { create.onTemplates(); onDismiss(); }}><span aria-hidden><Icon source="▦" size="1em" /></span>{t('templates')}</button>
    <button onClick={() => { create.onConversation(); onDismiss(); }}><span aria-hidden><Icon source="◌" size="1em" /></span>{t('conversation')}</button>

    {/* Errands against a connected account, kept off the rail. Each one opens the SAME
        dock panel its rail button used to, drawn with the same glyph, so this is a move
        rather than a second entry point. */}
    <span className={styles.moreMenuHeading}>{t('connectedSources')}</span>
    <button aria-pressed={panels.open === 'miro'} onClick={() => { if (panels.allow(tMiro('title'))) panels.onToggle('miro'); onDismiss(); }}><span aria-hidden><CanvasMiroIcon /></span>{tMiro('title')}</button>
    <button aria-pressed={panels.open === 'social'} onClick={() => { if (panels.allow(tSocial('title'))) panels.onToggle('social'); onDismiss(); }}><span aria-hidden><CanvasSocialIcon /></span>{tSocial('title')}</button>
    <button aria-pressed={panels.open === 'ads'} onClick={() => { if (panels.allow(tAds('title'))) panels.onToggle('ads'); onDismiss(); }}><span aria-hidden><CanvasAdsIcon /></span>{tAds('title')}</button>

    <span className={styles.moreMenuHeading}>{t('sessionTools')}</span>
    <button onClick={() => { session.onHistory(); onDismiss(); }}><span aria-hidden>↶</span>{t('history')}</button>
    <button onClick={() => { session.onTutorial(); onDismiss(); }}><span aria-hidden>?</span>{t('tutorial')}</button>
    <button onClick={() => { session.onToggleHidden(); onDismiss(); }}><span aria-hidden>◉</span>{session.hiddenShown ? t('hideHidden') : t('showHidden')}</button>
    <button onClick={() => { session.onBranch(); onDismiss(); }}><span aria-hidden>⑂</span>{t('branch')}</button>
    {session.onMerge && <button onClick={() => { session.onMerge?.(); onDismiss(); }}><span aria-hidden>⇄</span>{t('merge')}</button>}

    {/* See `connectors` above for why these are two axes and not one list. */}
    <label><span><i aria-hidden>⌁</i>{t('edge')}</span><select aria-label={t('connectionKind')} value={connectors.kind} onChange={(event) => connectors.onKindChange(event.target.value as CreationConnectionKind)}>{CREATION_CONNECTION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
    <label><span><i aria-hidden>─</i>{t('connector.line')}</span><select aria-label={t('connector.line')} value={connectors.style.line} onChange={(event) => connectors.onStyleChange({ line: event.target.value as ConnectionStyle['line'] })}>{CONNECTION_LINES.map((line) => <option key={line} value={line}>{t(`connector.line_${line}` as 'connector.line_solid')}</option>)}</select></label>
    <label><span><i aria-hidden>→</i>{t('connector.ends')}</span><select aria-label={t('connector.ends')} value={connectors.style.ends} onChange={(event) => connectors.onStyleChange({ ends: event.target.value as ConnectionStyle['ends'] })}>{CONNECTION_ENDS.map((ends) => <option key={ends} value={ends}>{t(`connector.ends_${ends}` as 'connector.ends_arrow')}</option>)}</select></label>
    <label><span><i aria-hidden>⌐</i>{t('connector.router')}</span><select aria-label={t('connector.router')} value={connectors.style.router} onChange={(event) => connectors.onStyleChange({ router: event.target.value as ConnectionStyle['router'] })}>{CONNECTION_ROUTERS.map((router) => <option key={router} value={router}>{t(`connector.router_${router}` as 'connector.router_step')}</option>)}</select></label>
  </>;
}
