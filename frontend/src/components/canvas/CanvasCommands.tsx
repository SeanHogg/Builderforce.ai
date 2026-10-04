import { ControlButton, Controls, type Node } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import { useCallback, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { CanvasMiniMapPanel } from './commands/CanvasMiniMapPanel';
import { CanvasRailToggle } from './commands/CanvasRailToggle';
import { CleanLayoutIcon, MinimapIcon, ThreeDIcon } from './commands/railIcons';
import { ThreeDRailCommands } from './commands/ThreeDRailCommands';
import styles from './CanvasCommands.module.css';

/*
 * THE path every canvas imports its commands from. The pieces live in `./commands/`
 * — the icon set, the rail toggle, the 3D commands, the mini map and the arrange
 * layout — and are re-exported here so no importer has to know how they are split.
 */
export {
  MinimapIcon, CleanLayoutIcon, ThreeDIcon, ChatSurfaceIcon, GraphSurfaceIcon, AppSurfaceIcon, DepthIcon,
  MarqueeSelectIcon, LayerGuidesIcon, DropToLayersIcon, ZoomInIcon, ZoomOutIcon, ResetViewIcon, FitViewIcon,
  FullscreenIcon, ExitFullscreenIcon, CanvasFilesIcon, CanvasDriveIcon, CanvasMiroIcon, CanvasSocialIcon, CanvasAdsIcon,
} from './commands/railIcons';
export {
  UndoIcon, RedoIcon, WalkthroughIcon, OutcomeMetricsIcon, DiagnosticsIcon, StartCallIcon, StandupIcon,
  RecordTalktrackIcon, MoreActionsIcon, ShareCanvasIcon, ProveIdeaIcon, DrawIcon, PresentIcon, PublishCanvasIcon,
  RunCanvasIcon, CollapseBarIcon, ExpandBarIcon, DisclosureIcon, AddObjectIcon, ClosePaletteIcon,
} from './commands/sessionIcons';
export {
  PreviewReadingIcon, CodeReadingIcon, ConsoleReadingIcon, ViewportDesktopIcon, ViewportTabletIcon,
  ViewportMobileIcon, AccessibleOutlineIcon,
} from './commands/readingIcons';
export { CanvasRailToggle } from './commands/CanvasRailToggle';
export { CANVAS_FIT_MIN_ZOOM, canvasLayoutOrientation, cleanCanvasLayout, type CanvasLayoutOrientation } from './commands/cleanCanvasLayout';
export { useCanvasCleanLayout } from './commands/useCanvasCleanLayout';

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
  /**
   * Stand the rail down entirely: this host has a command bar of its own, and every
   * command the rail carries is contributed to that bar instead.
   *
   * It used to be `hideOnFlatBoard`, which stood the rail down on the flat board ONLY —
   * so the Creation Canvas showed one bar on the board and TWO toolbars on every other
   * surface, with Files and the accessible outline living in the bar on one surface and
   * in the bottom-left corner on the next. A canvas either has a bar of its own or it
   * does not; which surface it happens to be drawing does not change the answer.
   *
   * The mini map thumbnail is unaffected — it is a READING of the board rather than a
   * command, and it is gated by `threeDActive` exactly as it always was.
   */
  hideRail?: boolean;
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
  hideRail = false,
}: CanvasCommandsProps) {
  const t = useTranslations('canvasCommands');
  const toggleMinimap = useCallback(() => setMinimapOpen((open) => !open), [setMinimapOpen]);
  return <>
    {!hideRail && <Controls
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
      <ThreeDRailCommands threeDActive={threeDActive} />
      {!threeDActive && <CanvasRailToggle
        pressed={minimapOpen}
        onClick={toggleMinimap}
        label={t('toggleMiniMap')}
        activeTitle={t('hideMiniMap')}
        inactiveTitle={t('showMiniMap')}
      >
        <MinimapIcon />
      </CanvasRailToggle>}
      {extraControls}
    </Controls>}
    <CanvasMiniMapPanel
      minimapOpen={minimapOpen}
      setMinimapOpen={setMinimapOpen}
      threeDActive={threeDActive}
      nodeColor={minimapNodeColor}
      maskColor={minimapMaskColor}
      style={minimapStyle}
    />
  </>;
}
