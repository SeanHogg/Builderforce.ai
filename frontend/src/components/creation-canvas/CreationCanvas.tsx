import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEffectEvent } from '@/hooks/useEffectEvent';
import { ReactFlowProvider, useEdgesState, useNodesState, type Edge, type NodeTypes, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasCleanLayout } from '@/components/canvas/CanvasCommands';
import { CanvasNodeFace } from '@/components/canvas/CanvasNodeFace';
import { Canvas3DControlsProvider, useCanvas3DControls } from '@/components/canvas/canvas3dControls';
import { canvasSurfaceDefinition, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { type ConnectionStyle, DEFAULT_CONNECTION_STYLE } from '@/lib/canvasConnectionStyle';
import { type CanvasSurfaceNodes } from './CanvasSurfaceRouter';
import { type CanvasDockPanel } from './CanvasBoardMenuBody';
import { usePhoneViewport } from '@/lib/usePhoneViewport';
import { useLivePresence } from '@/lib/canvas/useLivePresence';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { CanvasDiagnosticsProvider } from './canvasDiagnosticsContext';
import { CanvasSurfaceProvider } from './canvasSurfaceContext';
import { CanvasSurfaceActionsProvider } from './canvasSurfaceActions';
import { canvasNavigate, canvasSurface } from '@/lib/canvasHost';
import { DEFAULT_BRAIN_DOCK_PREFERENCES } from './brainDockPreferences';
import { useToast } from '@/components/ToastProvider';
import { CreationNode, type CreationFlowNode } from './CreationNode';
import type { CreationNodeData } from './types';
import { shouldAcquireCanvasObjectLock } from '@/domains/canvas/domain/selection';
import { type ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import { CARD_ACTS } from '@/domains/canvas/application/cardActs';
import { CardActProvider } from './cardActRunner';
import { CanvasBoardBridgeProvider } from './canvasBoardBridge';
import { CanvasSpacePresenceProvider } from './canvasSpacePresence';
import { cardActFor } from '@/domains/canvas/application/CardAct';
import { createCanvasNotices, type CanvasNotices } from '@/domains/canvas/application/PersistCanvas';
import { type CreationOutcomeMetrics, type CreationSessionDetail, type CreationSessionInvitation, creationSessionsApi, type CreationSessionSummary, type CreationSnapshotSummary, type CreationTemplate as ServerCreationTemplate } from '@/lib/builderforceApi';
import { creationStorageKey } from '@/domains/canvas/infrastructure/localCanvasStore';
import { useSharedCanvasRoom } from '@/domains/canvas/presentation/useSharedCanvasRoom';

/**
 * Which guided tour this board offers, and at which revision.
 *
 * Exported because the tour's "have I already seen this?" history is keyed by
 * exactly this pair — so a test (or any other caller) that needs the
 * returning-visitor state has to write the SAME key. Typed inline in two places
 * it drifted the moment the version was bumped, and the failure mode is silent:
 * the seed stops matching, the welcome dialog opens over the board again, and
 * whatever the test was actually measuring is measured through an overlay.
 */
export const CREATION_CANVAS_TOUR = { sectionId: 'creation-canvas', version: 2 } as const;
import { useCanvasLiveRoom } from '@/lib/live/useCanvasLiveRoom';
import { canvasNoticesFrom } from '@/lib/canvasNotices';
import { type BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { type LocalCheckpointSummary } from '@/lib/creationCheckpoints';
import { creationObjectDefinition } from './creationObjectRegistry';
import { type CreationTemplate } from '@/lib/templates/creationTemplates';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type CreationConnectionKind } from '@builderforce/creation-canvas-contract';
import { type CanvasGesture } from './canvasPointerMode';
import { type DrawingPreferences } from './drawingPreferences';
import { useChromeSpace } from './useChromeSpace';
import { type ImportTranslator } from '@/domains/canvas/application/ImportCanvasFile';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { usePublishBoardToShell } from '@/lib/canvas/usePublishBoardToShell';
import { clearActiveCanvasSync, setActiveCanvasSync } from '@/lib/activeCanvasSyncStatus';
import { placeAppendedCanvasNodes } from './creationCanvasLayout';
import { useCanvasLayoutViewport } from '@/components/canvas/useCanvasLayoutViewport';
import { useConfirm } from '@/components/ConfirmProvider';
import { useSectionTour } from '@/components/onboarding/useSectionTour';
import { useChatModelOptions } from '@/lib/useLlmModels';
import type { ChatModelSelection } from '@/components/ChatInput';
import { NEW_CHAT_MODE, type ChatMode } from '@/lib/brain';
import { defaultExportAction } from '@/lib/canvasExports';
import { canvasProjectId } from '@/lib/canvasProjectRef';
import { CREATIVE_GENERATOR_KINDS } from '@/lib/creationObjectGroups';
import '@/lib/canvasKindSettings.people';
import '@/lib/canvasKindSettings.simple';
import '@/lib/canvasKindSettings.dispatch';
import '@/lib/canvasKindSettings.custom';
import '@/lib/canvasKindSettings.board';
import '@/lib/canvasKindSettings.sales';
import '@/lib/canvasKindSettings.outreach';
import '@/lib/canvasKindSettings.dataArchitecture';
import '@/lib/canvasKindSettings.qa';
import '@/lib/canvasKindSettings.delivery';
import { builtinAgentSurfaceHref, type BuiltinAgentSurfaceIntent } from '@/lib/team/builtinAgentSurface';
import { useFormat } from "@/i18n/useFormat";
import { faultText } from '@/lib/apiClient';
import { useErrorText } from '@/i18n/useErrorMessage';
import type { AccountGate, CanvasTimelineMessage, FramePreset, MergeReview } from './canvasBoardTypes';
import { initialEdges, initialNodes } from './canvasSeed';
import { type CanvasInspectorValue } from './inspector/inspectorContext';
import { useCanvasObjectPlacement } from './hooks/useCanvasObjectPlacement';
import { useCanvasConnectedSources } from './hooks/useCanvasConnectedSources';
import { useCanvasTeammates } from './hooks/useCanvasTeammates';
import { useCanvasFileIntake } from './hooks/useCanvasFileIntake';
import { useCanvasTemplates } from './hooks/useCanvasTemplates';
import { useCanvasBranching } from './hooks/useCanvasBranching';
import { useCanvasProjectActions } from './hooks/useCanvasProjectActions';
import { useCanvasEvermindActions } from './hooks/useCanvasEvermindActions';
import { useCanvasDiagramConversion } from './hooks/useCanvasDiagramConversion';
import { useCanvasBrainVocabulary } from './hooks/useCanvasBrainVocabulary';
import { useCanvasAgentTesting } from './hooks/useCanvasAgentTesting';
import { useCanvasBrainTurn } from './hooks/useCanvasBrainTurn';
import { useCanvasProposalReview } from './hooks/useCanvasProposalReview';
import { useCanvasFlowBuild } from './hooks/useCanvasFlowBuild';
import { useCanvasWorkflowRun } from './hooks/useCanvasWorkflowRun';
import { useCanvasPublishing } from './hooks/useCanvasPublishing';
import { useCanvasCreativeGeneration } from './hooks/useCanvasCreativeGeneration';
import { useCanvasArtifactExport } from './hooks/useCanvasArtifactExport';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { useCanvasRenderedBoard } from './hooks/useCanvasRenderedBoard';
import { useCanvasDiagnostics } from './hooks/useCanvasDiagnostics';
import { useCanvasBrainSurface } from './hooks/useCanvasBrainSurface';
import { useCanvasSurfaceState } from './hooks/useCanvasSurfaceState';
import { useCanvasNodePanels } from './hooks/useCanvasNodePanels';
import { useCanvasBrainRuntime } from './hooks/useCanvasBrainRuntime';
import { useCanvasAccountGate } from './hooks/useCanvasAccountGate';
import { useCanvasDockAndFullscreen } from './hooks/useCanvasDockAndFullscreen';
import { useCanvasSessionModes } from './hooks/useCanvasSessionModes';
import { useCanvasSession } from './hooks/useCanvasSession';
import { useCanvasSessionSync } from './hooks/useCanvasSessionSync';
import { useCanvasPresence } from './hooks/useCanvasPresence';
import { useCanvasScope } from './hooks/useCanvasScope';
import { useCanvasLivePublish } from './hooks/useCanvasLivePublish';
import { useCanvasBoardModel } from './hooks/useCanvasBoardModel';
import { useCanvasDatasetImport } from './hooks/useCanvasDatasetImport';
import { useCanvasEditing } from './hooks/useCanvasEditing';
import { useCanvasPresentation } from './hooks/useCanvasPresentation';
import { useCanvasDatasetViews } from './hooks/useCanvasDatasetViews';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useCanvasFiles } from './hooks/useCanvasFiles';
import { useLatestRef } from './hooks/useLatestRef';
import { useCanvasPresenceRelay } from './hooks/useCanvasPresenceRelay';
import { useCanvasCardActs } from './hooks/useCanvasCardActs';
import { useCanvasTurnQueue } from './hooks/useCanvasTurnQueue';
import { useCanvasResumeShares } from './hooks/useCanvasResumeShares';
import { CanvasSessionProvider, type CanvasSessionFacts } from './chrome/canvasSessionContext';
import { useCanvasChromeMenus } from './chrome/useCanvasChromeMenus';
import { useCanvasSessionActionHandlers } from './chrome/useCanvasSessionActionHandlers';
import { CanvasPromptComposer } from './chrome/CanvasPromptComposer';
import { effectiveCanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import type { CanvasLens } from '@/lib/canvasLens';
import { CanvasLensBar } from './chrome/CanvasLensBar';
import { useCanvasLens } from './hooks/useCanvasLens';
import { useCanvasEntryApp } from './hooks/useCanvasEntryApp';
import type { CanvasScopeMode } from './chrome/CanvasScopeChip';
import { CanvasInviteSheet, useInviteDraft } from './chrome/CanvasInviteSheet';
import { CanvasMakeItReal } from './chrome/CanvasMakeItReal';
import { CanvasBoardMenu } from './chrome/CanvasBoardMenu';
import { CanvasTemplateMenu, useCanvasTemplateBrowser } from './chrome/CanvasTemplateMenu';
import { CanvasTopChrome } from './chrome/CanvasTopChrome';
import { boardUsesTwilio, CanvasDesktopCommandBar } from './chrome/CanvasDesktopCommandBar';
import { CanvasPhoneActions } from './chrome/CanvasPhoneActions';
import { CanvasTours } from './chrome/CanvasTours';
import { CanvasNodePanelHost } from './stage/CanvasNodePanelHost';
import { CanvasAccountGateDialog } from './stage/CanvasAccountGateDialog';
import { CanvasDrawingToolbar } from './stage/CanvasDrawingToolbar';
import { CanvasPresentBar } from './stage/CanvasPresentBar';
import { CanvasSelectionToolbar } from './stage/CanvasSelectionToolbar';
import { CanvasFileDropOverlay, CanvasFrameFocusBar, CanvasLargeSessionNotice, CanvasLoadingSkeleton } from './stage/CanvasBoardNotices';
import { CanvasBoardFlow, canvasMinimapColor } from './stage/CanvasBoardFlow';
import { CanvasShell } from './stage/CanvasShell';
import { CanvasBoardStage } from './stage/CanvasBoardStage';
import { CanvasObjectPickerHost } from './stage/CanvasObjectPickerHost';
import { useCanvasTurnErrors } from './hooks/useCanvasTurnErrors';
import { useCanvasTourDefaults } from './hooks/useCanvasTourDefaults';
import { useCanvasSocialCampaignSync } from './hooks/useCanvasSocialCampaignSync';
import { useCanvasStandup } from './hooks/useCanvasStandup';
import { useCanvasBoardDrop } from './hooks/useCanvasBoardDrop';
import { CanvasSurfaceStage } from './stage/CanvasSurfaceStage';
import { CanvasRoomStage } from './stage/CanvasRoomStage';
import { CanvasSidePanels } from './stage/CanvasSidePanels';
import { CanvasWorkspaceOverlays } from './stage/CanvasWorkspaceOverlays';
import { CanvasHistoryPanel } from './stage/CanvasHistoryPanel';
import { CanvasOutcomeMetricsPanel } from './stage/CanvasOutcomeMetricsPanel';
import { CanvasConversationPanel, CanvasDiagnosticsPanel } from './stage/CanvasSessionPanels';
import { CanvasChangeSetPanel, CanvasMergePanel } from './stage/CanvasReviewPanels';
import { CanvasBrainDockHost } from './stage/CanvasBrainDockHost';
import { CanvasBrainLauncher } from './stage/CanvasBrainLauncher';
import { useCanvasSessionApp, useOpenCanvasApp } from './hooks/useCanvasSessionApp';
import { sessionHasApp } from '@/lib/canvasSessionApp';
import { useBrainConversation } from './stage/useBrainConversation';

/** The air between the command bar and the prompt floating above it. The bar's HEIGHT is
 *  measured (see `useChromeSpace`); this is the only part of that band a number can
 *  honestly state, because it is a spacing decision rather than a fact about an element. */
const COMMAND_BAR_CLEARANCE = 10;
/** The air between the floating TOP chrome and anything drawn under it — the panels that
 *  open in the top-right corner, and every full-bleed surface. Same reasoning as
 *  `COMMAND_BAR_CLEARANCE`, at the other edge: the cards' height is measured, and only the
 *  gap is a number this file is entitled to state. */
const TOP_CHROME_CLEARANCE = 8;

function CanvasInner({ sessionId, persistence, lens = 'canvas', initialFocusId, initialShareOpen = false, initialPrompt, initialPresent = false, initialModelComparisonIds = [], stageActive = true, hostSurfaces, initialSurface, onExitToLibrary }: { sessionId: string; persistence: 'local' | 'server'; lens?: CanvasLens; initialFocusId?: string | null; initialShareOpen?: boolean; initialPrompt?: string | null; initialPresent?: boolean; initialModelComparisonIds?: readonly string[]; stageActive?: boolean; hostSurfaces?: CanvasSurfaceNodes; initialSurface?: CanvasSurfaceId; onExitToLibrary?: () => void }) {
  const fmt = useFormat();
  /** The board's language — recorded on content minted INTO the board (the worked
   *  course's `language`), alongside the copy `canvasText` mints in it. */
  const locale = useLocale();
  const t = useTranslations('creationCanvas');
  const errorText = useErrorText();
  /**
   * The plain-module translator, built ONCE.
   *
   * Three places had written the same cast inline — the materialisation deps, the
   * card-act runner and the shared room — because `useTranslations` returns a
   * key-typed function and `CanvasTextTranslator` is the widened seam a use case
   * takes (see `domains/canvas/domain/canvasText.ts`). A third copy is what the
   * DRY rule exists to stop, and a fourth would have been written by whoever adds
   * the next use case.
   */
  const canvasText = useMemo<CanvasTextTranslator>(
    () => (key, values) => t(key as never, values as never),
    [t],
  );
  // The proposal stage is built once, so it reads the CURRENT translator through a
  // ref — a new object's default title is persisted in the board's language.
  const canvasTextRef = useRef(canvasText);
  useEffect(() => { canvasTextRef.current = canvasText; }, [canvasText]);
  /**
   * A turn's runtime notices, already in the viewer's language. Built here because the
   * turn runner is not a component and cannot translate for itself, and memoized so the
   * three call sites below pass a stable object.
   */
  const noticeText = useTranslations('creationCanvas.notice');
  const canvasNotices = useMemo(() => canvasNoticesFrom(noticeText), [noticeText]);
  const router = useRouter();
  /**
   * A shipped pack's name and blurb are product copy, so they come from the
   * catalogs; the English in `creationTemplates.ts` is the source string and the
   * last-resort fallback while a new pack's translations land.
   */
  const templateText = useCallback((template: CreationTemplate, field: 'name' | 'description') => {
    const key = `template.${template.id}.${field}`;
    return t.has(key) ? t(key) : template[field];
  }, [t]);
  const tMiro = useTranslations('creationCanvas.miro');
  const tSocial = useTranslations('creationCanvas.social');
  // The step catalog names itself out of the builder's namespace — the same keys the
  // standalone palette reads, because they name the same steps.
  const tStep = useTranslations('evermindBuild');
  const tImport = useTranslations('creationCanvas.import');
  // The facilitation vocabulary. Its own namespace rather than `creationCanvas.poll.*`
  // because the SAME strings are read by the participant's page — which is not a canvas
  // at all — and a phone must not have to load the board's catalogue to say "voting
  // closed".
  const tPoll = useTranslations('poll');
  /** The import engine is a plain module, so it is handed the catalog rather
   * than reaching for one — every string it produces stays translated. */
  const importLabel = useCallback<ImportTranslator>((key, values) => tImport(key as never, values as never), [tImport]);
  const { guestLimit, setGuestLimit, describeTurnError } = useCanvasTurnErrors({ sessionId, t });
  const confirm = useConfirm();
  const toast = useToast();
  const storageKey = creationStorageKey(sessionId);
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(persistence === 'local' ? initialNodes(canvasText) : []);
  const [evermindLiveByNodeId, setEvermindLiveByNodeId] = useState<Record<string, Partial<CreationNodeData>>>({});
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persistence === 'local' ? initialEdges(canvasText) : []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /**
   * Which inspector section a wide panel was opened AT — the agent workbench, the test
   * bench, the evaluation or the delivery checklist. Declared beside the panel state it
   * belongs to rather than three hundred lines away, because the two are set together
   * every time and read together every time.
   */
  const [inspectorFocus, setInspectorFocus] = useState<'knowledge' | 'test' | 'evaluation' | 'delivery' | null>(null);
  const [scopeMode, setScopeMode] = useState<CanvasScopeMode>('auto');
  const [connectionKind, setConnectionKind] = useState<CreationConnectionKind>('reference');
  /**
   * How the next connector LOOKS — a separate axis from what it MEANS.
   *
   * `connectionKind` is semantics the board computes over (the critical path is a fold
   * over `blocks`, coverage over `verifies`); this is appearance. Keeping them as two
   * controls is the whole point: a dashed line is not a kind of relationship, and adding
   * one to the kind list would put a rendering choice into the vocabulary the critical
   * path is computed from. See `lib/canvasConnectionStyle.ts`.
   *
   * Changing it restyles whatever edges are SELECTED as well as arming the next draw,
   * which is the only behaviour that makes it usable on a diagram already on the board.
   */
  const [connectionStyle, setConnectionStyleState] = useState<ConnectionStyle>(DEFAULT_CONNECTION_STYLE);
  const [title, setTitle] = useState('Untitled session');
  const [minimapOpen, setMinimapOpen] = useState(true);
  const { comparisonModelIds, setSurfaceState, surfaceTarget, surface, exitSurface, surfaceDef, setSurface, promptPlacement, setPromptPlacement, barCollapsed, phase, setPhase, phaseReadiness, settleLoadedPhase, setBarCollapsed } = useCanvasSurfaceState({ initialModelComparisonIds, initialSurface, sessionId, nodes });
  const { shareOpen, setShareOpen, closeShareSheet, moreOpen, setMoreOpen, closeMoreMenu, toggleMoreMenu, realOpen, closeRealMenu, toggleRealMenu, actionsOpen, closeActionsSheet, toggleActionsSheet, closeActionMenus } = useCanvasChromeMenus(initialShareOpen);
  const [accountGate, setAccountGate] = useState<AccountGate | null>(null);
  /** The two phone decisions CSS cannot make: which host renders the board menu and the
   *  invite sheet (rendering, not hiding — see `usePhoneViewport`), and which verb the
   *  composer arms while the Brain sheet is open.
   *
   *  A third gate sits on top of the media query: an embedding host (`hostSurfaces`) is
   *  a docked editor panel, routinely narrower than 767px, and must keep the desktop
   *  chrome. The CSS half of the same question is `.canvasShell:not([data-host='editor'])`
   *  around the 767px block — a 500px VS Code webview must not grow a phone app bar. */
  const phoneViewport = usePhoneViewport() && !hostSurfaces;
  const [templateOpen, setTemplateOpen] = useState(false);
  const templateBrowser = useCanvasTemplateBrowser(templateOpen);
  /**
   * Whether this board builds something the App surface could actually open.
   *
   * Asked of `canvasApp` rather than of `nodes.length`, because "there are objects on the
   * board" and "there is an app here" are different questions and only the second one
   * makes a Run button honest — a canvas holding a Brain conversation and three notes has
   * plenty of objects and nothing to run.
   */
  const runnableApp = useMemo(() => sessionHasApp(nodes), [nodes]);
  const flowWrapRef = useRef<HTMLDivElement | null>(null);
  const { openObjectPicker, setNodePanel, openNodeInspector, openNodePanel, setObjectPicker, openInsertPicker, nodePanel, anchorFrom, objectPicker, objectPickerOpen } = useCanvasNodePanels({ boardRef: flowWrapRef, selectedId, setInspectorFocus });
  const { journalRef, recentJournalEvidence, brainRuntimeRef, disableBrainModel, recordBrainCompletion, lastTurnProvenance } = useCanvasBrainRuntime({ sessionId });

  const liveSession = useOptionalLiveSession();
  // "Is there a room here, may I open it, and is one already running" — one decision,
  // owned by the hook, read by the session action below. The canvas never assembles a
  // room out of auth and a session id itself.
  const liveRoom = useCanvasLiveRoom();
  const [localPresentMode, setLocalPresentMode] = useState(initialPresent);
  const presentMode = liveSession ? liveSession.presentMode : localPresentMode;
  // A ref, because the functional-updater form (`setPresentMode(v => !v)`) has to
  // read the CURRENT value, and the shell's value does not live in this closure.
  const presentModeRef = useLatestRef(presentMode);
  const setPresentMode = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(presentModeRef.current) : value;
    if (liveSession) liveSession.setPresentMode(next);
    else setLocalPresentMode(next);
  }, [liveSession, presentModeRef]);
  /** The pen currently in hand — `null` means the pointer pans and selects.
   *  Colour, width and the last tool persist, because marking up a board is
   *  twenty strokes in a row and choosing the pen twenty times is not a tool. */
  const [drawing, setDrawing] = useState<DrawingPreferences | null>(null);
  const drawingMode = drawing !== null;
  // Pan is the default in both pointer worlds, so a board behaves on first touch the way
  // it always has on first click. The toggle exists because a one-finger drag can only
  // do one of the two things — see `canvasPointerMode.ts`.
  const [canvasGesture, setCanvasGesture] = useState<CanvasGesture>('pan');
  const [showHidden, setShowHidden] = useState(false);
  const [localFollowingUserId, setLocalFollowingUserId] = useState<string | null>(null);
  const followingUserId = liveSession ? liveSession.followingUserId : localFollowingUserId;
  const followingRef = useLatestRef(followingUserId);
  const setFollowingUserId = useCallback((value: string | null | ((current: string | null) => string | null)) => {
    const next = typeof value === 'function' ? value(followingRef.current) : value;
    if (liveSession) liveSession.setFollowing(next);
    else setLocalFollowingUserId(next);
  }, [followingRef, liveSession]);
  const [branchParentId, setBranchParentId] = useState<string | null>(null);
  const [mergeReview, setMergeReview] = useState<MergeReview | null>(null);
  /**
   * The section being worked on alone — a canvas within a canvas.
   *
   * This replaced `workflowFocus`, which mounted the standalone workflow builder in a
   * modal over the board: a SECOND canvas, with its own palette, node renderer and
   * selection model, drawn on top of a board that already had all three. Focusing a
   * frame is the same board showing one section, so everything that works on the board
   * — the palette, Brain, undo, presence, the inspector — works inside it unchanged.
   */
  const [frameFocus, setFrameFocus] = useState<string | null>(null);
  const [trainingFocus, setTrainingFocus] = useState<{ nodeId: string; projectId: number | string; localOnly: boolean } | null>(null);
  /**
   * The game whose SHIP panel is open — distribution, not play.
   *
   * Playing moved to the `play` surface (`surface` + `surfaceTarget` below), because a
   * build in a drawer is a build nobody can judge. This boolean used to carry both jobs
   * under the name `gameFocus`, which is how "open the game" meant "open a 620px panel
   * about publishing it".
   */
  const [gameShipFocus, setGameShipFocus] = useState<string | null>(null);
  /** The object being listed for sale, by node id — `''` publishes the whole board. */
  const [publishFocus, setPublishFocus] = useState<string | null>(null);
  // Build → Stage → Live for one card. Held separately from `publishFocus` because
  // they are two different questions: "what is this and what does it cost" is a
  // form, and "which version is on sale and is the next one fit to be" is a
  // lifecycle. An empty string means the whole board.
  const [releaseFocus, setReleaseFocus] = useState<string | null>(null);
  const [talktrackOpen, setTalktrackOpen] = useState(false);
  const [creatingBuild, setCreatingBuild] = useState(false);
  const [framePresets, setFramePresets] = useState<FramePreset[]>([]);
  const [serverTemplates, setServerTemplates] = useState<ServerCreationTemplate[]>([]);
  const inviteDraft = useInviteDraft();
  const [prompt, setPrompt] = useState('');
  // The composer text as the Brain tools read it. A ref, so `canvasActions` (68
  // tools, one memo) is not rebuilt on every keystroke.
  const promptRef = useRef(prompt);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);
  /* The prompt's HEIGHT, its resize grip and its drag offset all moved into
     `CanvasComposer` with the markup: they are chrome of that one card, nothing outside
     it ever read the number, and seven hooks here were seven hooks this file did not
     need to own. */
  const [twilioPromptSelected, setTwilioPromptSelected] = useState(false);
  const [thinking, setThinking] = useState(false);
  /**
   * The in-flight turn's cancellation handle and the correlation id it was started
   * under — everything Stop needs to interrupt the run AND record that the user is
   * the one who ended it. Held in a ref rather than state because Stop must reach
   * the CURRENT run from a callback the composer holds for the whole session.
   */
  const canvasRunRef = useRef<{ abort: AbortController; requestMessageId: string; startedAt: number } | null>(null);
  // When the in-flight turn began. Shared with every Brain surface (dock strip,
  // transcript, board anchor) so they narrate the same phase at the same instant.
  const [brainRunStartedAt, setBrainRunStartedAt] = useState<number | null>(null);
  const [activeAgentIds, setActiveAgentIds] = useState<Set<string>>(() => new Set());
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({ mode: 'auto' });
  const { options: canvasModelOptions, identity: modelIdentity } = useChatModelOptions();
  const [notice, setNoticeText] = useState('');
  /**
   * The pill's one status line, arbitrated by the use case rather than here.
   *
   * `outcome()` is what the user did — shown until the next thing happens.
   * `saveState()` is the routine autosave tick; it no longer has anything of its
   * own to say, so it clears the line once a recent outcome's hold has expired,
   * rather than replacing it with ambient "Saving…" / "Saved on this device"
   * chatter. The rule and the reason for it are in `application/PersistCanvas.ts`
   * — what matters at this call site is that the two are DIFFERENT verbs, so a
   * new message cannot pick the wrong one by picking the only one.
   */
  const [notices] = useState<CanvasNotices>(() => createCanvasNotices(setNoticeText));
  const setNotice = useCallback((text: string) => notices.outcome(text), [notices]);
  const noteSaveState = useCallback(() => notices.saveState(''), [notices]);

  /**
   * SHARED FREE SESSION, and the account-less board's ONE write.
   *
   * Two state values, three refs, two effects and four callbacks used to sit here
   * for this. They are `useSharedCanvasRoom` now — the first module of the canvas
   * PRESENTATION layer, and the shape that actually shrinks this component: a hook
   * that OWNS its state rather than a function this function calls while keeping it.
   *
   * What crosses the line is deliberately narrow: what this board is, how to speak,
   * how to put a board on screen, and how to read the one being held. Nothing about
   * nodes, edges or React setters goes through it.
   */
  /**
   * Where everyone's pointer, typing, body and Brain run is RIGHT NOW — as opposed to
   * `members`, which is where they were when the 8s presence poll last ran. Fed by
   * whichever relay this board has: the server session's socket for a saved board, the
   * guest room's for an account-less shared one (`useLivePresence`).
   */
  const liveRelay = useLivePresence();
  const { receive: receivePresence, clear: clearPresence } = liveRelay;
  const sharedRoom = useSharedCanvasRoom({
    enabled: persistence === 'local',
    sessionId,
    t: canvasText,
    notify: setNotice,
    adopt: (snapshot) => applyRoomSnapshotRef.current(snapshot),
    currentSnapshot: () => currentSnapshotRef.current(),
    onPresenceFrame: receivePresence,
  });
  const inRoom = sharedRoom.active;
  const persistSnapshot = sharedRoom.persist;
  /** A live presence channel exists: the server session's relay, or a shared guest room's. */
  const presenceLive = persistence === 'server' || inRoom;
  /** The guest room's presence send, read by the relay constructed once below. */
  const sendRoomPresenceRef = useLatestRef(sharedRoom.sendPresence);
  const [loadingSession, setLoadingSession] = useState(persistence === 'server');
  const [realtimeState, setRealtimeState] = useState<'local' | 'connecting' | 'online' | 'reconnecting' | 'offline'>(persistence === 'local' ? 'local' : 'connecting');
  // Published for the session rail, which lives outside this component's tree
  // (a sibling in the app shell, not a child) and so cannot read this state as
  // a prop. A local-only board has no connection to report, so it publishes
  // nothing rather than a fifth state the rail would have to invent a label for.
  useEffect(() => {
    setActiveCanvasSync(sessionId, realtimeState === 'local' ? undefined : realtimeState);
  }, [sessionId, realtimeState]);
  useEffect(() => () => clearActiveCanvasSync(sessionId), [sessionId]);
  const [members, setMembers] = useState<CreationSessionDetail['members']>([]);
  // Merged over the roster for rendering (`liveMembers`), never kept as a rival roster.
  const livePresence = liveRelay.live;
  const [joinedCollaborator, setJoinedCollaborator] = useState<CreationSessionDetail['members'][number] | null>(null);
  const [allMembers, setAllMembers] = useState<CreationSessionDetail['members']>([]);
  const [pendingInvitations, setPendingInvitations] = useState<CreationSessionInvitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const localizedTourDefaults = useCanvasTourDefaults(t);
  const sectionTour = useSectionTour({
    ...CREATION_CANVAS_TOUR,
    audienceId: currentUserId || (persistence === 'local' ? 'guest' : null),
    activity: { sessionId, clientSurface: canvasSurface() },
  });
  const prepareTourStep = useCallback((step: number) => {
    setMoreOpen(false);
    setShareOpen(false);
    if (step === 1) openObjectPicker();
  }, [openObjectPicker, setMoreOpen, setShareOpen]);
  /**
   * Where the presentation is standing, as an INDEX rather than a node id.
   *
   * An id would be the obvious choice and is wrong for the case that actually happens:
   * a collaborator deletes the frame you are on mid-presentation, and an id-based
   * cursor then points at nothing while an index simply lands on the frame that took
   * its place. `presentationStepAt` clamps, so the control never blanks.
   */
  const [presentStep, setPresentStep] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreationSnapshotSummary[]>([]);
  /**
   * The same two verbs for a board with no server — see `creationCheckpoints.ts`.
   *
   * A SECOND list rather than a mapped one: a server revision is a monotonic number the
   * API restores by, and a local checkpoint is an id in this browser. Coercing them into
   * one shape would mean one of the two restore paths taking an identifier that means
   * nothing to it, which is the kind of collapse that reads as tidy and fails silently.
   * The PANEL is one panel; the stores are two, because they genuinely are.
   */
  const [localCheckpoints, setLocalCheckpoints] = useState<LocalCheckpointSummary[]>([]);
  /** The checkpoint name being typed, inline. See `createCheckpoint` for why it is not a prompt. */
  const [checkpointName, setCheckpointName] = useState('');
  const [timeline, setTimeline] = useState<CanvasTimelineMessage[]>([]);
  const [brainTrace, setBrainTrace] = useState<BrainTraceEvent[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  /**
   * The left dock holds ONE panel at a time.
   *
   * These were six independent booleans, and every panel they gate docks at the
   * same coordinates — so opening a second one stacked it invisibly on the first
   * rather than replacing it. A single value cannot express that state, which is
   * the point: exclusivity is the data model, not a rule each toggle remembers.
   */
  const [dockPanel, setDockPanel] = useState<CanvasDockPanel | null>(null);
  // "A hit is listed but not SHOWN" — the outline panel's own search already ranks
  // and filters real board content (see its header comment); this is the board HALF
  // that was missing: while a query is active, everything NOT in its result set
  // dims, so the query reads as a map rather than only a list. Gated on `dockPanel`
  // rather than cleared on unmount — the panel closing already means this stops
  // applying, without needing its own cleanup effect.
  const [outlineHighlightIds, setOutlineHighlightIds] = useState<ReadonlySet<string> | null>(null);
  const toggleDockPanel = useCallback((panel: CanvasDockPanel) => setDockPanel((current) => (current === panel ? null : panel)), [setDockPanel]);
  const closeDockPanel = useCallback(() => setDockPanel(null), [setDockPanel]);
  const [fullscreen, setFullscreen] = useState(false);
  /** True while the BROWSER is what put us full screen, false for the CSS fallback. */
  const nativeFullscreenRef = useRef(false);
  // ONE Brain surface: which side it is parked on, how wide, and whether the user
  // wants the step list. Read from storage after mount so SSR stays deterministic.
  const [brainDock, setBrainDock] = useState(DEFAULT_BRAIN_DOCK_PREFERENCES);
  const [outcomeMetricsOpen, setOutcomeMetricsOpen] = useState(false);
  const [outcomeMetrics, setOutcomeMetrics] = useState<CreationOutcomeMetrics | null>(null);
  const [outcomeMetricsLoading, setOutcomeMetricsLoading] = useState(false);
  const [outcomeMetricsError, setOutcomeMetricsError] = useState<string | null>(null);
  const [proposedChanges, setProposedChanges] = useState<ProposedCanvasChange[]>([]);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<Set<string>>(new Set());
  const [autoApply, setAutoApply] = useState(true);
  const [autoApplyPending, setAutoApplyPending] = useState(false);
  /** Conversation vs execution for this session (0409). Hydrated from the loaded
   *  session below; `setSessionMode` is the writer that also persists it. */
  const [sessionMode, setSessionMode_] = useState<ChatMode>(NEW_CHAT_MODE);
  const [pendingBrainActions, setPendingBrainActions] = useState<Array<{ objectId: string; action: string }>>([]);
  const [dispatchedBrainAction, setDispatchedBrainAction] = useState<{ objectId: string; action: string } | null>(null);
  const [sessionRole, setSessionRole] = useState<CreationSessionSummary['role']>('owner');
  /** Whether the lock on the selected object was refused — recorded against the object it was asked for. */
  const [lockRefusal, setLockRefusal] = useState<{ objectId: string; blocked: boolean } | null>(null);
  // Locks are server records. A freshly added Canvas node exists in React state
  // before the debounced graph save creates its database row, so attempting to
  // lock it immediately produces a misleading 404. Track confirmed server IDs
  // and start the lease only after persistence succeeds.
  const [persistedObjectIds, setPersistedObjectIds] = useState<Set<string>>(new Set());
  const [datasetRowLimit, setDatasetRowLimit] = useState(500);
  const canEdit = persistence === 'local' || sessionRole === 'editor' || sessionRole === 'runner' || sessionRole === 'owner';
  const canRun = persistence === 'local' || sessionRole === 'runner' || sessionRole === 'owner';
  const isComposingPrompt = prompt.trim().length > 0;
  const { connectedAccountGate, requireAccount, openAccountGate, hasAccount, claimingDraft, setClaimingDraft } = useCanvasAccountGate({ sessionId, setAccountGate, t });
  const shellRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance<CreationFlowNode, Edge> | null>(null);
  const hydratedRef = useRef(false);
  const revisionRef = useRef(1);
  /** The revision as the diagnostics panel shows it. Every write goes through
   *  `commitRevision`: the ref for the async readers, this for the render. */
  const [revision, setRevision] = useState(1);
  const commitRevision = useCallback((next: number) => {
    revisionRef.current = next;
    setRevision(next);
  }, []);
  const lastSavedGraphRef = useRef('');
  const sessionOpenCorrelationRef = useRef(crypto.randomUUID());
  const currentGraphRef = useRef('');
  const saveInFlightRef = useRef(false);
  const activePresenceInitializedRef = useRef(false);
  const activeMemberIdsRef = useRef<Set<string>>(new Set());
  const pendingSaveRef = useRef<{ signature: string; key: string } | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  /** The live socket, when it is open — the channel pointer frames go out on. */
  const liveSocketRef = useRef<WebSocket | null>(null);
  /** Last outbound presence frame's timestamp + payload, for the send throttle. */
  /** This client's ephemeral state on the relay — see `useCanvasPresenceRelay`. */
  const presenceRelay = useCanvasPresenceRelay(liveSocketRef, sendRoomPresenceRef);
  const sendPresence = useCallback((state: CanvasPresenceState) => presenceRelay.send(state), [presenceRelay]);
  const pendingViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  /**
   * How much board a layout has to spend, measured now. ONE reader for every
   * placement decision on this canvas — authoring, arranging, pasting — so the
   * board cannot be width-aware in one of them and blind in the others. See
   * `useCanvasLayoutViewport`; it replaced three copies of
   * `typeof window !== 'undefined' && window.innerWidth <= 760`, which threw the
   * width away and left every batch of authored objects in a single column.
   */
  const layoutViewport = useCanvasLayoutViewport({ boardRef: flowWrapRef, instanceRef: flowRef });
  /**
   * The same reader, reachable from things constructed once and never replaced —
   * `CanvasProposalStage` and the Brain tools registered against it. Same treatment,
   * and for the same reason, as `nodesRef` below: they must see today's measurement
   * without being rebuilt when the window resizes.
   */
  const layoutViewportRef = useLatestRef(layoutViewport);
  /**
   * "Bring that object forward", reachable from the callbacks declared ABOVE the one
   * that implements it. `revealObject` needs the surface switcher and React Flow and
   * so is defined late; `seatTeammate` needs it and is defined early. A ref rather
   * than reordering two thousand lines of callbacks, and rather than a second
   * hand-rolled select-and-fit that would drift from the real one.
   */
  const revealObjectRef = useRef<(objectId: string) => void>(() => undefined);
  /**
   * Objects about to join the board, each placed against everything already on
   * it INCLUDING the rest of this batch.
   *
   * Called inside the `setNodes` updater at every append site, which is the only
   * place that can see the board five queued updaters deep. Appending straight
   * onto `current` is what put six @-mentioned agents on one coordinate.
   *
   * A REF, not a `useCallback`, for the same reason `nodesRef` is one: it is read
   * by 27 append sites across this component, and as a value it would have to be
   * named in 27 dependency arrays — 22 of which the hooks ratchet then reports,
   * for a helper that is provably stable (it closes over refs only). The ref is
   * refreshed after every commit (`useLatestRef`), so it always measures today's board.
   */
  const placeAppendedRef = useLatestRef<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>(
    (current, additions) => placeAppendedCanvasNodes(current, additions, layoutViewport()),
  );
  // The prompt's real height, published to the board as `--composer-space` — the
  // band every bottom-anchored panel and the phone command rail sit above. It
  // was a hardcoded 112px, which the execution chip alone overran.
  const composerDockRef = useChromeSpace(flowWrapRef, '--composer-space');
  // The command bar's real height, published to the SHELL as `--canvas-command-bar-space`
  // — the band the floating prompt sits above. Measured for the same reason and by the
  // same hook: the bar grows by whatever the SURFACE contributes to it (the App surface's
  // Run, its three readings, its width switcher), and the literal `66px` it used to be is
  // how the bar came to be drawn straight over the prompt on exactly that surface.
  const commandBarSpaceRef = useChromeSpace(shellRef, '--canvas-command-bar-space', { gap: COMMAND_BAR_CLEARANCE });
  // The band the floating chrome owns at the TOP of the shell, published as
  // `--canvas-top-chrome-space`. It is measured off the fused phase/surface card because
  // that is the TALLER of the two cards sharing that line now that Invite / Publish / •••
  // moved into the bottom bar (see `handoffChrome`'s own header for why) — the session
  // pill is a single row, the fused widget is two, so clearing the widget clears the pill.
  //
  // TWO things read it, and both were broken without it. Every FULL-BLEED surface draws
  // from the shell's top edge, so the conversation surface drew its own header underneath
  // the pill — the session's name painted over by the same session's name, with its
  // participants marooned beside the surface tabs. And a panel anchored to the shell's top
  // edge needs to know how much of it the floating cards already own. Measured rather than
  // declared for the reason the bottom bands are: the widget grows by a row when a surface
  // is added to `CANVAS_SURFACES`, and its content changes with the phase.
  const topChromeSpaceRef = useChromeSpace(shellRef, '--canvas-top-chrome-space', { edge: 'top', gap: TOP_CHROME_CLEARANCE });
  /**
   * The executive contract THIS TURN is running, read off the prompt when the
   * run starts.
   *
   * A ref rather than state because it is read inside a tool `run`, which the
   * Brain calls mid-turn from a closure that must see the CURRENT value — state
   * would hand it whatever was captured when `canvasActions` was memoised. It
   * is what lets `canvas_prepare_executive_use_case` recover from a model that
   * mistypes the one argument it was given.
   */
  const inFlightUseCaseIdRef = useRef<string | null>(null);
  /**
   * Every tool this turn actually CALLED, by its advertised name.
   *
   * A ref rather than state: it is read inside tool handlers that run mid-turn, and a
   * re-render per tool call would rebuild the whole action list underneath the loop
   * that is walking it. Cleared at the start of every turn beside `brainTrace`, which
   * is the other per-turn record and must not disagree with it about which turn it is.
   *
   * This is what makes `ExecutiveCanvasWorkflow.requiredTools` an enforcement rather
   * than a sentence: a completion condition a model can satisfy by reasoning is not a
   * contract, and the career intents are the set where reasoning produces a confident,
   * unreproducible number.
   */
  const turnToolCallsRef = useRef<Set<string>>(new Set());
  /** Set by the turn runner when the string it returned is a RUNTIME NOTICE rather
   *  than an answer Brain produced — read once when the turn settles so the notice is
   *  shown to the user without entering the transcript the next turn is built from. */
  const turnUnansweredRef = useRef<{ reason: string; detail?: string } | null>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const historyBaselineRef = useRef<string | null>(null);
  const historyApplyingRef = useRef(false);
  const drawingPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const canvasClipboardRef = useRef<{ nodes: CreationFlowNode[]; edges: Edge[] } | null>(null);
  const initialPromptSubmittedRef = useRef(false);
  const modelComparisonStartedRef = useRef(false);
  const autoApplyRef = useRef(true);
  const mobileViewportFittedRef = useRef(false);
  const { updateBrainDock, toggleFullscreen } = useCanvasDockAndFullscreen({ autoApplyRef, comparisonModelIds, fullscreen, initialSurface, nativeFullscreenRef, phoneViewport, sessionId, setAutoApply, setBrainDock, setFullscreen, setSurfaceState, shellRef });
  // HOW THIS BOARD IS PRESENTED — `/create` or `/studio`, the same instance either way
  // (`lib/canvasLens.ts`). Every lens decision below reads this def, never the id.
  const lensDef = useCanvasLens({ lens, surface, showSurface: setSurfaceState, phase, setPhase, updateBrainDock, phoneViewport });
  const { setAutoApplyMode, setSessionMode, setMemoryMode } = useCanvasSessionModes({ autoApplyRef, nodes, persistence, sessionId, sessionRole, setAutoApply, setDatasetRowLimit, setFramePresets, setMemoryEnabled, setNotice, setPendingInvitations, setServerTemplates, setSessionMode_, shareOpen, t, templateOpen });
  const { applyRoomSnapshotRef, currentSnapshotRef, currentSnapshot, localBoardState, applyRemoteBoard, boardLoaded } = useCanvasSession({ commitRevision, currentGraphRef, edges, flowRef, hydratedRef, lastSavedGraphRef, nodes, noteSaveState, onBoardLoaded: settleLoadedPhase, pendingViewportRef, persistence, revisionRef, saveInFlightRef, sessionId, sessionOpenCorrelationRef, setAllMembers, setBranchParentId, setCurrentUserId, setEdges, setEvermindLiveByNodeId, setLoadingSession, setMembers, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setSelectedIds, setSessionMode_, setSessionRole, setTimeline, setTitle, t, timeline, title, viewportRef });
  const showApp = useCallback(() => setSurface('app'), [setSurface]);
  const openApp = useOpenCanvasApp({ setNodes, showApp });
  useCanvasSessionSync({ commitRevision, activeMemberIdsRef, activePresenceInitializedRef, applyRemoteBoard, brainRunStartedAt, canEdit, clearPresence, currentGraphRef, currentSnapshot, currentUserId, cursorRef, edges, flowRef, followingUserId, hydratedRef, initialSurface, initialFocusId, isComposingPrompt, joinedCollaborator, lastSavedGraphRef, liveSocketRef, loadingSession, localBoardState, mobileViewportFittedRef, nodes, noteSaveState, pendingSaveRef, persistSnapshot, persistence, presenceLive, presenceRelay, receivePresence, revisionRef, saveInFlightRef, selectedIds, sendPresence, sessionId, openApp, setCurrentUserId, setEdges, setJoinedCollaborator, setMembers, setNodes, setNotice, setPersistedObjectIds, setRealtimeState, setSelectedId, setTimeline, storageKey, t, thinking, timeline, title, viewportRef });
  const { liveMembers, presenceSelfId } = useCanvasPresence({ currentUserId, flowRef, followingUserId, inRoom, livePresence, members, sharedRoom });

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  /**
   * The object the active surface is about, or null.
   *
   * Derived rather than stored alongside the id, so a target that is deleted — by this
   * user, by a collaborator, or by Brain — simply stops resolving. The effect below turns
   * that into a return to the board, which is the only sane answer to "the page you were
   * editing is gone": a surface with no object renders nothing and offers nothing.
   */
  const surfaceNode = surfaceTarget ? nodes.find((node) => node.id === surfaceTarget) ?? null : null;
  useEffect(() => {
    if (canvasSurfaceDefinition(surface).scope === 'object' && !surfaceNode) exitSurface();
  }, [surface, surfaceNode, exitSurface]);
  const { scopedNodes, scopedNodeIds, effectiveSelectedIds, resolvedScopeMode, scopeLabel } = useCanvasScope({ edges, journalRef, nodes, scopeMode, selectedId, selectedIds, selectedNode, t });
  useCanvasLivePublish({ currentUserId, liveSession, members, persistence, sharedRoom, t });

  /**
   * What this board tells the shell — the projects it references and the strictest
   * assessment being sat on it (see `usePublishBoardToShell`). The gate it returns is
   * what a turn started WITHOUT the composer (a per-object action) must also obey.
   */
  const assistantGate = usePublishBoardToShell(sessionId, nodes);
  const evermindProjectId = useMemo(() => {
    const candidates = [...scopedNodes, ...nodes.filter((node) => !scopedNodeIds.has(node.id))];
    for (const node of candidates) {
      if (node.data.kind === 'project') {
        const numeric = canvasProjectId(node.data) ?? Number(node.data.projectId);
        if (Number.isInteger(numeric) && numeric > 0) return numeric;
      }
      const source = Number(node.data.sourceProjectId);
      if (Number.isInteger(source) && source > 0) return source;
    }
    return null;
  }, [nodes, scopedNodeIds, scopedNodes]);

  /** One writer for an object's content, wherever the edit was made — the
   * inspector, a cell edited on the card itself, or the Files library. */
  /**
   * Whether a direct edit made ON a card can land at all.
   *
   * One gate, read by both the writer and the cards: `updateNodeData` enforces
   * it, and the cards use it to decide whether an editing control exists. A
   * viewer on a shared board, or an editor whose lock has gone, gets no Edit
   * button rather than one that silently does nothing.
   */
  // Derived rather than cleared by the lock effect: an object that needs no lock is never
  // blocked, and a refusal only ever applies to the object it was for.
  const lockObjectId = shouldAcquireCanvasObjectLock(persistence, selectedId, canEdit, persistedObjectIds) ? selectedId : null;
  const lockBlocked = lockObjectId !== null && lockRefusal?.objectId === lockObjectId && lockRefusal.blocked;
  const cardsEditable = canEdit && !lockBlocked;

  const syncSocialCampaign = useCanvasSocialCampaignSync({ setNodes, setNotice, tSocial });
  const { nodesRef, framedBoardRef, stage, appendTimeline, edgesRef, updateNodeData, moveDealFromNode, updateWebsiteViewport } = useCanvasBoardModel({ canEdit, canvasTextRef, cardsEditable, edges, layoutViewportRef, lockBlocked, nodes, noteSaveState, persistence, sessionId, setNodes, setNotice, setTimeline, syncSocialCampaign, t });
  const sessionApp = useCanvasSessionApp({ nodes, nodesRef, setNodes, stage, placeAppendedRef, persistence });
  // The app the lens expects, made once the loaded board is on screen — before the first turn.
  const entryApp = useCanvasEntryApp({ boardLoaded, nodes, modality: lensDef.appModality, canEdit, appTitle: title.trim() || t('surface.app.defaultAppTitle'), createApp: sessionApp.createApp });

  // The Brain Object mirrors the live turn — messages, trace, and the run state that
  // drives its activity bar — so a working Brain reads as working on the board too,
  // not only inside the dock (which the user may have closed).
  useEffect(() => {
    const messages = timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt }));
    setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, messages, ...(brainTrace.length ? { trace: brainTrace } : {}), brainRunning: thinking, brainRunStartedAt, aiResponse: [...timeline].reverse().find((message) => message.messageRole === 'assistant')?.body || node.data.aiResponse } } : node));
  }, [brainRunStartedAt, brainTrace, setNodes, thinking, timeline]);

  useEffect(() => {
    if (lockObjectId === null) return;
    const lockedObjectId = lockObjectId;
    let stopped = false;
    const acquire = async (action: 'acquire' | 'renew') => {
      try {
        await creationSessionsApi.lock(sessionId, lockedObjectId, action);
        if (!stopped) setLockRefusal({ objectId: lockedObjectId, blocked: false });
      } catch (error) {
        if (!stopped) { setLockRefusal({ objectId: lockedObjectId, blocked: true }); setNotice(faultText(error, t('noticeObjectLocked'))); }
      }
    };
    void acquire('acquire');
    const timer = window.setInterval(() => void acquire('renew'), 45_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void creationSessionsApi.lock(sessionId, lockedObjectId, 'release').catch(() => undefined);
    };
  }, [lockObjectId, sessionId, setNotice, t]);
  const { attachmentBytesStrategy, importDataset } = useCanvasDatasetImport({ canvasText, datasetRowLimit, edges, fmt, historyApplyingRef, historyBaselineRef, hydratedRef, importLabel, journalRef, nodes, persistence, redoStackRef, selectedId, setNodes, setNotice, t, undoStackRef });
  const { selectionIds, redo, undo, deleteObjects, duplicateSelection, copySelection, pasteSelection, openFrame, deleteNodeFromCard, alignSelection, frameSelection, togglePlacementLock, toggleHidden, deleteSelection, exitFrame } = useCanvasEditing({ canEdit, canvasClipboardRef, cardsEditable, edges, flowRef, historyApplyingRef, historyBaselineRef, journalRef, nodes, nodesRef, placeAppendedRef, redoStackRef, selectedId, selectedIds, setEdges, setFrameFocus, setNodePanel, setNodes, setNotice, setScopeMode, setSelectedId, setSelectedIds, t, undoStackRef });

  /**
   * The commands the 3D scene publishes while it is on screen, and `null` in the
   * flat view. Everything the canvas can do to its own camera — focus, zoom, fit
   * — routes through this so there is ONE action per command that means the right
   * thing in whichever view is live, rather than a control that quietly dies in
   * the other one.
   */
  const threeDControls = useCanvas3DControls();
  /**
   * Whether this canvas's objects are on screen and workable. The registry answers
   * for every surface but one: the room, whose session is a read-only diorama until
   * it is opened at full size — and the projection says it is up by publishing its
   * controls. Read once here, so the selection toolbar and the large-session notice
   * cannot disagree about it.
   */
  const objectsOnScreen = surfaceDef.showsObjects || threeDControls !== null;
  const { presentationSteps, movePresentation, focusSelection } = useCanvasPresentation({ canEdit, copySelection, deleteObjects, duplicateSelection, flowRef, flowWrapRef, nodes, pasteSelection, presentMode, presentModeRef, presentStep, redo, selectionIds, setNodes, setPresentMode, setPresentStep, setSelectedId, setSelectedIds, threeDControls, undo });
  const { visualizeDataset, plotDataset, profileDataset } = useCanvasDatasetViews({ canvasText, fmt, nodes, openNodeInspector, placeAppendedRef, selectedNode, setEdges, setNodes, setNotice, setSelectedId });
  const { openBrainDock, setConnectionStyle, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp, onCanvasNodesChange, onConnect, connectionProps, onNodeClick, onSelectionChange, clearSelection, onViewportChange, interactionProps } = useCanvasInteraction({ canEdit, canvasGesture, connectionKind, connectionStyle, currentSnapshot, cursorRef, drawing, drawingPointsRef, edges, flowRef, framedBoardRef, guestLimit, hydratedRef, nodes, onNodesChange, openNodeInspector, openNodePanel, persistSnapshot, persistence, placeAppendedRef, presenceLive, sendPresence, sessionId, setBrainDock, setConnectionStyleState, setDiagnosticsOpen, setEdges, setHistoryOpen, setInspectorFocus, setNodes, setNotice, setOutcomeMetricsOpen, setSelectedId, setSelectedIds, t, title, viewportRef });
  const { addAtCenter, choiceSeed, captureIdeaFromComposer, pickObject, appendAtCenter } = useCanvasObjectPlacement({ canEdit, cardsEditable, connectionKind, flowRef, localizedTourDefaults, nodes, openNodeInspector, placeAppendedRef, sessionId, setEdges, setNodes, setNotice, setObjectPicker, setPrompt, setSelectedId, setSelectedIds, t, tStep, timeline });
  const { socialAccountGate, buildSocialFeedNode, importMiroBoard, addSocialFeedToBoard, addSocialCampaignToBoard, boardMedia } = useCanvasConnectedSources({ canEdit, connectedAccountGate, layoutViewportRef, nodes, placeAppendedRef, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, stage, t, tMiro, tSocial });
  const { seatTeammate } = useCanvasTeammates({ addAtCenter, canEdit, nodesRef, placeAppendedRef, revealObjectRef, sessionId, setNodes, setNotice, setPrompt, setSelectedId, setSelectedIds, t });
  const { addFilesToCanvas, attachCanvasArtifact, addHostCapture } = useCanvasFileIntake({ addAtCenter, attachmentBytesStrategy, canEdit, flowRef, importLabel, journalRef, openBrainDock, placeAppendedRef, seatTeammate, sessionId, setNodes, setNotice, setPrompt, setSelectedId, setSelectedIds, stageActive, t });
  const { applyTemplate, applyServerTemplate, addFramePreset, saveFramePreset } = useCanvasTemplates({ commitRevision, canEdit, canvasText, flowRef, locale, persistence, placeAppendedRef, revisionRef, selectedNode, sessionId, setEdges, setFramePresets, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setServerTemplates, setTemplateOpen, t, templateText });
  const { createBranch, prepareMerge, applyMerge } = useCanvasBranching({ branchParentId, edges, mergeReview, nodes, persistence, requireAccount, sessionId, setMergeReview, setNotice, t, title });
  const { expandProject, compareProjects, expandMockupSet, deliverMockup, loadProjectQuality } = useCanvasProjectActions({ errorText, nodes, openNodeInspector, persistence, placeAppendedRef, requireAccount, selectedNode, sessionId, setEdges, setNodes, setNotice, setSelectedId, t });
  const { openEvermindTraining, evaluateEvermind, attachEvermindProject, expandEvermindPipeline } = useCanvasEvermindActions({ flowRef, nodes, openNodeInspector, persistence, placeAppendedRef, selectedNode, sessionId, setEdges, setEvermindLiveByNodeId, setNodes, setNotice, setSelectedId, setSelectedIds, setTrainingFocus, t });

  const { boardProjectId, startStandup } = useCanvasStandup({ nodes, selectedNode, persistence, requireAccount, setNodes, setEdges, setNotice, t });

  const { fileDragging, onDrop, onCanvasDragEnter, onCanvasDragLeave } = useCanvasBoardDrop({ canEdit, flowRef, placeAppendedRef, addFilesToCanvas, seatTeammate, choiceSeed, localizedTourDefaults, openNodeInspector, setNodes, setSelectedId, setSelectedIds, setNotice, t });
  const { convertObjectToDiagram } = useCanvasDiagramConversion({ canEdit, nodes, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t });

  const { canvasActions } = useCanvasBrainVocabulary({ buildsRef: sessionApp.buildsRef, createApp: sessionApp.createApp, buildSocialFeedNode, canEdit, canvasText, convertObjectToDiagram, effectiveSelectedIds, fmt, inFlightUseCaseIdRef, layoutViewportRef, localizedTourDefaults, nodes, nodesRef, openAccountGate, persistence, promptRef, recentJournalEvidence, requireAccount, resolvedScopeMode, scopedNodeIds, sessionId, setDockPanel, socialAccountGate, stage, t, tSocial, turnToolCallsRef });
  const { addAgentKnowledge, runAgentTest } = useCanvasAgentTesting({ brainRuntimeRef, canEdit, canvasNotices, describeTurnError, disableBrainModel, edges, modelSelection, nodes, persistence, placeAppendedRef, recordBrainCompletion, setEdges, setNodes, setNotice, t });
  const { evaluateCanvas } = useCanvasBrainTurn({ appendTimeline, autoApplyRef, brainRuntimeRef, canvasActions, canvasNotices, canvasRunRef, confirm, currentUserId, describeTurnError, disableBrainModel, edges, effectiveSelectedIds, evermindProjectId, inFlightUseCaseIdRef, initialPromptSubmittedRef, journalRef, lastTurnProvenance, members, memoryEnabled, modelSelection, nodes, persistence, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setBrainRunStartedAt, setBrainTrace, setEdges, setGuestLimit, setModelSelection, setNodes, setNotice, setPrompt, setProposedChanges, setSelectedId, setSelectedIds, setThinking, stage, t, thinking, timeline, title, turnToolCallsRef, turnUnansweredRef });
  const { rejectProposedChanges, applyAndEnableAutoApply, applyProposedChanges } = useCanvasProposalReview({ acceptedProposalIds, autoApplyPending, comparisonModelIds, describeTurnError, entryAppPending: entryApp.pending, evaluateCanvas, flowRef, hydratedRef, initialFocusId, initialPrompt, initialPromptSubmittedRef, layoutViewportRef, modelComparisonStartedRef, nodes, persistence, proposedChanges, selectedId, sessionId, setAcceptedProposalIds, setAutoApplyMode, setAutoApplyPending, setEdges, setNodes, setNotice, setPendingBrainActions, setPrompt, setProposedChanges, setSelectedId, setSelectedIds, setSurface, stage, t, thinking, timeline });
  const { resolveWorkflowNode, buildFlowFromFrame, buildFlow, openEvermindBuild, loadEvermindTemplate, evermindBuild, setEvermindBuild } = useCanvasFlowBuild({ connectionKind, edgesRef, errorText, framedBoardRef, nodes, nodesRef, persistence, requireAccount, selectedNode, sessionId, setEdges, setNodes, setNotice, t, updateNodeData });
  const { compileWorkflow, runWorkflow, unpackWorkflow, saveAgent } = useCanvasWorkflowRun({ buildFlowFromFrame, canRun, connectionKind, errorText, persistence, requireAccount, resolveWorkflowNode, selectedNode, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t });
  const { publishWebsite, publishApp, openBuild, openReleasesPanel, attachBuild, deleteBuildWorkspace, buildWebsiteWithCode, openGamePanel, openPublishPanel, gamePanelTarget } = useCanvasPublishing({ canEdit: cardsEditable, confirm, connectionKind, creatingBuild, edges, errorText, gameShipFocus, layoutViewportRef, nodes, persistence, placeAppendedRef, requireAccount, selectedNode, sessionId, openApp, provisionApp: sessionApp.provisionApp, setCreatingBuild, setEdges, setGameShipFocus, setNodes, setNotice, setPublishFocus, setReleaseFocus, setSelectedId, setSelectedIds, t });
  const { generateVideo, runCreativeAction } = useCanvasCreativeGeneration({ errorText, nodes, persistence, requireAccount, selectedNode, sessionId, setNodes, setNotice, t });
  const { exportArtifact } = useCanvasArtifactExport({ edges, nodes, setNodes, setNotice, t });
  const { revealObject, walkthroughRef, walkthroughStops, sessionFiles, downloadCanvasFile } = useCanvasFiles({ edges, exportArtifact, flowRef, nodes, revealObjectRef, setInspectorFocus, setNotice, setSelectedId, setSelectedIds, setSurface, t });
  const { runPollAction, evaluateReleaseGate, runCardActOnObject, cardActBoard } = useCanvasCardActs({ canvasText, edges, nodes, nodesRef, persistence, requireAccount, setEdges, setNodes, setNotice, setSurface, t, tPoll, updateNodeData });

  /**
   * Brain's queued object actions, one at a time. An action is about ITS object, and
   * several of them act on the selection, so the object is selected first; a queued
   * action whose object has gone is dropped. Both are adjusted while rendering — on the
   * render the queue changed in — and the action that is ready moves to
   * `dispatchedBrainAction`, which the effect below performs exactly once.
   */
  const pendingBrainAction = pendingBrainActions[0];
  if (pendingBrainAction) {
    const dropHead = (current: typeof pendingBrainActions) => (current[0] === pendingBrainAction ? current.slice(1) : current);
    const pendingTarget = nodes.find((node) => node.id === pendingBrainAction.objectId);
    if (!pendingTarget) setPendingBrainActions(dropHead);
    else if (selectedId !== pendingTarget.id) {
      setSelectedId(pendingTarget.id);
      setSelectedIds([pendingTarget.id]);
    } else {
      setDispatchedBrainAction(pendingBrainAction);
      setPendingBrainActions(dropHead);
    }
  }
  // An effect EVENT: the effect is keyed on the dispatched action alone, so it never performs twice.
  const performBrainAction = useEffectEvent((pending: { objectId: string; action: string }) => {
    const target = nodes.find((node) => node.id === pending.objectId);
    if (!target) return;
    if (target.data.kind === 'workflow' && pending.action === 'build') void compileWorkflow(target.id);
    else if (target.data.kind === 'workflow' && pending.action === 'run') runWorkflow(target.id);
    else if (target.data.kind === 'website' && pending.action === 'publish') publishWebsite(target.id);
    else if (target.data.kind === 'build') (pending.action === 'publish' ? publishApp : openBuild)(target.id);
    else if (target.data.kind === 'video' && pending.action === 'generate') generateVideo(target.id);
    // BEFORE the creative-generator branch, which would otherwise swallow it:
    // `image` and `cad` are both generator kinds, and routing a conversion into
    // `runCreativeAction` is why this action was advertised as connected and
    // answered "no delivery adapter" for every kind that offered it.
    else if (pending.action === 'convert-to-diagram') {
      void convertObjectToDiagram(target.id).then((result) => setNotice(result.ok ? t('diagramCreatedStatus') : result.error ?? t('drawioAppendFailed')));
    }
    else if (CREATIVE_GENERATOR_KINDS.has(target.data.kind)) runCreativeAction(target.id, pending.action);
    else if (target.data.kind === 'dataset' && pending.action === 'visualize') visualizeDataset();
    else if (target.data.kind === 'dataset' && pending.action === 'plot') plotDataset();
    else if (target.data.kind === 'dataset' && pending.action === 'profile') profileDataset(target.id);
    else if (target.data.kind === 'project' && pending.action === 'expand') expandProject();
    else if (target.data.kind === 'project' && pending.action === 'compare') compareProjects();
    else if (target.data.kind === 'mockupSet' && pending.action === 'expand') expandMockupSet();
    else if ((target.data.kind === 'mockup' || target.data.kind === 'mockupSet') && pending.action === 'deliver') deliverMockup();
    else if (target.data.kind === 'standup' && pending.action === 'start') startStandup();
    else if (target.data.kind === 'poll') void runPollAction(target.id, pending.action);
    else if (target.data.kind === 'evermind' && pending.action === 'train') openEvermindTraining();
    else if (target.data.kind === 'evermind' && pending.action === 'evaluate') evaluateEvermind(target.id);
    else if (target.data.kind === 'testPlan' && pending.action === 'gate') evaluateReleaseGate(target.id);
    // TEN acts used to be ten branches here, each naming a kind and an action, and
    // each one a place to forget the next kind that offers the same act. They are
    // registry entries now (`domains/canvas/application/cardActs.ts`), so this is
    // one lookup and the chain stops growing.
    else if (cardActFor(CARD_ACTS, target.data.kind, pending.action)) runCardActOnObject(target.id, pending.action);
    else if (pending.action === 'export') void exportArtifact(target.id, defaultExportAction(target.data.kind)).then(setNotice);
    else if (target.data.kind === 'slides' && pending.action === 'present') setPresentMode(true);
    else if (target.data.kind === 'evermind' && pending.action === 'publish') {
      openEvermindTraining();
      setNotice(t('noticeUseTrainedPackage'));
    }
    else {
      setNotice(t('noticeNoDeliveryAdapter', { action: pending.action, kind: creationObjectDefinition(target.data.kind).label }));
    }
  });
  useEffect(() => {
    if (dispatchedBrainAction) performBrainAction(dispatchedBrainAction);
  }, [dispatchedBrainAction]);
  const { exportSession, openHistory, createCheckpoint, restoreRevision, restoreLocalCheckpoint } = useCanvasHistory({ canEdit, checkpointName, edges, flowRef, nodes, persistence, sessionId, setCheckpointName, setEdges, setHistory, setHistoryOpen, setLocalCheckpoints, setNodes, setNotice, t, timeline, title, viewportRef });

  const cleanLayout = useCanvasCleanLayout({ boardRef: flowWrapRef, instanceRef: flowRef, setNodes, edges, padding: .16, maxZoom: .9 });
  const { zoomInAction, zoomOutAction, fitViewAction, framedBoard, roomSceneInput, threeDNodes, describeThreeD, selectThreeDObject, moveThreeDObjects, roomCreations, openRoomCreation } = useCanvasRenderedBoard({ activeAgentIds, canEdit, comparisonModelIds, dockPanel, edges, evermindLiveByNodeId, flowRef, frameFocus, framedBoardRef, minimapColor: canvasMinimapColor, nodes, outlineHighlightIds, setInspectorFocus, setNodes, setSelectedId, setSelectedIds, setSurface, showHidden, t, threeDControls, timeline });
  const { startCanvasTurnRef, exportFromNode, startCanvasTurn, stopCanvasRun, queuedTurns } = useCanvasTurnQueue({ appendTimeline, assistantGate, canvasRunRef, evaluateCanvas, exportArtifact, persistence, prompt, resolvedScopeMode, scopedNodeIds, sessionId, setActiveAgentIds, setBrainRunStartedAt, setNotice, setPrompt, setThinking, t, thinking });
  const { tailorResumeFromNode, detachResumeFromNode, createResumeShare, listResumeShares, revokeResumeShare } = useCanvasResumeShares({ persistence, sessionId, setNodes, setNotice, setScopeMode, setSelectedId, setSelectedIds, startCanvasTurnRef, t });
  /**
   * The same treatment for `runWorkflow`, which needed it just as badly and was
   * missed.
   *
   * It closes over `resolveWorkflowNode`, which closes over `nodes` AND
   * `selectedNode` — so it changed identity on every board edit and on every
   * SELECTION, which handed React Flow a new `nodeTypes` and remounted every
   * Object on the board each time. Most cards survive a remount because they are
   * pure functions of their data; the ones that fetch do not. The catalog-tool
   * card refetches its definition on mount, so clicking around a board with a
   * diagnostic on it put that card back on "Loading…" indefinitely — one request
   * per selection, hundreds in a session.
   */
  const runWorkflowRef = useLatestRef(runWorkflow);
  const runWorkflowFromNode = useCallback((nodeId: string) => { runWorkflowRef.current(nodeId); }, [runWorkflowRef]);
  const openBuiltinAgentSurface = useCallback((nodeId: string, intent: BuiltinAgentSurfaceIntent) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const href = builtinAgentSurfaceHref(node?.data.agentDomain, node?.data.agentSeat, intent);
    if (!href) return;
    // Web navigation stays inside the app shell, where the destination opens as
    // a side panel over this still-mounted canvas. The editor host owns its own
    // navigation contract.
    if (canvasSurface() === 'vscode') canvasNavigate(href);
    else router.push(href);
  }, [nodes, router]);
  const openBuiltinAgentSurfaceRef = useLatestRef(openBuiltinAgentSurface);
  const openBuiltinAgentSurfaceFromNode = useCallback((nodeId: string, intent: BuiltinAgentSurfaceIntent) => {
    openBuiltinAgentSurfaceRef.current(nodeId, intent);
  }, [openBuiltinAgentSurfaceRef]);
  // Brain reaches its Object through BrainSurfaceProvider, not through this memo:
  // a per-token dependency here would hand React Flow a new nodeTypes object and
  // remount every Object on the board on every streamed word.
  /** The inspector's board — see `inspector/inspectorContext.tsx`. */
  const removeConnection = useCallback((edgeId: string) => setEdges((current) => current.filter((edge) => edge.id !== edgeId)), [setEdges]);
  const convertDiagramFromInspector = useCallback(async (nodeId: string, format: string, diagramId?: string) => {
    const result = await convertObjectToDiagram(nodeId, format, diagramId);
    return result.ok ? t(diagramId && diagramId !== '__new__' ? 'diagramAddedStatus' : 'diagramCreatedStatus') : result.error || t('drawioAppendFailed');
  }, [convertObjectToDiagram, t]);
  const askBrainFromInspector = useCallback((request: string) => { openBrainDock(); evaluateCanvas(request); }, [evaluateCanvas, openBrainDock]);
  const inspectorValue = useMemo<CanvasInspectorValue>(() => ({
    nodes, edges, focus: inspectorFocus, timeline, brainTrace, sessionId, persistence, role: sessionRole, editable: canEdit && !lockBlocked, members, creatingBuild,
    updateNodeData, updateWebsiteViewport, runWorkflow, publishWebsite, openBuild, attachBuild, deleteBuildWorkspace, buildWebsiteWithCode,
    generateVideo, runCreativeAction, openGamePanel, openPublishPanel, openReleasesPanel, unpackWorkflow, compileWorkflow, buildFlow,
    openEvermindBuild, loadEvermindTemplate, openBuiltinAgent: openBuiltinAgentSurfaceFromNode, addAgentKnowledge, runAgentTest,
    convertDiagram: convertDiagramFromInspector, exportArtifact,
    removeConnection, saveAgent, saveFramePreset, expandProject, loadProjectQuality, compareProjects, deliverMockup, expandMockupSet,
    importDataset, visualizeDataset, plotDataset, profileDataset, attachEvermindProject, expandEvermindPipeline, trainEvermind: openEvermindTraining,
    startStandup, askBrain: askBrainFromInspector,
    resumeTailor: tailorResumeFromNode, resumeDetach: detachResumeFromNode, resumeShare: createResumeShare, resumeSharesList: listResumeShares, resumeShareRevoke: revokeResumeShare,
  }), [addAgentKnowledge, askBrainFromInspector, attachBuild, attachEvermindProject, brainTrace, buildFlow, buildWebsiteWithCode, canEdit, compareProjects, compileWorkflow, convertDiagramFromInspector, createResumeShare, creatingBuild, deleteBuildWorkspace, deliverMockup, detachResumeFromNode, edges, expandEvermindPipeline, expandMockupSet, expandProject, exportArtifact, generateVideo, importDataset, inspectorFocus, listResumeShares, loadEvermindTemplate, loadProjectQuality, lockBlocked, members, nodes, openBuild, openBuiltinAgentSurfaceFromNode, openEvermindBuild, openEvermindTraining, openGamePanel, openPublishPanel, openReleasesPanel, persistence, plotDataset, profileDataset, publishWebsite, removeConnection, revokeResumeShare, runAgentTest, runCreativeAction, runWorkflow, saveAgent, saveFramePreset, sessionId, sessionRole, startStandup, tailorResumeFromNode, timeline, unpackWorkflow, updateNodeData, updateWebsiteViewport, visualizeDataset]);
  const canvasNodeTypes = useMemo<NodeTypes>(() => ({
    creation: (props) => <CreationNode {...props} canRun={canRun} onRun={runWorkflowFromNode} onExport={exportFromNode} onOpenBuiltinAgent={openBuiltinAgentSurfaceFromNode} onOpenPanel={openNodePanel} onInsertFrom={openInsertPicker} onOpenSurface={(nodeId, surface) => setSurface(surface, nodeId)} onOpenFrame={openFrame} onRevealObject={revealObject} {...(cardsEditable ? { onEditData: updateNodeData, onMoveDeal: moveDealFromNode, onDeleteNode: deleteNodeFromCard } : {})} onOpenDetails={(nodeId, focus) => {
      setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
      // Asking for a specific section (knowledge, test, evaluation, delivery) is asking
      // for the WIDE panel directly — the short one has no such section to scroll to.
      setSelectedId(nodeId); setSelectedIds([nodeId]); openNodeInspector(nodeId, focus || null);
    }} />,
  }), [canRun, cardsEditable, deleteNodeFromCard, exportFromNode, moveDealFromNode, openBuiltinAgentSurfaceFromNode, openFrame, openInsertPicker, openNodeInspector, openNodePanel, revealObject, runWorkflowFromNode, setDiagnosticsOpen, setHistoryOpen, setOutcomeMetricsOpen, setSelectedId, setSelectedIds, setSurface, updateNodeData]);
  /**
   * An object in the 3D space is drawn by the component that draws it on the board —
   * a website shows its page, an agent its latest response — so the two readings of
   * one board cannot disagree about what an object looks like. Depends on the node
   * types alone, so each face redraws only when its own object changes.
   */
  const renderThreeDCard = useCallback(
    (node: CreationFlowNode) => <CanvasNodeFace node={node} nodeTypes={canvasNodeTypes} />,
    [canvasNodeTypes],
  );
  const { openOutcomeMetrics, openDiagnostics, buildDiagnostics, buildProofJourneyDiagnostics } = useCanvasDiagnostics({ allMembers, autoApplyRef, brainRunStartedAt, brainRuntimeRef, brainTrace, canvasActions, currentGraphRef, edges, effectiveSelectedIds, journalRef, lastSavedGraphRef, memoryEnabled, modelSelection, nodes, pendingInvitations, persistence, proposedChanges, realtimeState, resolvedScopeMode, revisionRef, saveInFlightRef, scopedNodeIds, scopedNodes, sessionId, sessionMode, sessionRole, setDiagnosticsOpen, setHistoryOpen, setOutcomeMetrics, setOutcomeMetricsError, setOutcomeMetricsLoading, setOutcomeMetricsOpen, t, thinking, timeline, title, toast, undoStackRef });
  const { brainSurfaceOpen, brainPlacement, rosterMembers, seatedAgents, boardBridge, spacePresence, brainDockReserved, brainSurface, brainMessages, brainReveal, brainRunning, brainRunShownStartedAt, brainNode, brainCollaborators, replayBrainMessage, guestSignupPrompt, roomOccupants, roomSpeechBySeat, revealSpeechInChat, rosterSelfId, brainUnreadReplies } = useCanvasBrainSurface({ activeAgentIds, brainDock, brainRunStartedAt, brainTrace, cardActBoard, cardsEditable, currentUserId, deleteObjects, edges, evermindProjectId, guestLimit, inRoom, joinedCollaborator, liveMembers, livePresence, members, nodes, openBrainDock, persistence, presenceSelfId, presentMode, sendPresence, sessionId, setSelectedId, setSelectedIds, sharedRoom, startCanvasTurnRef, surfaceDef, t, thinking, timeline, title, updateBrainDock, updateNodeData });

  /* The prompt sits bottom-centre, where every chat product people already use puts it,
     and is deliberately NOT part of the Brain surface: it stays reachable whether Brain
     is inline in its Object, docked to either edge, or closed entirely. */
  // WHERE THE ONE COMPOSER GOES — see `effectiveCanvasPromptPlacement`.
  const brainDockDrawn = brainSurfaceOpen && brainPlacement === 'docked' && !surfaceDef.brainIsSurface;
  const effectivePromptPlacement = effectiveCanvasPromptPlacement({ hostOwnsSurface: !!hostSurfaces?.[surface], brainIsSurface: surfaceDef.brainIsSurface, preference: promptPlacement, brainDockDrawn, lensPlacement: lensDef.promptPlacement });
  const promptInBrainPanel = effectivePromptPlacement === 'docked';
  /** THE ONE COMPOSER — see `CanvasPromptComposer`. One element, drawn in exactly one of
   *  its two homes below: the Brain panel's last row, or floating over the board. */
  const composer = !presentMode && effectivePromptPlacement !== 'closed' && <CanvasPromptComposer
    docked={promptInBrainPanel} intents={surfaceDef.composerIntents} editable={cardsEditable} preferAsk={phoneViewport && brainSurfaceOpen}
    startTurn={startCanvasTurn} onCaptureIdea={captureIdeaFromComposer} hostRef={composerDockRef} actionsOpen={actionsOpen} onToggleActions={toggleActionsSheet}
    running={thinking} trace={brainTrace} runStartedAt={brainRunStartedAt} brainIsSurface={surfaceDef.brainIsSurface}
    promptPlacement={promptPlacement} setPromptPlacement={setPromptPlacement} brainDockDrawn={brainDockDrawn} updateBrainDock={updateBrainDock}
    prompt={prompt} setPrompt={setPrompt} onStop={stopCanvasRun} queuedCount={queuedTurns.count}
    scopeMode={scopeMode} setScopeMode={setScopeMode} scopeLabel={scopeLabel} selectionCount={effectiveSelectedIds.length} frameSelected={selectedNode?.data.kind === 'frame'}
    onAttach={attachCanvasArtifact} onAddContext={openObjectPicker} autoMode={autoApply} onAutoModeChange={setAutoApplyMode}
    modelSelection={modelSelection} modelOptions={canvasModelOptions} onModelSelectionChange={setModelSelection} modelIdentity={modelIdentity}
    chatMode={sessionMode} onChatModeChange={setSessionMode} memoryEnabled={memoryEnabled} onMemoryChange={setMemoryMode}
    hasMemoryProject={evermindProjectId != null} onTwilioJourney={setTwilioPromptSelected} applyTemplate={applyTemplate} conversationStarted={brainMessages.length > 0}
  />;

  const sessionActionHandlers = useCanvasSessionActionHandlers({
    closeActionMenus, undo, redo, openOutcomeMetrics, outcomeMetricsOpen, openDiagnostics, diagnosticsOpen, walkthroughRef, walkthroughStopCount: walkthroughStops.length,
    toggleFullscreen, fullscreen, liveRoom, hasAccount, talktrackOpen, setTalktrackOpen, runWorkflow, presentMode, setPresentMode, drawingMode, setDrawing,
    shareOpen, setShareOpen, openReleasesPanel, releaseOpen: releaseFocus !== null, timeline, title, sessionId, persistence, requireAccount,
    standup: { members: rosterMembers, agents: seatedAgents, boardProjectId, ceremonyEnabled: hasAccount, onError: setNotice, onAgentRound: startCanvasTurn },
  });
  const sessionFacts = useMemo<CanvasSessionFacts>(() => ({ sessionId, persistence, role: sessionRole, canEdit, notify: setNotice, requireAccount, lens }), [canEdit, lens, persistence, requireAccount, sessionId, sessionRole, setNotice]);
  const brainConversation = useBrainConversation({
    brain: { brainMessages, brainReveal, brainRunning, brainRunShownStartedAt, brainNode, brainCollaborators, replayBrainMessage, brainSurface, guestSignupPrompt },
    showExecutionDetail: brainDock.showExecutionDetail, updateBrainDock, trace: brainTrace, nodes, edges, joinedCollaborator,
  });
  const closeAccountGate = useCallback(() => setAccountGate(null), []);

  // The three sheets the chrome hands to whichever host draws it — see each component.
  const inviteMenu = <CanvasInviteSheet open={shareOpen} onClose={closeShareSheet} inRoom={inRoom} sharedRoom={sharedRoom} draft={inviteDraft} currentUserId={currentUserId} allMembers={allMembers} setAllMembers={setAllMembers} pendingInvitations={pendingInvitations} setPendingInvitations={setPendingInvitations} />;
  const makeItRealChrome = <CanvasMakeItReal open={realOpen} onToggle={toggleRealMenu} onClose={closeRealMenu} surface={surface} collapsed={barCollapsed} handlers={sessionActionHandlers} onExport={exportSession} />;
  const boardMenuChrome = <CanvasBoardMenu
    open={moreOpen} onToggle={toggleMoreMenu} onClose={closeMoreMenu} phoneViewport={phoneViewport} showsBoard={surfaceDef.showsBoard}
    onZoomIn={zoomInAction} onZoomOut={zoomOutAction} onFit={fitViewAction} onArrange={cleanLayout} minimapOpen={minimapOpen} setMinimapOpen={setMinimapOpen}
    gesture={canvasGesture} setGesture={setCanvasGesture} threeD={threeDControls} dockPanel={dockPanel} toggleDockPanel={toggleDockPanel} allowPanel={connectedAccountGate}
    onTemplates={() => setTemplateOpen(true)} setConversationOpen={setConversationOpen} onHistory={openHistory} onTutorial={sectionTour.openOffer}
    showHidden={showHidden} setShowHidden={setShowHidden} onBranch={createBranch} onMerge={branchParentId ? prepareMerge : undefined}
    connectors={{ kind: connectionKind, onKindChange: setConnectionKind, style: connectionStyle, onStyleChange: setConnectionStyle }}
  >
    <CanvasTemplateMenu open={templateOpen} onClose={() => setTemplateOpen(false)} browser={templateBrowser} onPrompt={setPrompt} onPack={applyTemplate} serverTemplates={serverTemplates} onServerTemplate={applyServerTemplate} framePresets={framePresets} onFramePreset={addFramePreset} />
  </CanvasBoardMenu>;

  return (
    // Published to the whole shell, not just the board: the Brain surface's controls
    // render in three places and each needs the same answer to "is there a board to move
    // this conversation into?". One provider, read where it is needed.
    <CanvasSurfaceProvider value={surface}>
    {/* Same reasoning for the card-act runner: a card's action button is drawn deep in
        the inspector, and handing it a callback would have meant one more entry in a
        prop list that already carries fifty. Published once, read where it is needed. */}
    <CardActProvider runner={runCardActOnObject}><CanvasBoardBridgeProvider value={boardBridge}><CanvasSpacePresenceProvider value={spacePresence}><CanvasDiagnosticsProvider value={buildDiagnostics}><CanvasSessionProvider value={sessionFacts}>
    <CanvasShell shellRef={shellRef} fullscreen={fullscreen} hosted={!!hostSurfaces} lens={lens} brainDockSide={brainDock.side} brainDockReserved={brainDockReserved} phase={{ phase, setPhase, readiness: phaseReadiness, askBrain: startCanvasTurn, publishApp, appendAtCenter: cardsEditable ? appendAtCenter : null, openSurface: setSurface }}>
      {lensDef.chrome.topChrome && <CanvasTopChrome
        phoneViewport={phoneViewport} topChromeRef={topChromeSpaceRef} title={title} surface={surface} setSurface={setSurface}
        collapsed={barCollapsed} roster={rosterMembers} share={sessionActionHandlers.share} inviteMenu={inviteMenu} boardMenu={boardMenuChrome} onExitToLibrary={onExitToLibrary} notice={notice}
      />}
      {/* A lens with no command bar draws its own one-row bar instead, and it owns the top
          band: ONE host for `--canvas-top-chrome-space` at a time. */}
      {!lensDef.chrome.commandBar && <CanvasLensBar hostRef={topChromeSpaceRef} title={title} notice={notice} />}
      <CanvasNodePanelHost nodePanel={nodePanel} setNodePanel={setNodePanel} anchorFrom={anchorFrom} presentMode={presentMode} nodes={nodes} editable={canEdit && !lockBlocked} updateNodeData={updateNodeData} setInspectorFocus={setInspectorFocus} setSurface={setSurface} inspectorValue={inspectorValue} />

      <CanvasObjectPickerHost objectPicker={objectPicker} setObjectPicker={setObjectPicker} onPick={pickObject} />

      {lensDef.chrome.commandBar && <CanvasDesktopCommandBar
        phoneViewport={phoneViewport} hostRef={commandBarSpaceRef} surface={surface} setSurface={setSurface} collapsed={barCollapsed} setCollapsed={setBarCollapsed}
        handlers={sessionActionHandlers} makeItReal={makeItRealChrome} boardMenu={boardMenuChrome} inviteMenu={inviteMenu} runnableApp={runnableApp}
        objectPickerOpen={objectPickerOpen} setObjectPicker={setObjectPicker} setNodePanel={setNodePanel}
        roster={rosterMembers} followingUserId={followingUserId} currentUserId={currentUserId} setFollowingUserId={setFollowingUserId} seatedAgents={seatedAgents}
        promptToggleable={!presentMode && !surfaceDef.brainIsSurface} promptPlacement={promptPlacement} setPromptPlacement={setPromptPlacement} promptOpen={effectivePromptPlacement !== 'closed'}
        canvasUsesTwilio={twilioPromptSelected || boardUsesTwilio(nodes)} selectedNode={selectedNode} captureDisabled={!canEdit || lockBlocked} onCapture={addHostCapture}
      />}

      <CanvasAccountGateDialog gate={accountGate} onClose={closeAccountGate} hasAccount={hasAccount} claimingDraft={claimingDraft} setClaimingDraft={setClaimingDraft} />

      <CanvasBoardStage
        boardRef={flowWrapRef} brainSide={brainDockReserved > 0 ? brainDock.side : 'none'} brainOpen={brainDockDrawn} surface={surface} drawingMode={drawingMode}
        onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={() => { cursorRef.current = null; drawingPointsRef.current = []; sendPresence({ cursor: null }); }}
        onDragEnter={onCanvasDragEnter} onDragLeave={onCanvasDragLeave} onDrop={onDrop}
      >
        <CanvasFileDropOverlay active={fileDragging} />
        <CanvasDrawingToolbar drawing={drawing} setDrawing={setDrawing} />
        <CanvasPresentBar presentMode={presentMode} steps={presentationSteps} step={presentStep} onMove={movePresentation} setPresentMode={setPresentMode} />
        <CanvasSelectionToolbar
          presentMode={presentMode} objectsOnScreen={objectsOnScreen} selectedIds={effectiveSelectedIds} nodes={nodes} onFocus={focusSelection} onDuplicate={duplicateSelection}
          onAlign={alignSelection} onFrame={frameSelection} onTogglePlacementLock={togglePlacementLock} onToggleHidden={toggleHidden} onDelete={deleteSelection}
        />
        <CanvasFrameFocusBar frameFocus={frameFocus} nodes={nodes} memberIdsOf={framedBoard.memberIdsOf} onExit={exitFrame} />
        <CanvasLoadingSkeleton loading={loadingSession} />
        <CanvasLargeSessionNotice objectsOnScreen={objectsOnScreen} count={nodes.length} onFrame={openObjectPicker} />
        <CanvasBoardFlow
          brainSurface={brainSurface} nodes={framedBoard.nodes} edges={framedBoard.edges} nodeTypes={canvasNodeTypes} onNodesChange={onCanvasNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} connectionProps={connectionProps} onNodeClick={onNodeClick} onSelectionChange={onSelectionChange} onPaneClick={clearSelection} onMoveEnd={onViewportChange}
          interactionProps={interactionProps} flowRef={flowRef} pendingViewportRef={pendingViewportRef} drawingMode={drawingMode} liveMembers={liveMembers} presenceSelfId={presenceSelfId}
          minimapOpen={minimapOpen} setMinimapOpen={setMinimapOpen} onCleanLayout={cleanLayout} threeDActive={!surfaceDef.showsBoard}
        />

        {/* NOTHING FLOATS OVER THE BOARD HERE ANY MORE.
            The phone's surface switcher used to be an icon COLUMN parked in this
            corner — five unlabelled glyphs over the surface's own heading, with a rule
            that laid them down in a row ACROSS that heading whenever the Brain sheet
            opened. It is `CanvasSurfaceStrip` now, worded, in its own band under the
            canvas app bar at the top of the shell. "Add to canvas" left this corner
            earlier and for the same reason: one door onto the picker, on the bar. */}

        <CanvasSurfaceStage
          surface={surface} hostSurfaces={hostSurfaces} surfaceNode={surfaceNode} exitSurface={exitSurface} setSurface={setSurface} sessionApp={sessionApp} sessionTitle={title} entryAppPending={entryApp.pending}
          nodes={nodes} editable={cardsEditable} updateNodeData={updateNodeData} appendAtCenter={appendAtCenter} revealObject={revealObject}
          conversation={brainConversation} roster={rosterMembers} openGamePanel={openGamePanel} setShareOpen={setShareOpen} doors={{ prove: sessionActionHandlers.prove, publish: sessionActionHandlers.publish, openListing: openPublishPanel, openReleases: openReleasesPanel, openSocial: () => { if (connectedAccountGate(tSocial('title'))) setDockPanel('social'); } }}
          resume={{ tailorResumeFromNode, detachResumeFromNode, createResumeShare, listResumeShares, revokeResumeShare }}
          room={<CanvasRoomStage
            title={title} members={roomOccupants} speech={roomSpeechBySeat} onSelectSpeech={revealSpeechInChat} currentUserId={rosterSelfId} live={livePresence}
            onPresence={sendPresence} sceneInput={roomSceneInput} brainSurface={brainSurface} threeDNodes={threeDNodes} edges={edges} describe={describeThreeD}
            renderCard={renderThreeDCard} selectedIds={effectiveSelectedIds} onSelect={selectThreeDObject} onMove={moveThreeDObjects} creations={roomCreations}
            onOpenCreation={openRoomCreation} onPublishRoom={openPublishPanel} sessionInitiallyOpen={comparisonModelIds.length >= 2} onExit={() => setSurface('graph')}
          />}
        />

        <CanvasSidePanels
          dockPanel={dockPanel} closeDockPanel={closeDockPanel} files={{ sessionFiles, downloadCanvasFile, revealObject }} addFilesToCanvas={addFilesToCanvas}
          connectedAccountGate={connectedAccountGate} sources={{ importMiroBoard, addSocialFeedToBoard, addSocialCampaignToBoard, boardMedia }}
          gameShipFocus={gameShipFocus} setGameShipFocus={setGameShipFocus} gamePanelTarget={gamePanelTarget} talktrackOpen={talktrackOpen} setTalktrackOpen={setTalktrackOpen}
          title={title} selectedNode={selectedNode} captureDisabled={!canEdit || lockBlocked} onCapture={addHostCapture} publishFocus={publishFocus} setPublishFocus={setPublishFocus}
          releaseFocus={releaseFocus} setReleaseFocus={setReleaseFocus} nodes={nodes} edges={edges} setSelectedId={setSelectedId} setSelectedIds={setSelectedIds}
          openNodePanel={openNodePanel} setOutlineHighlightIds={setOutlineHighlightIds}
        />
        <CanvasWorkspaceOverlays
          evermindBuild={evermindBuild}
          setEvermindBuild={setEvermindBuild} trainingFocus={trainingFocus} setTrainingFocus={setTrainingFocus} setNodes={setNodes}
        />
        <CanvasHistoryPanel
          open={historyOpen} setOpen={setHistoryOpen} history={history} localCheckpoints={localCheckpoints} checkpointName={checkpointName} setCheckpointName={setCheckpointName}
          createCheckpoint={createCheckpoint} restoreRevision={restoreRevision} restoreLocalCheckpoint={restoreLocalCheckpoint}
        />
        <CanvasOutcomeMetricsPanel open={outcomeMetricsOpen} setOpen={setOutcomeMetricsOpen} metrics={outcomeMetrics} loading={outcomeMetricsLoading} error={outcomeMetricsError} onRetry={openOutcomeMetrics} buildProofJourneyDiagnostics={buildProofJourneyDiagnostics} />
        <CanvasConversationPanel open={conversationOpen} setOpen={setConversationOpen} timeline={timeline} buildDiagnostics={buildDiagnostics} />
        <CanvasDiagnosticsPanel
          open={diagnosticsOpen} setOpen={setDiagnosticsOpen} revision={revision} realtimeState={realtimeState} objectCount={nodes.length} connectionCount={edges.length}
          thinking={thinking} actionCount={canvasActions.length} scope={resolvedScopeMode} buildDiagnostics={buildDiagnostics}
        />

        <CanvasChangeSetPanel changes={proposedChanges} accepted={acceptedProposalIds} setAccepted={setAcceptedProposalIds} onReject={rejectProposedChanges} onApplyAndAutoApply={applyAndEnableAutoApply} onApply={applyProposedChanges} />
        <CanvasMergePanel review={mergeReview} setReview={setMergeReview} onApply={applyMerge} />

        <CanvasBrainDockHost
          drawn={brainDockDrawn} conversation={brainConversation} composer={composer} promptInPanel={promptInBrainPanel} onUndockPrompt={() => setPromptPlacement('float')}
          mode={brainPlacement} preferences={brainDock} updateBrainDock={updateBrainDock}
        />
        {/* Floating over the board. A docked prompt is not drawn here at all — it is a row
            inside the panel above, and rendering it in both places would mount the same
            live composer twice. */}
        {!promptInBrainPanel && composer}
        <CanvasBrainLauncher
          visible={!presentMode && !brainDock.open && !surfaceDef.brainIsSurface && (brainPlacement === 'docked' || !brainNode)}
          side={brainDock.side} thinking={thinking} unreadReplies={brainUnreadReplies} updateBrainDock={updateBrainDock}
        />
        <CanvasPhoneActions open={actionsOpen} surface={surface} handlers={sessionActionHandlers} onClose={closeActionsSheet} setObjectPicker={setObjectPicker} setNodePanel={setNodePanel} />
      </CanvasBoardStage>
      <CanvasTours
        tour={sectionTour} onStepChange={prepareTourStep} walkthroughRef={walkthroughRef} boardId={sessionId}
        audienceId={currentUserId || (persistence === 'local' ? 'guest' : null)} stops={walkthroughStops} busy={thinking} onReveal={revealObject}
      />
    </CanvasShell>
    </CanvasSessionProvider></CanvasDiagnosticsProvider></CanvasSpacePresenceProvider></CanvasBoardBridgeProvider></CardActProvider>
    </CanvasSurfaceProvider>
  );
}

