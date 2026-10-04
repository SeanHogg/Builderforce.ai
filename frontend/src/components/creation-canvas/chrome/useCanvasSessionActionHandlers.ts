import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import type { useCanvasLiveRoom } from '@/lib/live/useCanvasLiveRoom';
import type { CanvasSessionActionHandler } from '../CanvasSessionActions';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import { readDrawingPreferences, type DrawingPreferences } from '../drawingPreferences';
import { useCanvasStandupAction, type CanvasStandupActionInput } from '../useCanvasStandupAction';
import type { useCanvasFiles } from '../hooks/useCanvasFiles';
import type { CanvasSessionFacts } from './canvasSessionContext';

export interface CanvasSessionActionHandlerDeps extends Pick<CanvasSessionFacts, 'sessionId' | 'persistence' | 'requireAccount'> {
  /** Closes every sheet an action can be pressed from. */
  closeActionMenus: () => void;
  undo: () => void;
  redo: () => void;
  openOutcomeMetrics: () => void;
  outcomeMetricsOpen: boolean;
  openDiagnostics: () => unknown;
  diagnosticsOpen: boolean;
  walkthroughRef: ReturnType<typeof useCanvasFiles>['walkthroughRef'];
  walkthroughStopCount: number;
  toggleFullscreen: () => void;
  fullscreen: boolean;
  liveRoom: ReturnType<typeof useCanvasLiveRoom>;
  hasAccount: boolean;
  standup: CanvasStandupActionInput;
  talktrackOpen: boolean;
  setTalktrackOpen: Dispatch<SetStateAction<boolean>>;
  runWorkflow: () => void;
  presentMode: boolean;
  setPresentMode: (value: boolean | ((current: boolean) => boolean)) => void;
  drawingMode: boolean;
  setDrawing: Dispatch<SetStateAction<DrawingPreferences | null>>;
  shareOpen: boolean;
  setShareOpen: Dispatch<SetStateAction<boolean>>;
  openReleasesPanel: () => void;
  releaseOpen: boolean;
  timeline: readonly CanvasTimelineMessage[];
  title: string;
}

/**
 * What each session action DOES. The registry owns the rest — the glyph, the name, the
 * cluster it belongs to and whether a phone keeps it in the bar or in the ••• sheet —
 * so this map is behaviour only, and the desktop bar and the phone sheet are driven by
 * the same entry rather than by two copies of the same `onClick`.
 *
 * Memoized over exactly what the handlers read, so the bar, the phone sheet and the
 * Make it real menu are handed the SAME record on a render that changed none of it —
 * a keystroke in the composer, a streamed Brain token.
 */
