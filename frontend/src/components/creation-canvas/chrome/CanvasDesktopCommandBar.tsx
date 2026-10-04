import type { ReactNode } from 'react';
import { canvasChromeShows } from '@/lib/canvasChrome';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import type { CanvasHostCapture } from '@/lib/canvasHost';
import { toggledCanvasPromptPlacement, type CanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import { TeamBar } from '@/components/team/TeamBar';
import { CanvasCommandBar } from '../CanvasCommandBar';
import type { CanvasSessionActionHandler } from '../CanvasSessionActions';
import { CanvasHostActions } from '../CanvasHostActions';
import { TwilioCanvasSetup } from '../TwilioCanvasSetup';
import type { CreationFlowNode } from '../CreationNode';
import type { useCanvasBrainSurface } from '../hooks/useCanvasBrainSurface';
import type { useCanvasNodePanels } from '../hooks/useCanvasNodePanels';
import { CanvasRoster, type CanvasRosterProps } from './CanvasRoster';
import { useCanvasSessionFacts } from './canvasSessionContext';

type NodePanels = ReturnType<typeof useCanvasNodePanels>;

export interface CanvasDesktopCommandBarProps extends Omit<CanvasRosterProps, 'members'> {
  /** A phone draws no command bar at all — see below. */
  phoneViewport: boolean;
  hostRef: (node: HTMLElement | null) => void;
  surface: CanvasSurfaceId;
  setSurface: (surface: CanvasSurfaceId) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  makeItReal: ReactNode;
  boardMenu: ReactNode;
  inviteMenu: ReactNode;
  /** The App surface would have something to open. */
  runnableApp: boolean;
  objectPickerOpen: boolean;
  setObjectPicker: NodePanels['setObjectPicker'];
  setNodePanel: NodePanels['setNodePanel'];
  roster: ReturnType<typeof useCanvasBrainSurface>['rosterMembers'];
  seatedAgents: ReturnType<typeof useCanvasBrainSurface>['seatedAgents'];
  /** The prompt can be shown or hidden here — not while presenting, not when Brain IS the surface. */
  promptToggleable: boolean;
  promptPlacement: CanvasPromptPlacement;
  setPromptPlacement: (placement: CanvasPromptPlacement) => void;
  promptOpen: boolean;
  canvasUsesTwilio: boolean;
  selectedNode: CreationFlowNode | null;
  /** The role or the object lock forbids a capture. */
  captureDisabled: boolean;
  onCapture: (capture: CanvasHostCapture) => void;
}

/**
 * THE bar. Everything you can do to what you are looking at, in one floating card
 * — including whatever the SURFACE contributed, so an app's Run, its readings and
 * the address it is running at land here rather than in a second toolbar of their
 * own. See `CanvasCommandBar` for why one bar and why the bottom.
 *
 * NOT DRAWN ON A PHONE AT ALL, and the distinction from `display:none` is
 * load-bearing: a hidden box measures zero from the TOP of the viewport rather
 * than zero height, so `--canvas-command-bar-space` would push the composer most
 * of a screen up — and its ••• sheet and invite panel would each exist twice in
 * one document. The composer's "+" opens the same registry instead.
 */
export function CanvasDesktopCommandBar({
  phoneViewport, hostRef, surface, setSurface, collapsed, setCollapsed, handlers, makeItReal, boardMenu, inviteMenu, runnableApp,
  objectPickerOpen, setObjectPicker, setNodePanel, roster, followingUserId, currentUserId, setFollowingUserId, seatedAgents,
  promptToggleable, promptPlacement, setPromptPlacement, promptOpen, canvasUsesTwilio, selectedNode, captureDisabled, onCapture,
}: CanvasDesktopCommandBarProps) {
  const { notify } = useCanvasSessionFacts();
  if (phoneViewport) return null;
  return <CanvasCommandBar
        // Its measured height becomes the band the prompt floats above. See the ref's
        // declaration: this used to be a literal that the App surface's own controls
        // overran, which is how the bar came to be drawn on top of the prompt.
        hostRef={hostRef}
        surface={surface}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        handlers={handlers}
        makeItReal={makeItReal}
        boardMenu={boardMenu}
        inviteMenu={inviteMenu}
        // The board's Run takes this canvas to the surface that runs it. Offered only
        // when the App surface would actually have something to open — the SAME question
        // that surface asks, asked of the same projection, so the bar can never promise a
        // run that lands on an empty frame. And only when the surface is not already
        // contributing its own Run: two Run buttons that can disagree about whether
        // something is running is worse than none.
        onRun={surface === 'graph' && runnableApp ? () => setSurface('app') : undefined}
        // The circles open the PICKER — the same component a node's `+` opens, so
        // "choose an object" is ONE interaction with one search and one contents, reached
        // from two places. It replaced a group-focus helper that drove the palette rail;
        // keeping both would have been two answers to one question.
        onQuickAdd={(group, rect) => {
          // A second press on the same open, unfiltered picker closes it — the button's
          // `aria-pressed` already says it is a toggle, so a press while it reads pressed
          // has to behave like one rather than just re-anchoring the picker in place.
          if (!group && objectPickerOpen) { setObjectPicker(null); return; }
          setNodePanel(null);
          setObjectPicker({ anchor: { x: Math.min(Math.max(12, rect.left - 170), Math.max(12, window.innerWidth - 412)), y: Math.max(12, rect.top - 330) }, ...(group ? { group } : {}) });
        }}
        quickAddOpen={objectPickerOpen}
        roster={<CanvasRoster members={roster} followingUserId={followingUserId} currentUserId={currentUserId} setFollowingUserId={setFollowingUserId} />}
        // Moving around the board, folded out of the left-edge rail. The rail was the
        // last toolbar competing with this bar, and it split "what can I do to this
        // canvas" across two floating elements with nothing saying why.
        onTogglePrompt={promptToggleable ? () => setPromptPlacement(toggledCanvasPromptPlacement(promptPlacement)) : undefined}
        promptOpen={promptOpen}
        // The always-on seats, folded out of the shell's footer band and into the one
        // bar. Same component, same roster endpoint, same drag-to-board payload — the
        // band simply stands down on a stage route and draws itself here instead.
        team={<TeamBar variant="bar" onBoard={seatedAgents} />}
        extras={canvasChromeShows('actions', collapsed) ? <>
          <TwilioCanvasSetup active={canvasUsesTwilio} />
          {/* Editor-only capture actions. Renders nothing on the web — it asks the
              host port whether an editor is present rather than being told. */}
          <CanvasHostActions
            selectedNode={selectedNode ?? null}
            disabled={captureDisabled}
            onCapture={onCapture}
            onError={notify}
          />
        </> : undefined}
      />;
}