export function CreationCanvas({ sessionId, persistence = 'server', lens = 'canvas', initialFocusId, initialShareOpen, initialPrompt, initialPresent, initialModelComparisonIds, stageActive = true, hostSurfaces, initialSurface, onExitToLibrary }: { sessionId: string; persistence?: 'local' | 'server'; /** How the board is presented — `/create` (canvas) or `/studio` (studio). LIVE: the same instance switches lens with the route. See `lib/canvasLens.ts`. */ lens?: CanvasLens; initialFocusId?: string | null; initialShareOpen?: boolean; initialPrompt?: string | null; initialPresent?: boolean; initialModelComparisonIds?: readonly string[]; stageActive?: boolean; /** Surfaces the embedding host implements itself — see `CanvasSurfaceRouter`. VS Code supplies `chat`, whose runs execute in the extension host. */ hostSurfaces?: CanvasSurfaceNodes; /** The surface this ENTRY asked for, above the stored preference — what "open my chat" means. */ initialSurface?: CanvasSurfaceId;
  /**
   * The way OUT of this board, on a phone — the back button in the canvas app bar.
   *
   * A prop rather than a `router.push` in here because not every host has a library to
   * go back to: the VS Code webview opens one canvas and has no `/create` behind it, and
   * a back button that navigates nowhere is worse than no back button. The web page
   * passes the push; an embedding host passes nothing and the button is not drawn.
   */
  onExitToLibrary?: () => void }) {
  // The 3D scene publishes its view commands to the canvas rail rather than
  // carrying a toolbar of its own, so both live under one provider — and the app
  // surface publishes ITS controls into the session bar for the same reason, which
  // is what leaves this canvas with one bar instead of one per runtime.
  return <ReactFlowProvider><Canvas3DControlsProvider><CanvasSurfaceActionsProvider><CanvasInner sessionId={sessionId} persistence={persistence} lens={lens} initialFocusId={initialFocusId} initialShareOpen={initialShareOpen} initialPrompt={initialPrompt} initialPresent={initialPresent} initialModelComparisonIds={initialModelComparisonIds} stageActive={stageActive} hostSurfaces={hostSurfaces} initialSurface={initialSurface} onExitToLibrary={onExitToLibrary} /></CanvasSurfaceActionsProvider></Canvas3DControlsProvider></ReactFlowProvider>;
}