export function useCanvasSessionActionHandlers({
  closeActionMenus, undo, redo, openOutcomeMetrics, outcomeMetricsOpen, openDiagnostics, diagnosticsOpen,
  walkthroughRef, walkthroughStopCount, toggleFullscreen, fullscreen, liveRoom, hasAccount, standup,
  talktrackOpen, setTalktrackOpen, runWorkflow, presentMode, setPresentMode, drawingMode, setDrawing,
  shareOpen, setShareOpen, openReleasesPanel, releaseOpen, timeline, title, sessionId, persistence, requireAccount,
}: CanvasSessionActionHandlerDeps): Record<CanvasSessionActionId, CanvasSessionActionHandler> {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  // The standup beside the call. The hook resolves the project (scope, then this
  // board's), owns the ceremony and asks the agents at the table for their updates
  // through the ordinary turn path; this file learns one handler.
  const standupAction = useCanvasStandupAction(standup);
  return useMemo(() => {
    // Every one of these can be pressed from the command bar, the phone's "+" sheet, or
    // (for a few) the board menu, and a sheet that stays open over the panel it just
    // opened is a sheet in the way. Wrapping once here is what keeps that true for an
    // action added later.
    const act = (run: () => void, active?: boolean): CanvasSessionActionHandler =>
      ({ run: () => { closeActionMenus(); run(); }, active });
    return {
      undo: act(undo),
      redo: act(redo),
      outcomes: act(openOutcomeMetrics, outcomeMetricsOpen),
      diagnostics: act(() => void openDiagnostics(), diagnosticsOpen),
      // WITHDRAWN, NOT DISABLED, on a board too small to get lost in. A guide to
      // three cards is a control whose only honest answer is "you can see them" —
      // the same reasoning the call uses once its dock has taken over. The
      // threshold is the walkthrough's own: an empty `walkthroughStops` IS the
      // answer, so it is not restated here as a second number to keep in step.
      // Spelled out rather than through `act`: the walkthrough is reached through its ref,
      // which is read when the action is PRESSED, never while this record is built.
      walkthrough: { run: () => { closeActionMenus(); walkthroughRef.current?.open(); }, available: walkthroughStopCount > 0 },
      fullscreen: act(toggleFullscreen, fullscreen),
      // The call is a session action like any other, so it is in the bar on every
      // surface instead of in a band of chrome of its own. Two session facts decide how
      // it is drawn, and neither is something the registry could know:
      //   `disabled`  — there is no room to open here (a canvas that lives only on this
      //                 device and has not been shared has nobody to call).
      //   `available` — a call is ALREADY running, so the dock at the bottom of the
      //                 shell is the control from now on and this one withdraws rather
      //                 than sitting beside it lit up doing nothing.
      //   A GUEST is the exception to `disabled`: their press opens the account prompt,
      //   which answers "why can I not call" where a dimmed glyph said nothing.
      call: {
        ...act(() => (liveRoom?.canStart ? liveRoom.start() : requireAccount('call', t('gateCallTitle'), t('gateCallBody')))),
        disabled: !liveRoom || (!liveRoom.canStart && hasAccount),
        available: liveRoom?.live !== true,
      },
      standup: { ...act(standupAction.run), active: standupAction.active, disabled: standupAction.disabled },
      // A local canvas opens the SAME share sheet a saved one does. It used to open a
      // sign-up gate, which answered a question nobody asked: they wanted to show
      // someone the board, not to create an account.
      // The recorder keeps recording while its panel is shut, so this toggles a
      // panel that is always mounted rather than mounting one — closing the sheet
      // mid-walkthrough must not throw the walkthrough away.
      talktrack: act(() => setTalktrackOpen((value) => !value), talktrackOpen),
      // RUN THIS BOARD'S FLOW. ALWAYS OFFERED — never withdrawn for a board that has no
      // flow on it yet.
      //
      // It was gated on `resolveWorkflowNode() !== null` for one pass, which meant a
      // fresh board simply had no Run button and nothing said why. That is the failure
      // `canvasKindSettings` already names for the section's own Build/Run pair: "neither
      // is hidden when the frame holds no steps — the compiler's own message is a better
      // answer than a control that silently is not there." A control that vanishes cannot
      // teach; `runWorkflow` answers `noticeNeedWorkflow` and that sentence is the point.
      //
      // A section that has never been compiled is built first; `runWorkflow` owns that.
      run: act(() => runWorkflow()),
      // PRESENT sits in the RUN group beside it: running the board and showing it
      // running are the two things "run it" means. It was a ••• row under "Create and
      // view", a heading that filed starting something with showing what you started.
      present: act(() => setPresentMode((value) => !value), presentMode),
      // DRAW leads IDEA — the other way to put a mark on a board, beside the palette.
      // It was a ••• row filed with "export the session", which is a once-a-month
      // errand; this is one of the first things anybody does on a canvas.
      draw: act(() => setDrawing((current) => current ? null : readDrawingPreferences()), drawingMode),
      share: act(() => setShareOpen((value) => !value), shareOpen),
      // The whole board, not a card: an application is the session, and this is the
      // door that was previously reachable only from a selected object's inspector
      // under "Sell in the marketplace". Same lifecycle, same gate — `openReleasesPanel`
      // already refuses a board with nothing on a server and says why.
      publish: act(() => openReleasesPanel(), releaseOpen),
      // PROVE. Hands this board's own idea to the proof picker and names the
      // session, which is what lets the loop — Read, Prove, Build, Measure — be
      // recorded against it. A local-only board withdraws instead of gating: the
      // header's own CTA already becomes "Keep your work" the moment this browser
      // holds one (`MarketingHeader`), and a second button opening its own sign-up
      // gate for the same board was the same offer twice at the top of the screen.
      prove: {
        ...act(() => {
          const seed = timeline.find((message) => message.messageRole === 'user')?.body?.trim() || title;
          router.push(`/realize?session=${encodeURIComponent(sessionId)}&idea=${encodeURIComponent(seed.slice(0, 2_000))}`);
        }),
        available: persistence !== 'local',
      },
    };
  }, [closeActionMenus, diagnosticsOpen, drawingMode, fullscreen, hasAccount, liveRoom, openDiagnostics, openOutcomeMetrics, openReleasesPanel, outcomeMetricsOpen, persistence, presentMode, redo, releaseOpen, requireAccount, router, runWorkflow, sessionId, setDrawing, setPresentMode, setShareOpen, setTalktrackOpen, shareOpen, standupAction, t, talktrackOpen, timeline, title, toggleFullscreen, undo, walkthroughRef, walkthroughStopCount]);
}
