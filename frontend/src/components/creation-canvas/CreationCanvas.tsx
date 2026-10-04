import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePolledResource } from '@/hooks/usePolledResource';
import {
  addEdge,
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AddObjectIcon, CANVAS_FIT_MIN_ZOOM, CanvasCommands, DisclosureIcon, MoreActionsIcon, ProveIdeaIcon, useCanvasCleanLayout } from '@/components/canvas/CanvasCommands';
import type { Canvas3DMove } from '@/components/canvas/Canvas3DView';
import { CanvasNodeFace } from '@/components/canvas/CanvasNodeFace';
import { leadsToRoom, type RoomCreation } from '@/lib/canvas/roomCreations';
import { roomCreationsOf } from './roomCreationsOf';
import { useCanvasStandupAction } from './useCanvasStandupAction';
import { Canvas3DControlsProvider, useCanvas3DControls } from '@/components/canvas/canvas3dControls';
import { canvasSurfaceDefinition, readCanvasSurface, writeCanvasSurface, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { DEFAULT_CANVAS_PHASE, readCanvasPhase, surfacesForPhase, writeCanvasPhase, type CanvasPhase } from '@/lib/canvasPhases';
import { canvasChromeShows, readCanvasBarCollapsed, writeCanvasBarCollapsed } from '@/lib/canvasChrome';
import { canvasApp } from '@/lib/canvasApp';
import { isTypingTarget } from '@/lib/keyboardTarget';
import { canvasNodeMessages, type CanvasNodePanelId, canvasNodeSettingsPanel } from '@/lib/canvasNodeAffordances';
import { memberAvatarClass, memberInitials } from './rosterAvatar';
import {
  DEFAULT_CANVAS_PROMPT_PLACEMENT,
  readCanvasPromptPlacement,
  toggledCanvasPromptPlacement,
  writeCanvasPromptPlacement,
  type CanvasPromptPlacement,
} from '@/lib/canvasPromptPlacement';
import { CanvasNodePanel } from './CanvasNodePanel';
import { CanvasObjectPicker } from './CanvasObjectPicker';
import { parsePaletteChoice, stencilSeed, stencilSize, type PaletteChoice } from '@/lib/canvasStencils';
import { type ConnectionStyle, DEFAULT_CONNECTION_STYLE, edgeVisuals } from '@/lib/canvasConnectionStyle';
import { CanvasSurfaceRouter, type CanvasSurfaceNodes } from './CanvasSurfaceRouter';
import { CanvasFacilitateSurface } from './CanvasFacilitateSurface';
import { CanvasFormSurface } from './CanvasFormSurface';
import { publishPoll, setPollState } from '@/lib/pollApi';
import { pollJoinUrl, pollPublishBody } from '@/lib/pollObject';
import { CanvasCalendarSurface } from './CanvasCalendarSurface';
import { PhaseModalitySelector } from './PhaseModalitySelector';
import { CanvasSurfaceStrip } from './CanvasSurfaceStrip';
import { CanvasPhoneAppBar } from './CanvasPhoneAppBar';
import { CanvasComposer } from './CanvasComposer';
import { CanvasActionsSheet } from './CanvasActionsSheet';
import { CanvasActionsTrigger } from './CanvasActionsTrigger';
import { CanvasBoardMenuBody, type CanvasDockPanel } from './CanvasBoardMenuBody';
import { useBrainUnreadReplies } from './useBrainUnreadReplies';
import { usePhoneViewport } from '@/lib/usePhoneViewport';
import { IDEA_KIND, ideaFromScratch } from '@/lib/ideaLog';
import { CanvasInsightsSurface } from './CanvasInsightsSurface';
import { CanvasIdeasSurface } from './CanvasIdeasSurface';
import { CanvasSessionActions, type CanvasSessionActionHandler } from './CanvasSessionActions';
import { CanvasMenuSheet } from './CanvasMenuSheet';
import { CanvasSessionPill } from './CanvasSessionPill';
import { RemoteCursors } from './RemoteCursors';
import { mergeLivePresence, peerBrainRuns, BRAIN_RUN_HEARTBEAT_MS, PRESENCE_SEND_INTERVAL_MS } from '@/lib/canvas/livePresence';
import { useLivePresence } from '@/lib/canvas/useLivePresence';
import { resolveStandupProject } from '@/lib/canvas/standupProject';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { CANVAS_PRESENCE_FRAME, type CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { CanvasCommandBar } from './CanvasCommandBar';
import { TeamBar } from '@/components/team/TeamBar';
import { boardAgentOccupants, boardAgents } from '@/lib/canvas/boardAgents';
import { mentionedBoardAgents } from '@/lib/canvas/agentMentions';
import { roomSpeech } from '@/lib/canvas/roomSpeech';
import { CanvasDiagnosticsProvider } from './canvasDiagnosticsContext';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import { CanvasChatSurface } from './CanvasChatSurface';
import { CanvasAppSurface } from './CanvasAppSurface';
import { CanvasPageSurface } from './CanvasPageSurface';
import { CanvasPlaySurface } from './CanvasPlaySurface';
import { CanvasSiteSurface } from './CanvasSiteSurface';
import { CanvasTimelineSurface } from './CanvasTimelineSurface';
import { CanvasSurfaceProvider } from './canvasSurfaceContext';
import { CanvasSurfaceActionsProvider } from './canvasSurfaceActions';
import { applyCanvas3DMoves, canvas3dDepthOffset, type Canvas3DDescriptor, type Canvas3DSceneInput } from '@/lib/canvas/canvas3d';
import { CanvasOutlinePanel } from './CanvasOutlinePanel';
import { CanvasFilesPanel } from './CanvasFilesPanel';
import { CanvasMiroPanel } from './CanvasMiroPanel';
import { CanvasTalktrackPanel } from './CanvasTalktrackPanel';
import type { MiroBoardSummary, MiroImportResult } from '@/lib/miroImport';
import { CanvasSocialPanel } from './CanvasSocialPanel';
import { CanvasAdsPanel } from './CanvasAdsPanel';
import { CanvasAttributedOutcomes } from './CanvasAttributedOutcomes';
import { CanvasHostActions } from './CanvasHostActions';
import { canvasNavigate, canvasSurface, canvasWebOrigin, type CanvasHostCapture } from '@/lib/canvasHost';
import { BrainDock } from './BrainDock';
import { BrainActivityIndicator } from './BrainActivityView';
import { BrainMark } from '@/components/brain/BrainMark';
import { brainDockReservedWidth, brainDockWidth, DEFAULT_BRAIN_DOCK_PREFERENCES, readBrainDockPreferences, writeBrainDockPreferences, type BrainDockMode, type BrainDockPreferences } from './brainDockPreferences';
import { BrainSurfaceProvider, type BrainSurfaceContextValue } from './brainSurfaceContext';
import { useToast } from '@/components/ToastProvider';
import { CreationNode, type CreationFlowNode } from './CreationNode';
import type { CreationNodeData, CreationObjectKind } from './types';
// ── The canvas DOMAIN ────────────────────────────────────────────────────────
// `CanvasBoard` is the aggregate root (`lib/canvas/boundedContexts.ts`). These are
// the operations that produce or consume a whole board, the selection rules, and
// the change vocabulary — all of them pure, none of them React, and every one of
// them previously declared inside this component where its invariants could not
// be asserted. See `domains/canvas/domain/canvasBoard.ts` for why the persistence
// boundary is the place the "declared kind" invariant is enforced.
import { associateBrainWithArtifacts, persistedGraphFromBoard } from '@/domains/canvas/domain/canvasBoard';
import { selectionWithinBoard, shouldAcquireCanvasObjectLock } from '@/domains/canvas/domain/selection';
import { canvasObjectTwin } from '@/domains/canvas/domain/canvasBoard';
import { canvasChangesCanAutoApply, type ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
// The canvas APPLICATION layer. PRD 22 §3.4 used the three dataset materialisations
// as its worked example of a presentation callback running a whole domain query and
// mutating the graph in the same function; they are now use cases that return a
// DESCRIPTION of the change, and this file is what applies it.
import {
  plotDataset as plotDatasetUseCase,
  profileDataset as profileDatasetUseCase,
  visualizeDataset as visualizeDatasetUseCase,
  type MaterializeResult,
} from '@/domains/canvas/application/MaterializeDataset';
import { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import { CARD_ACTS } from '@/domains/canvas/application/cardActs';
import { formatResourceRef, parseResourceRef } from '@builderforce/creation-canvas-contract';
import { canvasPlacementFlags } from '@/domains/canvas/domain/canvasObject';
import { CardActProvider, useCardActRunnerFor, type CardActBoardBinding } from './cardActRunner';
import { CanvasBoardBridgeProvider, useCanvasBoardBridgeFor } from './canvasBoardBridge';
import { CanvasSpacePresenceProvider, type CanvasSpacePresenceValue } from './canvasSpacePresence';
import { syncSocialCampaign as syncCampaignUseCase } from '@/domains/marketing/application/SyncSocialCampaign';
import { socialCampaignGateway } from '@/domains/marketing/infrastructure/socialCampaignGateway';
import { cardActFor } from '@/domains/canvas/application/CardAct';
import {
  boardSignature,
  createCanvasNotices,
  persistBoard,
  saveAttemptKey,
  type CanvasNotices,
} from '@/domains/canvas/application/PersistCanvas';
import { adoptRemoteBoard, type AdoptRemoteBoardDecision, type LocalBoardState } from '@/domains/canvas/application/AdoptRemoteBoard';
import { createPresenceRelay, type PresenceRelay } from '@/domains/canvas/application/PresenceRelay';
import styles from './CreationCanvas.module.css';
import { agileMetricsApi, ceremonySessionsApi, type CreationOutcomeMetric, type CreationOutcomeMetrics, type CreationSessionDetail, type CreationSessionInvitation, creationSessionsApi, type CreationSessionSummary, type CreationSnapshotSummary, type CreationTimelineMessage, llmApi, runtimeApi, type CreationTemplate as ServerCreationTemplate, tasksApi, taskSpecsApi, toolsApi, workflowDefinitions } from '@/lib/builderforceApi';
import {
  compareOutcomeMetric,
  formatOutcomeMetric,
  groupOutcomeMetrics,
  northStarMetric,
  outcomeFamilyLabel,
  outcomeMetricDefinition,
  outcomeMetricLabel,
  type OutcomeTranslator,
} from '@/lib/outcomeMetrics';
import { creationStorageKey, localCreationSnapshot, readLocalCreationSession, writeLocalCreationSession, type LocalCreationSnapshot } from '@/domains/canvas/infrastructure/localCanvasStore';
import { useSharedCanvasRoom } from '@/domains/canvas/presentation/useSharedCanvasRoom';
import { canvasSessionGateway } from '@/domains/canvas/infrastructure/canvasSessionGateway';

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
import { TEAMMATE_JOIN_EVENT, teammateFromDrag, type TeammatePayload } from '@/lib/team/teammate';
import { getGuestDisplayName, guestMediaTransport } from '@/lib/guestRoomApi';
import { useCanvasLiveRoom } from '@/lib/live/useCanvasLiveRoom';
import { GuestInviteLink } from '@/components/guest/GuestInviteLink';
import { GuestCollaboratorNotice } from '@/components/guest/GuestCollaboratorNotice';
import { CanvasInviteLinkPanel } from './CanvasInviteLinkPanel';
import { runCreationCanvasAi, type CanvasAiCompletion } from '@/lib/creationCanvasAi';
import { CanvasRunAbortedError, GuestAiUnavailableError, isCanvasRunAborted } from '@/lib/canvasAiErrors';
import { canvasNoticesFrom } from '@/lib/canvasNotices';
import { canvasTranscriptForModel } from '@/lib/canvasTranscript';
import { projectMemoryHooks, type BrainAction, type BrainMessage, type BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { getProjectEvermindContributions, getProjectEvermindHead, teachProjectEvermindFromText, type ProjectEvermindContributions, type ProjectEvermindHead } from '@/lib/projectEvermindApi';
import { isAwaitingApprovalExecution, type WorkflowApprovalMode, type WorkflowDefinitionGraph } from '@/lib/builderforceApi';
import { guestLimitRefusal, type GuestLimitRefusal } from '@/lib/guestLimit';
import { GuestSignupCta, type GuestSignupPrompt } from '@/components/GuestSignupCta';
import { createProject, evaluateModel, fetchProjects, publishSite } from '@/lib/api';
import { computeProjectHealth } from '@/lib/projectHealth';
import { createCloudAgent, updateAgent } from '@/lib/api';
import { presentationSequence, presentationStepAt, presentationViewport, stepPresentation } from '@/lib/canvasPresentation';
import { localCheckpointSummaries, readLocalCheckpoint, saveLocalCheckpoint, type LocalCheckpointSummary } from '@/lib/creationCheckpoints';
import { createDefaultCreationData, creationObjectDefinition, creationObjectMutableFields, emptyShellProblem, sanitizeCreationObjectPatch, TITLE_IS_CONTENT_KINDS, type CreationObjectGroup } from './creationObjectRegistry';
import { CREATION_TEMPLATES, type CreationTemplate } from '@/lib/templates/creationTemplates';
import { expandTemplateWorkflows } from './expandTemplateWorkflows';
import { describeSocialFilter, socialApi, type SocialCampaign, type SocialFeedFilter } from '@/lib/socialApi';
import { socialCampaignNodeData, socialFeedPatch } from '@/lib/canvasSocial';
import { canvasMediaSource, isCanvasMediaKind } from '@/lib/canvasPublicMedia';
import { trackActivity } from '@/lib/activity/tracker';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { analyzeDependencies, appendCanvasVideoSource, CANVAS_SOCIAL_ACCOUNT_GATE, canvasToolRequiresAccount, canvasVideoDuration, type CanvasVideoSource, canvasVideoSourcesFrom, canvasVideoTimelineFrom, type CreationConnectionKind, type DependencyAnalysis } from '@builderforce/creation-canvas-contract';
import { getStoredTenantToken } from '@/lib/auth';
import { useViewerSession } from '@/lib/viewerSession';
import { claimLocalDraft } from '@/lib/pendingWork';
import { downloadBlob, downloadJson, downloadText, toCsv } from '@/lib/download';
import { OfficeExportUnavailableError, exportCsv, exportDocx, exportPdf, exportPptx, exportXlsx } from '@/lib/exportApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { profileTabular, type TabularSource } from '@/lib/canvasTabularData';
import { classificationSummary, classifyTabular, evaluateDatasetUse, normalizeClassifications, normalizeUsePolicy } from '@/lib/canvasDataGovernance';
// The brand a generative object composes against, and the consent state a send is
// gated on. Adapter only — the rules live in the contract; see `canvasMarketing.ts`.
import { brandForNode, brandViolationsIn } from '@/lib/canvasMarketing';
import { useCoarsePointer } from '@/lib/useCoarsePointer';
import { flowConnectionProps } from '@/lib/flowConnection';
import { canvasInteractionProps, type CanvasGesture } from './canvasPointerMode';
import { type CanvasStroke, canvasStrokes, DRAWING_TOOLS, drawingPatch, eraseStrokes } from '@/lib/canvasDrawing';
import { DEFAULT_DRAWING_PREFERENCES, readDrawingPreferences, writeDrawingPreferences, type DrawingPreferences } from './drawingPreferences';
import { useChromeSpace } from './useChromeSpace';
import {
  fileToDataUrl, importCanvasFile, type AttachmentBytesStrategy, type ImportTranslator,
} from '@/domains/canvas/application/ImportCanvasFile';
import { uploadAttachmentSource } from '@/lib/canvasAttachmentUploadApi';
import { aiContextGate, boardInventory, scopeNote } from '@/lib/canvasContextSnapshot';
import { objectMayCross } from '@/lib/canvasConfidentiality';
import { CanvasAppPanel } from '@/components/apps/CanvasAppPanel';
import { embeddedAppsApi } from '@/lib/embeddedApps';
import { renderedCanvasResume, resumeHtmlFile } from '@/lib/canvasResumeRenderer';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { createCanvasJournal, describeGraphChange } from '@/lib/canvasActionJournal';
import { readStoredJournal, writeStoredJournal } from '@/lib/canvasJournalStore';
import { usePublishBoardToShell } from '@/lib/canvas/usePublishBoardToShell';
import { Icon } from '@/components/ui/Icon';
import { appendImageToDrawioCanvas, createDrawioImageCanvas } from '@/lib/drawioImageCanvas';
import { convertGraphSource, diagramConvertSource, diagramConvertTargets } from '@/lib/canvasDiagramConvert';
import { diagramNotation } from '@/lib/diagramNotations';
import { compileBoardFlow } from '@/domains/workflow/domain/compileBoardFlow';
import { subflowSessionIdsOn } from '@/domains/workflow/domain/subflow';
import { flowDefinitionIdOf, flowDefinitionRef } from '@/domains/workflow/domain/flowDefinitionRef';
import { useSubflowBoards } from '@/domains/canvas/presentation/useSubflowBoards';
import { boardFlowFromDefinition, type UnpackedFlow } from '@/domains/workflow/domain/boardFlowFromDefinition';
import { flowStepsFromCanvasSteps } from '@/domains/workflow/domain/flowStepsFromCanvasSteps';
import { loadTemplateGraph } from '@/lib/evermindBuild';
import { createFlowStepData, isStepChoice, parseStepChoice, stepConfigOf, stepKindOf } from '@/domains/workflow/domain/flowStepObject';
import { outletForHandle } from '@/domains/workflow/domain/stepOutlets';
import { nodeKindLabel } from '@/domains/workflow/domain/stepCatalog';
import { boundingRect } from '@/domains/canvas/domain/canvasFrame';
import { withFrameCollapsed } from '@/domains/canvas/application/ExpandFramesOnPlacement';
import { useExpandFramesOnPlacement } from '@/domains/canvas/presentation/useExpandFramesOnPlacement';
import { toFrameBox, useFramedBoard } from './useFramedBoard';
import { resolveCanvasFlowNode } from './canvasFlowTarget';
import { EvermindBuildPanel } from '@/domains/workflow/presentation/EvermindBuildPanel';
import { CopyButton } from '@/components/CopyButton';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildCreationCanvasDiagnosticsReport } from '@/lib/creationCanvasDiagnostics';
import { clearActiveCanvasSync, setActiveCanvasSync } from '@/lib/activeCanvasSyncStatus';
import { buildProofJourneyDiagnosticsReport } from '@/lib/proofJourneyDiagnostics';
import { alignCanvasNodesLeft, canvasNodeDimensions, canvasPlacementUnlocked, nextCanvasObjectPosition, placeAppendedCanvasNodes } from './creationCanvasLayout';
import { useCanvasLayoutViewport } from '@/components/canvas/useCanvasLayoutViewport';
import { CanvasWalkthrough, type CanvasWalkthroughHandle } from './CanvasWalkthrough';
import { canvasWalkthroughStops } from '@/lib/canvasWalkthrough';
import { isBrainAutoApprove, setBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useConfirm } from '@/components/ConfirmProvider';
import { SectionTour, type SectionTourStep } from '@/components/onboarding/SectionTour';
import { useSectionTour } from '@/components/onboarding/useSectionTour';
import { type CanvasTourDesign, defaultCanvasTourDesign } from '@/lib/onboarding/canvasTourDesign';
import { useChatModelOptions } from '@/lib/useLlmModels';
import type { ChatModelSelection } from '@/components/ChatInput';
import { PromptUseCasePicker } from '@/components/PromptUseCasePicker';
import { cSuiteCanvasWorkflow, executiveUseCaseFromPrompt } from '@/lib/templates/promptUseCases';
import { applyTemplateEntry } from '@/lib/templates/apply';
import { useTemplateCatalog } from '@/lib/templates/useTemplateCatalog';
import { matchesTemplateQuery } from '@/lib/templates/contract';
import { TwilioCanvasSetup } from './TwilioCanvasSetup';
import { NEW_CHAT_MODE, normalizeChatMode, useQueuedTurns, type ChatMode } from '@/lib/brain';
import { runCanonicalCanvasGroupTurn } from '@/lib/creationAgentChat';
import { buildBrowserCreativeArtifact, buildWebsiteAssets, type CreationDeliverable, type CreativeArtifact, creativeBrief, creativeMeshGeometry, creativePreviewImageUrl, EVERMIND_CREATIVE_KINDS, evermindMediaArtifact, generateEvermindMedia, generateServerCreativeArtifact, mediaFrameDataUrl, navigableArtifactUrl, SERVER_CREATIVE_KINDS, withCreationDeliverable } from '@/lib/creationDeliverables';
import { canvasDiagram, canvasFiles, canvasObjectMarkdown, type CanvasFile } from '@/lib/canvasDocuments';
import { EXPORT_EXTENSION, EXPORT_MIME, SERVER_RENDERED_ACTIONS, defaultExportAction, pdfExportStrategy, type CanvasExportAction } from '@/lib/canvasExports';
import { markdownHtmlDocument, printCanvasObject } from '@/lib/printDocument';
import { canvasObjectSvg } from '@/lib/renderedSvg';
import { listEvermindModels } from '@/lib/studioModelsApi';
import { canvasProjectId, canvasProjectNodes, canvasProjectPatch, connectedCanvasProjectNode } from '@/lib/canvasProjectRef';
import { normalizeExitCriteria, planGateVerdict, releaseEvidence } from '@/lib/canvasQa';
import { canvasBuildBinding, canvasBuildModality, canvasBuildPatch, createCanvasBuild } from '@/lib/canvasBuild';
import { canvasBuildActions, type BoundCanvasBuild } from '@/lib/canvasBuildTools';
import { canvasFounderOpsActions, pipelineFieldsFrom, type CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import { canvasDataRoomActions } from '@/lib/canvasDataRoomTools';
import { canvasDocumentTemplateActions } from '@/lib/canvasDocumentTemplateTools';
import { canvasEquityActions } from '@/lib/canvasEquityTools';
import { canvasHiringPostingActions } from '@/lib/canvasHiringPostingTools';
import { canvasLegalDocumentActions } from '@/lib/canvasLegalDocumentTools';
import { canvasLegalRecordActions } from '@/lib/canvasLegalRecordTools';
import { canvasSellMotionActions } from '@/lib/canvasSellMotionTools';
import { canvasPromptLibraryActions } from '@/lib/canvasPromptLibraryTools';
import { canvasSignatureActions } from '@/lib/canvasSignatureTools';
import { moveDeal as moveDealOnBoard } from '@/lib/founderOpsApi';
import { notifyWorkspaceFilesChanged } from '@/lib/workspaceFileEvents';
import { normalizeWebPageUrl, webPageHost } from '@/lib/canvasWebPage';
import { deleteIdeProject } from '@/lib/api';
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
import type { IdeProject } from '@/lib/types';
import { CanvasBuildPanel } from './CanvasBuildPanel';
import { gamePayloadFrom } from '@/lib/gameTargets';
import type { ProjectModality } from '@/lib/modality';
import { buildLlmCourse, buildScormPackage, courseFromNode, isWorkedLlmCourse } from '@/lib/courseLms';
import { executeModelComparison } from '@/lib/modelComparison';
import { normalizeModelComparisonIds } from '@/lib/modelComparisonRequest';
import { builtinAgentSurfaceHref, type BuiltinAgentSurfaceIntent } from '@/lib/team/builtinAgentSurface';
import { useFormat } from "@/i18n/useFormat";
import { apiRequest, faultMessage, faultText } from '@/lib/apiClient';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { useErrorText } from '@/i18n/useErrorMessage';
import type { AccountGate, CanvasTimelineMessage, FramePreset, MergeItem, MergeReview } from './canvasBoardTypes';
import { AITrainingPanel, Canvas3DView, CanvasGamePanel, CanvasPublishPanel, CanvasReleasesPanel, CanvasRoomSurface, CanvasSceneGeneratorPanel, CanvasWorldView } from './canvasLazyPanels';
import { initialEdges, initialNodes } from './canvasSeed';
import { flowFromSession, flowFromSnapshotGraph, rejectedObjectKinds } from './canvasBoardLoad';
import { DRAWING_FALLBACK_HEX, DRAWING_TOOL_GLYPH, newNode, specBoardOf, topmostNodeAt } from './canvasNodeHelpers';
import { exportableSheet, safeDownloadName, safeTraceJson } from './canvasArtifactExport';
import { dragCarriesFiles, IMPORT_COLUMN_GAP, IMPORT_ROW_GAP, MAX_DROPPED_FILES, nextPaint } from './canvasFileDrop';
import { Inspector } from './inspector/CanvasInspector';
import { accountGateResult } from './actions/accountGate';
import { canvasSpecSource, releaseGateEvidence } from './canvasReleaseEvidence';
import { scoreAgentTestResponse } from './canvasAgentTest';
import { persistCanonicalProjectPrd, projectEvermindNodePatch } from './canvasProjectSync';
import { canvasInlineActions } from './actions';
import { createCanvasActionContext, type CanvasActionLive } from './actions/context';
import { SERVER_OWNED_CAMPAIGN_FIELDS } from './canvasSocialCampaignFields';

const DND_MIME = 'application/x-builderforce-creation-object';
/**
 * The anchored panel's two widths.
 *
 * They live here because the ANCHOR has to be clamped against whichever one is in play
 * (a card near the right edge must not open a 560px panel off the screen), and the same
 * two numbers are declared in `.anchoredPanel` / `.anchoredPanel[data-expanded='true']`.
 * There is no third width and no drag-resize: the panel used to be a rail you could size
 * yourself, and a remembered rail width is meaningless for a thing that is anchored to a
 * card wherever that card happens to be.
 */
const NODE_PANEL_WIDTH = 300;
const NODE_PANEL_WIDE_WIDTH = 560;
/** The air between the command bar and the prompt floating above it. The bar's HEIGHT is
 *  measured (see `useChromeSpace`); this is the only part of that band a number can
 *  honestly state, because it is a spacing decision rather than a fact about an element. */
const COMMAND_BAR_CLEARANCE = 10;
/** The air between the floating TOP chrome and anything drawn under it — the panels that
 *  open in the top-right corner, and every full-bleed surface. Same reasoning as
 *  `COMMAND_BAR_CLEARANCE`, at the other edge: the cards' height is measured, and only the
 *  gap is a number this file is entitled to state. */
const TOP_CHROME_CLEARANCE = 8;

function CanvasInner({ sessionId, persistence, initialFocusId, initialShareOpen = false, initialBuildOpen = false, initialBuildChatId, initialBuildTicket, initialPrompt, initialPresent = false, initialModelComparisonIds = [], stageActive = true, hostSurfaces, initialSurface, onExitToLibrary }: { sessionId: string; persistence: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialBuildOpen?: boolean; initialBuildChatId?: number | null; initialBuildTicket?: { kind: string; ref: string } | null; initialPrompt?: string | null; initialPresent?: boolean; initialModelComparisonIds?: readonly string[]; stageActive?: boolean; hostSurfaces?: CanvasSurfaceNodes; initialSurface?: CanvasSurfaceId; onExitToLibrary?: () => void }) {
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
  /** The shared metric vocabulary — labels, units and comparisons, identical to
   *  the superadmin Value outcomes panel. See `lib/outcomeMetrics.ts`. */
  const outcomeText = useTranslations('outcomeMetrics') as unknown as OutcomeTranslator;
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
  const templateCategoryLabel = useCallback((category: CreationTemplate['category']) => (
    t(category === 'Object pack' ? 'templateCategoryObjectPack' : 'templateCategoryMarketplace')
  ), [t]);
  /** Chrome shared with every other spatial canvas lives in its own namespace. */
  const tCommands = useTranslations('canvasCommands');
  const tFiles = useTranslations('creationCanvas.files');
  const tMiro = useTranslations('creationCanvas.miro');
  const tSocial = useTranslations('creationCanvas.social');
  // The step catalog names itself out of the builder's namespace — the same keys the
  // standalone palette reads, because they name the same steps.
  const tStep = useTranslations('evermindBuild');
  const tAds = useTranslations('canvas.ads');
  const tImport = useTranslations('creationCanvas.import');
  // The facilitation vocabulary. Its own namespace rather than `creationCanvas.poll.*`
  // because the SAME strings are read by the participant's page — which is not a canvas
  // at all — and a phone must not have to load the board's catalogue to say "voting
  // closed".
  const tPoll = useTranslations('poll');
  /** The import engine is a plain module, so it is handed the catalog rather
   * than reaching for one — every string it produces stays translated. */
  const importLabel = useCallback<ImportTranslator>((key, values) => tImport(key as never, values as never), [tImport]);
  /**
   * The guest wall this board has run into, or null while it has not. Set from the
   * refused turn itself and cleared by the next turn that succeeds, so the CTA is
   * exactly as live as the block it answers — a visitor who signs up in another
   * tab and comes back to a working canvas is not still being sold an account.
   */
  const [guestLimit, setGuestLimit] = useState<GuestLimitRefusal | null>(null);
  /**
   * The one place a failed AI turn becomes words. Known failures the visitor can
   * act on are said in their own language; anything else keeps the underlying
   * message, which is what makes a real error debuggable. Every turn site routes
   * through here so the guest path can never regress to a raw English throw.
   */
  const describeTurnError = useCallback((error: unknown, fallbackKey: 'noticeBrainFailed' | 'noticeAgentTestFailed' | 'noticeAgentGroupFailed') => {
    if (error instanceof GuestAiUnavailableError) return t('noticeGuestAiUnavailable');
    // A guest who has spent their free turns: the gateway sends `guest_limit_reached`
    // with the cap on the body (GUEST_CHAT_LIMITS), and its own English prose. Say it
    // in the visitor's language, and ARM the conversion CTA in the same step — the
    // sentence alone told a blocked visitor to sign up while offering nothing to
    // click. Every turn site routes through here, so no path can say the words and
    // forget the button.
    const refusal = guestLimitRefusal(error);
    if (refusal) {
      setGuestLimit(refusal);
      // Same event the account-gate modal files, so conversion is counted once
      // wherever the visitor met the wall.
      trackActivity('creation_account_gate_shown', { sessionId, metadata: { clientSurface: canvasSurface(), action: 'guest_limit' } });
      if (refusal.reason === 'ip') return t('noticeGuestLimitDevice');
      if (refusal.reason === 'room') return t('noticeGuestLimitRoom', { limit: refusal.limit ?? 0 });
      return t('noticeGuestLimitReached', { limit: refusal.limit ?? 0 });
    }
    return error instanceof Error && error.message ? error.message : t(fallbackKey);
  }, [sessionId, t]);
  const confirm = useConfirm();
  const toast = useToast();
  const storageKey = creationStorageKey(sessionId);
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(persistence === 'local' ? initialNodes(canvasText) : []);
  const [evermindLiveByNodeId, setEvermindLiveByNodeId] = useState<Record<string, Partial<CreationNodeData>>>({});
  /** A file is being dragged over the board from outside the browser. */
  const [fileDragging, setFileDragging] = useState(false);
  const fileDragDepth = useRef(0);
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
  const [scopeMode, setScopeMode] = useState<'auto' | 'canvas' | 'selection' | 'connected' | 'frame'>('auto');
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
  /**
   * WHICH SURFACE this canvas is being read through — the board, the 3D space, or the
   * conversation. Every surface but the board replaces the flat view rather than
   * floating over it: two live views of the same objects would compete for the same
   * pointer, and the point of a surface is to read the work one way without distraction.
   *
   * ONE state, because it is one question. 3D used to keep its own boolean beside this
   * (`useCanvasThreeD`, which the three other spatial canvases still use), and a second
   * answer to "what am I looking at?" is a second control that can disagree with the
   * first. The rail and the phone stack both drive THIS, and `data-view` publishes it to
   * the stylesheet — see `lib/canvasSurfaces.ts`.
   *
   * A model comparison opens straight into the space: the whole point of running two
   * models side by side is to read the results in depth.
   */
  const comparisonModelIds = useMemo(() => normalizeModelComparisonIds(initialModelComparisonIds), [initialModelComparisonIds]);
  const [surface, setSurfaceState] = useState<CanvasSurfaceId>(comparisonModelIds.length >= 2 ? 'room' : initialSurface ?? 'graph');
  /**
   * The object an object-scoped surface is about. Null for every board surface, and
   * the reason a surface can be `page` at all: a page is a page OF something.
   */
  const [surfaceTarget, setSurfaceTarget] = useState<string | null>(null);
  /**
   * The object the App surface should mount, when the reader got there by opening a
   * SITE rather than by pressing App in the rail.
   *
   * It is deliberately not `surfaceTarget`. That one is cleared the moment a board
   * surface opens, because a board surface is about the whole session — and the App
   * surface IS board-scoped, so it would lose this the instant it was needed. This
   * remembers which object the reader last chose so the App modality opens the same
   * thing the site modality is showing, and it is cleared when they pick an object
   * that has no code on this board (below), so it can never point at a stale card.
   */
  const [appTarget, setAppTarget] = useState<string | null>(null);
  const surfaceDef = canvasSurfaceDefinition(surface);
  /**
   * Whether the session bar is folded to what the canvas IS DOING.
   *
   * Read from storage in an effect rather than as the initial state, the way the surface
   * preference is: reading `localStorage` during render is a hydration mismatch, and the
   * bar arriving expanded for one frame is the safe direction to be wrong in.
   */
  const [barCollapsed, setBarCollapsedState] = useState(false);
  useEffect(() => { setBarCollapsedState(readCanvasBarCollapsed()); }, []);
  /**
   * Where the prompt lives — floating, docked into Brain, or closed. Read in an effect
   * for the same reason the folded bar is: reading storage during render is a hydration
   * mismatch, and a prompt that arrives floating for one frame is the safe direction.
   */
  const [promptPlacement, setPromptPlacementState] = useState<CanvasPromptPlacement>(DEFAULT_CANVAS_PROMPT_PLACEMENT);
  useEffect(() => { setPromptPlacementState(readCanvasPromptPlacement()); }, []);
  const setPromptPlacement = useCallback((next: CanvasPromptPlacement) => {
    setPromptPlacementState(next);
    writeCanvasPromptPlacement(next);
  }, []);
  const setBarCollapsed = useCallback((next: boolean) => {
    setBarCollapsedState(next);
    writeCanvasBarCollapsed(next);
  }, []);
  /**
   * Where an object surface's way back goes. Null — the board — for every entry except
   * one made FROM a surface that asked to be returned to: a creation opened from the
   * room goes back into the room rather than dropping the reader on the board.
   */
  const [surfaceOrigin, setSurfaceOrigin] = useState<CanvasSurfaceId | null>(null);
  const setSurface = useCallback((next: CanvasSurfaceId, targetId: string | null = null, origin: CanvasSurfaceId | null = null) => {
    setSurfaceState(next);
    // Only an object-scoped surface keeps a target (and an origin); the rail's switcher
    // never passes either.
    const objectScoped = canvasSurfaceDefinition(next).scope === 'object';
    setSurfaceTarget(objectScoped ? targetId : null);
    setSurfaceOrigin(objectScoped ? origin : null);
    // The registry decides what is worth remembering — a PLACE the user chose, never a
    // projection of the board they were already on, and never a surface that cannot be
    // restored without the object it was about.
    writeCanvasSurface(next);
    /**
     * OPENING A SITE ALSO ARMS THE APP.
     *
     * A website on this board is not only a set of pages: when the session carries the
     * code that serves it, the SAME thing is also a running application. Pressing "Open
     * the site" used to land on `site` alone, and the App modality stayed on whatever it
     * last showed — so the reader had to find the rail and press App to see the very
     * build they had just opened, and the two surfaces disagreed about which object was
     * in hand.
     *
     * So the site's target is carried over to the App surface here, at the ONE place
     * every door into a surface passes through (the card header, the anchored panel and
     * the room all call this). The App surface stays a board-scoped reading — it is
     * still "the session as one application" — this only tells it which object the
     * reader just chose, so it mounts that one rather than its own last guess.
     */
    if (next === 'site' && targetId) setAppTarget(targetId);
  }, []);
  /** Leave an object surface: back to wherever it was opened from, else the board. */
  const exitSurface = useCallback(() => setSurface(surfaceOrigin ?? 'graph'), [setSurface, surfaceOrigin]);
  /**
   * Which stage of ITS OWN methodology this session is in — see `lib/canvasPhases.ts`
   * for why this is not `useFounderJourney()`. Same SSR-safe pattern as `surface`:
   * a safe default in the initial state, the real preference restored in a mount-only
   * effect below, because reading `localStorage` during render is a hydration mismatch.
   */
  const [phase, setPhaseState] = useState<CanvasPhase>(DEFAULT_CANVAS_PHASE);
  useEffect(() => { setPhaseState(readCanvasPhase()); }, []);
  const setPhase = useCallback((next: CanvasPhase) => {
    setPhaseState(next);
    writeCanvasPhase(next);
    // Additive narrowing (see `surfacesForPhase`), so this only ever RESETS the surface
    // when the one already open falls outside the new phase's offer — pressing Idea
    // while reading the app it built must not silently pull the reader back to the
    // board over a surface the new phase would still have shown them.
    if (!surfacesForPhase(next).includes(surface)) setSurface('graph');
  }, [surface, setSurface]);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [accountGate, setAccountGate] = useState<AccountGate | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  /** The phone's actions sheet — the one that IS the command bar at that width. Its own
   *  flag for the reason `realOpen` has one: three sheets, three presses. */
  const [actionsOpen, setActionsOpen] = useState(false);
  const closeActionsSheet = useCallback(() => setActionsOpen(false), []);
  /** The two phone decisions CSS cannot make: which host renders the board menu and the
   *  invite sheet (rendering, not hiding — see `usePhoneViewport`), and which verb the
   *  composer arms while the Brain sheet is open.
   *
   *  A third gate sits on top of the media query: an embedding host (`hostSurfaces`) is
   *  a docked editor panel, routinely narrower than 767px, and must keep the desktop
   *  chrome. The CSS half of the same question is `.canvasShell:not([data-host='editor'])`
   *  around the 767px block — a 500px VS Code webview must not grow a phone app bar. */
  const phoneViewport = usePhoneViewport() && !hostSurfaces;
  /** Whether the Make it real menu is open. Its own state and not `moreOpen`'s: the two
   *  sheets sit at opposite ends of the bar and each closes the other, which a shared
   *  flag could not express. */
  const [realOpen, setRealOpen] = useState(false);
  /** Stable so `CanvasMenuSheet` binds its Escape listener once per opening rather
   *  than on every render of a board this size. */
  const closeMoreMenu = useCallback(() => setMoreOpen(false), []);
  const closeRealMenu = useCallback(() => setRealOpen(false), []);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateKind, setTemplateKind] = useState<CreationObjectKind | 'all'>('all');
  // The category filter is now over template SOURCES rather than the packs'
  // own two-value `category` field, because the browser renders every source.
  const [templateCategory, setTemplateCategory] = useState<'all' | 'pack' | 'workspace' | 'prompt'>('all');
  // The one catalogue, shared with the prompt picker. Installable templates are
  // fetched only while the browser is open — a guest canvas never opens it.
  const templateEntries = useTemplateCatalog({ includeWorkspace: templateOpen });
  /**
   * Whether this board builds something the App surface could actually open.
   *
   * Asked of `canvasApp` rather than of `nodes.length`, because "there are objects on the
   * board" and "there is an app here" are different questions and only the second one
   * makes a Run button honest — a canvas holding a Brain conversation and three notes has
   * plenty of objects and nothing to run.
   */
  const runnableApp = useMemo(() => canvasApp(nodes).entry !== null, [nodes]);

  /**
   * THE ANCHORED PANEL AND THE PICKER — two overlays, one rule.
   *
   * Both are positioned from a SCREEN rect handed up by whichever control opened them,
   * never from a board coordinate. The alternative is projecting a node's flow position
   * through the viewport transform on every pan and zoom, which is a second copy of React
   * Flow's own maths and drifts the moment either changes. A fixed overlay anchored to
   * where the button actually is cannot drift, and both close on click-away anyway.
   */
  /**
   * THE ONE PANEL, and how it is placed.
   *
   * `box` is the card's own screen rectangle, not a resolved anchor: the panel has two
   * widths and the clamp that keeps it on screen depends on which one is showing, so the
   * position is derived at render from the box rather than frozen when it opened.
   * A `null` box means "read it off the card's element" — the board actions that open an
   * object's inspector have a node id and no event to take a rectangle from.
   *
   * `panel` may be null for the same reason: an action that opens an object's whole
   * inspector has no opinion about which SHORT panel it narrows back to, so the kind's
   * own settings panel is chosen at render.
   */
  const [nodePanel, setNodePanel] = useState<{ nodeId: string; panel: CanvasNodePanelId | null; box: { top: number; right: number } | null; expanded: boolean } | null>(null);
  const [objectPicker, setObjectPicker] = useState<{ anchor: { x: number; y: number }; group?: CreationObjectGroup; fromNodeId?: string } | null>(null);
  /**
   * "The add-to-canvas picker is up, opened from a DOOR rather than a node's own
   * `+`" — the one condition every entry point that offers a pressed/open state
   * (the command bar's circles, the board's own toggle) reads, so the two can never
   * disagree about whether the picker is "the add flow" being open.
   */
  const objectPickerOpen = objectPicker !== null && !objectPicker.fromNodeId;

  /** Beside the badge, clamped so a card at the right edge does not open a panel off it. */
  const anchorFrom = (rect: { top: number; right: number }, width: number) => ({
    x: Math.min(Math.max(12, rect.right + 12), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(12, rect.top - 8), Math.max(12, window.innerHeight - 220)),
  });

  const boxOf = (rect: DOMRect) => ({ top: rect.top, right: rect.right });

  /**
   * Opens the object picker with no group filter — the command bar's own "add to
   * canvas" button reaches it directly by anchoring on its own rect; this is for the
   * doors that have no card or circle of their own to anchor beside (the composer's
   * "add context" row, the large-canvas notice's "Frame" button, the guided tour), so
   * they open at a fixed, sensible corner instead.
   */
  const openObjectPicker = useCallback(() => {
    setNodePanel(null);
    setObjectPicker({ anchor: { x: 54, y: 54 } });
  }, []);

  /**
   * The card's box on screen, found through the card itself.
   *
   * The board actions that open an object's inspector — visualize a dataset, compare
   * projects, expand a pipeline — have a node id and no event. A node's FLOW position
   * would have to be projected through the viewport transform to become a screen box,
   * which is a second copy of React Flow's own maths; its rendered element already is one.
   * Null when the card has not painted yet (an object created in the same tick), and the
   * render falls back to a sensible on-screen position until it has.
   */
  const nodeBoxOnScreen = useCallback((nodeId: string) => {
    if (typeof document === 'undefined') return null;
    const element = document.querySelector(`[data-node-id="${nodeId}"]`);
    return element instanceof Element ? boxOf(element.getBoundingClientRect()) : null;
  }, []);

  /**
   * Fills in the box for a panel that was opened without one.
   *
   * A LAYOUT effect and not a read during render: the card is often created in the same
   * tick as the panel that describes it, so the element does not exist yet when the panel
   * first renders. Measuring after paint is the only point at which the answer exists, and
   * doing it here — rather than calling `getBoundingClientRect` from the render body —
   * keeps the render a pure function of state. Until it resolves, the panel draws at the
   * fallback position below, which is one frame.
   */
  useLayoutEffect(() => {
    if (!nodePanel || nodePanel.box) return;
    const box = nodeBoxOnScreen(nodePanel.nodeId);
    if (!box) return;
    setNodePanel((current) => (current && current.nodeId === nodePanel.nodeId && !current.box ? { ...current, box } : current));
  }, [nodeBoxOnScreen, nodePanel]);

  const openNodePanel = useCallback((nodeId: string, panel: CanvasNodePanelId, rect: DOMRect) => {
    setObjectPicker(null);
    setNodePanel({ nodeId, panel, box: boxOf(rect), expanded: false });
  }, []);

  /**
   * "Show me everything about this object" — the same anchored panel, opened WIDE.
   *
   * This replaced `setInspectorNodeId`, which opened a separate full-height rail on the
   * far side of the board. Every one of the eighteen board actions that used to reach for
   * that rail lands here instead, so an object's values, its settings and its activity are
   * always read beside the card they belong to.
   */
  const openNodeInspector = useCallback((nodeId: string, focus: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null = null, rect?: DOMRect) => {
    setObjectPicker(null);
    setInspectorFocus(focus);
    setNodePanel({ nodeId, panel: null, box: rect ? boxOf(rect) : null, expanded: true });
  }, []);

  /**
   * While the WIDE panel is open, it FOLLOWS selection rather than being left behind.
   *
   * Dozens of the inspector's own actions — deliver a mockup, visualize a dataset,
   * compare projects, build a website with code, expand an Evermind pipeline — create
   * a NEW object and select it, exactly the "just made something, look at it" moment
   * the wide reading exists for. Requiring every one of those call sites to remember to
   * retarget the panel is the kind of thing one of them eventually forgets; this is the
   * single place that keeps the rule instead. It does nothing while the panel is COMPACT:
   * a plain click on a different card opens that card's own short panel, which
   * `onNodeClick` has already done by the time this runs.
   */
  useEffect(() => {
    if (!selectedId) return;
    setNodePanel((current) => (current && current.expanded && current.nodeId !== selectedId
      ? { ...current, nodeId: selectedId, panel: null, box: null }
      : current));
  }, [selectedId]);

  const openInsertPicker = useCallback((nodeId: string, rect: DOMRect) => {
    setNodePanel(null);
    setObjectPicker({ anchor: anchorFrom(boxOf(rect), 400), fromNodeId: nodeId });
  }, []);
  /**
   * PRESENTATION AND FOLLOW ARE SHELL STATE NOW.
   *
   * Both used to be `useState` here, which meant leaving the board ended the
   * presentation and dropped whoever you were following — so "let me show you
   * the delivery numbers" was a way to END the thing you were doing. They live on
   * the live session, which outlives every navigation; the local fallbacks below
   * keep the board working on surfaces with no session provider (the embed tree,
   * and the tests, which mount the canvas bare).
   */
  /**
   * The action journal for THIS board — see `canvasActionJournal`. A ref rather
   * than state: recording an action must never re-render the canvas, or the act
   * of observing the board would change what is being observed.
   */
  const journal = useRef(createCanvasJournal());
  /**
   * The tail of the journal, in the shape a defect carries it.
   *
   * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
   * The journal already recorded exactly what a bug report needs — ordered actions
   * with durations, failures, and the ones that started and never finished — and it
   * lived only in this ref, capped at 240 entries and gone on reload. So by the time
   * anyone filed the report, the three steps that explain it no longer existed
   * anywhere. Attaching it to the defect is what makes "it did this a moment ago" a
   * reproducible claim rather than a memory.
   *
   * The FAILURES and the stalls are hoisted to the front: a twenty-row list where the
   * one red row is in the middle gets skimmed past, and that row is the report.
   */
  /**
   * Keep the journal across a reload, and flush it before the tab goes away.
   *
   * Hydrate once per session id; flush on a slow interval and on `pagehide` (which
   * fires for a reload, a navigation and a bfcache eviction, where `unload` does
   * not). Writing on every recorded action would put a storage write in the path of
   * every tool call, and the whole point of the journal is that observing the board
   * does not change it.
   */
  useEffect(() => {
    const stored = readStoredJournal(sessionId);
    if (stored.length) journal.current.restore(stored);
    const flush = () => writeStoredJournal(sessionId, journal.current.entries());
    const timer = window.setInterval(flush, 15_000);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sessionId]);

  const recentJournalEvidence = useCallback((limit = 12) => {
    const entries = journal.current.entries();
    const notable = entries.filter((entry) => entry.ok === false || entry.durationMs == null);
    const recent = entries.slice(-limit);
    return [...notable, ...recent.filter((entry) => !notable.includes(entry))]
      .slice(0, limit)
      .map((entry) => ({
        at: entry.at, kind: entry.kind, label: entry.label,
        ...(entry.detail ? { detail: entry.detail.slice(0, 300) } : {}),
        ...(entry.ok != null ? { ok: entry.ok } : {}),
        ...(entry.durationMs != null ? { durationMs: entry.durationMs } : {}),
      }));
  }, []);
  /** Effective inference facts accumulated by this mounted Creation Session.
   * Kept out of render state: observing completions must not remount the board. */
  const brainRuntime = useRef<{ completions: CanvasAiCompletion[]; disabledModels: string[] }>({
    completions: [], disabledModels: [],
  });
  const recordBrainCompletion = useCallback((completion: CanvasAiCompletion) => {
    brainRuntime.current.completions = [...brainRuntime.current.completions, completion].slice(-50);
  }, []);
  /**
   * What the LAST completion of the turn just finished actually ran on — the resolved
   * model and the tools it called. Stamped onto the assistant message so a thumb
   * pressed on it (now or after a reload) can be filed against the model that earned
   * it, exactly as the Brain chat files provenance. Without this the Canvas — a large
   * share of all model calls — could rate nothing.
   */
  const lastTurnProvenance = useCallback((): { model?: string; tools?: string[] } => {
    const last = brainRuntime.current.completions[brainRuntime.current.completions.length - 1];
    if (!last?.resolvedModel) return {};
    return { model: last.resolvedModel, ...(last.toolCalls.length ? { tools: last.toolCalls } : {}) };
  }, []);
  const disableBrainModel = useCallback((model: string) => {
    if (!model || brainRuntime.current.disabledModels.includes(model)) return;
    brainRuntime.current.disabledModels = [...brainRuntime.current.disabledModels, model];
  }, []);

  const liveSession = useOptionalLiveSession();
  // "Is there a room here, may I open it, and is one already running" — one decision,
  // owned by the hook, read by the session action below. The canvas never assembles a
  // room out of auth and a session id itself.
  const liveRoom = useCanvasLiveRoom();
  const [localPresentMode, setLocalPresentMode] = useState(initialPresent);
  const presentMode = liveSession ? liveSession.presentMode : localPresentMode;
  // A ref, because the functional-updater form (`setPresentMode(v => !v)`) has to
  // read the CURRENT value, and the shell's value does not live in this closure.
  const presentModeRef = useRef(presentMode);
  presentModeRef.current = presentMode;
  const setPresentMode = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(presentModeRef.current) : value;
    if (liveSession) liveSession.setPresentMode(next);
    else setLocalPresentMode(next);
  }, [liveSession]);
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
  const followingRef = useRef(followingUserId);
  followingRef.current = followingUserId;
  const setFollowingUserId = useCallback((value: string | null | ((current: string | null) => string | null)) => {
    const next = typeof value === 'function' ? value(followingRef.current) : value;
    if (liveSession) liveSession.setFollowing(next);
    else setLocalFollowingUserId(next);
  }, [liveSession]);
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
  // The Builder object whose workspace is open on top of the board.
  const [buildFocus, setBuildFocus] = useState<{ nodeId: string; storageProjectId: number } | null>(null);
  /** The game object whose ship-to-device panel is open, by node id. */
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CreationSessionSummary['role']>('editor');
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
  const notices = useRef<CanvasNotices | null>(null);
  if (!notices.current) notices.current = createCanvasNotices(setNoticeText);
  const setNotice = useCallback((text: string) => notices.current!.outcome(text), []);
  const noteSaveState = useCallback(() => notices.current!.saveState(''), []);

  /**
   * SHARED FREE SESSION (no account).
   *
   * An account-less canvas used to be strictly single-player: "Share" opened a
   * sign-up gate, which answers a question nobody asked — they wanted to show
   * someone the board, not to file paperwork. So a local canvas can now open the
   * same guest ROOM the free Brain chat uses: an invite link, a roster, a combined
   * turn allowance, and (on the chat surface) a camera meeting.
   *
   * The board syncs through the room as ONE serialized snapshot, last-writer-wins
   * on the existing save debounce. That is deliberately not a CRDT: this is a
   * short-lived ≤8-person free session, and an operational-transform stack has
   * failure modes far worse than "whoever moved a card most recently won".
   * localStorage stays the local cache, so a dropped connection still leaves the
   * board on the device that was editing it.
   */
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
  const sendRoomPresenceRef = useRef(sharedRoom.sendPresence);
  sendRoomPresenceRef.current = sharedRoom.sendPresence;
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
  const localizedTourDefaults = useCallback((): Partial<CreationNodeData> => {
    const base = defaultCanvasTourDesign();
    const tour: CanvasTourDesign = {
      ...base,
      offerTitle: t('tourBuilder.defaultOfferTitle'),
      offerBody: t('tourBuilder.defaultOfferBody'),
      startLabel: t('tourBuilder.defaultStartLabel'),
      cancelLabel: t('tourBuilder.defaultCancelLabel'),
      steps: [
        { ...base.steps[0]!, title: t('tourBuilder.defaultStep1Title'), body: t('tourBuilder.defaultStep1Body') },
        { ...base.steps[1]!, title: t('tourBuilder.defaultStep2Title'), body: t('tourBuilder.defaultStep2Body') },
      ],
    };
    return { title: t('tourBuilder.defaultObjectTitle'), status: t('tourBuilder.draftSteps', { count: tour.steps.length }), tour };
  }, [t]);
  const tourSteps = useMemo<SectionTourStep[]>(() => Array.from({ length: 6 }, (_, index) => ({
    title: t(`tourTitle${index + 1}` as 'tourTitle1'),
    body: t(`tourBody${index + 1}` as 'tourBody1'),
    target: [
      '[data-tour="creation-brain-dock"]',
      '[data-tour="creation-object-palette"]',
      '[data-tour="creation-board"]',
      '[data-tour="creation-board"]',
      '[data-tour="creation-collaborators"]',
      '[data-tour="creation-share"]',
    ][index],
  })), [t]);
  const sectionTour = useSectionTour({
    ...CREATION_CANVAS_TOUR,
    audienceId: currentUserId || (persistence === 'local' ? 'guest' : null),
    activity: { sessionId, clientSurface: canvasSurface() },
  });
  const prepareTourStep = useCallback((step: number) => {
    setMoreOpen(false);
    setShareOpen(false);
    if (step === 1) openObjectPicker();
  }, [openObjectPicker]);
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
  const toggleDockPanel = useCallback((panel: CanvasDockPanel) => setDockPanel((current) => (current === panel ? null : panel)), []);
  const closeDockPanel = useCallback(() => setDockPanel(null), []);
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
  const [sessionRole, setSessionRole] = useState<CreationSessionSummary['role']>('owner');
  const [lockBlocked, setLockBlocked] = useState(false);
  // Locks are server records. A freshly added Canvas node exists in React state
  // before the debounced graph save creates its database row, so attempting to
  // lock it immediately produces a misleading 404. Track confirmed server IDs
  // and start the lease only after persistence succeeds.
  const [persistedObjectIds, setPersistedObjectIds] = useState<Set<string>>(new Set());
  const [datasetRowLimit, setDatasetRowLimit] = useState(500);
  const canEdit = persistence === 'local' || sessionRole === 'editor' || sessionRole === 'runner' || sessionRole === 'owner';
  const canRun = persistence === 'local' || sessionRole === 'runner' || sessionRole === 'owner';
  const isComposingPrompt = prompt.trim().length > 0;
  // "IS THIS BOARD SAVED?" AND "DOES THIS PERSON HAVE AN ACCOUNT?" ARE DIFFERENT
  // QUESTIONS, AND `persistence` ONLY ANSWERS THE FIRST.
  //
  // It is derived from the session id alone (`isLocalCreationSession` — a `local-…`
  // prefix), so a SIGNED-IN user working on an unsaved board reads as anonymous. Used
  // as a stand-in for "no account" it told a paying user to create an account before
  // they could generate an image, when their own credentials would have authorized the
  // call: image generation posts to `/llm/v1/images/generations` with the tenant token
  // and never touches the session row.
  //
  // Keep the two separate at the source. `persistence` still gates anything that needs
  // a SAVED SESSION to point at (durable object actions, branches, comparisons); this
  // answers only "will a tenant request from this browser authenticate?".
  //
  // Answered by `useViewerSession`, which falls back to the token store rather than
  // requiring `useAuth`, for two reasons: it is the exact value `apiRequest`
  // authorizes with (so it cannot disagree with the call it is predicting), and the
  // canvas mounts in surfaces that have no AuthProvider above them — the VS Code
  // webview, the embed, and the component tests, where `useAuth()` throws.
  const hasAccount = useViewerSession().hasTenant;
  const [claimingDraft, setClaimingDraft] = useState(false);
  const requireAccount = useCallback((action: string, title: string, description: string) => {
    setAccountGate({ action, title, description });
    trackActivity('creation_account_gate_shown', { sessionId, metadata: { clientSurface: canvasSurface(), action } });
  }, [sessionId]);
  /**
   * ONE door in front of everything that reads a CONNECTED ACCOUNT.
   *
   * Cloud storage, Miro, social and paid media all call the API with the tenant
   * token. A signed-out visitor has none, so opening any of them used to fire a
   * request that came back 401 "Missing or malformed Authorization header" — and
   * because the canvas reports API failures as support tickets, a guest tapping
   * along the rail filed five of them in ninety seconds. The condition is the
   * same for every one of these surfaces, so the check, the copy and the
   * sign-up prompt are one function rather than a rule each panel remembers.
   *
   * ── THE IMPERATIVE SIBLING OF `<SessionGate action="connectIntegration">` ────
   * Same question, same answer, two shapes — and the shapes are genuinely
   * different rather than a duplicate: `SessionGate` WRAPS a control, which is
   * what a button in a list needs, while this is called from inside an
   * `onClick` and from the model's own tool handlers, where there is no element
   * to wrap. What must never differ is the CONDITION, so both read "is there a
   * readable workspace behind this screen": the component through
   * `useSampleWorkspace`, which is reactive because it renders, and this
   * through the stored tenant token, which is what an event handler can see.
   *
   * Returns true when the caller may proceed.
   */
  const connectedAccountGate = useCallback((source: string) => {
    if (getStoredTenantToken()) return true;
    requireAccount('connected_account', t('connectedGateTitle', { source }), t('connectedGateBody', { source }));
    return false;
  }, [requireAccount, t]);
  /**
   * ONE door for a guest-GATED canvas TOOL — the model half of `connectedAccountGate`.
   *
   * `accountGateResult` builds the shape the model reads, and every gate string in the
   * contract ends with "The account prompt is now open" — but the builder is a plain
   * function and CANNOT open anything. `canvas_read_attachment` returned it directly, so
   * that sentence was false there: the model told the user a prompt was waiting and no
   * prompt had been raised. The two halves are one call here precisely so the claim and
   * the prompt cannot drift apart again.
   *
   * The CONDITION stays with the caller because it genuinely differs: a corpus needs
   * CREDENTIALS (a signed-in user promotes from an unsaved board), while reading a scan
   * needs a SAVED canvas for the bytes to have been stored at all. Folding both into one
   * predicate would gate each tool on something it does not actually need. What must
   * never differ is this: the prompt opens whenever the gate shape is returned.
   *
   * Returns the gate result to hand straight back to the model.
   */
  const openAccountGate = useCallback((
    tool: string, action: string, title: string, description: string, reason: string,
  ): { requiresAccount: true; tool: string; error: string } => {
    requireAccount(action, title, description);
    return accountGateResult(tool, reason);
  }, [requireAccount]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance<CreationFlowNode, Edge> | null>(null);
  const hydrated = useRef(false);
  const revision = useRef(1);
  const lastSavedGraph = useRef('');
  const sessionOpenCorrelation = useRef(crypto.randomUUID());
  const currentGraph = useRef('');
  const saveInFlight = useRef(false);
  const activePresenceInitialized = useRef(false);
  const activeMemberIds = useRef<Set<string>>(new Set());
  const pendingSave = useRef<{ signature: string; key: string } | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  /** The live socket, when it is open — the channel pointer frames go out on. */
  const liveSocketRef = useRef<WebSocket | null>(null);
  /** Last outbound presence frame's timestamp + payload, for the send throttle. */
  /**
   * This client's ephemeral state on the relay — cursor, viewport, selection,
   * typing.
   *
   * The coalescing throttle that makes a fast drag look like a drag rather than a
   * teleport lives in `application/PresenceRelay.ts`; what stays here is the
   * TRANSPORT: this board's socket, or — for an account-less board shared through a
   * guest room, which has no server socket — that room's relay, which carries the
   * same frame. Silence when neither is open is correct: on a saved board the
   * 8-second presence poll is the fallback and carries the cursor on its own.
   */
  const presenceRef = useRef<PresenceRelay | null>(null);
  if (!presenceRef.current) {
    presenceRef.current = createPresenceRelay({
      deliver: (state) => {
        const socket = liveSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return sendRoomPresenceRef.current(state);
        try { socket.send(JSON.stringify({ type: CANVAS_PRESENCE_FRAME, ...state })); return true; }
        catch { return false; } // the socket is closing; the poll takes over
      },
    }, { intervalMs: PRESENCE_SEND_INTERVAL_MS });
  }
  const sendPresence = useCallback((state: CanvasPresenceState) => presenceRef.current!.send(state), []);
  const pendingViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const flowWrapRef = useRef<HTMLDivElement | null>(null);
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
  const layoutViewportRef = useRef(layoutViewport);
  layoutViewportRef.current = layoutViewport;
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
   * reassigned every render, so it always measures today's board.
   */
  const placeAppendedRef = useRef<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>(() => []);
  placeAppendedRef.current = (current, additions) => placeAppendedCanvasNodes(current, additions, layoutViewport());
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
  const inFlightUseCaseId = useRef<string | null>(null);
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
  const turnToolCalls = useRef<Set<string>>(new Set());
  /** Set by the turn runner when the string it returned is a RUNTIME NOTICE rather
   *  than an answer Brain produced — read once when the turn settles so the notice is
   *  shown to the user without entering the transcript the next turn is built from. */
  const turnUnanswered = useRef<{ reason: string; detail?: string } | null>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const historyBaseline = useRef<string | null>(null);
  const historyApplying = useRef(false);
  const drawingPoints = useRef<Array<{ x: number; y: number }>>([]);
  const canvasClipboard = useRef<{ nodes: CreationFlowNode[]; edges: Edge[] } | null>(null);
  const initialPromptSubmitted = useRef(false);
  const initialBuildOpened = useRef(false);
  const modelComparisonStarted = useRef(false);
  const autoApplyRef = useRef(true);
  const mobileViewportFitted = useRef(false);

  useEffect(() => {
    const enabled = isBrainAutoApprove();
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
  }, []);

  useEffect(() => { setBrainDock(readBrainDockPreferences()); }, []);
  // BRAIN NEVER AUTO-COVERS A PHONE. The stored (and default) preference is a docked
  // rail standing open, which is the desktop. At phone width that same preference is a
  // sheet over the board, so the first paint that learns it is a phone closes it without
  // writing — a reload must not cover the surface, and a desktop that last left Brain
  // open must not find it shut when they come back. The launcher is how it opens.
  useEffect(() => {
    if (!phoneViewport) return;
    setBrainDock((current) => (current.open ? { ...current, open: false } : current));
  }, [phoneViewport]);
  /**
   * The surface the visitor last chose to work on, restored after hydration rather than
   * in the initial state — `localStorage` does not exist on the server, and a first
   * render that disagreed with the markup would flash the wrong surface. A canvas opened
   * FOR a model comparison keeps the space it was opened into; the stored preference is
   * about where someone works, not about what a link asked for.
   */
  useEffect(() => {
    if (comparisonModelIds.length >= 2) return;
    // An ENTRY that named a surface outranks the stored preference: "open my chat" has
    // to open the chat even for someone whose last visit left them on the board. The
    // preference is where you were, not what you just asked for — the same precedence
    // the comparison case above already asserts.
    setSurfaceState(initialSurface ?? readCanvasSurface());
    // Mount only: this restores a preference, and re-running it would drag the visitor
    // back out of whatever surface they have since switched to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Persist AND report the layout the user chose. The signal is what lets the
   * shipped default become the layout people actually prefer instead of a guess.
   * A resize drag passes persist=false so the board reflows live without writing
   * storage — and firing a preference signal — on every pointer move.
   */
  const updateBrainDock = useCallback((patch: Partial<BrainDockPreferences>, persist = true) => {
    setBrainDock((current) => {
      const next = { ...current, ...patch };
      if (persist) {
        writeBrainDockPreferences(next);
        trackActivity('creation_brain_dock_preference', { sessionId, metadata: { clientSurface: canvasSurface(), ...next } });
      }
      return next;
    });
  }, [sessionId]);

  /**
   * Fill the screen with the board, natively where the browser offers it and by
   * taking over the viewport where it does not.
   *
   * iOS Safari exposes no element Fullscreen API at all, so the button used to
   * report "full screen unavailable" on the one class of device where handing the
   * whole screen to the canvas is worth the most. The CSS fallback (see
   * `[data-fullscreen]` in the stylesheet) pins the shell over the app chrome and
   * the mobile bottom bar, which is the same result the native call would give.
   */
  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (typeof document === 'undefined' || !shell) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.().catch(() => undefined); return; }
    if (fullscreen) { setFullscreen(false); return; }
    const request = document.fullscreenEnabled ? shell.requestFullscreen?.() : undefined;
    if (request) void request.catch(() => setFullscreen(true));
    else setFullscreen(true);
  }, [fullscreen]);

  useEffect(() => {
    // Only the native path owns the flag while IT is what is on screen. Without
    // this guard a `fullscreenchange` fired by anything else on the page (a video,
    // say) would silently drop the canvas out of the CSS fallback.
    const sync = () => {
      const native = !!document.fullscreenElement && document.fullscreenElement === shellRef.current;
      if (!native && !nativeFullscreenRef.current) return;
      nativeFullscreenRef.current = native;
      setFullscreen(native);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Escape leaves the CSS fallback, the way it leaves native full screen — the
  // browser handles that key itself only when the browser put us there.
  useEffect(() => {
    if (!fullscreen || nativeFullscreenRef.current) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const setAutoApplyMode = useCallback((enabled: boolean) => {
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
    setBrainAutoApprove(enabled);
  }, []);

  /**
   * Session MODE (migration 0409) — `chat` (author on the board and answer) or `work`
   * (leave a tracked, dispatched ticket behind). Persisted on the SESSION rather than
   * in this browser, so a mode a collaborator armed is the mode everyone's next turn
   * runs in. A local (unsaved) canvas has nowhere to persist it, so it keeps the value
   * in state only — the same degradation the rest of the local canvas accepts.
   */
  const setSessionMode = useCallback((next: ChatMode) => {
    setSessionMode_(next);
    if (persistence !== 'server') {
      // No server row to hold it, so the local snapshot does — otherwise the mode
      // reset on every reload of a guest canvas.
      const prior = readLocalCreationSession(sessionId);
      if (prior) writeLocalCreationSession(sessionId, { ...prior, mode: next, updatedAt: new Date().toISOString() });
      return;
    }
    void creationSessionsApi.update(sessionId, { mode: next })
      .catch(() => setNotice(t('modeSaveFailed')));
  }, [persistence, sessionId, t]);

  const memoryStorageKey = useMemo(() => {
    const chat = nodes.find((node) => node.data.kind === 'chat');
    const canonicalId = chat?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
    return `brain.memoryEnabled:${canonicalId || `canvas:${sessionId}`}`;
  }, [nodes, sessionId]);

  useEffect(() => {
    try { setMemoryEnabled(localStorage.getItem(memoryStorageKey) !== '0'); } catch { setMemoryEnabled(true); }
  }, [memoryStorageKey]);

  const setMemoryMode = useCallback((enabled: boolean) => {
    setMemoryEnabled(enabled);
    try { localStorage.setItem(memoryStorageKey, enabled ? '1' : '0'); } catch { /* storage may be unavailable */ }
  }, [memoryStorageKey]);

  useEffect(() => {
    try { setFramePresets(JSON.parse(localStorage.getItem('builderforce:create-frame-presets') || '[]') as FramePreset[]); } catch { setFramePresets([]); }
  }, []);

  useEffect(() => {
    if (persistence !== 'server') return;
    void creationSessionsApi.quotas().then((quota) => {
      if (quota.limits.datasetRows === -1) setDatasetRowLimit(1_000_000);
      else setDatasetRowLimit(Math.max(1, quota.limits.datasetRows));
    }).catch(() => undefined);
  }, [persistence]);

  useEffect(() => {
    if (!templateOpen || persistence !== 'server') return;
    void creationSessionsApi.templates.list().then((result) => setServerTemplates(result.templates)).catch(() => setServerTemplates([]));
  }, [persistence, templateOpen]);

  useEffect(() => {
    if (!shareOpen || persistence !== 'server' || sessionRole !== 'owner') return;
    void creationSessionsApi.invitations.list(sessionId)
      .then((result) => setPendingInvitations(result.invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)))
      .catch((error) => setNotice(faultText(error, t('noticeInvitationsFailed'))));
  }, [persistence, sessionId, sessionRole, shareOpen]);

  useEffect(() => {
    try {
      if (persistence === 'local') {
        const saved = readLocalCreationSession(sessionId);
        if (saved) {
          setTitle(saved.title);
          setNodes(saved.nodes);
          setEdges(saved.edges);
          setTimeline((saved.timeline ?? []).map((message) => ({ clientMessageId: message.clientMessageId, messageRole: message.role, body: message.body, metadata: message.metadata ?? {}, createdAt: message.createdAt })));
          // The mode a guest armed in the homepage composer, carried across the
          // hand-off — a local canvas has no server row, so the snapshot IS the store.
          setSessionMode_(normalizeChatMode(saved.mode));
          if (saved.viewport) { viewportRef.current = saved.viewport; pendingViewport.current = saved.viewport; void flowRef.current?.setViewport(saved.viewport); }
        }
        hydrated.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: canvasSurface(), persistence: 'local' } });
        return;
      }
      const openedAt = performance.now();
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'started' }).catch(() => undefined);
      void Promise.all([creationSessionsApi.get(sessionId), creationSessionsApi.timeline.list(sessionId)]).then(([detail, transcript]) => {
        const { nodes: loadedNodes, edges: loadedEdges, rejected } = flowFromSession(detail);
        // The `declaredKind` invariant, said out loud. An object this build cannot
        // name is dropped rather than drawn as a blank card, and the user is told
        // which kinds — without that sentence the board silently has fewer objects
        // than the person who saved it put on it, which is the worse failure.
        if (rejected.length) setNotice(t('objectsRejected', { count: rejected.length, kinds: rejectedObjectKinds(rejected) }));
        setTitle(detail.session.title);
        // Mode is a property of the SESSION (0409), so a collaborator opening this
        // board inherits the mode it is actually running in rather than the default.
        setSessionMode_(normalizeChatMode(detail.session.mode));
        setBranchParentId(detail.session.branchParentSessionId ?? null);
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setPersistedObjectIds(new Set(loadedNodes.map((node) => node.id)));
        setMembers(detail.members);
        setAllMembers(detail.members);
        setCurrentUserId(detail.currentUserId || null);
        const personalSelection = detail.members.find((member) => member.userId === detail.currentUserId)?.selection?.filter((id) => loadedNodes.some((node) => node.id === id)) ?? [];
        setSelectedIds(personalSelection);
        setSelectedId(personalSelection.length === 1 ? personalSelection[0] : null);
        setSessionRole(detail.role);
        setTimeline(transcript.messages);
        const restoredViewport = detail.personalViewport && typeof detail.personalViewport.x === 'number' && typeof detail.personalViewport.y === 'number' && typeof detail.personalViewport.zoom === 'number'
          ? { x: detail.personalViewport.x, y: detail.personalViewport.y, zoom: detail.personalViewport.zoom }
          : null;
        if (restoredViewport) {
          viewportRef.current = restoredViewport;
          pendingViewport.current = restoredViewport;
          void flowRef.current?.setViewport(restoredViewport);
        }
        revision.current = detail.session.canvasRevision ?? detail.session.revision ?? 1;
        lastSavedGraph.current = JSON.stringify({ nodes: loadedNodes, edges: loadedEdges });
        currentGraph.current = lastSavedGraph.current;
        hydrated.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [...new Set(loadedNodes.map((node) => node.data.kind))] } });
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'succeeded', durationMs: performance.now() - openedAt }).catch(() => undefined);
        noteSaveState();
      }).catch((error) => {
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'failed', durationMs: performance.now() - openedAt }).catch(() => undefined);
        setNotice(faultText(error, t('noticeLoadSessionFailed')));
      }).finally(() => setLoadingSession(false));
    } catch { hydrated.current = true; }
  }, [persistence, sessionId, setEdges, setNodes]);

  /**
   * Adopt the room's board. Used for the first load in a shared session and for
   * every peer edit after it.
   *
   * Recording the board as EXCHANGED and as SAVED before the state lands is the
   * whole trick: both save debounces compare against those and bail, so applying a
   * peer's board cannot be mistaken for a local edit and pushed straight back —
   * which is how a two-person session turns into an infinite sync loop. The echo
   * half of that now belongs to `ShareCanvasSession`, which is where it is tested.
   */
  /**
   * What this browser is holding, for the use case that decides whether a
   * collaborator's board may replace it.
   *
   * A function rather than a value because the answer must be read at the MOMENT
   * of the decision: these are refs precisely so a poll firing eight seconds after
   * its effect closed over them still sees the board as it is now.
   */
  const localBoardState = useCallback((): LocalBoardState => ({
    saving: saveInFlight.current,
    signature: currentGraph.current,
    savedSignature: lastSavedGraph.current,
    revision: revision.current,
  }), []);

  /**
   * Put an adopted board on screen. The ONE place a collaborator's board lands,
   * for both channels that can carry one.
   *
   * A refusal is silent on purpose: "your unsaved edits kept a newer board out"
   * is not something to interrupt someone with, and the next poll or frame will
   * carry it again once the save lands.
   */
  const applyRemoteBoard = useCallback((decision: AdoptRemoteBoardDecision, notice: string) => {
    if (!decision.adopt) return;
    setNodes(decision.board.nodes);
    setEdges(decision.board.edges);
    setPersistedObjectIds(new Set(decision.board.nodes.map((node) => node.id)));
    setTitle(decision.title);
    setAllMembers(decision.members as CreationSessionDetail['members']);
    revision.current = decision.revision;
    lastSavedGraph.current = decision.signature;
    currentGraph.current = decision.signature;
    // A collaborator on a newer deployment can save a kind this build does not
    // declare. Both of these doors used to drop those objects in silence while
    // the initial load, three hundred lines away, said so.
    if (decision.rejected.length) setNotice(t('objectsRejected', { count: decision.rejected.length, kinds: rejectedObjectKinds(decision.rejected) }));
    else setNotice(notice);
  }, [setEdges, setNodes, setNotice, t]);

  const applyRoomSnapshot = useCallback((snapshot: LocalCreationSnapshot) => {
    // `noteExchanged` is NOT called here any more: the shared session moved into
    // `useSharedCanvasRoom`, and its `pull` records the exchange before it calls the
    // adopt callback — which is this function, and its only caller. Calling it here
    // would be the same fact written twice, and the binding no longer exists.
    lastSavedGraph.current = boardSignature(snapshot);
    setTitle(snapshot.title);
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setTimeline((snapshot.timeline ?? []).map((message) => ({
      clientMessageId: message.clientMessageId,
      messageRole: message.role,
      body: message.body,
      metadata: message.metadata ?? {},
      createdAt: message.createdAt,
    })));
    // The viewport is personal — following someone else's pan mid-edit is
    // disorienting, and each participant keeps their own place on the board.
    writeLocalCreationSession(sessionId, snapshot);
    // A joiner mounts on the starter board and this is the first real one it has
    // seen; the load gate opens here so the save debounce may start writing.
    hydrated.current = true;
  }, [sessionId, setEdges, setNodes]);

  /**
   * The board as it stands, in the shape localStorage keeps it.
   *
   * ONE builder. It was written out three times — the autosave debounce, the
   * viewport write and the moment sharing starts — and a fourth caller copying
   * whichever one it happened to sit next to is how a field starts being carried
   * by two of the three.
   *
   * The title comes off the STORED snapshot, not this component's own `title`
   * state: renaming now happens in the session rail, not on the canvas, so this
   * board is no longer the one place a local session's name changes. Reading it
   * fresh off storage rather than baking in the closure's copy is what stops a
   * card move made after a rail rename from writing the OLD name back over it.
   */
  const currentSnapshot = useCallback((viewport = viewportRef.current) => localCreationSnapshot(sessionId, {
    title: readLocalCreationSession(sessionId)?.title ?? title,
    timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })),
    nodes,
    edges,
    viewport,
  }), [edges, nodes, sessionId, timeline, title, viewportRef]);
  const currentSnapshotRef = useRef(currentSnapshot);
  currentSnapshotRef.current = currentSnapshot;

  // Both are read by the hook through a ref, so its pull effect is driven by the
  // ROOM changing rather than by this component re-rendering — which would
  // re-pull the shared board on every keystroke.
  const applyRoomSnapshotRef = useRef(applyRoomSnapshot);
  applyRoomSnapshotRef.current = applyRoomSnapshot;

  const evermindBindingKey = useMemo(() => JSON.stringify(nodes.flatMap((node) => {
    const match = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string'
      ? /^evermind:(\d+)$/.exec(node.data.resourceId)
      : null;
    return match ? [{ nodeId: node.id, projectId: Number(match[1]) }] : [];
  }).sort((a, b) => a.nodeId.localeCompare(b.nodeId))), [nodes]);

  const evermindLiveEnabled = persistence === 'server' && evermindBindingKey !== '[]';
  useEffect(() => {
    if (!evermindLiveEnabled) setEvermindLiveByNodeId({});
  }, [evermindLiveEnabled]);
  usePolledResource(async (signal) => {
      const bindings = JSON.parse(evermindBindingKey) as Array<{ nodeId: string; projectId: number }>;
      const byProject = new Map<number, Promise<[ProjectEvermindHead, ProjectEvermindContributions]>>();
      for (const binding of bindings) {
        if (!byProject.has(binding.projectId)) byProject.set(binding.projectId, Promise.all([getProjectEvermindHead(binding.projectId), getProjectEvermindContributions(binding.projectId)]));
      }
      const settled = await Promise.all(bindings.map(async (binding) => {
        try {
          const [head, activity] = await byProject.get(binding.projectId)!;
          return [binding.nodeId, projectEvermindNodePatch(head, activity)] as const;
        } catch { return null; }
      }));
      if (signal.aborted) return;
      const activeNodeIds = new Set(bindings.map((binding) => binding.nodeId));
      setEvermindLiveByNodeId((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([nodeId]) => activeNodeIds.has(nodeId)));
        for (const entry of settled) {
          if (entry) next[entry[0]] = entry[1];
        }
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
  }, { intervalMs: 20_000, enabled: evermindLiveEnabled, restartKey: evermindBindingKey });

  useEffect(() => { currentGraph.current = JSON.stringify({ nodes, edges }); }, [edges, nodes]);

  // A persisted viewport is expressed in screen pixels, so restoring a camera
  // saved on desktop can put the useful part of the graph beyond a phone's
  // narrow viewport. Reframe once after hydration; subsequent pans and zooms
  // remain entirely under the user's control.
  useEffect(() => {
    if (loadingSession || mobileViewportFitted.current || !nodes.length || typeof window === 'undefined' || window.innerWidth > 760) return;
    const handle = window.setTimeout(() => {
      if (!flowRef.current) return;
      mobileViewportFitted.current = true;
      // A full desktop graph can otherwise shrink to an illegible thumbnail on
      // a phone. Keep objects readable and let the user pan to off-screen work.
      void flowRef.current.fitView({ padding: 0.18, minZoom: 0.62, maxZoom: 0.82, duration: 280 });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [loadingSession, nodes]);

  useEffect(() => {
    if (!initialFocusId || !nodes.some((node) => node.id === initialFocusId)) return;
    setSelectedId(initialFocusId);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id: initialFocusId }], padding: 0.45, duration: 350 }), 0);
  }, [initialFocusId, nodes]);

  useEffect(() => {
    if (!initialBuildOpen || initialBuildOpened.current || !initialFocusId) return;
    const target = nodes.find((node) => node.id === initialFocusId && node.data.kind === 'build');
    const binding = target ? canvasBuildBinding(target.data) : null;
    if (!target || !binding) return;
    initialBuildOpened.current = true;
    setBuildFocus({ nodeId: target.id, storageProjectId: binding.storageProjectId });
  }, [initialBuildOpen, initialFocusId, nodes]);

  /**
   * AUTOSAVE. Debounced 300ms behind the edit that triggered it.
   *
   * What is left here is the SCHEDULING and the React state the result lands in.
   * Everything that decides anything — has the board changed, is this retry the
   * same write, is `Session changed` a failure or a collaborator having saved
   * first — is `persistBoard` in `application/PersistCanvas.ts`, which is why the
   * conflict merge finally has a test that does not mount a canvas.
   */
  useEffect(() => {
    if (!hydrated.current || !canEdit) return;
    const handle = window.setTimeout(() => {
      const board = { nodes, edges };
      const signature = boardSignature(board);
      if (signature === lastSavedGraph.current) return;
      if (persistence === 'local') {
        const snapshot = currentSnapshot();
        persistSnapshot(snapshot);
        lastSavedGraph.current = signature;
        noteSaveState();
        return;
      }
      noteSaveState();
      saveInFlight.current = true;
      // STABLE across retries of the same board, NEW for a different one — so a
      // retry after a timeout is the same write and an edit made during it is not.
      pendingSave.current = saveAttemptKey(pendingSave.current, signature);
      const attempt = pendingSave.current;
      void persistBoard(
        { sessionId, board, viewport: viewportRef.current, expectedRevision: revision.current, idempotencyKey: attempt.key, signature },
        canvasSessionGateway,
        t,
      ).then((result) => {
        if (result.outcome === 'failed') { setNotice(result.notice); return; }
        revision.current = result.revision;
        lastSavedGraph.current = result.signature;
        setPersistedObjectIds(new Set(result.objectIds));
        if (pendingSave.current?.key === attempt.key) pendingSave.current = null;
        if (result.outcome === 'saved') { noteSaveState(); return; }
        setNodes(result.board.nodes);
        setEdges(result.board.edges);
        // A collaborator's board can carry a kind this build does not declare, and
        // the merge is the moment it arrives. Saying so here is the same promise
        // the initial load makes rather than a second, quieter rule for the same event.
        if (result.rejected.length) setNotice(t('objectsRejected', { count: result.rejected.length, kinds: rejectedObjectKinds(result.rejected) }));
        else setNotice(result.notice);
      }).finally(() => { saveInFlight.current = false; });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canEdit, edges, nodes, noteSaveState, persistSnapshot, persistence, sessionId, setEdges, setNodes, setNotice, storageKey, t, timeline, title, viewportRef]);

  useEffect(() => {
    if (persistence !== 'local' || !hydrated.current) return;
    const handle = window.setTimeout(() => {
      const prior = readLocalCreationSession(sessionId); if (!prior) return;
      // `...prior` carries prior.title forward untouched — a rename now happens in
      // the session rail, not here, so this write must not overwrite it with the
      // stale copy this component hydrated `title` from.
      const snapshot: LocalCreationSnapshot = { ...prior, nodes, edges, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), viewport: viewportRef.current, updatedAt: new Date().toISOString() };
      persistSnapshot(snapshot);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [edges, nodes, persistence, sessionId, storageKey, timeline]);

  // The board-reconcile poll. Its load reads the CURRENT selection, composer state
  // and follow target at call time (the hook holds the latest closure), so a click
  // or a keystroke no longer tears the timer down and fires a round-trip.
  usePolledResource(async (signal) => {
      try {
        // The cursor is STILL written here, on purpose. The relay is what makes a
        // pointer live; this row is what makes it survive a client with no socket at
        // all (a blocked WebSocket behind a corporate proxy) — such a client is both
        // seen by everyone and able to see everyone, exactly as before, because the
        // merge simply has no live entry to prefer. And it costs nothing: this tick
        // already UPDATEs the row for `lastSeenAt`, which is what makes a member
        // count as active, so dropping one column out of a write that happens anyway
        // would have bought staleness rather than saved a write.
        const relayed = liveSocketRef.current?.readyState === WebSocket.OPEN;
        const presence = await creationSessionsApi.presence(sessionId, { revision: revision.current, viewport: viewportRef.current, cursor: cursorRef.current, selection: selectedIds, typing: isComposingPrompt, followingUserId });
        if (signal.aborted) return;
        const nextActiveIds = new Set(presence.members.map((member) => member.userId));
        if (activePresenceInitialized.current) {
          const joined = presence.members.find((member) => member.userId !== (presence.currentUserId || currentUserId) && !activeMemberIds.current.has(member.userId));
          if (joined) setJoinedCollaborator(joined);
        } else activePresenceInitialized.current = true;
        activeMemberIds.current = nextActiveIds;
        setMembers(presence.members);
        // Following is driven by the relay when it is up (see the follow effect);
        // this is the same move at poll speed for a client with no socket.
        const followed = relayed ? undefined : presence.members.find((member) => member.userId === followingUserId && member.viewport && typeof member.viewport.x === 'number' && typeof member.viewport.y === 'number' && typeof member.viewport.zoom === 'number');
        if (followed?.viewport) void flowRef.current?.setViewport({ x: Number(followed.viewport.x), y: Number(followed.viewport.y), zoom: Number(followed.viewport.zoom) }, { duration: 350 });
        if (presence.currentUserId) setCurrentUserId(presence.currentUserId);
        // The poll's own revision is the cheap probe; whether the board may
        // actually be replaced — and what happens to the objects this build
        // cannot render — belongs to `AdoptRemoteBoard`.
        if (presence.revision <= revision.current) return;
        const decision = await adoptRemoteBoard(sessionId, localBoardState(), canvasSessionGateway);
        if (signal.aborted) return;
        applyRemoteBoard(decision, t('noticeUpdatedByCollaborator'));
      } catch { /* Presence and polling are best-effort; local edits continue. */ }
  }, { intervalMs: 8_000, enabled: persistence === 'server', restartKey: sessionId });

  useEffect(() => {
    if (!joinedCollaborator) return;
    const timer = window.setTimeout(() => setJoinedCollaborator(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [joinedCollaborator]);

  useEffect(() => {
    if (persistence !== 'server') return;
    const liveUrl = creationSessionsApi.liveUrl(sessionId);
    if (!liveUrl) { setRealtimeState('offline'); return; }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryMs = 1_000;
    const syncRevision = async (hint?: number) => {
      if (stopped) return;
      try {
        // `events` is this channel's cheap probe, exactly as the poll's payload is
        // the other channel's. Everything after it is the same act, and lives in
        // one place so the two doors cannot answer differently.
        const caughtUp = await creationSessionsApi.events(sessionId, revision.current);
        if (Math.max(Number(hint || 0), Number(caughtUp.revision || 0)) <= revision.current) return;
        const decision = await adoptRemoteBoard(sessionId, localBoardState(), canvasSessionGateway);
        if (stopped) return;
        applyRemoteBoard(decision, t('noticeUpdatedLive'));
      } catch { /* The presence reconciliation remains a durable fallback. */ }
    };
    const connect = () => {
      if (stopped) return;
      setRealtimeState(retryMs > 1_000 ? 'reconnecting' : 'connecting');
      try { socket = new WebSocket(liveUrl); } catch { socket = null; }
      if (!socket) {
        setRealtimeState('reconnecting');
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(15_000, retryMs * 2);
        return;
      }
      socket.onopen = () => {
        setRealtimeState('online');
        retryMs = 1_000;
        // Publishing the socket is what arms `sendPresence`; until this runs, the
        // pointer keeps riding the presence poll.
        liveSocketRef.current = socket;
        void syncRevision();
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as { type?: string; revision?: number; lastId?: number; action?: string; peer?: { id?: string } };
          if (frame.type === 'canvas.changed') void syncRevision(frame.revision);
          if (frame.type === 'timeline.changed') void creationSessionsApi.timeline.list(sessionId).then((result) => setTimeline(result.messages)).catch(() => undefined);
          // A peer's pointer at pointer speed, and the `leave` that retires it. Relayed
          // frames are attributed by the SERVER (`userId`), never by the sender — see
          // `SessionRoomDO`; the folding is `useLivePresence`'s, shared with the guest room.
          receivePresence(frame);
        } catch { /* Ignore malformed relay frames. */ }
      };
      socket.onclose = () => {
        if (liveSocketRef.current === socket) liveSocketRef.current = null;
        socket = null;
        // Nobody's pointer is live while this client is deaf; the poll takes over.
        clearPresence();
        if (!stopped) {
          setRealtimeState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting');
          retryTimer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(15_000, retryMs * 2);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      liveSocketRef.current = null;
      // Drop the pending flush with the socket it was going to be written to.
      presenceRef.current?.dispose();
      socket?.close();
    };
  }, [clearPresence, persistence, receivePresence, sessionId, setEdges, setNodes]);

  /**
   * Composing a prompt is presence too — the cursor label says so. It changes at
   * human speed, so it is sent on the state change rather than throttled per frame.
   */
  useEffect(() => {
    if (!presenceLive) return;
    sendPresence({ typing: isComposingPrompt });
  }, [isComposingPrompt, presenceLive, sendPresence]);

  /**
   * A Brain turn in flight is presence too. The run executes in THIS browser, so
   * without announcing it everyone else on the board saw an idle Brain for the
   * minutes a long turn takes. Re-sent on a heartbeat because a still requester
   * sends nothing else and would otherwise expire off their screens mid-run — the
   * same beat also reaches a collaborator who joins after the turn began.
   */
  useEffect(() => {
    if (!presenceLive) return;
    const brainRun = thinking && brainRunStartedAt != null ? { startedAt: brainRunStartedAt } : null;
    sendPresence({ brainRun });
    if (!brainRun) return;
    const timer = window.setInterval(() => sendPresence({ brainRun }), BRAIN_RUN_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [brainRunStartedAt, presenceLive, sendPresence, thinking]);

  /**
   * Follow, driven live. The poll's copy of this only runs when the relay is down,
   * so a follower moves WITH the person they are following rather than catching up
   * to where they were.
   */
  const followedViewport = followingUserId ? livePresence[followingUserId]?.viewport : undefined;
  useEffect(() => {
    if (!followedViewport) return;
    void flowRef.current?.setViewport(followedViewport, { duration: 120 });
  }, [followedViewport]);

  /**
   * Who "you" are in the live roster. A saved board keys the viewer by account; an
   * account-less guest room keys every person by `guestRoomOccupantId`, so the viewer
   * is the room's own answer (`sharedRoom.selfId`).
   */
  const presenceSelfId = inRoom ? sharedRoom.selfId : currentUserId;
  /**
   * One roster to draw. Identity (name, role) comes from the poll — or, in a guest
   * room, from the room's roster; position comes from the relay. Merging rather than
   * keeping two lists is why a name and a pointer can never disagree — see
   * `lib/canvas/livePresence`. (Unretracted pointers are retired by `useLivePresence`.)
   */
  const liveMembers = useMemo(
    () => mergeLivePresence<CreationSessionDetail['members'][number]>(inRoom ? sharedRoom.roster : members, livePresence, presenceSelfId),
    [inRoom, livePresence, members, presenceSelfId, sharedRoom.roster],
  );

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
  const effectiveSelectedIds = useMemo(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);
  /**
   * SELECTING THE CHAT IS NOT A SCOPING INTENT.
   *
   * The Brain chat is an object on the board, so typing into it selects it — and AUTO
   * scope read any selection as "ask about this", which narrowed every turn after the
   * first to the chat itself. Measured 2026-08-15 (ui 2026.8.17): turn one ran against
   * 2 of 2 objects, the composer selected the chat 116ms later, and turns two and three
   * ran against 1 of 2 — the board's only real object invisible to Brain for the rest
   * of the session, with the diagnostics reporting "an answer about what is on the
   * canvas from this scope is answering about a subset".
   *
   * A selection that is ENTIRELY chat objects is where the person is typing, not what
   * they are pointing at. Selecting the chat AND something else is still a real
   * selection, and an explicitly chosen scope is always honoured — this only decides
   * what `auto` infers.
   */
  const selectionIsOnlyChat = effectiveSelectedIds.length > 0
    && effectiveSelectedIds.every((id) => nodes.find((node) => node.id === id)?.data.kind === 'chat');
  const resolvedScopeMode = scopeMode === 'auto'
    ? selectedNode?.data.kind === 'frame' ? 'frame'
      : effectiveSelectedIds.length && !selectionIsOnlyChat ? 'selection' : 'canvas'
    : scopeMode;
  const scopedNodeIds = useMemo(() => {
    if (resolvedScopeMode === 'canvas') return new Set(nodes.map((node) => node.id));
    const selected = new Set(effectiveSelectedIds);
    if (resolvedScopeMode === 'connected') {
      edges.forEach((edge) => {
        if (selected.has(edge.source)) selected.add(edge.target);
        if (selected.has(edge.target)) selected.add(edge.source);
      });
    }
    if (resolvedScopeMode === 'frame' && selectedNode?.data.kind === 'frame') {
      const { width, height } = canvasNodeDimensions(selectedNode);
      nodes.forEach((node) => {
        if (node.id === selectedNode.id) return;
        const withinX = node.position.x >= selectedNode.position.x
          && node.position.x <= selectedNode.position.x + width;
        const withinY = node.position.y >= selectedNode.position.y
          && node.position.y <= selectedNode.position.y + height;
        if (withinX && withinY) selected.add(node.id);
      });
    }
    return selected;
  }, [edges, effectiveSelectedIds, nodes, resolvedScopeMode, selectedNode]);
  const scopeLabel = resolvedScopeMode === 'canvas' ? t('entireCanvas')
    : resolvedScopeMode === 'connected' ? `Connected objects (${scopedNodeIds.size})`
      : resolvedScopeMode === 'frame' ? `Current frame: ${selectedNode?.data.title || 'Frame'}`
        : effectiveSelectedIds.length > 1 ? `${effectiveSelectedIds.length} selected objects`
          : selectedNode ? `Selected: ${selectedNode.data.title}` : t('entireCanvas');
  const scopedNodes = useMemo(() => nodes.filter((node) => scopedNodeIds.has(node.id)), [nodes, scopedNodeIds]);

  /**
   * WHAT THE PERSON WAS LOOKING AT WHEN THEY ASKED.
   *
   * Scope and selection decide how much of the board a Brain turn can see, and
   * the reported failure — "I don't see that file anywhere on the canvas", said
   * about a file that was on the canvas — happened because the turn ran against
   * ONE selected object. Neither the scope nor the selection that produced an
   * answer was recorded anywhere, so the report could not show the reader the
   * one fact that explained it. Recorded on CHANGE rather than per render, so
   * the journal reads as a sequence of decisions rather than a render log.
   */
  const scopeSignature = `${resolvedScopeMode}:${scopedNodeIds.size}/${nodes.length}`;
  const lastScopeSignature = useRef(scopeSignature);
  useEffect(() => {
    if (lastScopeSignature.current === scopeSignature) return;
    lastScopeSignature.current = scopeSignature;
    journal.current.record({
      kind: 'user',
      label: 'scope.change',
      detail: `${resolvedScopeMode} · ${scopedNodeIds.size} of ${nodes.length} object(s) visible to Brain`,
    });
  }, [nodes.length, resolvedScopeMode, scopeSignature, scopedNodeIds.size]);

  /**
   * The board is the source of truth for WHO IS ON IT; the shell is the source of
   * truth for who is on the CALL. Publishing the roster upward is what lets the
   * live bar show one set of people instead of the board and the room each
   * keeping their own — and it is why a teammate who navigates away from the
   * board does not vanish from the call.
   */
  /**
   * A logged-out board that has started a shared free session IS a room — it has a
   * guest room code and the guest media transport that `GuestRoomMeeting` has used
   * since guest rooms shipped. Nothing on the canvas could reach it, so the free
   * board was the one surface where people could work on the same thing and had no
   * way to talk about it. Declaring the anchor is all it takes: `useCanvasLiveRoom`
   * owns the decision and the bar's own `call` action is the control — the same one
   * every signed-in canvas uses, so the free board gains a call rather than a second
   * way of starting one.
   */
  const publishAnchor = liveSession?.publishAnchor;
  useEffect(() => {
    if (!publishAnchor) return undefined;
    if (persistence !== 'local' || !sharedRoom.code) { publishAnchor(null); return undefined; }
    publishAnchor({
      roomKey: sharedRoom.code,
      label: t('sharedCallLabel'),
      tenantId: null,
      participant: { name: getGuestDisplayName(), ref: 'self' },
      transport: guestMediaTransport,
    });
    return () => publishAnchor(null);
  }, [persistence, publishAnchor, sharedRoom.code, sharedRoom.displayName, t]);

  const publishPresence = liveSession?.publishPresence;
  useEffect(() => {
    if (!publishPresence) return;
    publishPresence(members.map((member) => ({ userId: member.userId, displayName: member.displayName })), currentUserId);
  }, [currentUserId, members, publishPresence]);

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
  const cardsEditable = canEdit && !lockBlocked;

  /**
   * A social campaign's copy lives on the SERVER, not on the tile.
   *
   * The tile is a view of a saved campaign, and publishing reads the saved copy — so an
   * edit that stopped at the card would show one message on the board and publish a
   * different one. Editing these fields therefore writes through, and the returned
   * campaign (whose blockers and target count may have changed) is what lands back on
   * the tile. Everything else about a campaign object is a read-only reflection.
   */
  const syncSocialCampaign = useCallback(async (campaignId: number, nodeId: string, patch: Partial<CreationNodeData>) => {
    // WHICH fields of an edited card may be sent — and why an untouched
    // `scheduledAt` must not be one of them — is the marketing context's rule.
    const result = await syncCampaignUseCase(campaignId, patch, socialCampaignGateway, tSocial as CanvasTextTranslator);
    if (!result.ok) { setNotice(result.notice); return; }
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...socialCampaignNodeData(result.campaign) } as CreationNodeData }
      : node));
  }, [setNodes, setNotice, tSocial]);

  /**
   * The board, read WITHOUT depending on it.
   *
   * `updateNodeData` is handed to every card through the `nodeTypes` memo, and `nodes`
   * changes identity on every board event — a selection, a drag, a re-measure, each
   * streamed Brain token writing the transcript back onto the chat Object. Listing it
   * as a dependency therefore gave React Flow a new `nodeTypes` object continuously and
   * REMOUNTED every Object on the board, destroying the local state a card holds: the
   * dashboard's open editor, a document's caret, a data grid's edited cell.
   *
   * Reported as "Edit dashboard does nothing", and that is precisely what it did: the
   * remount lands between the mousedown that SELECTS a card and the click on a control
   * inside it, so the first press hit an element that no longer existed and never
   * reached a handler. Locked by `CreationCanvas.realFlow.test.tsx`, which needs the
   * real store — a mocked XYFlow cannot see a remount.
   *
   * Same ref treatment, for the same reason, as `exportFromNode` and
   * `runWorkflowFromNode` below: stable identity, newest closure. `nodesRef` is the ONE
   * such ref — the build tools and the object vocabulary read the board through it too.
   */
  const nodesRef = useRef<CreationFlowNode[]>([]);
  nodesRef.current = nodes;
  /**
   * The framed reading of the board — who is inside which frame — as a ref.
   *
   * Same treatment, for the same reason, as `nodesRef` above: the drag handler needs
   * the newest containment and must keep a stable identity, and the containment is
   * derived far below it (`useFramedBoard`, which reads the fully decorated nodes). A
   * dependency instead of a ref would either reorder the whole component or hand React
   * Flow a new handler on every board edit.
   */
  const framedBoardRef = useRef<{ memberIdsOf: (frameId: string) => string[] }>({ memberIdsOf: () => [] });
  /** The connections, on the same terms as `nodesRef` — what a compile reads. */
  const edgesRef = useRef<Edge[]>([]);
  edgesRef.current = edges;

  /**
   * What THIS Brain turn intends the board to become, before a human has agreed
   * to any of it.
   *
   * Reading it through {@link CanvasProposalStage} rather than a raw array is the
   * reason a tool can no longer forget that its view of the board must include
   * what the tools before it staged: `stage.nodes()` is the union and there is no
   * accessor that is not. That question used to be re-answered by hand at 58 call
   * sites — three of which spelled the local differently and one of which left the
   * staged EDGES out — and getting it wrong placed objects on top of each other.
   *
   * Constructed once and never replaced, so the tools registered in `canvasActions`
   * keep one identity across renders; it reads `nodesRef`/`edgesRef` so it always
   * sees the CURRENT board rather than whichever one the memo captured.
   */
  const stageRef = useRef<CanvasProposalStage | null>(null);
  stageRef.current ??= new CanvasProposalStage(
    { nodes: () => nodesRef.current, edges: () => edgesRef.current },
    { defaults: (kind) => createDefaultCreationData(kind, canvasTextRef.current), position: nextCanvasObjectPosition, viewport: () => layoutViewportRef.current() },
  );
  const stage = stageRef.current;

  const updateNodeData = useCallback((nodeId: string, patch: Partial<CreationNodeData>) => {
    if (!cardsEditable) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const data = { ...node.data, ...patch };
      // A frame putting itself away is not only a fact ABOUT the frame — it is a
      // different-sized object on the board, and size lives on the node, not in its
      // data. Handled here rather than through a second callback so that every route
      // that collapses a frame (the card, Brain, a keyboard shortcut) resizes it, and
      // so `frameExpandedWidth/Height` is written by exactly one piece of code.
      if (node.data.kind === 'frame' && 'frameCollapsed' in patch) {
        return withFrameCollapsed(
          { ...node, data },
          patch.frameCollapsed === true,
          { id: node.id, kind: 'frame', position: node.position, size: canvasNodeDimensions(node), data: node.data as unknown as Record<string, unknown> },
        );
      }
      return { ...node, data };
    }));
    noteSaveState();
    const target = nodesRef.current.find((node) => node.id === nodeId);
    const campaignId = Number(target?.data.campaignId);
    if (target?.data.kind === 'socialCampaign'
      && Number.isInteger(campaignId)
      && SERVER_OWNED_CAMPAIGN_FIELDS.some((field) => field in patch)) {
      void syncSocialCampaign(campaignId, nodeId, patch);
    }
  }, [cardsEditable, setNodes, syncSocialCampaign]);

  /**
   * A deal dragged into another stage, on the card.
   *
   * The gesture FO-F1 named itself after and could not perform: every piece was in
   * place — each projected card carries its `dealId`, and ONE call both moves the
   * deal and returns the redrawn board — and the renderer had no drag handler, so
   * the move was reachable through the MODEL and not through a pointer.
   *
   * Deliberately NOT `updateNodeData`: this is not a patch to the card, it is a
   * write to the DEAL followed by a redraw from that same response. Which is also
   * why there is no optimistic reorder — the board that comes back is the board,
   * and painting a guess first would reintroduce, for a few hundred milliseconds,
   * exactly the "the card says one thing and the CRM says another" the projection
   * exists to remove. A refusal (a stage the tenant retired, a deal somebody else
   * closed) leaves the card where it was and says why.
   */
  const moveDealFromNode = useCallback((nodeId: string, dealId: number, stage: string) => {
    if (!cardsEditable) return;
    noteSaveState();
    void moveDealOnBoard(dealId, stage)
      .then((pipeline) => {
        setNodes((current) => current.map((node) => node.id === nodeId
          ? { ...node, data: { ...node.data, ...pipelineFieldsFrom(pipeline) } }
          : node));
        setNotice(t('noticeDealMoved', { stage }));
      })
      .catch((error: unknown) => {
        setNotice(faultText(error, t('noticeDealNotMoved')));
      });
  }, [cardsEditable, setNodes, t]);

  /* Takes the node it resizes rather than reading the selection: the panel that offers
     this is anchored to ONE card, and "whichever card is selected" is exactly the
     ambiguity anchoring the panel removed. */
  const updateWebsiteViewport = useCallback((nodeId: string, viewport: 'desktop' | 'tablet' | 'mobile') => {
    if (!canEdit || lockBlocked) return;
    const preset = viewport === 'mobile' ? { width: 340, height: 620 } : viewport === 'tablet' ? { width: 520, height: 560 } : { width: 720, height: 460 };
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, style: { ...node.style, ...preset }, data: { ...node.data, viewport } } : node));
    setNotice(t('noticeViewportChanged', { viewport }));
  }, [canEdit, lockBlocked, setNodes]);

  // `clientMessageId` is annotated rather than inferred from the default:
  // `crypto.randomUUID()` is typed as the template literal `${string}-${string}…`
  // in the DOM lib, which would narrow the PARAMETER to that shape and reject
  // the ids callers legitimately pass through (a resumed message's own id).
  const appendTimeline = useCallback((role: 'user' | 'assistant' | 'system', body: string, metadata: CreationTimelineMessage['metadata'] = {}, clientMessageId: string = crypto.randomUUID()) => {
    const message: CanvasTimelineMessage = { clientMessageId, messageRole: role, body, metadata, createdAt: new Date().toISOString() };
    setTimeline((current) => current.some((item) => item.clientMessageId === clientMessageId) ? current : [...current, message]);
    if (persistence === 'server') void creationSessionsApi.timeline.append(sessionId, { clientMessageId, role, body, metadata }).then((saved) => {
      setTimeline((current) => current.map((item) => item.clientMessageId === clientMessageId ? saved : item));
    }).catch((error) => setNotice(error instanceof Error ? t('noticeConversationSaveFailedReason', { reason: error.message }) : t('noticeConversationSaveFailed')));
    return clientMessageId;
  }, [persistence, sessionId]);

  // The Brain Object mirrors the live turn — messages, trace, and the run state that
  // drives its activity bar — so a working Brain reads as working on the board too,
  // not only inside the dock (which the user may have closed).
  useEffect(() => {
    const messages = timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt }));
    setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, messages, ...(brainTrace.length ? { trace: brainTrace } : {}), brainRunning: thinking, brainRunStartedAt, aiResponse: [...timeline].reverse().find((message) => message.messageRole === 'assistant')?.body || node.data.aiResponse } } : node));
  }, [brainRunStartedAt, brainTrace, setNodes, thinking, timeline]);

  useEffect(() => {
    if (!shouldAcquireCanvasObjectLock(persistence, selectedId, canEdit, persistedObjectIds)) { setLockBlocked(false); return; }
    const lockedObjectId = selectedId!;
    let stopped = false;
    const acquire = async (action: 'acquire' | 'renew') => {
      try {
        await creationSessionsApi.lock(sessionId, lockedObjectId, action);
        if (!stopped) setLockBlocked(false);
      } catch (error) {
        if (!stopped) { setLockBlocked(true); setNotice(faultText(error, t('noticeObjectLocked'))); }
      }
    };
    void acquire('acquire');
    const timer = window.setInterval(() => void acquire('renew'), 45_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void creationSessionsApi.lock(sessionId, lockedObjectId, 'release').catch(() => undefined);
    };
  }, [canEdit, persistedObjectIds, persistence, selectedId, sessionId]);

  /**
   * How a dropped file's bytes survive past the import that could not read
   * them, so a later tool can still escalate it (OCR on a scan, a multimodal
   * read on a corrupted document). A signed-in, server-persisted session has a
   * tenant to scope an R2 upload to and later bill that read to, so its bytes
   * go there and only a key stays on the canvas object. A local/guest canvas
   * has neither, so the alternative is to keep the bytes inline as base64 —
   * unrealized cost if the draft is only ever a scratch board, but not lost if
   * the person later signs in and the draft is claimed, at which point the
   * same object can still be escalated.
   */
  const attachmentBytesStrategy: AttachmentBytesStrategy = useCallback(async (file: File) => {
    if (persistence === 'server') {
      try {
        return { sourceFileKey: await uploadAttachmentSource(file) };
      } catch {
        return null;
      }
    }
    const url = await fileToDataUrl(file);
    return url ? { sourceDataUrl: url } : null;
  }, [persistence]);

  /** Filling an existing Dataset object from a file reads it through the same
   * engine as a drop, so a workbook picked here loads exactly as one dropped on
   * the board rather than failing on a format only this path never learned. */
  const importDataset = useCallback(async (file: File) => {
    if (!selectedId) return;
    try {
      const [imported] = (await importCanvasFile(file, importLabel)).objects;
      const columns = Array.isArray(imported?.data.columns) ? imported.data.columns as string[] : [];
      const rows = Array.isArray(imported?.data.rows) ? imported.data.rows as TabularSource['rows'] : [];
      if (!columns.length) throw new Error(t('datasetNoColumns'));
      if (rows.length > datasetRowLimit) throw new Error(t('datasetRowLimit', { limit: fmt.number(datasetRowLimit) }));
      const { title: _title, ...fields } = imported!.data;
      // Adopt the imported file's name, but only over the palette's placeholder.
      // A card the user has already named is theirs and survives the import;
      // one that still says "Imported dataset.csv" after importing revenue.csv is
      // simply wrong, and every artifact derived from it — "… visualization",
      // the map, the chart — inherits that wrong name.
      // Both spellings: a card minted before default titles followed the board's
      // language still carries the English one.
      const placeholders = new Set([createDefaultCreationData('dataset').title, createDefaultCreationData('dataset', canvasText).title]);
      // Two facts are stamped at import because neither can be recovered later.
      // `fetchedAt` is what makes staleness computable at all — a dataset with no
      // timestamp is a snapshot of unknown age, and every chart built on it
      // inherits that silence. The PII scan runs here rather than on demand
      // because a restricted column must be masked from the FIRST render, not
      // from whenever someone remembers to ask.
      const source: TabularSource = { columns, rows };
      const classifications = classifyTabular(source, profileTabular(source));
      const governance = classificationSummary(classifications);
      setNodes((current) => current.map((node) => (node.id === selectedId
        ? { ...node, data: {
          ...node.data, ...fields,
          classifications, fetchedAt: new Date().toISOString(), sourceUri: file.name,
          ...(placeholders.has(node.data.title) ? { title: file.name } : {}),
        } }
        : node)));
      setNotice(governance.piiColumns
        ? t('datasetImportedWithPii', { name: file.name, rows: fmt.number(rows.length), columns: columns.length, pii: governance.piiColumns })
        : t('datasetImported', { name: file.name, rows: fmt.number(rows.length), columns: columns.length }));
    } catch (error) {
      setNotice(faultText(error, t('datasetImportFailed')));
    }
  }, [canvasText, datasetRowLimit, importLabel, selectedId, setNodes, t]);

  useEffect(() => {
    if (!hydrated.current || historyApplying.current) return;
    const next = JSON.stringify({ nodes, edges });
    const handle = window.setTimeout(() => {
      if (historyBaseline.current == null) historyBaseline.current = next;
      else if (historyBaseline.current !== next) {
        // Every board mutation — palette, drag, delete, inspector edit, an AI
        // proposal being applied, an undo — settles HERE, so this is the one
        // place that can record what the person did without a dozen handlers
        // each remembering to. See `describeGraphChange`.
        try {
          const change = describeGraphChange(
            JSON.parse(historyBaseline.current) as { nodes: CreationFlowNode[]; edges: Edge[] },
            { nodes, edges },
          );
          if (change) journal.current.record({ kind: 'user', label: change.label, detail: change.detail });
        } catch { /* the journal must never be able to break the history stack */ }
        undoStack.current = [...undoStack.current.slice(-49), historyBaseline.current];
        historyBaseline.current = next;
        redoStack.current = [];
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [edges, nodes]);

  const restoreGraphState = useCallback((serialized: string) => {
    const graph = JSON.parse(serialized) as { nodes: CreationFlowNode[]; edges: Edge[] };
    historyApplying.current = true;
    historyBaseline.current = serialized;
    setNodes(graph.nodes); setEdges(graph.edges);
    window.setTimeout(() => { historyApplying.current = false; }, 0);
  }, [setEdges, setNodes]);

  const undo = useCallback(() => {
    const prior = undoStack.current.pop(); if (!prior) { journal.current.record({ kind: 'user', label: 'undo', ok: false, detail: 'nothing to undo' }); setNotice(t('noticeNothingToUndo')); return; }
    journal.current.record({ kind: 'user', label: 'undo' });
    redoStack.current.push(JSON.stringify({ nodes, edges })); restoreGraphState(prior); setNotice(t('noticeChangeUndone'));
  }, [edges, nodes, restoreGraphState]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop(); if (!next) { journal.current.record({ kind: 'user', label: 'redo', ok: false, detail: 'nothing to redo' }); setNotice(t('noticeNothingToRedo')); return; }
    journal.current.record({ kind: 'user', label: 'redo' });
    undoStack.current.push(JSON.stringify({ nodes, edges })); restoreGraphState(next); setNotice(t('noticeChangeRedone'));
  }, [edges, nodes, restoreGraphState]);

  // Operator decision 2026-09-12: anything placed into a COLLAPSED frame — dropped,
  // dragged, pasted, imported, applied from Brain, adopted from a collaborator — opens
  // it. Diffed off the board state because that is the one path every placement shares.
  useExpandFramesOnPlacement(nodes, setNodes, { toBox: toFrameBox, enabled: cardsEditable, suspended: historyApplying });

  const selectionIds = useCallback(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);

  /**
   * REMOVE OBJECTS — and every connection into or out of them.
   *
   * ONE path for all three ways of asking: the Delete key, the trash on a card's own
   * header (`CanvasNodeDeleteButton`), and Delete in the selection toolbar. Written
   * three times it would have been three answers to "what happens to the edges", "does
   * a locked object go too" and "what is the selection afterwards" — and the keyboard
   * path already answered the second one differently from `arrange`, `align` and the
   * nudge keys, all of which skip a locked object.
   *
   * It reads `nodesRef` rather than `nodes` deliberately: this callback is handed to
   * every card through `canvasNodeTypes`, and a dependency on the board itself would
   * give React Flow a new `nodeTypes` object on every edit and remount the whole board.
   */
  const deleteObjects = useCallback((ids: readonly string[]) => {
    if (!canEdit) return;
    const requested = new Set(ids);
    // A locked object is locked against being moved, resized AND removed — the lock is
    // the one thing standing between a finished board and an accidental drag, and a
    // delete that ignored it would make that promise worth nothing.
    const removable = new Set(nodesRef.current.filter((node) => requested.has(node.id) && canvasPlacementUnlocked(node)).map((node) => node.id));
    if (!removable.size) {
      setNotice(requested.size ? t('noticeDeleteLocked') : t('noticeSelectToDelete'));
      return;
    }
    setNodes((current) => current.filter((node) => !removable.has(node.id)));
    setEdges((current) => current.filter((edge) => !removable.has(edge.source) && !removable.has(edge.target)));
    // Only what actually went. Clearing the whole selection would drop the other cards a
    // person had gathered, which is a second, unasked-for edit.
    setSelectedIds((current) => current.filter((id) => !removable.has(id)));
    setSelectedId((current) => (current && removable.has(current) ? null : current));
    setNotice(t('noticeObjectsDeleted', { count: removable.size }));
  }, [canEdit, setEdges, setNodes, setNotice, t]);
  /** Stable across renders so `canvasNodeTypes` keeps its identity — see above. */
  const deleteNodeFromCard = useCallback((nodeId: string) => deleteObjects([nodeId]), [deleteObjects]);
  const deleteSelection = useCallback(() => deleteObjects(selectionIds()), [deleteObjects, selectionIds]);

  const duplicateSelection = useCallback(() => {
    if (!canEdit) return;
    const ids = new Set(selectionIds());
    if (!ids.size) { setNotice(t('noticeSelectToDuplicate')); return; }
    const idMap = new Map<string, string>();
    const copies = nodes.filter((node) => ids.has(node.id)).map((node) => {
      const id = crypto.randomUUID(); idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 36, y: node.position.y + 36 }, selected: true, data: { ...node.data, title: `${node.data.title} copy`, resourceId: undefined } };
    });
    const copiedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    setNodes((current) => { const base = current.map((node) => ({ ...node, selected: false })); return [...base, ...placeAppendedRef.current(base, copies)]; });
    setEdges((current) => [...current, ...copiedEdges]);
    const nextIds = copies.map((node) => node.id); setSelectedIds(nextIds); setSelectedId(nextIds.length === 1 ? nextIds[0] : null);
    setNotice(t('noticeObjectsDuplicated', { count: copies.length }));
  }, [canEdit, edges, nodes, selectionIds, setEdges, setNodes]);

  const copySelection = useCallback(() => {
    const ids = new Set(selectionIds());
    if (!ids.size) { setNotice(t('noticeSelectToCopy')); return; }
    canvasClipboard.current = {
      nodes: nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node, data: { ...node.data } })),
      edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge })),
    };
    setNotice(t('noticeObjectsCopied', { count: ids.size }));
  }, [edges, nodes, selectionIds]);

  const pasteSelection = useCallback(() => {
    if (!canEdit || !canvasClipboard.current) return;
    const idMap = new Map<string, string>();
    const pasted = canvasClipboard.current.nodes.map((node) => {
      const id = crypto.randomUUID(); idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 48, y: node.position.y + 48 }, selected: true, data: { ...node.data, resourceId: undefined } };
    });
    const pastedEdges = canvasClipboard.current.edges.map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    setNodes((current) => { const base = current.map((node) => ({ ...node, selected: false })); return [...base, ...placeAppendedRef.current(base, pasted)]; }); setEdges((current) => [...current, ...pastedEdges]);
    const ids = pasted.map((node) => node.id); setSelectedIds(ids); setSelectedId(ids.length === 1 ? ids[0] : null); setNotice(t('noticeObjectsPasted', { count: ids.length }));
  }, [canEdit, setEdges, setNodes]);

  const alignSelection = useCallback(() => {
    const ids = new Set(selectionIds());
    if (!canEdit || ids.size < 2) { setNotice(t('alignNeedsTwo')); return; }
    // Left-aligning ALONE piles a selected row of objects onto one another, which
    // is what "align" used to do here; the shared primitive spaces the column too.
    const placements = alignCanvasNodesLeft(nodes, ids);
    if (!placements.size) { setNotice(t('alignNeedsTwo')); return; }
    setNodes((current) => current.map((node) => {
      const placement = placements.get(node.id);
      return placement ? { ...node, position: placement } : node;
    }));
    setNotice(t('objectsAligned', { count: placements.size }));
  }, [canEdit, nodes, selectionIds, setNodes, t]);

  /**
   * Work on one section alone — a canvas within a canvas.
   *
   * Everything outside the frame is hidden (not removed — see `useFramedBoard`), the
   * viewport fits what is left, and the board is otherwise exactly the board: same
   * palette, same Brain, same undo, same presence. That is the whole difference from
   * the modal editor this replaced, which had its own of each.
   */
  const openFrame = useCallback((frameId: string) => {
    setFrameFocus(frameId);
    setNodePanel(null);
    // After the hidden flags land, or the fit measures the whole board.
    window.setTimeout(() => { void flowRef.current?.fitView({ padding: 0.14, minZoom: CANVAS_FIT_MIN_ZOOM }); }, 0);
  }, []);
  const exitFrame = useCallback(() => {
    setFrameFocus(null);
    window.setTimeout(() => { void flowRef.current?.fitView({ padding: 0.12, minZoom: CANVAS_FIT_MIN_ZOOM }); }, 0);
  }, []);

  const frameSelection = useCallback(() => {
    const ids = new Set(selectionIds());
    const chosen = nodes.filter((node) => ids.has(node.id));
    if (!canEdit || chosen.length < 2) { setNotice(t('noticeSelectTwoForFrame')); return; }
    const left = Math.min(...chosen.map((node) => node.position.x)) - 40;
    const top = Math.min(...chosen.map((node) => node.position.y)) - 70;
    const right = Math.max(...chosen.map((node) => node.position.x + canvasNodeDimensions(node).width)) + 40;
    const bottom = Math.max(...chosen.map((node) => node.position.y + canvasNodeDimensions(node).height)) + 40;
    const frame = newNode('frame', { x: left, y: top }); frame.style = { width: right - left, height: bottom - top }; frame.zIndex = -1;
    frame.data = { ...frame.data, title: 'Grouped objects', framePurpose: 'Organize this related work' };
    setNodes((current) => [frame, ...current.map((node) => ({ ...node, selected: false }))]); setSelectedIds([frame.id]); setSelectedId(frame.id); setScopeMode('frame'); setNotice(t('noticeObjectsFramed', { count: chosen.length }));
  }, [canEdit, nodes, selectionIds, setNodes]);

  const togglePlacementLock = useCallback(() => {
    const ids = new Set(selectionIds()); if (!canEdit || !ids.size) return;
    const shouldLock = nodes.some((node) => ids.has(node.id) && canvasPlacementUnlocked(node));
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, ...canvasPlacementFlags(shouldLock), data: { ...node.data, placementLocked: shouldLock } } : node));
    setNotice(shouldLock ? 'Object placement locked' : t('noticePlacementUnlocked'));
  }, [canEdit, nodes, selectionIds, setNodes]);

  const toggleHidden = useCallback(() => {
    const ids = new Set(selectionIds()); if (!canEdit || !ids.size) return;
    const shouldHide = nodes.some((node) => ids.has(node.id) && node.data.placementHidden !== true);
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, hidden: shouldHide, data: { ...node.data, placementHidden: shouldHide } } : node));
    if (shouldHide) { setSelectedId(null); setSelectedIds([]); }
    setNotice(shouldHide ? 'Objects hidden from the canvas' : t('noticeObjectsShown'));
  }, [canEdit, nodes, selectionIds, setNodes]);

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
  /**
   * The ordered walk through this board's frames.
   *
   * Derived from the nodes rather than stored — see `canvasPresentation.ts` for why a
   * stored list is the wrong shape for a board several people are editing. Memoised on
   * the nodes, so adding a frame mid-presentation extends the sequence with no
   * bookkeeping anywhere.
   */
  const presentationSteps = useMemo(() => presentationSequence(nodes.map((node) => {
    const dimensions = canvasNodeDimensions(node);
    return {
      id: node.id,
      position: node.position,
      width: dimensions.width,
      height: dimensions.height,
      data: { kind: node.data.kind, title: node.data.title, presentationOrder: node.data.presentationOrder, hidden: node.data.placementHidden },
      hidden: node.hidden === true,
    };
  })), [nodes]);

  /**
   * Move the presentation, and everyone following, to one step.
   *
   * The follower half is FREE and is the reason this writes a viewport rather than
   * calling `fitView`: the presence channel already carries `viewport` on every pan and
   * zoom, and `followedViewport` already applies it. So moving the presenter's camera
   * moves every follower's, and the sequence needed no new transport at all — which is
   * exactly why these three were the Miro items worth chasing.
   */
  const goToPresentationStep = useCallback((index: number) => {
    const step = presentationStepAt(presentationSteps, index);
    if (!step) return;
    setPresentStep(step.index - 1);
    const wrapper = flowWrapRef.current;
    const screen = wrapper
      ? { width: wrapper.clientWidth, height: wrapper.clientHeight }
      : { width: typeof window === 'undefined' ? 1_280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight };
    void flowRef.current?.setViewport(presentationViewport(step.bounds, screen), { duration: 420 });
  }, [presentationSteps]);

  /**
   * Step relative, clamped. Wrapping past the last frame in front of a room reads as a
   * crash, which is the whole argument in `stepPresentation`.
   */
  const movePresentation = useCallback((delta: number) => {
    const next = stepPresentation(presentStep, delta, presentationSteps.length);
    if (next === null) return;
    goToPresentationStep(next);
  }, [goToPresentationStep, presentStep, presentationSteps.length]);

  /**
   * Opening present mode opens ON the sequence.
   *
   * Without this, entering present mode leaves the camera wherever the presenter
   * happened to be — which is the behaviour that made the mode feel unfinished: the
   * chrome vanishes and nothing else happens.
   */
  useEffect(() => {
    if (!presentMode || !presentationSteps.length) return;
    goToPresentationStep(presentStep);
    // Deliberately NOT depending on `presentStep`: this fires on ENTERING the mode, and
    // re-running it on every step would fight the step handler that just moved the
    // camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentMode, presentationSteps.length]);

  const focusSelection = useCallback(() => {
    const ids = selectionIds(); if (!ids.length) return;
    if (threeDControls) { threeDControls.focusObjects(ids); return; }
    void flowRef.current?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.28, duration: 350 });
  }, [selectionIds, threeDControls]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      const ids = new Set(selectionIds());
      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.size && canEdit) {
        event.preventDefault(); deleteObjects([...ids]);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return; }
      // PRESENTING TAKES THE ARROW KEYS. Nudging a selected object one pixel is the
      // right binding on a board being edited and the wrong one in front of a room,
      // where → means "next". Escape leaves the mode rather than clearing a selection,
      // for the same reason: it is what every presentation tool does.
      if (presentModeRef.current && presentationSteps.length > 0) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); movePresentation(1); return; }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); movePresentation(-1); return; }
        if (event.key === 'Home') { event.preventDefault(); goToPresentationStep(0); return; }
        if (event.key === 'End') { event.preventDefault(); goToPresentationStep(presentationSteps.length - 1); return; }
        if (event.key === 'Escape') { event.preventDefault(); setPresentMode(false); return; }
      }
      if (event.key === 'Escape') { setSelectedId(null); setSelectedIds([]); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && ids.size && canEdit) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1; const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        setNodes((current) => current.map((node) => ids.has(node.id) && canvasPlacementUnlocked(node) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node));
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [canEdit, copySelection, deleteObjects, duplicateSelection, goToPresentationStep, movePresentation, pasteSelection, presentationSteps.length, redo, selectionIds, setNodes, setPresentMode, undo]);

  /**
   * Apply what a materialisation use case decided.
   *
   * ONE place that turns a `MaterializeResult` into board state, because "add the
   * object, connect it to its source, select it, open its inspector, say so" is
   * the same five steps for a chart and for a map — and they were written twice,
   * so the map already differed from the chart in ways nobody had chosen.
   */
  const applyMaterialization = useCallback((result: MaterializeResult) => {
    if (!result.ok) { setNotice(result.notice); return; }
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [result.object])]);
    setEdges((current) => [...current, result.edge]);
    setSelectedId(result.object.id);
    openNodeInspector(result.object.id);
    setNotice(result.notice);
  }, [openNodeInspector, setEdges, setNodes, setNotice]);

  /** The dependencies every materialisation takes: how to speak to the person, and
   *  how to build an object of a kind (the factory reads the object registry, which
   *  the application layer must not import). */
  const materializeDeps = useMemo(
    () => ({ t: canvasText, createObject: (kind: CreationObjectKind, position: { x: number; y: number }) => newNode(kind, position, canvasText) }),
    [canvasText],
  );

  const visualizeDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    applyMaterialization(visualizeDatasetUseCase(selectedNode, materializeDeps, fmt.number));
  }, [applyMaterialization, fmt, materializeDeps, selectedNode]);

  /**
   * "Plot on a map" — the direct counterpart to {@link visualizeDataset}.
   *
   * A dataset whose rows ALREADY carry coordinates (an uploaded geocoded CSV, or one the
   * Brain has written lat/lng back onto) needed a Brain turn to become a map, because the
   * only path to `materializeAs: 'map'` was `canvas_query_dataset`. The detection was
   * already here — `detectGeoColumns` runs over the imported rows — so the UI was
   * withholding something it could see. This spends no tokens and makes no network call.
   */
  const plotDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    applyMaterialization(plotDatasetUseCase(selectedNode, materializeDeps));
  }, [applyMaterialization, materializeDeps, selectedNode]);

  const profileDataset = useCallback((nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const result = profileDatasetUseCase(target, materializeDeps.t, fmt.number);
    if (!result.ok) { setNotice(result.notice); return; }
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...result.patch } } : node));
    setNotice(result.notice);
  }, [fmt, materializeDeps, nodes, setNodes, setNotice]);

  // What a primary drag on empty board does, and how forgiving the board is about a
  // pointer that wanders. `panAndSelectConflict` is the invariant `canvasInteractionProps`
  // guarantees, not a React Flow prop, so it is dropped before the rest is spread.
  const coarsePointer = useCoarsePointer();
  const { panAndSelectConflict: _panAndSelectConflict, ...interactionProps } = useMemo(
    () => canvasInteractionProps({ gesture: canvasGesture, pointer: coarsePointer ? 'coarse' : 'fine', drawing: drawingMode }),
    [canvasGesture, coarsePointer, drawingMode],
  );

  // How a drawn connection is accepted. Shared with the workflow builder, because
  // "released on the wrong side of the card and nothing happened" is one bug, not two.
  const connectionProps = useMemo(() => flowConnectionProps(coarsePointer ? 'coarse' : 'fine'), [coarsePointer]);

  const onConnect = useCallback((connection: Connection) => {
    // An arm drawn out of a step that DECIDES is labeled with the outlet it left, not
    // with the board's connection kind: that label is what the executor prunes on
    // (`WorkflowDefEdge.label`), and it is what the arrow has to READ as, because
    // "reference" on the arm out of a switch case tells nobody which case it is.
    const from = nodes.find((node) => node.id === connection.source);
    const outlet = from?.data.kind === 'flowStep'
      ? outletForHandle(stepKindOf(from.data), stepConfigOf(from.data), connection.sourceHandle)
      : null;
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), ...edgeVisuals(connectionStyle), data: { connectionKind, connectionStyle }, label: outlet?.name || connectionKind }, current));
    trackActivity('creation_connection_added', { sessionId, metadata: { clientSurface: canvasSurface(), connectionKind } });
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (persistence === 'server' && source && target && source.data.kind !== 'chat' && target.data.kind !== 'chat') {
      const correlationId = crypto.randomUUID();
      const metadata = { sourceKind: source.data.kind, targetKind: target.data.kind, connectionKind };
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'started', artifactId: source.id, metadata }).catch(() => undefined);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'reused', artifactId: source.id, metricKey: 'outputs_reused', metricValue: 1, unit: 'count', metadata }).catch(() => undefined);
    }
  }, [connectionKind, connectionStyle, nodes, persistence, sessionId, setEdges]);

  /**
   * Choose the connector style — and RESTYLE what is selected.
   *
   * A style control that only armed the next draw would be unusable on a diagram that
   * already exists: the way a person restyles an arrow is to select it and pick, which
   * is what every drawing tool has taught them. So one press does both, and the same
   * `edgeVisuals` translation runs for the new edge and the existing ones — three call
   * sites computing that themselves would be three edges that look different while
   * claiming one style.
   */
  const setConnectionStyle = useCallback((patch: Partial<ConnectionStyle>) => {
    setConnectionStyleState((current) => {
      const next = { ...current, ...patch };
      setEdges((edges) => {
        if (!edges.some((edge) => edge.selected)) return edges;
        return edges.map((edge) => (edge.selected
          ? { ...edge, ...edgeVisuals(next), data: { ...(edge.data ?? {}), connectionStyle: next } }
          : edge));
      });
      return next;
    });
  }, [setEdges]);

  /** Selecting the Brain Object reveals the dock instead of a second transcript. */
  const openBrainDock = useCallback(() => setBrainDock((current) => {
    if (current.open) return current;
    const next = { ...current, open: true };
    writeBrainDockPreferences(next);
    return next;
  }), []);

  /**
   * A guest wall is the answer to something they just asked, and the answer — the
   * refusal and the account that clears it — lives on the Brain surface. Reveal it,
   * or a visitor with Brain closed gets a one-line notice and no way forward.
   */
  useEffect(() => { if (guestLimit) openBrainDock(); }, [guestLimit, openBrainDock]);

  const onNodeClick: NodeMouseHandler<CreationFlowNode> = useCallback((event, node) => {
    setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
    setInspectorFocus(null); setSelectedId(node.id); if (!node.selected) setSelectedIds([node.id]);
    if (node.data.kind === 'chat') openBrainDock();
    // Selecting a card opens the panel ANCHORED to it, SHORT. Everything else about the
    // object is one press away in the same panel, which is the whole reason the short
    // reading can afford to be short.
    //
    // `resume` opens it WIDE instead. The card now shows only the rendered document (no
    // fields left to put in a compact panel at all — see `ResumeInspectorSection`), so
    // the short reading would open on every click with nothing in it but the control
    // that widens it.
    if (node.data.kind === 'resume') { openNodeInspector(node.id, null, event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : undefined); return; }
    if (node.data.kind !== 'chat' && event.currentTarget instanceof Element) {
      openNodePanel(node.id, 'config', event.currentTarget.getBoundingClientRect());
    }
  }, [openBrainDock, openNodeInspector, openNodePanel]);
  // XYFlow subscribes to this callback through its Zustand store. An inline
  // callback is a new subscription every render; immediately writing a fresh
  // `[]` back to React from that subscription can create an update-depth loop
  // on a newly hydrated local Session. Keep the subscriber stable and preserve
  // state identity when the semantic selection did not change.
  /**
   * Node changes, plus the annotations that have to come along.
   *
   * A mark drawn ON a card is a separate node (only `data` survives the graph
   * round trip, so React Flow's own parenting cannot be used — see the note
   * where `annotatesId` is written). Without this, dragging a document left its
   * highlighting behind on the board, which is worse than not being able to
   * highlight it at all. The delta is taken from the position change itself, so
   * one drag moves the pair by exactly the same amount.
   */
  const onCanvasNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    const moves = changes.flatMap((change) => change.type === 'position' && change.position ? [{ id: change.id, position: change.position }] : []);
    if (!moves.length) { onNodesChange(changes); return; }
    // Anything React Flow is ALREADY moving. A selected card inside a frame that is
    // being dragged gets its own position change from the library, and adding a
    // follower for it would apply the delta twice — the card would drift out of the
    // section at double speed, which is worse than not carrying it at all.
    const alreadyMoving = new Set(moves.map((move) => move.id));
    const followers = moves.flatMap((move) => {
      const source = nodes.find((node) => node.id === move.id);
      if (!source) return [];
      const dx = move.position.x - source.position.x;
      const dy = move.position.y - source.position.y;
      if (!dx && !dy) return [];
      // An annotation follows the object it marks up; a FRAME carries everything
      // inside it. Both are "this moved, so did that", which is why they are resolved
      // in one pass — a frame full of annotated cards must not move its members and
      // leave their marks behind.
      const carried = source.data.kind === 'frame' ? new Set(framedBoardRef.current.memberIdsOf(move.id)) : null;
      return nodes
        .filter((node) => !alreadyMoving.has(node.id)
          && ((node.data.kind === 'drawing' && node.data.annotatesId === move.id) || carried?.has(node.id)))
        .map((node) => ({ id: node.id, type: 'position' as const, position: { x: node.position.x + dx, y: node.position.y + dy } }));
    });
    onNodesChange(followers.length ? [...changes, ...followers] : changes);
  }, [nodes, onNodesChange]);
  const onSelectionChange = useCallback(({ nodes: chosen }: { nodes: CreationFlowNode[] }) => {
    const ids = chosen.map((node) => node.id);
    setSelectedIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
    const nextId = ids.length === 1 ? ids[0]! : null;
    setSelectedId((current) => current === nextId ? current : nextId);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedId((current) => current == null ? current : null);
    setSelectedIds((current) => current.length ? [] : current);
  }, []);
  const onCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!flowRef.current) return;
    const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (presenceLive) { cursorRef.current = point; sendPresence({ cursor: point }); }
    if (drawingMode && drawingPoints.current.length) drawingPoints.current.push(point);
  }, [drawingMode, presenceLive, sendPresence]);
  const onCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // A stroke may START ANYWHERE, including on top of a card — that is what
    // makes annotation possible. While a tool is held the canvas is a drawing
    // surface, and the cards under it are things to mark up rather than things
    // to drag. (Dragging and connecting are disabled for the same reason.)
    if (!drawingMode || !canEdit || !flowRef.current) return;
    drawingPoints.current = [flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })];
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [canEdit, drawingMode]);
  /**
   * Commit the stroke.
   *
   * Where it LANDS is the whole difference between a drawing tool and a sketch
   * pad: a stroke over an existing drawing joins that drawing, a stroke over any
   * other object becomes an annotation that rides on it, and a stroke over empty
   * board starts a new sketch. All three go through `drawingPatch`, so the marks,
   * the card's size and its position stay in step however the drawing grew.
   */
  const onCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingMode) return;
    const path = drawingPoints.current.splice(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const start = path[0];
    if (!start) return;
    const tool = drawing.tool;
    // Freehand and shapes need a drag; text and the eraser act on a tap.
    if (tool !== 'text' && tool !== 'eraser' && path.length < 2) return;

    if (tool === 'eraser') {
      const radius = Math.max(8, drawing.width * 3);
      let erased = 0;
      setNodes((current) => current.flatMap((node) => {
        if (node.data.kind !== 'drawing') return [node];
        const absolute = canvasStrokes(node.data).map((stroke) => ({ ...stroke, points: stroke.points.map((item) => ({ x: item.x + node.position.x, y: item.y + node.position.y })) }));
        const kept = eraseStrokes(absolute, path, radius);
        if (kept.length === absolute.length) return [node];
        erased += absolute.length - kept.length;
        // A drawing with nothing left on it is not an empty card, it is gone.
        if (!kept.length) return [];
        const patch = drawingPatch(kept);
        return [{ ...node, position: { x: Number(patch.drawingOriginX ?? node.position.x), y: Number(patch.drawingOriginY ?? node.position.y) }, style: { width: Number(patch.drawingWidth), height: Number(patch.drawingHeight) + 44 }, data: { ...node.data, ...patch } }];
      }));
      if (erased) setNotice(t('noticeStrokesErased', { count: erased }));
      return;
    }

    const stroke: CanvasStroke = {
      tool,
      points: tool === 'text' ? [start] : tool === 'pen' || tool === 'highlighter' ? path : [start, path[path.length - 1]!],
      stroke: drawing.color,
      strokeWidth: drawing.width,
      ...(tool === 'text' ? { text: '' } : {}),
    };

    // The object under the first point decides where the stroke goes.
    const target = topmostNodeAt(nodes, start);
    if (target?.data.kind === 'drawing') {
      setNodes((current) => current.map((node) => {
        if (node.id !== target.id) return node;
        const absolute = canvasStrokes(node.data).map((item) => ({ ...item, points: item.points.map((position) => ({ x: position.x + node.position.x, y: position.y + node.position.y })) }));
        const patch = drawingPatch([...absolute, stroke]);
        return { ...node, position: { x: Number(patch.drawingOriginX), y: Number(patch.drawingOriginY) }, style: { width: Number(patch.drawingWidth), height: Number(patch.drawingHeight) + 44 }, data: { ...node.data, ...patch } };
      }));
      setSelectedId(target.id);
      return;
    }

    const patch = drawingPatch([stroke]);
    const node = newNode('drawing', { x: Number(patch.drawingOriginX), y: Number(patch.drawingOriginY) });
    node.style = { width: Number(patch.drawingWidth), height: Number(patch.drawingHeight) + (target ? 8 : 44) };
    node.data = {
      ...node.data,
      title: target ? t('annotationTitle', { title: target.data.title }) : t('sketchTitle'),
      ...patch,
      // An annotation names what it is ON. `annotatesId` is node DATA rather
      // than React Flow's `parentId` because only `data` survives the graph
      // round trip (see `persistedGraphFromBoard`) — a parent id would be
      // silently dropped on save and the mark would come back detached.
      ...(target ? { annotatesId: target.id, status: '' } : {}),
    };
    if (target) node.zIndex = 6;
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setSelectedId(node.id);
    setNotice(target ? t('noticeAnnotationAdded', { title: target.data.title }) : t('noticeSketchAdded'));
  }, [drawing, drawingMode, nodes, setNodes, t]);
  const onViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    viewportRef.current = viewport;
    // A follower is watching this pan happen, not reading about it eight seconds later.
    if (presenceLive) sendPresence({ viewport });
    if (persistence !== 'local' || !hydrated.current) return;
    const snapshot = currentSnapshot(viewport);
    persistSnapshot(snapshot);
  }, [edges, nodes, persistence, presenceLive, sendPresence, sessionId, storageKey, timeline, title]);

  /** Place a new object at the middle of the viewport. `data` lets a caller that
   *  already HAS the object's content (an editor capture) seed it in one step
   *  rather than adding an empty object and patching it afterwards. */
  /**
   * Create one object at the centre of the viewport and append it to the board — and
   * nothing else. The half of `addAtCenter` a SURFACE needs: the Ideas scratchpad adds a
   * card per captured line and must not select it or open its inspector, because the
   * reader is still typing into the list. Callers gate on edit rights themselves.
   */
  const appendAtCenter = useCallback((kind: CreationObjectKind, data?: Partial<CreationNodeData>, size?: { width: number; height: number }) => {
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const node = newNode(kind, position);
    if (kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
    if (kind === 'chat') node.data = { ...node.data, messages: timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt })) };
    if (data) node.data = { ...node.data, ...data };
    // A stencil's PROPORTIONS are part of the preset — a hexagon at 190x170 reads as a
    // hexagon and at 190x90 reads as a smudge. Written onto the node's style, which is
    // where the board already keeps an authored size and where the resizer writes, so
    // there is not a second place a card's width lives.
    if (size) node.style = { ...node.style, width: size.width, height: size.height };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [kind] } });
    return node;
  }, [localizedTourDefaults, sessionId, setNodes, timeline]);

  /**
   * WHAT ENTER MEANS ON THE SCRATCHPAD — the `captureIdea` composer intent, wired to the
   * SAME board mutation the retired `IdeaCaptureForm` called. It clears the prompt on
   * success and only on success: a line that produced no card must not be thrown away.
   */
  const captureIdeaFromComposer = useCallback((text: string) => {
    if (!cardsEditable) return;
    const data = ideaFromScratch(text);
    if (!data) return;
    appendAtCenter(IDEA_KIND, data as Partial<CreationNodeData>);
    setPrompt('');
  }, [appendAtCenter, cardsEditable]);

  const addAtCenter = useCallback((kind: CreationObjectKind, data?: Partial<CreationNodeData>, size?: { width: number; height: number }) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const node = appendAtCenter(kind, data, size);
    setSelectedId(node.id); setSelectedIds([node.id]);
    // A deliberate "add a Project/Task/Website" from the palette is a request to
    // configure it, not a glance at an existing card — so the panel opens WIDE here,
    // where a click on an existing card opens the short one.
    if (node.data.kind !== 'chat') openNodeInspector(node.id);
    setNotice(t('objectAdded', { title: node.data.title }));
  }, [appendAtCenter, canEdit, openNodeInspector, t]);

  /**
   * What choosing an object in the picker DOES.
   *
   * With a source node it is an INSERT: the object is created to the right of that node
   * and wired to it in one action, which is the difference between "add a step" and "add
   * an object" — and the reason the board could previously only be built by prompting.
   * Without one it is the bar's plain add, which is `addAtCenter` unchanged.
   */
  /**
   * ONE decode of a palette choice, for every way of placing one.
   *
   * The palette hands back THREE vocabularies through one string: an object kind, a
   * stencil (a preset of the untyped card — `canvasStencils.ts`), and a step (one of
   * the ~60 executable kinds, or an integration preset over one — `flowStepObject.ts`).
   * Each has its own declared prefix and its own parser, and this is the only place
   * that asks all three, so clicking a row, inserting after a card and dragging onto
   * the board cannot disagree about what was chosen.
   */
  const choiceSeed = useCallback((choice: PaletteChoice): { kind: CreationObjectKind; seed?: Partial<CreationNodeData>; size?: { width: number; height: number } } => {
    if (isStepChoice(choice)) {
      // Named in the author's language once, at creation — a step's title is workflow
      // data they then own, not chrome that re-translates under them.
      const step = parseStepChoice(choice, (meta) => nodeKindLabel(meta, tStep));
      if (step) return { kind: 'flowStep', seed: step as Partial<CreationNodeData> };
    }
    const picked = parsePaletteChoice(choice);
    if (picked) return { kind: 'sticky', seed: stencilSeed(picked.stencil) as Partial<CreationNodeData>, size: stencilSize(picked.stencil) };
    return { kind: choice as CreationObjectKind };
  }, [tStep]);

  const pickObject = useCallback((choice: PaletteChoice, fromNodeId?: string) => {
    setObjectPicker(null);
    const { kind, seed, size } = choiceSeed(choice);
    if (!fromNodeId) { addAtCenter(kind, seed, size); return; }
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const source = nodes.find((node) => node.id === fromNodeId);
    if (!source) { addAtCenter(kind, seed, size); return; }
    // Beside it, not on top of it — far enough right that the two cards and the edge
    // between them are all legible without an immediate re-layout.
    const node = newNode(kind, { x: source.position.x + (canvasNodeDimensions(source).width || 300) + 90, y: source.position.y });
    if (seed) node.data = { ...node.data, ...seed };
    if (size) node.style = { ...node.style, width: size.width, height: size.height };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setEdges((current) => addEdge({ id: crypto.randomUUID(), source: fromNodeId, target: node.id, type: connectionKind }, current));
    setSelectedId(node.id); setSelectedIds([node.id]);
    if (node.data.kind !== 'chat') openNodeInspector(node.id);
    setNotice(t('objectAdded', { title: node.data.title }));
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [kind] } });
  }, [addAtCenter, canEdit, choiceSeed, connectionKind, nodes, openNodeInspector, sessionId, setEdges, setNodes, t]);

  /**
   * ONE credential check in front of every social tool.
   *
   * Gated on CREDENTIALS, not on whether the board is saved — the same distinction
   * `canvas_add_image` draws and for the same reason: `/api/social/*` is a stateless
   * request carrying the tenant token, so a signed-in user on an unsaved board connects,
   * drafts and publishes for real. `persistence` still gates what needs a SAVED SESSION
   * to point at, which for social is exactly one thing: the campaign's `sessionId` link.
   *
   * Read from the token store per call rather than closing over `hasAccount`, so a
   * sign-in mid-session is reflected on the very next tool call.
   *
   * Six tools rather than six copies of this: the model must never be able to reach a
   * social tool that returns a different reason than its siblings, because the reason IS
   * the answer the user gets — see CANVAS_SOCIAL_ACCOUNT_GATE.
   */
  const socialAccountGate = useCallback((tool: string): { requiresAccount: true; tool: string; error: string } | null => {
    // Same door as the menu entry — a model asking for the social panel and a
    // person clicking it must not describe the missing account two ways.
    if (connectedAccountGate(tSocial('title'))) return null;
    return accountGateResult(tool, CANVAS_SOCIAL_ACCOUNT_GATE);
  }, [connectedAccountGate, tSocial]);

  /**
   * Read the connected social accounts and BUILD the feed tile — without adding it.
   *
   * Shared by `canvas_add_social_feed` (which stages it as a reviewable proposal) and
   * the social panel (which commits it immediately). One builder, so the tile a model
   * puts on the board and the one a person puts there are identical — the alternative
   * is two shapes that drift, and a refresh that works on only one of them.
   */
  const buildSocialFeedNode = useCallback(async (
    filter: SocialFeedFilter,
    opts: { title?: string; x?: number; y?: number } = {},
  ): Promise<{ ok: true; node: CreationFlowNode; read: Awaited<ReturnType<typeof socialApi.feed>> } | { ok: false; error: string }> => {
    let read: Awaited<ReturnType<typeof socialApi.feed>>;
    try {
      read = await socialApi.feed(filter);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : tSocial('feedFailed') };
    }
    if (read.accounts.length === 0) {
      // Actionable rather than a bare failure: the fix is one panel away.
      return { ok: false, error: tSocial('noAccountsHint') };
    }
    const node = stage.createObject('socialFeed', { ...(opts.x != null ? { x: opts.x } : {}), ...(opts.y != null ? { y: opts.y } : {}) });
    node.data = {
      ...node.data,
      title: opts.title?.trim().slice(0, 160) || tSocial('feedTitle'),
      subtitle: describeSocialFilter(filter, {
        all: tSocial('filterAll'),
        networks: (list) => tSocial('filterNetworks', { networks: list }),
        search: (term) => tSocial('filterSearch', { term }),
      }),
      status: tSocial('postCount', { count: read.items.length }),
      filter,
      ...socialFeedPatch(read),
    };
    node.style = { width: 460, height: 560 };
    return { ok: true, node, read };
  }, [nodes, stage, tSocial]);

  /** The panel's "put it on the board" — a committed add, not a proposal. */
  const addSocialFeedToBoard = useCallback(async (filter: SocialFeedFilter) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const built = await buildSocialFeedNode(filter);
    if (!built.ok) { setNotice(built.error); return; }
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [built.node])]);
    setSelectedId(built.node.id); setSelectedIds([built.node.id]);
    setNotice(t('objectAdded', { title: built.node.data.title }));
  }, [buildSocialFeedNode, canEdit, setNodes, t]);

  /**
   * A Miro board, landed on this canvas.
   *
   * The mapper normalises the imported graph to its own origin, so the only thing
   * left to decide is WHERE on this board it goes — and that has to be clear of
   * whatever is already here. Dropping it at the viewport centre would overlay an
   * imported 200-sticky workshop on top of the work in progress, which reads as
   * corruption rather than as an import. It lands to the right of everything, the
   * way a second page does.
   */
  const importMiroBoard = useCallback(async (result: MiroImportResult, board: MiroBoardSummary) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    if (!result.nodes.length) { setNotice(tMiro('importedNothing', { name: board.name || board.id })); return; }
    const rightEdge = nodes.reduce((widest, node) => {
      const width = typeof node.style?.width === 'number' ? node.style.width : 320;
      return Math.max(widest, node.position.x + width);
    }, 0);
    const offsetX = nodes.length ? rightEdge + IMPORT_COLUMN_GAP : 0;
    const placed = result.nodes.map((node) => ({ ...node, position: { x: node.position.x + offsetX, y: node.position.y } }));
    setNodes((current) => [...current, ...placeAppendedRef.current(current, placed)]);
    setEdges((current) => [...current, ...result.edges]);
    setSelectedId(placed[0]!.id);
    setSelectedIds(placed.map((node) => node.id));
    setNotice(result.skipped.length
      ? tMiro('importedWithSkips', { name: board.name || board.id, count: placed.length, types: result.skipped.join(', ') })
      : tMiro('imported', { name: board.name || board.id, count: placed.length }));
  }, [canEdit, nodes, setEdges, setNodes, t, tMiro]);

  /**
   * The pictures on this board, for the composer's attachment picker.
   *
   * Derived here rather than inside the panel because the canvas owns the nodes —
   * the same reason adding a tile is a callback. Only objects that actually HOLD a
   * picture are offered: an `image` card whose generation has not finished has no
   * source yet, and listing it would produce a post with nothing attached.
   */
  const boardMedia = useMemo(() => nodes.flatMap((node) => {
    if (!isCanvasMediaKind(node.data.kind)) return [];
    const source = canvasMediaSource(node.data);
    if (!source) return [];
    const thumbnail = typeof node.data.thumbnailUrl === 'string' && node.data.thumbnailUrl ? node.data.thumbnailUrl : source;
    return [{
      id: node.id,
      title: String(node.data.title || node.data.kind),
      source,
      thumbnailUrl: thumbnail.startsWith('data:') || /^https?:\/\//i.test(thumbnail) ? thumbnail : null,
    }];
  }), [nodes]);

  const addSocialCampaignToBoard = useCallback((campaign: SocialCampaign) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const data = socialCampaignNodeData(campaign);
    setNodes((current) => {
      // A campaign already on the board is UPDATED, never duplicated — publishing from
      // the panel must move the tile that is there rather than stack a second one.
      const existing = current.find((node) => node.data.kind === 'socialCampaign' && Number(node.data.campaignId) === campaign.id);
      if (existing) {
        return current.map((node) => node.id === existing.id ? { ...node, data: { ...node.data, ...data } as CreationNodeData } : node);
      }
      const node = newNode('socialCampaign', nextCanvasObjectPosition(
        current, {}, layoutViewportRef.current(), 'socialCampaign',
      ));
      node.data = { ...node.data, ...data } as CreationNodeData;
      node.style = { width: 440, height: 460 };
      return [...current, node];
    });
  }, [canEdit, setNodes, t]);

  // The shell recorder writes through the canonical Builder workspace store, then
  // announces the durable artifact to the board that started it. Hidden cached
  // boards hear the same event but ignore a different session id.
  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; projectId: number; path: string; mimeType: string }>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      addAtCenter('video', {
        title: t('recordingTitle'),
        status: t('recordingStatus'),
        projectId: detail.projectId,
        resourceId: `workspace:${detail.projectId}:${detail.path}`,
        outputFileName: detail.path.split('/').pop(),
        outputMimeType: detail.mimeType,
      });
    };
    window.addEventListener('builderforce:media-recording-saved', onSaved);
    return () => window.removeEventListener('builderforce:media-recording-saved', onSaved);
  }, [addAtCenter, sessionId, t]);

  /**
   * Seat a teammate on this board (PRD 21 §3.3).
   *
   * "Drag a teammate onto the board → it joins the session, takes a seat,
   * appears in presence, and can be addressed in the composer." All three
   * happen here rather than at each entry point, which is what lets the drag and
   * the keyboard route be genuinely the same action instead of two code paths
   * that agree today.
   *
   * `point` is where a drag landed; the keyboard route has no pointer, so it
   * seats at the viewport centre exactly as the object palette's click does.
   */
  const seatTeammate = useCallback((teammate: TeammatePayload, point?: { x: number; y: number }) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const data: Partial<CreationNodeData> = {
      title: teammate.name,
      status: t('teammateSeated'),
      subtitle: teammate.role ?? undefined,
      agentName: teammate.name,
      agentRef: teammate.ref,
      ...(teammate.seat && teammate.domain ? {
        agentSeat: teammate.seat,
        agentDomain: teammate.domain,
        builtinAgent: true,
      } : {}),
    };
    // ALREADY IN THE ROOM. Addressing five teammates in one prompt seats five, and
    // addressing the same one again — a second `@CMO`, a re-sent prompt, a keyboard
    // route racing the drag — used to seat another card with the same name. One real
    // board finished with `CMO` on it three times, which Brain then spent a turn
    // deleting. A seat is an identity, not an event: bring the existing card forward
    // instead. `canvasObjectTwin` is the same rule the authoring tool applies, asked
    // in the same words, so the two cannot disagree about what a duplicate is.
    const seated = canvasObjectTwin('agent', teammate.name, nodesRef.current, (kind) => TITLE_IS_CONTENT_KINDS.has(kind));
    if (seated) {
      revealObjectRef.current(seated.id);
      setNotice(t('teammateAlreadySeated', { name: teammate.name }));
    } else if (!point) { addAtCenter('agent', data); }
    else {
      const node = newNode('agent', point);
      node.data = { ...node.data, ...data };
      setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
      setSelectedId(node.id); setSelectedIds([node.id]);
      setNotice(t('objectAdded', { title: teammate.name }));
    }
    // Addressable immediately: the composer is seeded with the mention rather
    // than leaving the person to retype a name they just dragged in.
    setPrompt((current) => (current.includes(`@${teammate.name}`) ? current : `${current ? `${current.trimEnd()} ` : ''}@${teammate.name} `));
  }, [addAtCenter, canEdit, setNodes, t]);

  // The keyboard half of §3.3. Only the board actually on the stage answers —
  // hidden cached boards hear the same event and must not quietly seat someone
  // on a canvas nobody is looking at.
  useEffect(() => {
    if (!stageActive) return undefined;
    const onJoin = (event: Event) => {
      const detail = (event as CustomEvent<TeammatePayload>).detail;
      if (detail) seatTeammate(detail);
    };
    window.addEventListener(TEAMMATE_JOIN_EVENT, onJoin);
    return () => window.removeEventListener(TEAMMATE_JOIN_EVENT, onJoin);
  }, [seatTeammate, stageActive]);

  /** Place an object the EDITOR captured (active file, selection, problems, …). */
  const addHostCapture = useCallback((capture: CanvasHostCapture) => {
    addAtCenter(capture.kind, { title: capture.title, ...capture.content } as Partial<CreationNodeData>);
  }, [addAtCenter]);

  /**
   * Files arriving from anywhere — dropped from the desktop, attached in the
   * composer — become the objects they actually are: a Word file opens as a
   * document with pages, a workbook as a sheet per tab, a deck as slides, a
   * data export as a queryable Dataset. The board is the creative starting
   * space, so the drop also puts the first question in the composer and opens
   * Brain: a file that lands here starts a conversation, it does not just sit
   * there as an icon.
   */
  const addFilesToCanvas = useCallback(async (files: File[], origin?: { x: number; y: number }, source = 'canvas_drop') => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    if (!files.length) return;
    const start = origin ?? flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const accepted = files.slice(0, MAX_DROPPED_FILES);

    /**
     * Every dropped file gets a card BEFORE anything is read.
     *
     * The readers are synchronous CPU wearing an async signature, so a 40MB PDF
     * seizes the main thread for seconds. Creating the nodes only after the parse
     * meant the drop overlay vanished on release and the canvas then showed
     * nothing at all until the last of twelve files finished — indistinguishable
     * from a drop that failed. The card is the receipt.
     */
    const stubs = accepted.map((file, index) => {
      const node = newNode('file', { x: start.x + index * IMPORT_COLUMN_GAP, y: start.y });
      node.data = {
        ...node.data,
        title: file.name,
        fileName: file.name,
        fileSize: file.size,
        status: importLabel('statusImporting'),
        importPending: true,
      } as CreationNodeData;
      return node;
    });
    setNodes((current) => [...current, ...placeAppendedRef.current(current, stubs)]);
    setSelectedId(stubs[0]!.id);
    setSelectedIds(stubs.map((node) => node.id));
    openBrainDock();
    await nextPaint();

    const notices: string[] = [];
    const objectKinds: string[] = [];
    let suggestion = '';
    for (const [index, file] of accepted.entries()) {
      const stub = stubs[index]!;
      // Dropping four files and getting four cards is the moment a person stops
      // being able to explain what happened — so the journal records each one,
      // with the kind it BECAME. "guide.htm → attachment" is the single line that
      // explains why the agent could not read it.
      const importDone = journal.current.begin('user', 'file.import', `${file.name} · ${Math.max(1, Math.round(file.size / 1024))}KB`);
      try {
        const imported = await importCanvasFile(file, importLabel, attachmentBytesStrategy);
        const [first, ...rest] = imported.objects;
        if (!first) throw new Error('The file produced no object');
        importDone({ ok: true, detail: `→ ${imported.objects.map((object) => object.kind).join(', ')}` });
        // The stub BECOMES the artifact — same id, same position — so the card a
        // person is already looking at fills in rather than being replaced by a
        // second one somewhere else on the board.
        const resolved = newNode(first.kind, stub.position);
        // A workbook yields one object per sheet; the extras stack under the
        // card that stood in for the file.
        const extras = rest.map((object, offset) => {
          const node = newNode(object.kind, { x: stub.position.x, y: stub.position.y + (offset + 1) * IMPORT_ROW_GAP });
          node.data = { ...node.data, ...object.data } as CreationNodeData;
          return node;
        });
        setNodes((current) => [
          ...current.map((node) => node.id === stub.id
            ? { ...node, data: { ...resolved.data, ...first.data, importPending: false } as CreationNodeData }
            : node),
          ...extras,
        ]);
        objectKinds.push(first.kind, ...rest.map((object) => object.kind));
        notices.push(imported.notice);
        if (!suggestion) suggestion = imported.suggestedPrompt;
      } catch (error) {
        importDone({ ok: false, detail: `unreadable — ${toolErrorMessage(error, 'import failed')}` });
        setNodes((current) => current.map((node) => node.id === stub.id
          ? { ...node, data: { ...node.data, status: importLabel('statusUnreadable'), importPending: false } as CreationNodeData }
          : node));
        notices.push(importLabel('failed', { name: file.name }));
      }
      // Each file's result paints before the next one takes the thread back.
      await nextPaint();
    }
    if (files.length > MAX_DROPPED_FILES) notices.push(importLabel('tooManyFiles', { limit: MAX_DROPPED_FILES }));
    setNotice(notices.join(' · '));
    // Never overwrite something the person is part-way through typing.
    if (suggestion) setPrompt((current) => current.trim() ? current : suggestion);
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds, source } });
  }, [attachmentBytesStrategy, canEdit, importLabel, openBrainDock, sessionId, setNodes, t]);

  const attachCanvasArtifact = useCallback(
    (file: File) => addFilesToCanvas([file], undefined, 'composer_attachment'),
    [addFilesToCanvas],
  );

  const applyTemplate = useCallback((pack: CreationTemplate) => {
    if (!canEdit) return;
    // A pack that still authors a legacy `workflow` card is lowered to a frame of
    // `flowStep`s first — the same lowering opening a legacy card performs — so
    // placing a marketplace pack never mints the object the deprecation removed.
    const template = expandTemplateWorkflows(pack, {
      untitledStep: (position: number) => t('flowStep.untitledStep', { position }),
      framePurpose: t('flowStep.framePurpose'),
    });
    const center = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 260 };
    const created = template.objects.map((item) => {
      const node = newNode(item.kind, { x: center.x + item.x - 520, y: center.y + item.y - 180 });
      node.data = { ...node.data, ...(item.data ?? {}), ...(item.title ? { title: item.title } : {}) };
      // The pack stores the worked LLM course as ENGLISH (it is module data, built
      // with no board). Placing it re-mints it through the board's translator, so a
      // zh board's course is written in Chinese — the course is persisted, and an
      // English copy written here would stay English after every later edit.
      if (node.data.kind === 'course' && isWorkedLlmCourse(node.data.course)) node.data = { ...node.data, course: buildLlmCourse(canvasText, locale) };
      return node;
    });
    const createdEdges = (template.connections ?? []).map((edge) => ({ id: crypto.randomUUID(), source: created[edge.source].id, target: created[edge.target].id, type: 'smoothstep', label: edge.label }));
    // An edge that declares a `ref` also WIRES it: the source card's title lands in the
    // named field on the target, which is the form every canvas reference already takes.
    // Written here rather than in the pack data because the title is only decided at
    // placement — an item may carry its own `title` or fall back to the kind's label —
    // and a pack that hard-coded the string would break the moment either changed.
    // Guarded by the registry's own mutable-field list, so a pack cannot use this to set
    // a field the kind does not accept from an author.
    for (const edge of template.connections ?? []) {
      if (!edge.ref) continue;
      const source = created[edge.source];
      const target = created[edge.target];
      const title = typeof source?.data?.title === 'string' ? source.data.title : '';
      if (!title || !target || !creationObjectMutableFields(target.data.kind).includes(edge.ref)) continue;
      target.data = { ...target.data, [edge.ref]: title };
    }
    setNodes((current) => [...current, ...placeAppendedRef.current(current, created)]); setEdges((current) => [...current, ...createdEdges]); setTemplateOpen(false); setNotice(t('noticeTemplateAddedMarketplace', { name: templateText(template, 'name') }));
    trackActivity('creation_object_pack_added', { sessionId, metadata: { clientSurface: canvasSurface(), templateId: template.id, objectKinds: template.objects.map((item) => item.kind) } });
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: created.map(({ id }) => ({ id })), padding: .2, duration: 400 }), 0);
  }, [canEdit, canvasText, locale, sessionId, setEdges, setNodes, t, templateText]);

  const addFramePreset = useCallback((preset: FramePreset) => {
    if (!canEdit) return;
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 260 };
    const node = newNode('frame', position); node.data = { ...preset.data, title: preset.name };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]); setSelectedId(node.id); setTemplateOpen(false); setNotice(t('noticeFramePresetAdded', { name: preset.name }));
  }, [canEdit, setNodes]);

  const saveFramePreset = useCallback(() => {
    if (selectedNode?.data.kind !== 'frame') return;
    const preset: FramePreset = { id: crypto.randomUUID(), name: selectedNode.data.title, data: { ...selectedNode.data } };
    if (persistence === 'server') {
      const graph = persistedGraphFromBoard({ nodes: [{ ...selectedNode, id: crypto.randomUUID(), position: { x: 80, y: 80 } }], edges: [] });
      void creationSessionsApi.templates.create({ name: preset.name, description: 'Reusable Canvas frame', category: 'Frame', visibility: 'private', graph }).then(() => {
        setNotice(t('noticeFrameSavedAccount'));
        return creationSessionsApi.templates.list();
      }).then((result) => setServerTemplates(result.templates)).catch((error) => setNotice(faultText(error, t('noticeSaveTemplateFailed'))));
      return;
    }
    setFramePresets((current) => { const next = [...current.filter((item) => item.name !== preset.name), preset].slice(-20); localStorage.setItem('builderforce:create-frame-presets', JSON.stringify(next)); return next; });
    setNotice(t('noticeFrameSavedLibrary'));
  }, [persistence, selectedNode]);

  const applyServerTemplate = useCallback((template: ServerCreationTemplate) => {
    if (persistence !== 'server' || !canEdit) return;
    setNotice(t('noticeAddingTemplate', { name: template.name }));
    void creationSessionsApi.templates.apply(sessionId, template.id, revision.current).then(async (result) => {
      revision.current = result.revision;
      const detail = await creationSessionsApi.get(sessionId);
      const flow = flowFromSession(detail);
      setNodes(flow.nodes); setEdges(flow.edges); setPersistedObjectIds(new Set(flow.nodes.map((node) => node.id))); setTemplateOpen(false); setNotice(t('noticeTemplateAdded', { name: template.name }));
      window.setTimeout(() => void flowRef.current?.fitView({ nodes: result.objectIds.map((id) => ({ id })), padding: .2, duration: 400 }), 0);
    }).catch((error) => setNotice(faultText(error, t('noticeTemplateFailed'))));
  }, [canEdit, persistence, sessionId, setEdges, setNodes]);

  const createBranch = useCallback(() => {
    if (persistence !== 'server') { requireAccount('branch', 'Create an account to branch this canvas', 'Branches need durable version history so you can compare and merge safely without losing your local work.'); return; }
    setNotice(t('noticeCreatingBranch'));
    void creationSessionsApi.branch(sessionId, `${title} — branch`).then(async ({ session }) => {
      canvasNavigate(`/create/${session.id}`);
    }).catch((error) => setNotice(faultText(error, t('noticeCreateBranchFailed'))));
  }, [persistence, requireAccount, sessionId, title]);

  const prepareMerge = useCallback(() => {
    if (!branchParentId || persistence !== 'server') return;
    setNotice(t('noticeComparingBranch'));
    void creationSessionsApi.get(branchParentId).then((detail) => {
      const parent = flowFromSession(detail);
      const unused = new Set(parent.nodes.map((node) => node.id));
      const items = nodes.map((source, index): MergeItem => {
        const target = parent.nodes.find((candidate) => unused.has(candidate.id) && candidate.data.kind === source.data.kind && ((source.data.resourceId && candidate.data.resourceId === source.data.resourceId) || candidate.data.title === source.data.title)) ?? null;
        if (target) unused.delete(target.id);
        return { key: `${source.data.kind}:${source.data.resourceId || source.data.title}:${index}`, source, target, choice: 'branch' };
      });
      setMergeReview({ parentId: branchParentId, parentRevision: detail.session.canvasRevision, parentNodes: parent.nodes, parentEdges: parent.edges, items });
      setNotice(t('noticeDecisionsReady', { count: items.length }));
    }).catch((error) => setNotice(faultText(error, t('noticeCompareBranchFailed'))));
  }, [branchParentId, nodes, persistence]);

  const applyMerge = useCallback(() => {
    if (!mergeReview) return;
    const consumedTargets = new Set(mergeReview.items.map((item) => item.target?.id).filter((id): id is string => !!id));
    const idMap = new Map<string, string>();
    const merged = mergeReview.items.map((item) => {
      const id = item.target?.id ?? crypto.randomUUID(); idMap.set(item.source.id, id);
      return item.choice === 'parent' && item.target ? item.target : { ...item.source, id };
    });
    mergeReview.parentNodes.filter((node) => !consumedTargets.has(node.id)).forEach((node) => merged.push(node));
    const branchEdges = edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    const parentOnly = new Set(merged.filter((node) => !consumedTargets.has(node.id)).map((node) => node.id));
    const retainedEdges = mergeReview.parentEdges.filter((edge) => parentOnly.has(edge.source) || parentOnly.has(edge.target));
    const graph = persistedGraphFromBoard({ nodes: merged, edges: [...retainedEdges, ...branchEdges] });
    setNotice(t('noticeApplyingMerge'));
    void creationSessionsApi.saveGraph(mergeReview.parentId, { ...graph, expectedRevision: mergeReview.parentRevision }).then(() => { canvasNavigate(`/create/${mergeReview.parentId}`); }).catch((error) => setNotice(faultText(error, t('noticeMergeFailed'))));
  }, [edges, mergeReview]);

  const expandProject = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : nodes.find((node) => node.data.kind === 'project');
    if (!project) {
      setNotice(t('noticeAddOrSelectProject'));
      return;
    }
    const projectId = canvasProjectId(project.data);
    if (persistence === 'server' && projectId != null) {
      setNotice(t('noticeLoadingRelationships'));
      const lens = ['delivery', 'metrics', 'customer-feedback'].includes(String(project.data.projectLens))
        ? project.data.projectLens as 'delivery' | 'metrics' | 'customer-feedback'
        : 'everything';
      void creationSessionsApi.expandProject(sessionId, projectId, lens).then(async (expanded) => {
        const taskDetails = new Map<string, CreationNodeData>();
        await Promise.all(expanded.resources.filter((item) => item.kind === 'task' && item.resourceType === 'task').map(async (item) => {
          const taskId = Number(item.resourceId);
          if (!Number.isInteger(taskId) || taskId <= 0) return;
          try {
            const [task, specs] = await Promise.all([tasksApi.get(taskId), taskSpecsApi.list(taskId).catch(() => [])]);
            const primaryPrd = specs.find((spec) => spec.isPrimary) ?? specs[0];
            const agentNode = expanded.resources.find((resource) => resource.kind === 'agent' && String(resource.resourceId) === String(task.assignedAgentRef));
            taskDetails.set(String(item.resourceId), {
              kind: 'task', title: task.title, taskKey: task.key, status: task.status,
              content: task.description || undefined, priority: task.priority,
              agentRef: task.assignedAgentRef || undefined,
              assignee: agentNode?.title || task.assignedAgentRef || (task.assignedUserId ? 'Assigned teammate' : undefined),
              prdTitle: primaryPrd?.goal || undefined, prdStatus: primaryPrd?.status || undefined,
              prdSummary: primaryPrd?.prd?.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 240) || undefined,
              prdCount: specs.length,
            });
          } catch { /* Keep the relationship card available when task detail is inaccessible. */ }
        }));
        const related: CreationFlowNode[] = [
          ...expanded.resources.slice(0, 24).map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation',
            position: { x: project.position.x + 390 + (index % 3) * 300, y: project.position.y - 180 + Math.floor(index / 3) * 190 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, subtitle: item.subtitle ?? undefined, ...(item.kind === 'task' ? taskDetails.get(String(item.resourceId)) : undefined), resourceId: formatResourceRef(item.resourceType, item.resourceId) ?? undefined, workflowExecutable: item.workflowExecutable, resourceSubtype: item.resourceSubtype },
          })),
          ...expanded.generated.map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 390 + index * 370, y: project.position.y - 430 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, sourceProjectId: projectId, expansionKey: item.key },
          })),
        ];
        const knownResources = new Set(nodes.map((node) => node.data.resourceId).filter(Boolean));
        const knownNative = new Set(nodes.map((node) => String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        const additions = related.filter((node) => node.data.resourceId ? !knownResources.has(node.data.resourceId) : !knownNative.has(String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        setNodes((current) => [...current, ...placeAppendedRef.current(current, additions)]);
        setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: project.id, target: node.id, type: 'smoothstep', label: node.data.kind }))]);
        setNotice(additions.length ? `${additions.length} related project items added` : t('noticeLensAlreadyExpanded'));
        trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: canvasSurface(), projectId } });
      }).catch((error) => setNotice(faultText(error, t('noticeExpandProjectFailed'))));
      return;
    }
    // A SECTION, not a legacy `workflow` card: the canvas IS the workflow. Sized so
    // its steps' centres stay inside it and the 'Next delivery task' card seeded
    // below it stays clear — see `initialNodes`' own frame for the same accounting.
    const deliveryFramePosition = { x: project.position.x + 850, y: project.position.y - 150 };
    // Persisted with the board, so minted in the board's language.
    const projectTitle = project.data.title ?? '';
    const deliveryTitle = t('runtimeObject.deliveryWorkflow');
    const related: CreationFlowNode[] = [
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y - 150 }, data: { kind: 'dashboard', title: t('runtimeObject.projectHealth', { title: projectTitle }) } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y + 100 }, data: { kind: 'roadmap', title: t('runtimeObject.projectRoadmap', { title: projectTitle }), status: t('runtimeObject.status.live') } },
      { id: crypto.randomUUID(), type: 'creation', position: deliveryFramePosition, style: { width: 380, height: 220 }, zIndex: -1, data: { kind: 'frame', title: deliveryTitle, framePurpose: t('flowStep.framePurpose') } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y + 150 }, data: { kind: 'task', title: t('runtimeObject.nextDeliveryTask'), status: t('runtimeObject.status.ready'), role: t('seedBoard.strategist') } },
    ];
    const additions = related.filter((candidate) => !nodes.some((node) => node.data.kind === candidate.data.kind && node.data.title === candidate.data.title));
    // The frame's own steps, added only when the frame itself was — re-expanding an
    // already-present section must not duplicate what is already inside it.
    const deliveryFrame = additions.find((candidate) => candidate.data.kind === 'frame' && candidate.data.title === deliveryTitle);
    const deliveryTrigger: CreationFlowNode | null = deliveryFrame ? { id: crypto.randomUUID(), type: 'creation', position: { x: deliveryFramePosition.x + 30, y: deliveryFramePosition.y + 50 }, style: { width: 140, height: 150 }, data: createFlowStepData('trigger', t('runtimeObject.sprintCadence')) as CreationNodeData } : null;
    const deliveryTask: CreationFlowNode | null = deliveryFrame ? { id: crypto.randomUUID(), type: 'creation', position: { x: deliveryFramePosition.x + 200, y: deliveryFramePosition.y + 50 }, style: { width: 140, height: 150 }, data: createFlowStepData('agent', t('runtimeObject.shipNextTask')) as CreationNodeData } : null;
    const deliverySteps = [deliveryTrigger, deliveryTask].filter((step): step is CreationFlowNode => step !== null);
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [...additions, ...deliverySteps])]);
    setEdges((current) => [
      ...current,
      ...additions.map((candidate) => ({ id: crypto.randomUUID(), source: project.id, target: candidate.id, type: 'smoothstep' })),
      ...(deliveryTrigger && deliveryTask ? [{ id: crypto.randomUUID(), source: deliveryTrigger.id, target: deliveryTask.id, type: 'smoothstep', data: { connectionKind: 'control' } }] : []),
    ]);
    setNotice(t('noticeRelationshipsAdded'));
    trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: canvasSurface(), projectId: Number.isInteger(projectId) ? projectId : undefined } });
  }, [nodes, persistence, selectedNode, sessionId, setEdges, setNodes]);

  const compareProjects = useCallback(() => {
    if (persistence !== 'server') { requireAccount('compare', 'Create an account to compare projects', 'Project comparisons use live tenant projects, delivery metrics, feature evidence, and saved source references.'); return; }
    const projectNodes = canvasProjectNodes(nodes).slice(0, 6);
    if (projectNodes.length < 2) { setNotice(t('noticeNeedTwoProjects')); return; }
    setNotice(t('noticeLoadingEvidence'));
    void fetchProjects().then(async (available) => {
      const byId = new Map(available.map((project) => [project.id, project]));
      const evidence = await Promise.all(projectNodes.map(async (node) => {
        const projectId = canvasProjectId(node.data)!;
        const project = byId.get(projectId);
        if (!project) throw new Error(`Project ${projectId} is no longer accessible`);
        const [velocity, tasks, quality] = await Promise.all([
          agileMetricsApi.derivedVelocity(projectId).catch(() => null),
          tasksApi.list(projectId).catch(() => []),
          toolsApi.projectScore(projectId).catch(() => null),
        ]);
        const health = computeProjectHealth(project);
        const diagnostics = quality?.diagnostics.map((diagnostic) => ({
          toolId: diagnostic.toolId, name: diagnostic.name, icon: diagnostic.icon,
          score: diagnostic.score, scoreLabel: diagnostic.scoreLabel, headline: diagnostic.headline,
          gapCount: diagnostic.gapCount, remediation: diagnostic.remediation,
          recommendations: diagnostic.result.recommendations,
        })) ?? [];
        return {
          projectId, name: project.name, status: project.status || 'active', progress: health.progressPct,
          health: health.healthScore, healthTier: health.tier, open: health.open, blocked: health.blocked,
          overdue: health.overdue, velocity: velocity?.averageVelocity ?? null,
          qualityScore: quality?.result.score ?? null, qualityLabel: quality?.result.scoreLabel ?? null,
          qualityHeadline: quality?.result.headline ?? 'No quality diagnostics have been run', diagnostics,
          diagnosticCount: diagnostics.length, gapCount: diagnostics.reduce((total, diagnostic) => total + diagnostic.gapCount, 0),
          recommendations: diagnostics.flatMap((diagnostic) => diagnostic.recommendations.map((recommendation) => ({ ...recommendation, diagnostic: diagnostic.name, score: diagnostic.score }))).slice(0, 6),
          features: tasks.filter((task) => !['done', 'closed', 'cancelled'].includes(task.status)).slice(0, 5).map((task) => task.title),
        };
      }));
      const comparison = newNode('projectComparison', { x: Math.max(...projectNodes.map((node) => node.position.x)) + 430, y: Math.min(...projectNodes.map((node) => node.position.y)) });
      comparison.data = {
        ...comparison.data, title: `${evidence.map((project) => project.name).join(' vs ')}`, status: 'Live evidence', projects: evidence,
        fetchedAt: new Date().toISOString(), sources: evidence.flatMap((project) => [
          { label: `${project.name} project metrics`, resource: `/api/projects`, projectId: project.projectId },
          { label: `${project.name} velocity`, resource: `/api/agile/velocity/derived?projectId=${project.projectId}`, projectId: project.projectId },
          { label: `${project.name} feature/task evidence`, resource: `/api/tasks?projectId=${project.projectId}`, projectId: project.projectId },
          { label: `${project.name} quality diagnostics`, resource: `/api/tools/projects/${project.projectId}/score`, projectId: project.projectId },
        ]),
      };
      setNodes((current) => [...current.map((node) => {
        const projectId = canvasProjectId(node.data);
        const project = projectId ? evidence.find((candidate) => candidate.projectId === projectId) : null;
        return project ? { ...node, data: { ...node.data, ...project, qualityUpdatedAt: comparison.data.fetchedAt } } : node;
      }), comparison]);
      setEdges((current) => [...current, ...projectNodes.map((project) => ({ id: crypto.randomUUID(), source: project.id, target: comparison.id, label: 'compared in', type: 'smoothstep', animated: true }))]);
      setSelectedId(comparison.id);
      openNodeInspector(comparison.id);
      setNotice(t('noticeComparisonAdded'));
      trackActivity('creation_projects_compared', { sessionId, metadata: { clientSurface: canvasSurface(), projectCount: projectNodes.length } });
    }).catch((error) => setNotice(faultText(error, t('noticeCompareProjectsFailed'))));
  }, [nodes, openNodeInspector, persistence, requireAccount, setEdges, setNodes]);

  const loadProjectQuality = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : null;
    const projectId = project ? canvasProjectId(project.data) : null;
    if (!project || projectId == null) {
      if (persistence === 'local') requireAccount('diagnostics', 'Create an account to load project quality', 'Quality diagnostics are saved against a canonical project and include current results, gaps, and remediation recommendations.');
      else setNotice(t('noticeAttachForQuality'));
      return;
    }
    const validationCorrelationId = crypto.randomUUID();
    const validationStartedAt = performance.now();
    void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'started', projectId: Number(projectId), artifactId: project.id }).catch(() => undefined);
    setNotice(t('noticeLoadingQuality'));
    void toolsApi.projectScore(Number(projectId)).then((quality) => {
      const diagnostics = quality.diagnostics.map((diagnostic) => ({
        toolId: diagnostic.toolId, name: diagnostic.name, icon: diagnostic.icon,
        score: diagnostic.score, scoreLabel: diagnostic.scoreLabel, headline: diagnostic.headline,
        gapCount: diagnostic.gapCount, remediation: diagnostic.remediation,
        recommendations: diagnostic.result.recommendations,
      }));
      const recommendations = diagnostics.flatMap((diagnostic) => diagnostic.recommendations.map((recommendation) => ({ ...recommendation, diagnostic: diagnostic.name, score: diagnostic.score }))).slice(0, 8);
      const qualityData = {
        qualityScore: quality.result.score, qualityLabel: quality.result.scoreLabel,
        qualityHeadline: quality.result.headline, diagnosticCount: diagnostics.length,
        gapCount: diagnostics.reduce((total, diagnostic) => total + diagnostic.gapCount, 0),
        diagnostics, recommendations, qualityUpdatedAt: new Date().toISOString(),
      };
      const existing = nodes.find((node) => node.data.kind === 'diagnostics' && node.data.qualityProjectId === Number(projectId));
      const qualityNode = existing ?? newNode('diagnostics', { x: project.position.x + 390, y: project.position.y });
      qualityNode.data = { ...qualityNode.data, ...qualityData, qualityProjectId: Number(projectId), title: `${project.data.title} quality`, status: diagnostics.length ? 'Diagnostics current' : 'Not yet assessed', items: diagnostics };
      setNodes((current) => existing
        ? current.map((node) => node.id === project.id ? { ...node, data: { ...node.data, ...qualityData } } : node.id === existing.id ? { ...node, data: qualityNode.data } : node)
        : [...current.map((node) => node.id === project.id ? { ...node, data: { ...node.data, ...qualityData } } : node), qualityNode]);
      if (!existing) setEdges((current) => [...current, { id: crypto.randomUUID(), source: project.id, target: qualityNode.id, label: 'quality evidence', type: 'smoothstep', animated: true }]);
      setSelectedId(qualityNode.id);
      openNodeInspector(qualityNode.id);
      setNotice(diagnostics.length ? `${diagnostics.length} quality diagnostics added to the canvas` : t('noticeQualityCardAdded'));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'validated', projectId: Number(projectId), artifactId: project.id, durationMs: performance.now() - validationStartedAt, metricKey: 'validation_pass', metricValue: Number(quality.result.score ?? 0) >= 70 ? 1 : 0, unit: 'boolean', metadata: { score: quality.result.score, diagnosticCount: diagnostics.length } }).catch(() => undefined);
    }).catch((error) => {
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'failed', projectId: Number(projectId), artifactId: project.id, durationMs: performance.now() - validationStartedAt }).catch(() => undefined);
      setNotice(faultText(error, t('noticeLoadQualityFailed')));
    });
  }, [nodes, persistence, requireAccount, selectedNode, setEdges, setNodes]);

  const deliverMockup = useCallback(() => {
    if (!selectedNode || (selectedNode.data.kind !== 'mockup' && selectedNode.data.kind !== 'mockupSet')) return;
    if (persistence === 'local') { requireAccount('deliver', 'Create an account to deliver this mockup', 'Delivery creates a durable project task, assigns an authorized Agent, and keeps execution status connected to this canvas.'); return; }
    const configuredProjectRef = typeof selectedNode.data.deliveryProjectRef === 'string' ? selectedNode.data.deliveryProjectRef : null;
    const configuredAgentRef = typeof selectedNode.data.mockupAgentRef === 'string' ? selectedNode.data.mockupAgentRef : null;
    const project = configuredProjectRef == null
      ? nodes.find((node) => node.data.kind === 'project')
      : nodes.find((node) => node.data.kind === 'project' && (node.data.resourceId || node.id) === configuredProjectRef);
    const agent = configuredAgentRef == null
      ? nodes.find((node) => node.data.kind === 'agent')
      : nodes.find((node) => node.data.kind === 'agent' && (node.data.resourceId || node.id) === configuredAgentRef);
    const projectId = (project ? canvasProjectId(project.data) : null) ?? NaN;
    const addTaskNode = (resourceId: string, status: string, detail: Partial<CreationNodeData> = {}) => {
      const taskId = crypto.randomUUID();
      const task: CreationFlowNode = {
        id: taskId, type: 'creation', position: { x: selectedNode.position.x + 330, y: selectedNode.position.y + 40 },
        data: { kind: 'task', title: `Build ${selectedNode.data.title}`, status, role: agent?.data.title || 'Available agent', assignee: agent?.data.title, agentRef: agent?.data.resourceId?.replace(/^agent:/, ''), priority: 'high', content: selectedNode.data.subtitle || 'Implement the approved canvas mockup.', subtitle: project ? `Deliver to ${project.data.title}.` : 'Attach a project when ready.', ...detail, resourceId },
      };
      setNodes((current) => { const base = current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status } } : node); return [...base, ...placeAppendedRef.current(base, [task])]; });
      setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: taskId, type: 'smoothstep', animated: true }]);
      setSelectedId(taskId);
      openNodeInspector(taskId);
      return taskId;
    };
    if (persistence === 'server' && Number.isInteger(projectId) && projectId > 0) {
      const deliveryCorrelationId = crypto.randomUUID();
      const deliveryStartedAt = performance.now();
      const deliverable: CreationDeliverable = { id: deliveryCorrelationId, action: 'deliver', artifactKind: 'project-task', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-tasks', resourceRef: `project:${projectId}` };
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivering…', deliverables: withCreationDeliverable(node.data, deliverable) } } : node));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'started', projectId, artifactId: selectedNode.id, metadata: { kind: selectedNode.data.kind } }).catch(() => undefined);
      setNotice(t('noticeCreatingDelivery'));
      const agentRef = agent?.data.resourceId?.startsWith('agent:') ? agent.data.resourceId.slice('agent:'.length) : undefined;
      void tasksApi.create({
        projectId,
        title: `Build ${selectedNode.data.title}`,
        description: `${selectedNode.data.subtitle || 'Implement the approved canvas mockup.'}\n\nSource creation session: ${sessionId}\nSource canvas object: ${selectedNode.id}`,
        priority: 'high',
        ...(agentRef ? { assignedAgentRef: agentRef } : {}),
      }).then(async (created) => {
        const delivered: CreationDeliverable = { ...deliverable, status: 'delivered', completedAt: new Date().toISOString(), resourceRef: `task:${created.id}`, validation: { status: 'passed', detail: `Task ${created.key || created.id} created in ${project?.data.title || `project ${projectId}`}` }, metadata: { projectId, taskId: created.id, agentRef: agentRef || null } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivered', deliverables: withCreationDeliverable(node.data, delivered) } } : node));
        const canvasTaskId = addTaskNode(`task:${created.id}`, created.status || (agentRef ? 'Assigned' : 'Ready'), { taskKey: created.key, priority: created.priority, content: created.description || undefined, agentRef: created.assignedAgentRef || undefined });
        trackActivity('creation_artifact_delivered', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [selectedNode.data.kind], projectId } });
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'succeeded', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt, metricKey: 'delivered_outcomes', metricValue: 1, unit: 'count', metadata: { taskId: created.id, agentAssigned: !!agentRef } }).catch(() => undefined);
        if (agentRef) {
          trackActivity('creation_agent_assigned', { sessionId, metadata: { clientSurface: canvasSurface(), projectId } });
          let execution;
          try {
            execution = await runtimeApi.submitExecution({ taskId: created.id, sessionId });
          } catch (error) {
            setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status: 'Agent start failed' } } : node));
            setNotice(t('noticeDeliveryAgentFailed', { id: created.id, reason: error instanceof Error ? error.message : t('runtimeUnavailable') }));
            return;
          }
          if (isAwaitingApprovalExecution(execution)) {
            setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status: 'Awaiting approval' } } : node));
            setNotice(t('noticeDeliveryAwaitingApproval'));
          } else {
            setNotice(t('noticeDeliveryStarted'));
            const follow = async (remaining = 80) => {
              try {
                const live = await runtimeApi.get(execution.id);
                const status = String(live.status || 'running').replaceAll('_', ' ');
                setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status, executionId: execution.id, executionUpdatedAt: new Date().toISOString() } } : node));
                if (!['completed', 'failed', 'cancelled', 'canceled'].includes(String(live.status)) && remaining > 0) window.setTimeout(() => void follow(remaining - 1), 3_000);
                else setNotice(t('noticeAgentDelivery', { status }));
              } catch { if (remaining > 0) window.setTimeout(() => void follow(remaining - 1), 5_000); }
            };
            void follow();
          }
        } else {
          setNotice(t('noticeMockupDelivered'));
        }
      }).catch((error) => {
        const message = errorText(error);
        const failed: CreationDeliverable = { ...deliverable, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivery failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'failed', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt }).catch(() => undefined);
        setNotice(message);
      });
      return;
    }
    addTaskNode(`draft-task:${crypto.randomUUID()}`, 'Draft');
    setNotice(t('noticeNeedProjectForDelivery'));
  }, [errorText, nodes, persistence, requireAccount, selectedNode, sessionId, setEdges, setNodes]);

  const expandMockupSet = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'mockupSet') return;
    const labels = Array.isArray(selectedNode.data.items) && selectedNode.data.items.length
      ? selectedNode.data.items.map(String).slice(0, 10)
      : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'];
    const additions = labels.map((label, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: selectedNode.position.x + 440 + (index % 2) * 330, y: selectedNode.position.y - 180 + Math.floor(index / 2) * 220 }, data: { kind: 'mockup', title: label, status: 'Ready for review', subtitle: `High-fidelity concept ${index + 1} of ${labels.length}.` } }));
    setNodes((current) => [...current, ...placeAppendedRef.current(current, additions)]);
    setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: selectedNode.id, target: node.id, type: 'smoothstep', label: 'contains', animated: true }))]);
    setNotice(t('noticeMockupsExpanded', { count: additions.length }));
  }, [selectedNode, setEdges, setNodes]);

  const attachEvermindProject = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const evermindNodeId = selectedNode.id;
    const project = canvasProjectNodes(nodes)[0];
    if (!project) { setNotice(t('noticeNeedSavedProject')); return; }
    const projectId = canvasProjectId(project.data)!;
    setNodes((current) => current.map((node) => node.id === evermindNodeId ? { ...node, data: { ...node.data, resourceId: `evermind:${projectId}`, projectId, status: 'Syncing project…' } } : node));
    setEdges((current) => current.some((edge) => edge.source === project.id && edge.target === selectedNode.id) ? current : [...current, { id: crypto.randomUUID(), source: project.id, target: selectedNode.id, label: 'owns model', type: 'smoothstep' }]);
    void Promise.all([getProjectEvermindHead(projectId), getProjectEvermindContributions(projectId)]).then(([head, activity]) => {
      setEvermindLiveByNodeId((current) => ({ ...current, [evermindNodeId]: projectEvermindNodePatch(head, activity) }));
      setNotice(t('noticeEvermindAttached'));
    }).catch((error) => setNotice(faultText(error, t('noticeLoadEvermindFailed'))));
  }, [nodes, selectedNode, setEdges, setNodes]);

  const expandEvermindPipeline = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const existing = nodes.filter((node) => node.data.modelPipelineFor === selectedNode.id);
    if (existing.length) {
      const start = existing.find((node) => node.data.pipelineStep === 1) ?? existing[0]!;
      setSelectedId(start.id); setSelectedIds([start.id]); openNodeInspector(start.id);
      window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...existing].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
      setNotice(t('noticeDatasetStepOne'));
      return;
    }
    const specs: Array<{ kind: CreationObjectKind; title: string; status: string; x: number; y: number; step: number; instruction: string; detail?: Partial<CreationNodeData>; pipelineSteps?: Array<{ title: string; status: string }> }> = [
      { kind: 'dataset', title: `${selectedNode.data.title} training corpus`, status: 'Start here', x: -430, y: -20, step: 1, instruction: 'Select this card, then import a CSV or TSV in Details.' },
      // A guided STAGE is a section too: what used to be a `workflow` card's
      // display-only `steps` list (cosmetic status lines, never compiler input) is
      // now a frame holding one status-only `flowStep` per line — see below.
      { kind: 'frame', title: 'Tokenize examples', status: 'Waiting for data', x: -430, y: 250, step: 2, instruction: 'Review the corpus, then run tokenization.', pipelineSteps: [{ title: 'Inspect corpus', status: 'Waiting' }, { title: 'Build vocabulary', status: 'Waiting' }, { title: 'Verify tokens', status: 'Waiting' }] },
      { kind: 'frame', title: 'Distil & tune', status: 'Waiting for tokens', x: -20, y: 250, step: 3, instruction: 'Choose self-learning or a teacher, then adapt the model.', pipelineSteps: [{ title: 'Choose teacher', status: 'Waiting' }, { title: 'Create exemplars', status: 'Waiting' }, { title: 'Adapt weights', status: 'Waiting' }, { title: 'Save version', status: 'Waiting' }] },
      { kind: 'evaluation', title: 'Quality gate', status: 'Waiting for version', x: 800, y: 15, step: 4, instruction: 'Test learned answers before enabling replies.', detail: { verdict: 'Awaiting trained version', gaps: ['Run readiness prompts', 'Compare held-out loss', 'Approve the version'], recommendations: ['Complete distillation and tuning first.', 'Check regression against prior learnings.', 'Publish only after the model is coherent.'] } },
      { kind: 'dashboard', title: 'Learning telemetry', status: 'Waiting for run', x: 800, y: 300, step: 5, instruction: 'Observe loss, weight movement, and learned examples.', detail: { kpis: [{ label: 'Loss', value: '—', trend: 'After first run' }, { label: 'Weights moved', value: '—', trend: 'After first run' }, { label: 'Examples learned', value: '0', trend: 'No run yet' }], chartLabels: ['No training runs yet'], chartValues: [0] } },
    ];
    const created = specs.map((spec) => {
      const node = newNode(spec.kind, { x: selectedNode.position.x + spec.x, y: selectedNode.position.y + spec.y });
      node.data = { ...node.data, ...spec.detail, title: spec.title, status: spec.status, modelPipelineFor: selectedNode.id, pipelineStep: spec.step, pipelineStart: spec.step === 1, pipelineInstruction: spec.instruction, ...(spec.kind === 'frame' ? { framePurpose: spec.instruction } : {}) };
      if (spec.kind === 'frame') { node.style = { width: 380, height: 70 + (spec.pipelineSteps?.length ?? 0) * 54 }; node.zIndex = -1; }
      return node;
    });
    // One status-only `flowStep` per cosmetic line, positioned inside the stage
    // frame it belongs to. `pipelineStep`/`modelPipelineFor` (not any board wiring)
    // are what drive this walkthrough, so these carry no connections of their own.
    const stageSteps = specs.flatMap((spec, index) => (spec.pipelineSteps ?? []).map((line, lineIndex) => {
      const node = newNode('flowStep', { x: created[index]!.position.x + 20, y: created[index]!.position.y + 60 + lineIndex * 54 });
      node.style = { width: 340, height: 46 };
      node.data = { ...node.data, ...createFlowStepData('agent', line.title), status: line.status, modelPipelineFor: selectedNode.id };
      return node;
    }));
    const [dataset, tokenizer, tuning, evaluation, telemetry] = created;
    const sequence = [
      { source: dataset!.id, target: tokenizer!.id, label: '1 · examples' },
      { source: tokenizer!.id, target: tuning!.id, label: '2 · tokens' },
      { source: tuning!.id, target: selectedNode.id, label: '3 · learned version' },
      { source: selectedNode.id, target: evaluation!.id, label: '4 · test' },
      { source: evaluation!.id, target: telemetry!.id, label: '5 · observe' },
    ];
    setNodes((current) => { const base = current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, pipelineExpanded: true } } : node); return [...base, ...placeAppendedRef.current(base, [...created, ...stageSteps])]; });
    setEdges((current) => [...current, ...sequence.map((edge) => ({ ...edge, id: crypto.randomUUID(), type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed } }))]);
    setSelectedId(dataset!.id); setSelectedIds([dataset!.id]); openNodeInspector(dataset!.id);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...created, ...stageSteps].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
    setNotice(t('noticeDatasetStepOne'));
  }, [nodes, openNodeInspector, selectedNode, setEdges, setNodes]);

  const openEvermindTraining = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    expandEvermindPipeline();
    const attached = selectedNode.data.resourceId?.match(/^evermind:(\d+)$/)?.[1];
    const projectNode = canvasProjectNodes(nodes)[0];
    const projectId = attached ? Number(attached) : projectNode ? canvasProjectId(projectNode.data) : null;
    if (persistence === 'server' && !projectId) {
      setNotice(t('noticeNeedProjectForTraining'));
      return;
    }
    setTrainingFocus({ nodeId: selectedNode.id, projectId: projectId ?? `local-${sessionId}`, localOnly: persistence === 'local' });
    setNotice(persistence === 'local' ? 'Local-only adapter studio opened' : t('noticeAdapterStudioOpened'));
  }, [expandEvermindPipeline, nodes, persistence, selectedNode, sessionId]);

  const evaluateEvermind = useCallback((nodeId?: string) => {
    const target = nodes.find((node) => node.id === nodeId && node.data.kind === 'evermind')
      ?? (selectedNode?.data.kind === 'evermind' ? selectedNode : null);
    if (!target) return;
    const jobId = typeof target.data.trainingJobId === 'string' ? target.data.trainingJobId : '';
    if (!jobId) { setNotice(t('noticeTrainBeforeEval')); return; }
    setNotice(t('noticeEvaluatingAdapter'));
    void evaluateModel(jobId).then((result) => {
      const existing = nodes.find((node) => node.data.kind === 'evaluation' && node.data.modelEvaluationFor === target.id);
      const evaluation = existing ?? newNode('evaluation', { x: target.position.x + 560, y: target.position.y });
      evaluation.data = {
        ...evaluation.data,
        title: `${target.data.title} evaluation`,
        status: 'Evaluated',
        modelEvaluationFor: target.id,
        verdict: result.score >= .8 ? 'Passed' : result.score >= .6 ? 'Review required' : 'Failed',
        score: result.score,
        content: result.details,
        results: [
          { label: 'Overall', value: result.score },
          { label: 'Code correctness', value: result.code_correctness ?? 0 },
          { label: 'Reasoning quality', value: result.reasoning_quality ?? 0 },
          { label: 'Hallucination rate', value: result.hallucination_rate ?? 0 },
        ],
      };
      setNodes((current) => existing ? current.map((node) => node.id === existing.id ? evaluation : node) : [...current, evaluation]);
      setEdges((current) => current.some((edge) => edge.source === target.id && edge.target === evaluation.id) ? current : [...current, { id: crypto.randomUUID(), source: target.id, target: evaluation.id, type: 'smoothstep', label: 'evaluated by', animated: true }]);
      setNotice(t('noticeEvermindEvalComplete', { score: (result.score * 100).toFixed(0) }));
    }).catch((error) => setNotice(faultText(error, t('noticeEvermindEvalFailed'))));
  }, [nodes, selectedNode, setEdges, setNodes]);

  /**
   * WHICH PROJECT this canvas is about, when it says so on the board itself.
   *
   * One of the three answers `resolveStandupProject` weighs, and the weakest —
   * the standup card's action and the room surface both read it through that
   * resolver rather than reaching for the first project node themselves, so
   * "which project is this standup for" has one answer in one place.
   */
  const boardProjectId = useMemo(() => {
    const project = canvasProjectNodes(nodes)[0];
    return project ? canvasProjectId(project.data) : null;
  }, [nodes]);
  // Optional: the canvas also mounts inside the VS Code webview and the guest
  // surfaces, neither of which has the shell's project switcher above it.
  const projectScope = useOptionalProjectScope();
  const scopeProjectId = projectScope?.currentProjectId ?? null;

  const startStandup = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'standup') return;
    if (persistence === 'local') { requireAccount('start', 'Create an account to start a collaborative stand-up', 'A live stand-up needs durable participants, shared activity, follow-up tasks, and tenant permissions.'); return; }
    const people = nodes.filter((node) => node.data.kind === 'staff' || node.data.kind === 'agent').slice(0, 25);
    if (!people.length) { setNotice(t('noticeNeedPeopleOnCanvas')); return; }
    const participants = people.map((node) => ({
      kind: node.data.kind === 'agent' ? 'agent' : 'human',
      ref: parseResourceRef(node.data.resourceId)?.id || node.id,
      name: node.data.title,
      focus: node.data.focus || node.data.subtitle || 'No current focus recorded',
    }));
    const applyStandup = (resourceId?: string) => {
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: resourceId ? 'Live' : 'Draft', participants, resourceId: resourceId || node.data.resourceId, summary: resourceId ? undefined : t('standupGatheredSummary', { count: participants.length }) } } : node));
      setEdges((current) => [...current, ...people.filter((person) => !current.some((edge) => edge.source === person.id && edge.target === selectedNode.id)).map((person) => ({ id: crypto.randomUUID(), source: person.id, target: selectedNode.id, label: 'joins', type: 'smoothstep' }))]);
    };
    // The project a person is working IN wins over the one this board happens to
    // draw: a standup started while scoped into a project is that project's, and
    // a board with no project node can now start one at all.
    const { projectId } = resolveStandupProject({ scopeProjectId, boardProjectId });
    if (persistence === 'server' && projectId) {
      setNotice(t('noticeStartingStandup'));
      void ceremonySessionsApi.start(projectId, 'standup', participants.map(({ kind, ref, name }) => ({ kind, ref, name }))).then((result) => {
        const ceremonyId = result.session?.id;
        applyStandup(ceremonyId ? `ceremony:${ceremonyId}` : undefined);
        setNotice(ceremonyId ? t('noticeStandupStarted') : t('noticeStandupFramePrepared'));
      }).catch((error) => setNotice(faultText(error, t('noticeStartStandupFailed'))));
      return;
    }
    applyStandup();
    setNotice(t('noticeNeedProjectForStandup'));
  }, [boardProjectId, nodes, persistence, requireAccount, scopeProjectId, selectedNode, setEdges, setNodes, t]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    fileDragDepth.current = 0;
    setFileDragging(false);
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const point = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // A file dragged in from the desktop lands where it was dropped and becomes
    // a real object; a palette drag still carries only an object kind.
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) { void addFilesToCanvas(files, point); return; }
    // A teammate dragged off the footer roster joins the session HERE (PRD 21
    // §3.3). Same payload the keyboard route carries, same seating helper — a
    // drag is one way in, never the only one.
    const teammate = teammateFromDrag(event.dataTransfer);
    if (teammate) { seatTeammate(teammate, point); return; }
    // The palette rail and the picker both drag a palette CHOICE, not a bare kind:
    // a step and a stencil are as droppable as an object, and decoding them here
    // through the same `choiceSeed` the click path uses is what stops "dropped" and
    // "clicked" producing different objects from the same row.
    const choice = event.dataTransfer.getData(DND_MIME);
    // A link dragged from a browser tab or another app carries no object kind —
    // it lands as a live Web page panel, which is what a dropped URL means.
    if (!choice && point) {
      const dropped = normalizeWebPageUrl(event.dataTransfer.getData('text/uri-list').split('\n')[0] || event.dataTransfer.getData('text/plain'));
      if (dropped) {
        const page = newNode('browser', point);
        page.data = { ...page.data, title: webPageHost(dropped), url: dropped, status: '' };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [page])]);
        setSelectedId(page.id); setSelectedIds([page.id]); openNodeInspector(page.id);
        return;
      }
    }
    if (!choice || !point) return;
    const { kind, seed, size } = choiceSeed(choice);
    const node = newNode(kind, point);
    if (kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
    if (seed) node.data = { ...node.data, ...seed };
    if (size) node.style = { ...node.style, ...size };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setSelectedId(node.id); setSelectedIds([node.id]); openNodeInspector(node.id);
  }, [addFilesToCanvas, canEdit, choiceSeed, localizedTourDefaults, openNodeInspector, setNodes, t]);

  /**
   * Convert an object into a diagram, in any notation that can be written.
   *
   * THREE things arrive here and they are not the same:
   *
   *  • An object whose shapes are REAL — a diagram in another notation, a
   *    vector image, a CAD drawing. Its geometry is read, and written to the
   *    destination. This is the path that turns a Lucidchart SVG export into
   *    editable shapes rather than a picture of a diagram, and a draw.io file
   *    into the Mermaid that will live in a repository.
   *  • An object that is a PICTURE — a photograph, a freehand sketch. There are
   *    no shapes to find, so it is embedded, and draw.io is the only notation
   *    that can hold it. Appending to an existing draw.io file is how several
   *    photos become one board.
   *  • Anything else, which is refused with a reason rather than a blank file.
   *
   * The result is a normal canvas object, so session persistence, history, the
   * Files panel, collaboration and ownership all apply unchanged.
   */
  const convertObjectToDiagram = useCallback(async (
    sourceId: string,
    requestedFormat?: string,
    requestedDiagramId?: string,
  ): Promise<{ ok: boolean; diagramId?: string; error?: string }> => {
    if (!canEdit) return { ok: false, error: t('roleCannotEdit') };
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return { ok: false, error: t('diagramSourceMissing') };
    const resolved = await diagramConvertSource(source.data);
    if (!resolved) return { ok: false, error: t('diagramSourceUnreadable') };

    const allowed = diagramConvertTargets(resolved);
    const notation = requestedFormat
      ? allowed.find((entry) => entry.id === requestedFormat.trim().toLowerCase())
      : allowed[0];
    if (!notation) {
      return { ok: false, error: t('diagramTargetUnavailable', { formats: allowed.map((entry) => entry.name).join(', ') }) };
    }

    // Appending only ever means "add this picture to that draw.io file". A
    // graph conversion REPLACES a notation; merging two scene graphs is a
    // different operation and pretending otherwise would silently lose one.
    if (resolved.kind === 'asset' && notation.id === 'drawio') {
      const drawioDiagrams = nodes.filter((node) => node.data.kind === 'diagram' && canvasDiagram(node.data)?.format === 'drawio');
      const target = requestedDiagramId && requestedDiagramId !== '__new__'
        ? drawioDiagrams.find((node) => node.id === requestedDiagramId)
        : requestedDiagramId === '__new__' ? undefined : drawioDiagrams.length === 1 ? drawioDiagrams[0] : undefined;
      if (target) {
        const current = canvasDiagram(target.data)?.source ?? '';
        const updated = appendImageToDrawioCanvas(current, resolved.asset);
        if (!updated) return { ok: false, error: t('drawioAppendFailed') };
        setNodes((items) => items.map((node) => node.id === target.id ? { ...node, data: {
          ...node.data, diagram: updated, diagramXml: updated, content: updated,
          status: t('drawioUpdatedStatus'),
          sourceImageIds: [...new Set([...(Array.isArray(node.data.sourceImageIds) ? node.data.sourceImageIds.map(String) : []), source.id])],
        } } : node));
        setEdges((items) => items.some((edge) => edge.source === source.id && edge.target === target.id) ? items : [...items, { id: crypto.randomUUID(), source: source.id, target: target.id, type: 'smoothstep', label: t('drawioAddedToEdge'), data: { connectionKind: 'reference' } }]);
        setSelectedId(target.id); setSelectedIds([target.id]); setNotice(t('drawioImageAdded', { name: source.data.title, diagram: target.data.title }));
        return { ok: true, diagramId: target.id };
      }
    }

    const conversion = resolved.kind === 'asset'
      ? { source: createDrawioImageCanvas(resolved.asset), format: notation.id, shapes: 1, connections: 0, droppedConnections: 0 }
      : convertGraphSource(resolved, notation.id);
    if (!conversion) return { ok: false, error: t('diagramConversionFailed', { notation: notation.name }) };

    const diagram = newNode('diagram', { x: source.position.x + 430, y: source.position.y });
    diagram.data = {
      ...diagram.data,
      title: t('diagramConvertedTitle', { name: source.data.title, notation: notation.name }),
      status: t('diagramCreatedStatus'),
      fileName: `${safeDownloadName(source.data.title)}.${notation.extensions[0]}`,
      mimeType: notation.mimeType,
      diagramFormat: notation.id,
      diagram: conversion.source,
      content: conversion.source,
      sourceImageIds: [source.id],
      subtitle: t('diagramShape', { notation: notation.name, shapes: conversion.shapes, connections: conversion.connections }),
    };
    setNodes((items) => [...items, diagram]);
    setEdges((items) => [...items, { id: crypto.randomUUID(), source: source.id, target: diagram.id, type: 'smoothstep', label: t('drawioConvertedEdge'), data: { connectionKind: 'reference' } }]);
    setSelectedId(diagram.id); setSelectedIds([diagram.id]);
    // A destination that cannot carry every connection SAYS SO, at the moment
    // of conversion — the alternative is a person finding a missing arrow later
    // and having no way to know it was the format that dropped it.
    setNotice(conversion.droppedConnections
      ? t('diagramCreatedPartial', { name: diagram.data.title, dropped: conversion.droppedConnections })
      : t('diagramCreated', { name: diagram.data.title, notation: notation.name }));
    return { ok: true, diagramId: diagram.id };
  }, [canEdit, nodes, setEdges, setNodes, t]);

  /** Drag events fire again for every child element the pointer crosses, so the
   * overlay is held by a depth count rather than by the last event seen. */
  const onCanvasDragEnter = useCallback((event: React.DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    fileDragDepth.current += 1;
    setFileDragging(true);
  }, []);
  const onCanvasDragLeave = useCallback((event: React.DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (!fileDragDepth.current) setFileDragging(false);
  }, []);

  /**
   * The BUILD vocabulary — creating and editing the code behind a Builder object.
   *
   * Held in `lib/canvasBuildTools.ts` rather than inline below: the action array
   * in this component is already ~3 700 lines, and these are pure functions over
   * an injected context, so they unit-test without React or a canvas.
   *
   * `boundBuildsRef` exists so the tools read CURRENT board state without `nodes`
   * being a dependency of the memo that builds them — otherwise every object added
   * to the board would re-register all seven tools mid-turn.
   */
  /* The board as the tool modules read it is `nodesRef`, declared beside
   * `updateNodeData` above — ONE ref for the one reason all three callers need it,
   * `boundBuildsRef` directly below included: reading CURRENT board state without
   * `nodes` being a dependency, which would re-register the whole vocabulary mid-turn
   * and remount every Object on the board. */
  const boundBuildsRef = useRef<BoundCanvasBuild[]>([]);
  boundBuildsRef.current = useMemo(() => {
    return stage.nodes().flatMap((node) => {
      if (node.data.kind !== 'build') return [];
      const binding = canvasBuildBinding(node.data);
      return binding ? [{ objectId: node.id, title: String(node.data.title ?? 'Build'), binding }] : [];
    });
  }, [nodes, stage]);

  /**
   * Provision a workspace for the model and put its Builder object on the board.
   *
   * Committed straight to `nodes` rather than staged as a proposal, unlike almost
   * every other authoring tool. The reason is that the expensive half already
   * happened: `createCanvasBuild` creates a real build record with a seeded R2
   * workspace behind it, so a rejected proposal would leave an orphaned workspace
   * the board no longer references. This is the same order `openBuild` uses for
   * the click path, so both routes leave identical state.
   */
  const createBuildForTool = useCallback(async (input: { title: string; modality: ProjectModality }): Promise<BoundCanvasBuild> => {
    const node = stage.createObject('build');
    const ide = await createCanvasBuild({ title: input.title, modality: input.modality });
    const patch = canvasBuildPatch(ide);
    node.data = { ...node.data, ...patch, title: input.title };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    const binding = canvasBuildBinding(node.data);
    if (!binding) throw new Error('The workspace was created but could not be bound to the board.');
    return { objectId: node.id, title: input.title, binding };
  }, [setNodes, stage]);

  const canvasBuildActionList = useMemo<BrainAction[]>(() => canvasBuildActions({
    builds: () => boundBuildsRef.current,
    createBuild: createBuildForTool,
    onFilesChanged: notifyWorkspaceFilesChanged,
  }), [createBuildForTool]);

  /**
   * The context every board-mutation AI tool GROUP shares — founder-ops, legal
   * documents, and the generic e-signature tool all stage proposals against the
   * SAME board through the SAME three primitives (read objects, stage an add, stage
   * an update), so they read one context rather than three copies of the same three
   * closures. `CanvasFounderOpsContext` is generic enough for all three; a second,
   * near-identical interface would be exactly the duplication this consolidation
   * exists to avoid.
   *
   * Staged as PROPOSALS like every other authoring tool (unlike the build tools
   * above, which commit): nothing here provisions a durable resource that a
   * rejected proposal would orphan. `canvas_move_deal` is the exception worth
   * naming — it writes a real deal — but the write it performs is in the CRM and
   * is the user's stated intent; what gets staged is the board's redraw of it.
   */
  const canvasOpsContext = useMemo<CanvasFounderOpsContext>(() => ({
    sessionId,
    hasTenant: persistence === 'server',
    canEdit,
    t: canvasText,
    objects: () => {
      return stage.nodes().map((node) => ({
        id: node.id, kind: node.data.kind, title: node.data.title,
        data: node.data as unknown as Record<string, unknown>,
      }));
    },
    addObject: (kind, fields, at) => {
      const node = stage.createObject(kind as CreationObjectKind, at ?? {});
      node.data = { ...node.data, ...sanitizeCreationObjectPatch(kind as CreationObjectKind, fields) } as CreationNodeData;
      stage.addObject(String(fields.title ?? node.data.title), node);
      return { objectId: node.id };
    },
    updateObject: (objectId, patch, label) => {
      const kind = nodesRef.current.find((node) => node.id === objectId)?.data.kind;
      stage.updateObject(label, objectId, sanitizeCreationObjectPatch((kind ?? 'account') as CreationObjectKind, patch));
    },
  }), [canEdit, canvasText, persistence, sessionId, stage]);

  const canvasFounderOpsActionList = useMemo<BrainAction[]>(() => canvasFounderOpsActions(canvasOpsContext), [canvasOpsContext]);
  /** Ownership — fold the cap table, record a grant or a convertible, append a ledger
   *  event, model a round. See `canvasEquityTools.ts` for why there is deliberately no
   *  tool that WRITES a cap table. */
  const canvasEquityActionList = useMemo<BrainAction[]>(() => canvasEquityActions(canvasOpsContext), [canvasOpsContext]);
  /** The requisition, bound to its real `job_postings` row so `applicantCount` is a
   *  COUNT and not a typed number (FO-B3). See `canvasHiringPostingTools.ts` for why one
   *  tool covers both directions, and why it will not resolve a card by title. */
  const canvasHiringPostingActionList = useMemo<BrainAction[]>(() => canvasHiringPostingActions(canvasOpsContext), [canvasOpsContext]);
  /** The secure legal-document vocabulary — share, revoke, request signature, sync.
   *  See `canvasLegalDocumentTools.ts` for why these are dedicated tools rather than
   *  routed through `canvas_invoke_object_action`. */
  /** The data room, actually sent — sync it, share it with one named firm behind an
   *  NDA, revoke that firm's access. The three columns `data_rooms` has always carried
   *  and nothing ever read (FO-E2). */
  const canvasDataRoomActionList = useMemo<BrainAction[]>(() => canvasDataRoomActions(canvasOpsContext), [canvasOpsContext]);
  /** The founders' agreement and its siblings, drafted from the ONE template registry
   *  onto a `contract` card — then signed through the signature tool that already
   *  existed, so there is no second signature path (FO-D5). */
  const canvasDocumentTemplateActionList = useMemo<BrainAction[]>(() => canvasDocumentTemplateActions(canvasOpsContext), [canvasOpsContext]);
  const canvasLegalDocumentActionList = useMemo<BrainAction[]>(() => canvasLegalDocumentActions(canvasOpsContext), [canvasOpsContext]);
  /** The legal seat's own RECORDS — the entity, the IP asset, the matter — projected
   *  onto the board from `getEntityRows('legal', …)`. See `canvasLegalRecordTools.ts`
   *  for why one tool covers three kinds and why none of it is gated. */
  const canvasLegalRecordActionList = useMemo<BrainAction[]>(() => canvasLegalRecordActions(canvasOpsContext), [canvasOpsContext]);
  /** The generic e-signature request for authored (non-file) objects — closes the
   *  `contract.sign` gap; see `canvasSignatureTools.ts`. */
  const canvasSignatureActionList = useMemo<BrainAction[]>(() => canvasSignatureActions(canvasOpsContext), [canvasOpsContext]);
  /** The commercial half of the motion — share a board or a card with a prospect, read
   *  what they did with it, price a quote, read a call, assemble a trust packet, provision
   *  a trial, hand the board off, and drive a cadence. See `canvasSellMotionTools.ts` for
   *  why none of them can accept a quote. */
  const canvasSellMotionActionList = useMemo<BrainAction[]>(() => canvasSellMotionActions(canvasOpsContext), [canvasOpsContext]);
  /** Prompt iteration — read a library prompt with its versions, save the next one. See `canvasPromptLibraryTools.ts`. */
  const canvasPromptLibraryActionList = useMemo<BrainAction[]>(() => canvasPromptLibraryActions(canvasOpsContext), [canvasOpsContext]);

  /**
   * The inline Brain vocabulary — see `actions/context.ts`. `actionLive` is refreshed
   * after every commit (a layout effect, not a render-time write), so a tool reads the board as it is when it RUNS; `actionContext`, and
   * with it every tool, is rebuilt only when the session, role or locale changes. Before
   * this the vocabulary was one memo that depended on `nodes`, the scope and a function
   * re-created every render, so all of it was rebuilt on every render.
   */
  const actionLive = useRef<CanvasActionLive>(null!);
  useLayoutEffect(() => {
    actionLive.current = {
      nodes, scopedNodeIds, resolvedScopeMode, effectiveSelectedIds,
      requireAccount, openAccountGate, socialAccountGate, buildSocialFeedNode, convertObjectToDiagram, localizedTourDefaults, recentJournalEvidence,
    };
  });
  const actionContext = useMemo(() => createCanvasActionContext({
    sessionId, persistence, canEdit, t, tSocial, fmt, stage, setDockPanel, promptRef, layoutViewportRef, inFlightUseCaseId, turnToolCalls,
  }, actionLive), [canEdit, fmt, persistence, sessionId, stage, t, tSocial]);
  const canvasActions = useMemo<BrainAction[]>(() => ([...canvasInlineActions(actionContext), ...canvasBuildActionList, ...canvasFounderOpsActionList, ...canvasEquityActionList, ...canvasHiringPostingActionList, ...canvasDataRoomActionList, ...canvasDocumentTemplateActionList, ...canvasLegalDocumentActionList, ...canvasLegalRecordActionList, ...canvasSignatureActionList, ...canvasSellMotionActionList, ...canvasPromptLibraryActionList].filter((action) => persistence === 'server' || !canvasToolRequiresAccount(action.name))),
  [actionContext, canvasBuildActionList, canvasFounderOpsActionList, canvasEquityActionList, canvasHiringPostingActionList, canvasDataRoomActionList, canvasDocumentTemplateActionList, canvasLegalDocumentActionList, canvasLegalRecordActionList, canvasSignatureActionList, canvasSellMotionActionList, canvasPromptLibraryActionList, persistence]);

  const addAgentKnowledge = useCallback((agentId: string, content: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    const authored = content.trim();
    if (!agent || !authored || !canEdit) return;
    const knowledge = newNode('knowledge', { x: agent.position.x - 390, y: agent.position.y + 40 });
    knowledge.data = { ...knowledge.data, title: `${agent.data.title} knowledge`, status: 'Ready', markdown: authored, content: authored, sources: [{ label: 'Authored in Agent inspector', resource: `session:${agent.id}` }] };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [knowledge])]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: knowledge.id, target: agent.id, type: 'smoothstep', label: 'grounds', animated: true, data: { connectionKind: 'reference' } }]);
    setNotice(t('noticeKnowledgeConnected'));
  }, [canEdit, nodes, persistence, setEdges, setNodes]);

  const runAgentTest = useCallback(async (agentId: string, testPrompt: string, expected: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    if (!agent || !testPrompt.trim()) return;
    const connectedIds = new Set(edges.flatMap((edge) => edge.source === agentId ? [edge.target] : edge.target === agentId ? [edge.source] : []));
    const knowledge = nodes.filter((node) => connectedIds.has(node.id) && ['knowledge', 'document', 'dataset', 'file', 'url'].includes(node.data.kind));
    const evaluations = nodes.filter((node) => node.data.kind === 'evaluation');
    const evaluationNode = evaluations.find((node) => connectedIds.has(node.id)) || (evaluations.length === 1 ? evaluations[0] : undefined);
    if (evaluationNode && !connectedIds.has(evaluationNode.id)) {
      connectedIds.add(evaluationNode.id);
      setEdges((current) => current.some((edge) => (edge.source === agentId && edge.target === evaluationNode.id) || (edge.target === agentId && edge.source === evaluationNode.id)) ? current : [...current, { id: crypto.randomUUID(), source: agentId, target: evaluationNode.id, type: 'smoothstep', label: 'evaluated by', animated: true, data: { connectionKind: 'reference' } }]);
    }
    const snapshot = JSON.stringify({
      testMode: true,
      agent: { id: agent.id, ...creationObjectDefinition('agent').contextAdapter(agent.data, specBoardOf(nodes)) },
      knowledge: ((board) => knowledge.map((node) => ({ id: node.id, ...creationObjectDefinition(node.data.kind).contextAdapter(node.data, board) })))(specBoardOf(nodes)),
    });
    setNodes((current) => current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testPrompt, testExpected: expected, testStatus: 'Running', testResponse: '' } } : node));
    setNotice(t('noticeTestingAgent', { name: agent.data.title }));
    try {
      const response = await runCreationCanvasAi({
        prompt: testPrompt.trim(), canvasSnapshot: snapshot, persistence, canvasActions: [], notices: canvasNotices,
        disabledModels: brainRuntime.current.disabledModels,
        onCompletion: recordBrainCompletion, onModelDisabled: disableBrainModel,
        ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
        routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
        participant: { ref: agent.data.resourceId || agent.id, name: agent.data.title, instructions: typeof agent.data.instructions === 'string' ? agent.data.instructions : agent.data.subtitle },
      });
      const score = scoreAgentTestResponse(response, expected);
      const status = score.passed == null ? 'Completed · review response' : score.passed ? 'Passed' : 'Failed';
      const result = { id: crypto.randomUUID(), prompt: testPrompt.trim(), expected: expected.trim(), response, status, passed: score.passed, matched: score.matched, missing: score.missing, runAt: new Date().toISOString(), knowledgeObjectIds: knowledge.map((node) => node.id) };
      setNodes((current) => {
        const evaluation = evaluationNode ? current.find((node) => node.id === evaluationNode.id) : undefined;
        const currentAgent = current.find((node) => node.id === agentId);
        const priorHistory = Array.isArray(currentAgent?.data.testHistory) ? currentAgent.data.testHistory : [];
        const updated = current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testPrompt, testExpected: expected, testResponse: response, testStatus: status, testHistory: [result, ...priorHistory].slice(0, 25), status: 'Tested' } } : node);
        if (!evaluation) return updated;
        const priorResults = Array.isArray(evaluation.data.testResults) ? evaluation.data.testResults : [];
        const results = [result, ...priorResults].slice(0, 100);
        const scored = results.filter((item) => item && typeof item === 'object' && typeof (item as { passed?: unknown }).passed === 'boolean') as Array<{ passed: boolean }>;
        const passed = scored.filter((item) => item.passed).length;
        return updated.map((node) => node.id === evaluation.id ? { ...node, data: { ...node.data, testResults: results, runCount: results.length, passRate: scored.length ? Math.round(passed / scored.length * 100) : null, lastRunAt: result.runAt, verdict: status, status: 'Tested', gaps: score.missing, recommendations: score.missing.map((item) => `Improve the response so it demonstrates: ${item}`) } } : node);
      });
      setNotice(t('noticeAgentTestResult', { name: agent.data.title, status: status.toLowerCase() }));
    } catch (error) {
      const message = describeTurnError(error, 'noticeAgentTestFailed');
      setNodes((current) => current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testStatus: t('noticeAgentTestStatusError', { reason: message }) } } : node));
      setNotice(message);
    }
  }, [describeTurnError, disableBrainModel, edges, modelSelection, nodes, persistence, recordBrainCompletion, setEdges, setNodes, t]);

  const evaluateCanvas = useCallback((promptOverride?: string) => {
    const requestText = (promptOverride ?? prompt).trim();
    if (!requestText || thinking) return;
    // A tenant board with no tenant token cannot run a turn: the request would leave
    // without an Authorization header and come back 401 "Missing or malformed
    // Authorization header" — which is exactly what one signed-in user's diagnostics
    // recorded (session bf886fc1), on a board that had been working minutes earlier.
    // The token store is the value the transport authorizes with, so asking it here
    // predicts the call exactly; the answer is the same account prompt every other
    // tenant action raises, in the viewer's language, instead of a raw auth error
    // written into the transcript and filed as a support ticket.
    if (persistence === 'server' && !getStoredTenantToken()) {
      requireAccount('brain_turn', t('gateBrainTurnTitle'), t('gateBrainTurnBody'));
      return;
    }
    /**
     * Only a turn the user just typed empties the composer. A replay, a queued turn
     * flushing, or an object-initiated request carries its own text — clearing on
     * those wipes whatever the user is typing RIGHT NOW, which is exactly what the
     * composer staying live while a run streams makes possible.
     */
    const clearComposer = () => { if (promptOverride === undefined) setPrompt(''); };
    // ONE reader of the contract marker, shared with the tool's recovery path —
    // the prompt's `Execution contract <id>:` was written by
    // `executiveCanvasPrompt`, so this scan and that writer are two halves of
    // one fact and must not each carry their own copy of the string.
    const executiveUseCase = executiveUseCaseFromPrompt(requestText);
    // Published for the duration of the turn so the tool can fall back to it.
    inFlightUseCaseId.current = executiveUseCase?.id ?? null;
    const executiveWorkflow = executiveUseCase ? cSuiteCanvasWorkflow(executiveUseCase) : null;
    trackActivity('creation_prompt_submitted', { sessionId, metadata: { clientSurface: canvasSurface(), scope: resolvedScopeMode, objectKinds: [...new Set(scopedNodes.map((node) => node.data.kind))], ...(executiveUseCase ? { useCaseId: executiveUseCase.id } : {}) } });
    setThinking(true);
    setBrainRunStartedAt(Date.now());
    setNotice(t('noticeBrainEvaluating'));
    const initialMessage = initialPromptSubmitted.current ? timeline.find((message) => (message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:')) && message.body === requestText) : undefined;
    const promptAuthor = persistence === 'server' ? members.find((member) => member.userId === currentUserId) : null;
    const requestMessageId = appendTimeline('user', requestText, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'human', ref: currentUserId || 'local', name: promptAuthor?.displayName || 'You' } }, initialMessage?.clientMessageId);
    const promptStartedAt = performance.now();
    // The handle Stop reaches this run through. Created before the first await so a
    // Stop pressed while the request is still being assembled still lands.
    const runAbort = new AbortController();
    canvasRunRef.current = { abort: runAbort, requestMessageId, startedAt: promptStartedAt };
    if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'started', metadata: { scope: resolvedScopeMode, ...(executiveUseCase ? { useCaseId: executiveUseCase.id } : {}) } }).catch(() => undefined);
    // A composer submission is a chat interaction, so reveal its Brain object
    // immediately. Waiting for the vendor request to succeed left a blank canvas
    // (and hid useful streaming/failure state) whenever the provider cascade
    // rejected the turn.
    const existingChat = nodes.find((node) => node.data.kind === 'chat');
    const brainId = existingChat?.id ?? crypto.randomUUID();
    if (!existingChat) {
      const brain = { ...newNode('chat', { x: 120, y: 120 }), id: brainId };
      brain.data = { ...brain.data, title: 'Brain', subtitle: requestText };
      setNodes((current) => current.some((node) => node.data.kind === 'chat') ? current : [...current, brain]);
    }
    setSelectedId(brainId);
    setSelectedIds([brainId]);
    if (process.env.NODE_ENV !== 'test') {
      stage.reset();
      turnUnanswered.current = null;
      turnToolCalls.current = new Set();
      setBrainTrace([]);
      setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, trace: [] } } : node));
      setProposedChanges([]);
      const request = requestText;
      // The board as ONE loop of this turn sees it. A function rather than a value,
      // because a turn can run more than one loop — the invited agents first, then the
      // Brain synthesis — and the synthesis must see what the agents just put on the
      // board. Built once from the turn-start `nodes`, it showed the synthesis the
      // board the agents had already changed as if they had not, and the synthesis
      // re-made their objects (session bf886fc1: the same app built twice). Anything
      // added since the turn began is in scope for a later loop whatever the selection
      // was — it is this turn's own work.
      const startIds = new Set(nodes.map((node) => node.id));
      const turnSnapshot = (board: readonly CreationFlowNode[]): string => {
        const scoped = board.filter((node) => scopedNodeIds.has(node.id) || !startIds.has(node.id));
        const scopedIds = new Set(scoped.map((node) => node.id));
        // Restricted objects are stripped of DETAIL here and keep their inventory row —
        // see `aiContextGate` for why withholding is not the same as hiding.
        const aiGate = aiContextGate(scoped);
        return JSON.stringify({
          sessionId, scope: resolvedScopeMode, selectedObjectIds: effectiveSelectedIds,
          // A scoped turn used to send ONLY the scoped objects, with nothing saying
          // the view was partial — so the model answered "that file is not anywhere
          // on the canvas" about a file that was on the canvas, and asked the user
          // to upload it again. The inventory is identity-only (cheap) and always
          // complete, so an absence claim is never available to be made.
          scopeNote: scopeNote(resolvedScopeMode, board.length, scoped.length),
          boardInventory: boardInventory(board, scopedIds),
          ...(aiGate.note ? { confidentialityNote: aiGate.note } : {}),
          objects: ((spec) => aiGate.visible.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data, spec), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true }; }))(specBoardOf(board)),
          connections: stage.edges().filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target)).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
        });
      };
      clearComposer();
      // WHO THIS TURN IS FOR. An @-mention names its agents outright, wherever they are on
      // the board; without one, the agents in reach (selected, or wired to Brain) answer.
      // Mentions used to reach only the model: "@Manager @CFO @Counsel" with Counsel
      // selected asked Counsel alone, and Brain wrote the other two's parts for them.
      const mentionedIds = new Set(mentionedBoardAgents(requestText, boardAgents(nodes)).map((agent) => agent.objectId));
      const connectedAgentNodes = mentionedIds.size
        ? nodes.filter((node) => mentionedIds.has(node.id))
        : nodes.filter((node) => node.data.kind === 'agent' && (
          effectiveSelectedIds.includes(node.id)
          || edges.some((edge) => (edge.source === brainId && edge.target === node.id) || (edge.target === brainId && edge.source === node.id))
        )).slice(0, 3);
      setActiveAgentIds(new Set(connectedAgentNodes.map((agent) => agent.id)));
      const confirmCanvasAction = ({ name, args }: { name: string; args: unknown }) => {
        let preview = '';
        try { const serialized = JSON.stringify(args ?? {}); preview = serialized === '{}' ? '' : serialized.length > 320 ? `${serialized.slice(0, 320)}…` : serialized; } catch { preview = ''; }
        return confirm({ title: t('approveAgentActionTitle'), message: `${t('approveAgentActionBody', { action: name.replaceAll('_', ' ') })}${preview ? `\n\n${preview}` : ''}`, confirmLabel: t('approveAgentActionConfirm') });
      };
      const runGroupTurn = async () => {
        // Stop is honoured between every phase of the turn, not only inside the model
        // stream: a run interrupted while the invited agents are replying must not go
        // on to spend a synthesis turn.
        const throwIfStopped = () => { if (runAbort.signal.aborted) throw new CanvasRunAbortedError(); };
        const historicalConversation = canvasTranscriptForModel(timeline);
        const groupConversation = connectedAgentNodes.length
          ? [...historicalConversation, { role: 'user' as const, content: request }]
          : historicalConversation;
        /** Specialist replies actually gathered this turn — what decides whether the
         *  Brain runs as a synthesis or simply answers the request. */
        let contributions = 0;
        const canonicalObjectIds = new Set<string>();
        const canonicalAgents = connectedAgentNodes.flatMap((agent) => {
          // Two ways a card names a REAL agent: a canonical `agent:<id>` resource, or the
          // `ide_agents.id` a seated built-in teammate carries (`cmo-t14`, see
          // provisionBuiltinAgents / seatTeammate). The second was not read, so on a
          // signed-in board an @CMO fell through to the local-drafts branch below — a
          // full browser tool loop per seat, each free to build, then a synthesis that
          // could not see what they had built. Measured (session bf886fc1): the same
          // app provisioned twice, every competitor card twice, four-minute turns. An
          // @-addressed agent executes in ITS runtime, which is this path.
          const ref = agent.data.resourceId?.match(/^agent:(.+)$/)?.[1]
            ?? (agent.data.builtinAgent === true && typeof agent.data.agentRef === 'string' && agent.data.agentRef.trim()
              ? agent.data.agentRef.trim()
              : undefined);
          if (ref) canonicalObjectIds.add(agent.id);
          return ref ? [{ ref, name: agent.data.title || 'Specialist agent', role: typeof agent.data.role === 'string' ? agent.data.role : undefined }] : [];
        });
        if (persistence === 'server' && canonicalAgents.length) {
          try {
            const existingChatId = nodes.find((node) => node.data.kind === 'chat')?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
            const projectId = canvasProjectNodes(nodes).map((node) => canvasProjectId(node.data))[0] ?? null;
            const groupTurn = await runCanonicalCanvasGroupTurn({
              chatId: existingChatId ? Number(existingChatId) : null,
              title, projectId,
              sessionId, prompt: request, agents: canonicalAgents,
            });
            throwIfStopped();
            setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, resourceId: `chat:${groupTurn.chatId}`, status: 'Canonical group chat' } } : node));
            for (const { agent, message } of groupTurn.contributions) {
              appendTimeline('assistant', message.content, {
                scope: resolvedScopeMode, objectIds: [...scopedNodeIds],
                authoredBy: { kind: 'agent', ref: agent.ref, name: agent.name },
              }, `${requestMessageId}:agent:${agent.ref}`);
              groupConversation.push({ role: 'assistant', content: `${agent.name}: ${message.content}` });
              contributions += 1;
              setActiveAgentIds((current) => {
                const next = new Set(current);
                const canvasAgent = connectedAgentNodes.find((candidate) => candidate.data.resourceId === `agent:${agent.ref}` || candidate.data.agentRef === agent.ref);
                if (canvasAgent) next.delete(canvasAgent.id);
                return next;
              });
            }
          } catch (error) {
            // A stopped run is the user's decision, not a group-turn failure.
            if (isCanvasRunAborted(error)) throw error;
            const detail = describeTurnError(error, 'noticeAgentGroupFailed');
            appendTimeline('system', t('noticeAgentGroupTurnFailed', { reason: detail }), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:agent-group-error`);
          }
        }
        // AGENTS WITH NO RUNTIME BEHIND THEM still answer, in their own names. On a board
        // that lives only on this device that is every card: guest drafts cannot call the
        // tenant workforce runtime, so each is a local persona with the canvas tools, and
        // is never presented as a canonical agent. On a signed-in board it is the cards the
        // canonical turn above could not reach, and those answer TALK-ONLY, with no canvas
        // tools. They used to be skipped outright, because a full tool loop per card had an
        // "invited specialist" building the user's app before Brain did; but a skipped
        // card left an @-addressed agent with no reply, and Brain wrote one for it.
        const draftAgentNodes = persistence === 'server'
          ? connectedAgentNodes.filter((node) => !canonicalObjectIds.has(node.id))
          : connectedAgentNodes;
        if (draftAgentNodes.length) {
          for (const agent of draftAgentNodes) {
            const name = agent.data.title || 'Draft specialist';
            const ref = agent.id;
            try {
              const contribution = await runCreationCanvasAi({
                prompt: 'Contribute a specialist perspective to the latest request.', canvasSnapshot: turnSnapshot(stage.nodes()),
                guestTurnId: requestMessageId,
                guestTurnInput: request,
                persistence, canvasActions: persistence === 'server' ? [] : canvasActions, notices: canvasNotices, routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
                autoApprove: autoApplyRef.current, confirmAction: confirmCanvasAction,
                disabledModels: brainRuntime.current.disabledModels,
                onCompletion: recordBrainCompletion, onModelDisabled: disableBrainModel,
                onModelFallback: (model) => setModelSelection({ mode: 'model', model }),
                participant: { ref, name, instructions: typeof agent.data.instructions === 'string' ? agent.data.instructions : agent.data.subtitle },
                conversation: groupConversation,
                signal: runAbort.signal,
              });
              if (contribution.trim()) {
                appendTimeline('assistant', contribution.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'agent', ref, name } }, `${requestMessageId}:draft-agent:${agent.id}`);
                groupConversation.push({ role: 'assistant', content: `${name}: ${contribution.trim()}` });
                contributions += 1;
              }
            } catch (error) {
              // Brain synthesis still runs with the available transcript — unless the
              // user stopped the turn, which ends every remaining specialist too.
              if (isCanvasRunAborted(error)) throw error;
            }
            finally {
              setActiveAgentIds((current) => {
                const next = new Set(current);
                next.delete(agent.id);
                return next;
              });
            }
          }
        }
        throwIfStopped();
        return runCreationCanvasAi({
          // A synthesis only when there is something to synthesize. Agents that were
          // connected but produced nothing (no runtime, or a failed group turn) leave the
          // Brain answering the request itself, against the transcript it actually has.
          prompt: contributions > 0
            ? `The invited agents have each replied above, under their own names. Complete the user's requested outcome from what they said: resolve disagreements and make the final Canvas changes. Do not repeat or rewrite their replies, and never speak for an agent who did not reply. End with a short summary: one line per agent with their key point, then what was actually created.`
            : request,
          // The board as it is NOW — after the invited agents' work landed on it — not
          // as it was when the turn began. See `turnSnapshot`.
          canvasSnapshot: turnSnapshot(stage.nodes()), persistence, canvasActions, notices: canvasNotices,
          guestTurnId: requestMessageId,
          guestTurnInput: request,
          // The session's mode + the project the ticket would be filed against, so a
          // WORK turn has somewhere to put the work it creates.
          mode: sessionMode,
          projectId: evermindProjectId,
          ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
          routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
          autoApprove: autoApplyRef.current, confirmAction: confirmCanvasAction,
          disabledModels: brainRuntime.current.disabledModels,
          onCompletion: recordBrainCompletion, onModelDisabled: disableBrainModel,
          onModelFallback: (model) => setModelSelection({ mode: 'model', model }),
          onUnanswered: (outcome) => { turnUnanswered.current = outcome; },
          // The canvas runner takes recall + learn only, and deliberately NOT the
          // memory-first answer tier the conversational Brain uses: a canvas turn is a
          // COMMAND ("add a node", "lay these out"), and replaying a stored answer for
          // one would return prose where an artifact was asked for. Recall still
          // grounds it; contribution still happens.
          ...(persistence === 'server' && memoryEnabled && evermindProjectId != null ? { evermind: {
            // The Brain's one server-backed recall (same route, same contract, never throws).
            recall: projectMemoryHooks(evermindProjectId, apiRequest).recall,
            learn: (answer: string, question: string) => teachProjectEvermindFromText(evermindProjectId, answer, question),
          } } : {}),
          onTrace: (event) => {
            // Every tool and MCP call, as it happens. The trace already existed
            // for display; journalling it is what puts the CALLS beside the
            // timings and the user's actions in one ordered record.
            //
            // A FAILURE JOURNALS ITS REASON. This recorded `detail: 'error'` and
            // nothing else, while the reason sat right there in `event.result` —
            // and `brainTrace` is cleared at the start of every turn, so a
            // failure from an earlier turn became permanently unexplainable.
            // A real diagnostics report came in reading `canvas_read_snapshot
            // FAILED — error` twice with no way to find out why. The word
            // "error" is the one thing the reader already knows from `ok:false`.
            journal.current.record({
              kind: 'tool', label: event.label, at: event.ts,
              durationMs: event.durationMs ?? 0,
              ...(event.isError === true ? { ok: false } : {}),
              detail: event.isError === true
                ? safeTraceJson(event.result) || event.category
                : event.category,
            });
            if (event.category === 'tool' && event.label) turnToolCalls.current.add(event.label);
            setBrainTrace((current) => [...current, event]);
          },
          conversation: contributions > 0 ? groupConversation : historicalConversation,
          signal: runAbort.signal,
        });
      };
      // The turn, start to finish — including the SCOPE it ran against, which is
      // the fact that explained the reported "I don't see that file" answer and
      // which nothing was recording.
      const turnDone = journal.current.begin(
        'turn', 'brain.turn',
        `scope=${resolvedScopeMode} (${scopedNodes.length}/${nodes.length} objects) · ${request.slice(0, 80)}`,
      );
      void runGroupTurn().then((answer) => {
        // A run the user stopped has no result to record. `stopCanvasRun` already
        // unwound the UI and wrote the "you stopped this" line; a late answer from a
        // request that was already in flight must not overwrite it.
        if (runAbort.signal.aborted) return;
        if (canvasRunRef.current?.abort === runAbort) canvasRunRef.current = null;
        // A runtime notice ("I couldn't prepare any canvas changes…") is NOT something
        // Brain said, and writing it into the transcript as an assistant reply is what
        // let one failed turn become the template for the next: the following request
        // carried it as an example answer and a free model reproduced it verbatim.
        // Recorded as a failed turn instead — visible to the user, invisible to the model.
        const unanswered = turnUnanswered.current;
        turnUnanswered.current = null;
        // A turn that ran at all means the allowance is no longer spent (a new day,
        // or they took the account) — retire the conversion CTA the refusal armed.
        setGuestLimit(null);
        const changes = stage.drain();
        const changedKinds = new Set(changes.flatMap((change) => {
          if (change.type === 'object.add') return [change.node.data.kind];
          if ('objectId' in change) {
            const target = nodes.find((node) => node.id === change.objectId)
              ?? changes.find((candidate): candidate is Extract<ProposedCanvasChange, { type: 'object.add' }> => candidate.type === 'object.add' && candidate.node.id === change.objectId)?.node;
            return target ? [target.data.kind] : [];
          }
          return [];
        }));
        const executiveContractSatisfied = !executiveWorkflow || executiveWorkflow.outputs.some((kind) => changedKinds.has(kind as CreationObjectKind));
        turnDone({ ok: executiveContractSatisfied, detail: `${changes.length} proposed change(s)${executiveUseCase ? ` · ${executiveUseCase.id} ${executiveContractSatisfied ? 'complete' : 'incomplete'}` : ''}` });
        const shouldAutoApply = changes.length > 0 && (autoApplyRef.current || canvasChangesCanAutoApply(changes));
        if (answer.trim() && unanswered) {
          appendTimeline('system', answer.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:unanswered`);
          setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, subtitle: request, aiResponse: answer.trim() } } : node));
        } else if (answer.trim()) {
          appendTimeline('assistant', answer.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'brain', ref: 'brain', name: 'Brain' }, ...lastTurnProvenance() }, `${requestMessageId}:assistant`);
          setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, subtitle: request, aiResponse: answer.trim() } } : node));
          const promptTargets = effectiveSelectedIds.filter((id) => id !== brainId && nodes.some((node) => node.id === id && node.data.kind !== 'chat'));
          if (promptTargets.length) setEdges((current) => associateBrainWithArtifacts(current, brainId, promptTargets));
        }
        if (!executiveContractSatisfied && executiveUseCase && executiveWorkflow) {
          appendTimeline('system', `${executiveUseCase.label} is incomplete: the run did not successfully create or update an allowed ${executiveWorkflow.outputs.join(' or ')} Canvas object.`, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:use-case-incomplete`);
        }
        if (changes.length) {
          setProposedChanges(changes);
          setAcceptedProposalIds(new Set(changes.map((change) => change.id)));
          // Basic, non-destructive canvas output (including authored visual/image
          // objects and the response attached to them) applies immediately. A
          // user should not have to approve the ordinary result of their own
          // prompt, and on mobile the review surface may not be visible yet.
          setAutoApplyPending(shouldAutoApply);
        }
        setThinking(false);
        setActiveAgentIds(new Set());
        setNotice(!executiveContractSatisfied && executiveUseCase
          ? `${executiveUseCase.label} did not produce its required Canvas artifact.`
          : changes.length ? t(shouldAutoApply ? 'noticeApplyingBrainChanges' : 'noticeBrainChangesAwaitReview', { count: changes.length }) : t('noticeBrainFinished'));
        trackActivity('creation_ai_evaluation_completed', { sessionId, metadata: { clientSurface: canvasSurface(), proposedChangeCount: changes.length, objectKinds: [...new Set(nodes.map((node) => node.data.kind))], ...(executiveUseCase ? { useCaseId: executiveUseCase.id, contractSatisfied: executiveContractSatisfied } : {}) } });
        if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: executiveContractSatisfied ? 'succeeded' : 'failed', actorType: 'brain', durationMs: performance.now() - promptStartedAt, metricKey: 'artifacts_proposed', metricValue: changes.length, unit: 'count', metadata: executiveUseCase ? { useCaseId: executiveUseCase.id, contractSatisfied: executiveContractSatisfied, allowedOutputs: executiveWorkflow?.outputs } : undefined }).catch(() => undefined);
      }).catch((error) => {
        if (isCanvasRunAborted(error) || runAbort.signal.aborted) {
          // Stop is not a failure. The journal still closes the turn (an open span
          // would make the next diagnostics report unreadable), and the transcript
          // entry was written by `stopCanvasRun` at the moment the user asked.
          turnDone({ ok: false, detail: 'stopped by user' });
          if (canvasRunRef.current?.abort === runAbort) canvasRunRef.current = null;
          return;
        }
        if (canvasRunRef.current?.abort === runAbort) canvasRunRef.current = null;
        const detail = describeTurnError(error, 'noticeBrainFailed');
        turnDone({ ok: false, detail });
        appendTimeline('system', detail, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:error`);
        setThinking(false);
        setActiveAgentIds(new Set());
        setNotice(detail);
        if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'failed', actorType: 'brain', durationMs: performance.now() - promptStartedAt, metadata: executiveUseCase ? { useCaseId: executiveUseCase.id, contractSatisfied: false } : undefined }).catch(() => undefined);
      });
      return;
    }
    window.setTimeout(() => {
      const request = requestText.toLowerCase();
      if (/\b(?:course|training|lms|academy|learn)\b/.test(request) && /\b(?:llm|language model)\b/.test(request)) {
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const course: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 420, y: 180 }, data: { kind: 'course', title: t('runtimeObject.llmCourse'), status: t('runtimeObject.status.readyToLearn'), subtitle: t('runtimeObject.llmCourseSubtitle'), course: buildLlmCourse(canvasText, locale) } };
        const lab: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1020, y: 230 }, data: { ...createDefaultCreationData('code'), title: t('runtimeObject.llmLab'), status: t('runtimeObject.status.practiceWorkspace'), language: 'python', code: '# Build your tokenizer, model, and training loop here\n' } };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [course, lab])]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: course.id, target: lab.id, type: 'smoothstep', label: 'practice', animated: true, data: { connectionKind: 'reference' } }], brain?.id || '', [course.id], 'Created with Brain'));
        setSelectedId(course.id); openNodeInspector(course.id); setThinking(false); clearComposer(); setNotice(t('noticeLlmCourseAdded')); return;
      }
      if (request.includes('roadmap')) {
        const project = nodes.find((node) => node.data.kind === 'project');
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const roadmap: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'roadmap', title: request.includes('executive') ? t('runtimeObject.executiveRoadmap') : t('runtimeObject.salesRoadmap'), status: t('runtimeObject.status.aiGenerated') } };
        const slides: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 315 }, data: { kind: 'slides', title: request.includes('executive') ? t('runtimeObject.executiveSlides') : t('runtimeObject.salesSlides'), status: t('runtimeObject.status.aiGenerated') } };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [roadmap, slides])]);
        setEdges((current) => associateBrainWithArtifacts([...current, ...(project ? [{ id: crypto.randomUUID(), source: project.id, target: roadmap.id, type: 'smoothstep' as const }] : []), { id: crypto.randomUUID(), source: roadmap.id, target: slides.id, type: 'smoothstep', label: 'presents', animated: true }], brain?.id || '', [roadmap.id], 'Created with Brain'));
        setSelectedId(roadmap.id); openNodeInspector(roadmap.id); setThinking(false); clearComposer(); setNotice(t('noticeRoadmapAdded')); return;
      }
      if (request.includes('top 10') || request.includes('requested features')) {
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const summary: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 500, y: 260 }, data: { kind: 'featureSummary', title: t('runtimeObject.featureSummary'), status: t('runtimeObject.status.synthesized') } };
        const mockupItems = (['onboarding', 'analytics', 'approvals', 'voice', 'dashboards', 'handoffs', 'mobileReview', 'audit', 'templates', 'collaboration'] as const)
          .map((key) => t(`runtimeObject.mockupItem.${key}`));
        const mockups: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 300 }, data: { kind: 'mockupSet', title: t('runtimeObject.featureMockups'), status: t('runtimeObject.status.readyForReview'), subtitle: t('runtimeObject.featureMockupsSubtitle'), items: mockupItems, sources: [{ label: t('runtimeObject.feedbackEvidence'), resource: '/api/feedback' }] } };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [summary, mockups])]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: summary.id, target: mockups.id, type: 'smoothstep', animated: true }], brain?.id || '', [summary.id], 'Created with Brain'));
        setSelectedId(mockups.id); openNodeInspector(mockups.id); setThinking(false); clearComposer(); setNotice(t('noticeFeatureSummaryAdded')); return;
      }
      const evaluationId = crypto.randomUUID();
      setNodes((current) => [...current, ...placeAppendedRef.current(current, [{ id: evaluationId, type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'evaluation', title: t('runtimeObject.evaluation'), status: t('runtimeObject.status.aiEvaluation') } }])]);
      const workflow = nodes.find((node) => node.data.kind === 'workflow');
      const website = nodes.find((node) => node.data.kind === 'website');
      const brain = nodes.find((node) => node.data.kind === 'chat');
      setEdges((current) => associateBrainWithArtifacts([...current, ...[workflow, website].filter((node): node is CreationFlowNode => !!node).map((node) => ({ id: crypto.randomUUID(), source: node.id, target: evaluationId, type: 'smoothstep', animated: true }))], brain?.id || '', [evaluationId], 'Created with Brain'));
      setSelectedId(evaluationId);
      openNodeInspector(evaluationId);
      setThinking(false);
      clearComposer();
      setNotice(t('noticeEvaluationAdded'));
    }, 850);
  }, [appendTimeline, canvasActions, canvasNotices, canvasText, confirm, currentUserId, locale, describeTurnError, disableBrainModel, effectiveSelectedIds, edges, evermindProjectId, lastTurnProvenance, members, memoryEnabled, modelSelection, nodes, openNodeInspector, persistence, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setEdges, setNodes, setNotice, stage, t, thinking, timeline, title]);

  useEffect(() => {
    if (!hydrated.current || modelComparisonStarted.current || comparisonModelIds.length < 2) return;
    const initial = timeline.find((message) => message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'));
    if (!initial?.body.trim()) return;
    const completed = nodes.filter((node) => node.data.comparisonPrompt === initial.body && node.data.comparisonState === 'completed');
    if (comparisonModelIds.every((model) => completed.some((node) => node.data.comparisonModel === model))) {
      modelComparisonStarted.current = true;
      return;
    }

    modelComparisonStarted.current = true;
    initialPromptSubmitted.current = true;
    const promptId = `comparison-prompt:${sessionId}`;
    const resultIds = new Map(comparisonModelIds.map((model, index) => [model, `comparison-result:${index}:${sessionId}`]));
    const promptNode: CreationFlowNode = {
      id: promptId,
      type: 'creation',
      position: { x: 100, y: 180 },
      data: {
        kind: 'chat',
        title: t('comparison.promptTitle'),
        subtitle: initial.body,
        status: t('comparison.sharedPrompt'),
        comparisonPrompt: initial.body,
      },
    };
    const resultNodes: CreationFlowNode[] = comparisonModelIds.map((model, index) => ({
      id: resultIds.get(model)!,
      type: 'creation',
      position: { x: 620, y: 60 + index * 280 },
      data: {
        kind: 'document',
        title: model,
        subtitle: t('comparison.responseFrom', { model }),
        status: t('comparison.executing'),
        model,
        comparisonModel: model,
        comparisonPrompt: initial.body,
        comparisonState: 'running',
        markdown: t('comparison.executingWith', { model }),
      },
    }));
    setNodes([promptNode, ...resultNodes]);
    setEdges(comparisonModelIds.map((model) => ({
      id: `comparison-edge:${resultIds.get(model)}`,
      source: promptId,
      target: resultIds.get(model)!,
      type: 'smoothstep',
      label: t('comparison.executesWith', { model }),
      animated: true,
    })));
    setNotice(t('comparison.runningCount', { count: comparisonModelIds.length }));

    void Promise.all(comparisonModelIds.map(async (model) => {
      try {
        const output = await executeModelComparison({ prompt: initial.body, model, persistence });
        setNodes((current) => current.map((node) => node.id === resultIds.get(model) ? {
          ...node,
          data: {
            ...node.data,
            status: t('comparison.completed'),
            comparisonState: 'completed',
            markdown: output || t('comparison.emptyOutput'),
          },
        } : node));
      } catch (error) {
        setNodes((current) => current.map((node) => node.id === resultIds.get(model) ? {
          ...node,
          data: {
            ...node.data,
            status: t('comparison.failed'),
            comparisonState: 'failed',
            markdown: describeTurnError(error, 'noticeBrainFailed'),
          },
        } : node));
      }
    })).then(() => {
      setNotice(t('comparison.finished'));
    });
  }, [comparisonModelIds, describeTurnError, nodes, persistence, sessionId, setEdges, setNodes, t, timeline]);

  useEffect(() => {
    if (comparisonModelIds.length >= 2) return;
    if (!hydrated.current || initialPromptSubmitted.current || thinking) return;
    const initial = timeline.find((message) => message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'));
    if (!initial || timeline.some((message) => message.messageRole === 'assistant')) return;
    initialPromptSubmitted.current = true;
    setPrompt(initial.body);
    evaluateCanvas(initial.body);
  }, [comparisonModelIds.length, thinking, timeline, evaluateCanvas]);

  useEffect(() => {
    const request = initialPrompt?.trim();
    if (!request || !hydrated.current || initialPromptSubmitted.current || thinking) return;
    if (initialFocusId && selectedId !== initialFocusId) return;
    initialPromptSubmitted.current = true;
    setPrompt(request);
    evaluateCanvas(request);
  }, [evaluateCanvas, initialFocusId, initialPrompt, selectedId, thinking]);

  const applyProposedChanges = useCallback(async () => {
    const selected = proposedChanges.filter((change) => acceptedProposalIds.has(change.id));
    const additions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add');
    const updates = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.update' }> => change.type === 'object.update');
    const deletions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.delete' }> => change.type === 'object.delete');
    const layouts = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.layout' }> => change.type === 'object.layout');
    const actions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.action' }> => change.type === 'object.action');
    const connectionAdditions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.add' }> => change.type === 'connection.add');
    const connectionUpdates = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.update' }> => change.type === 'connection.update');
    const connectionDeletions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.delete' }> => change.type === 'connection.delete');
    const deletedObjectIds = new Set(deletions.map((change) => change.objectId));
    const deletedConnectionIds = new Set(connectionDeletions.map((change) => change.connectionId));
    let materializedAdditions = additions;
    const canonicalPrds = additions.filter((change) => change.node.data.kind === 'prd' && change.node.data.canonicalPrdPending === true);
    if (canonicalPrds.length) {
      setNotice(t('noticeSavingPrd'));
      try {
        materializedAdditions = await Promise.all(additions.map(async (change) => {
          if (!canonicalPrds.includes(change)) return change;
          return { ...change, node: await persistCanonicalProjectPrd(change.node) };
        }));
      } catch (error) {
        setNotice(error instanceof Error ? t('noticePrdNotSavedReason', { reason: error.message }) : t('noticePrdNotSaved'));
        return;
      }
    }
    setNodes((current) => {
      const next = [...current, ...materializedAdditions.map((change) => change.node)];
      return next
        .filter((node) => !deletedObjectIds.has(node.id))
        .map((node) => updates.reduce((value, change) => value.id === change.objectId ? { ...value, data: { ...value.data, ...change.patch } } : value, node))
        .map((node) => layouts.reduce((value, change) => {
          if (value.id !== change.objectId) return value;
          const locked = change.locked ?? value.data.placementLocked === true;
          return {
            ...value,
            ...(change.position ? { position: change.position } : {}),
            ...(change.hidden != null ? { hidden: change.hidden } : {}),
            ...canvasPlacementFlags(locked),
            style: { ...value.style, ...(change.width != null ? { width: change.width } : {}), ...(change.height != null ? { height: change.height } : {}) },
            data: { ...value.data, ...(change.hidden != null ? { placementHidden: change.hidden } : {}), ...(change.locked != null ? { placementLocked: change.locked } : {}) },
          };
        }, node));
    });
    setEdges((current) => {
      const reviewed = [...current, ...connectionAdditions.map((change) => change.edge)]
        .filter((edge) => !deletedConnectionIds.has(edge.id) && !deletedObjectIds.has(edge.source) && !deletedObjectIds.has(edge.target))
        .map((edge) => connectionUpdates.reduce((value, change) => value.id === change.connectionId ? { ...value, ...(change.patch.label != null ? { label: change.patch.label } : {}), data: { ...value.data, ...(change.patch.kind ? { connectionKind: change.patch.kind } : {}) } } : value, edge));
      const brain = nodes.find((node) => node.data.kind === 'chat');
      const changedArtifactIds = [...materializedAdditions.map((change) => change.node.id), ...updates.map((change) => change.objectId), ...layouts.map((change) => change.objectId), ...actions.map((change) => change.objectId)];
      return brain && changedArtifactIds.length ? associateBrainWithArtifacts(reviewed, brain.id, changedArtifactIds, 'Changed with Brain') : reviewed;
    });
    // `selectionWithinBoard`, in the same change as the deletion.
    //
    // This used to clear the multi-selection only when the SINGLE `selectedId`
    // happened to be one of the deleted objects, and not at all when the proposal
    // also added something — so a turn that deleted one of three selected cards
    // left `selectedIds` naming an object the board no longer held, and a turn
    // that added and deleted left every stale id in place. The invariant says
    // "in the same change, not on the next render", which is what makes this a
    // filter here rather than an effect that tidies up afterwards.
    if (deletedObjectIds.size) setSelectedIds((current) => selectionWithinBoard(current, nodes.filter((node) => !deletedObjectIds.has(node.id))));
    if (materializedAdditions.length) setSelectedId(materializedAdditions[materializedAdditions.length - 1]!.node.id);
    else if (selectedId && deletedObjectIds.has(selectedId)) { setSelectedId(null); setSelectedIds([]); }
    // A 3D creation stands in the ROOM — that is where it is walked round and opened
    // from — and a room design IS the room, so a turn that made either takes the
    // reader there, on every device.
    if (materializedAdditions.some((change) => leadsToRoom(change.node.data.kind))) setSurface('room');
    if (layoutViewportRef.current().narrow && materializedAdditions.length) {
      const brainId = nodes.find((node) => node.data.kind === 'chat')?.id;
      const focusIds = [brainId, ...materializedAdditions.map((change) => change.node.id)].filter((id): id is string => !!id);
      window.setTimeout(() => {
        void flowRef.current?.fitView({ nodes: focusIds.map((id) => ({ id })), padding: .18, minZoom: .62, maxZoom: .9, duration: 350 });
      }, 0);
    }
    if (actions.length) setPendingBrainActions((current) => [...current, ...actions.filter((change) => !deletedObjectIds.has(change.objectId)).map(({ objectId, action }) => ({ objectId, action }))]);
    setProposedChanges([]);
    setAcceptedProposalIds(new Set());
    setNotice(canonicalPrds.length ? `${canonicalPrds.length} project PRD${canonicalPrds.length === 1 ? '' : 's'} saved and ${selected.length} reviewed Brain changes applied` : `${selected.length} reviewed Brain changes applied`);
    trackActivity('creation_change_set_applied', { sessionId, metadata: { clientSurface: canvasSurface(), commandCount: selected.length } });
  }, [acceptedProposalIds, nodes, proposedChanges, selectedId, sessionId, setEdges, setNodes, setSurface]);

  useEffect(() => {
    if (!autoApplyPending || !proposedChanges.length || acceptedProposalIds.size !== proposedChanges.length) return;
    setAutoApplyPending(false);
    void applyProposedChanges();
  }, [acceptedProposalIds.size, applyProposedChanges, autoApplyPending, proposedChanges.length]);

  const applyAndEnableAutoApply = useCallback(() => {
    setAutoApplyMode(true);
    void applyProposedChanges();
  }, [applyProposedChanges, setAutoApplyMode]);

  const rejectProposedChanges = useCallback(() => {
    setProposedChanges([]);
    setAcceptedProposalIds(new Set());
    stage.reset();
    setAutoApplyPending(false);
    setNotice(t('noticeChangesRejected'));
  }, [setNotice, stage, t]);

  /** Resolve which workflow node an action applies to: the one named, else the
   *  selection, else the only one on the board. Shared by build and run. */
  const resolveWorkflowNode = useCallback(
    // A FRAME that holds a built flow is as runnable as a legacy `workflow` card: the
    // definition id lives on whichever object stands for the flow, and since the board
    // became the workflow that object is the section that bounds it.
    //
    // The predicate itself lives in `canvasFlowTarget.ts` because the SESSION ACTION has
    // to ask the same question — Run must be offered for exactly the objects Run can act
    // on, and two copies of "is this a flow" is how a button gets shown for one object
    // and then runs another.
    (workflowId?: string) => resolveCanvasFlowNode(nodes, { preferredId: workflowId, selected: selectedNode }),
    [nodes, selectedNode],
  );

  /**
   * THE BOARD, COMPILED — turn the steps inside a frame into a real definition.
   *
   * This is what "the canvas is the workflow" cashes out to. There is no separate
   * document being edited somewhere else and no modal to open: the objects on the
   * board ARE the graph, the connections between them ARE the edges, and the outlet
   * an arm was drawn from IS the label the executor prunes on.
   *
   * The FRAME is the unit, because a board holds more than one flow and a section is
   * how a person says which steps belong together. Running with no frame at all draws
   * one round the steps first — the alternative is either refusing (a board full of
   * steps that will not run) or compiling every step on the board into one graph (a
   * flow nobody authored).
   *
   * All-or-nothing on issues, for the reason a compiler always refuses an
   * underspecified step: a graph that runs, reports success and does nothing that was
   * asked for is worse than one that will not build. Each unbuildable step SAYS what
   * it needs, on the card, so the board is the error report too.
   */
  /**
   * THE CHILD CANVASES THIS BOARD RUNS.
   *
   * A `subflow` step nests another canvas, and the compiler is synchronous — so the
   * boards it may need have to be in memory before a build starts. The hook watches
   * which canvases the board references and loads them; an unresolved one becomes a
   * refusal naming the canvas, never a step left silently out of the graph.
   */
  const subflowSessionIds = useMemo(
    () => subflowSessionIdsOn(nodes.map((node) => ({ data: node.data as unknown as Record<string, unknown> }))),
    [nodes],
  );
  const resolveSubflow = useSubflowBoards(subflowSessionIds, canvasSessionGateway);

  const buildFlowFromFrame = useCallback(async (frameId: string): Promise<string | null> => {
    if (persistence === 'local') {
      requireAccount('workflow', t('buildWorkflowGateTitle'), t('buildWorkflowGate'));
      return null;
    }
    const board = nodesRef.current;
    const frame = board.find((node) => node.id === frameId);
    if (!frame) return null;
    const memberIds = new Set(framedBoardRef.current.memberIdsOf(frameId));
    const objects = board
      .filter((node) => memberIds.has(node.id))
      .map((node) => ({ id: node.id, position: node.position, data: node.data as unknown as Record<string, unknown> }));
    const connections = edgesRef.current
      .filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target))
      .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null }));

    // `stack` starts at THIS canvas so a board nesting itself is refused as the
    // cycle it is, rather than recursing once before noticing.
    const { definition, issues, compiledCount } = compileBoardFlow(objects, connections, { resolveSubflow, stack: [sessionId] });
    if (issues.length > 0) {
      const explain = (issue: (typeof issues)[number]) => t(`flowIssue.${issue.messageKey}` as 'flowIssue.noSteps', issue.values ?? {});
      const blocked = new Map(issues.filter((issue) => issue.objectId).map((issue) => [issue.objectId, explain(issue)]));
      setNodes((current) => current.map((node) => blocked.has(node.id)
        ? { ...node, data: { ...node.data, status: t('flowStep.needsSetup'), flowStepIssue: blocked.get(node.id) } }
        : node));
      setNotice(explain(issues[0]!));
      updateNodeData(frameId, { status: t('flowStep.needsSetup') });
      return null;
    }
    // A step that WAS blocked and is now fine must stop saying so — a stale error on a
    // card is indistinguishable from a live one.
    setNodes((current) => current.map((node) => (memberIds.has(node.id) && node.data.flowStepIssue
      ? { ...node, data: { ...node.data, flowStepIssue: undefined, status: '' } }
      : node)));

    const projectId = canvasProjectNodes(board).map((node) => canvasProjectId(node.data))[0] ?? null;
    const name = frame.data.title || t('flowStep.untitledFlow');
    const linked = flowDefinitionIdOf(frame.data as unknown as Record<string, unknown>) ?? '';
    try {
      // The section's own two controls travel WITH the graph, exactly as the legacy
      // card's did: a section reading "Approval required" that compiled to a definition
      // with no gate would run unapproved (see migration 1092), and one with no run
      // target saves as built and refuses at run time. `builderforce` is the default
      // because a canvas flow runs on the hosted cloud runtime unless somebody says
      // otherwise, and the canvas offers no host picker to say it with.
      const runTarget = typeof frame.data.runTarget === 'string' && frame.data.runTarget ? frame.data.runTarget : 'builderforce';
      const approvalMode = frame.data.approvalMode === 'required' || frame.data.approvalMode === 'autonomous'
        ? (frame.data.approvalMode as WorkflowApprovalMode)
        : undefined;
      const saved = linked
        ? await workflowDefinitions.update(linked, { name, definition, runTarget, ...(approvalMode ? { approvalMode } : {}) })
        : await workflowDefinitions.create({ name, definition, runTarget, ...(approvalMode ? { approvalMode } : {}), ...(projectId != null ? { projectId } : {}) });
      updateNodeData(frameId, {
        resourceId: flowDefinitionRef(saved.id),
        resourceSubtype: 'definition',
        workflowExecutable: true,
        workflowStepCount: compiledCount,
        status: t('flowStep.built'),
      });
      setNotice(t('noticeWorkflowBuilt', { count: compiledCount }));
      return saved.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('noticeWorkflowNotRunnable');
      updateNodeData(frameId, { status: t('flowStep.needsSetup') });
      setNotice(message);
      return null;
    }
  }, [persistence, requireAccount, resolveSubflow, sessionId, setNodes, setNotice, t, updateNodeData]);

  /**
   * Build the flow the person is looking at, drawing the section first if there is none.
   *
   * A frame is the unit a flow is built from, and requiring one before anything can run
   * would make the first flow somebody draws fail for a reason that is about bookkeeping
   * rather than about their work. So the steps get a frame round them — which is what
   * they meant — and then it builds.
   */
  const buildFlow = useCallback((nodeId?: string): Promise<string | null> => {
    const board = nodesRef.current;
    const target = nodeId ? board.find((node) => node.id === nodeId) : null;
    if (target?.data.kind === 'frame') return buildFlowFromFrame(target.id);
    const steps = board.filter((node) => node.data.kind === 'flowStep');
    if (steps.length === 0) { setNotice(t('flowIssue.noSteps')); return Promise.resolve(null); }
    const rect = boundingRect(steps.map((node) => ({
      id: node.id, kind: node.data.kind, position: node.position, size: canvasNodeDimensions(node), data: node.data as unknown as Record<string, unknown>,
    })), 60);
    const frame = newNode('frame', { x: rect.x, y: rect.y });
    frame.style = { width: rect.width, height: rect.height };
    frame.zIndex = -1;
    frame.data = { ...frame.data, title: t('flowStep.untitledFlow'), framePurpose: t('flowStep.framePurpose') };
    setNodes((current) => [frame, ...current]);
    setNotice(t('flowStep.framedForBuild'));
    // The frame has to exist on the board before its membership can be read — the
    // containment is geometric, and geometry is what the next render establishes.
    return new Promise((resolve) => { window.setTimeout(() => { void buildFlowFromFrame(frame.id).then(resolve); }, 0); });
  }, [buildFlowFromFrame, setNodes, setNotice, t]);

  /**
   * The section whose steps are being run IN THE BROWSER, and the graph they compile to.
   *
   * Evermind BUILD steps do not run in the cloud at all — they run here, on this
   * device's GPU, through `lib/evermindBuild.ts`. That runner had exactly one door, a
   * panel inside the standalone workflow builder, and it moved with the capability
   * rather than being deleted alongside the shell that used to host it.
   */
  const [evermindBuild, setEvermindBuild] = useState<{ name: string; projectId: number | null; graph: WorkflowDefinitionGraph } | null>(null);

  const openEvermindBuild = useCallback((frameId: string) => {
    const board = nodesRef.current;
    const frame = board.find((node) => node.id === frameId);
    if (!frame) return;
    const memberIds = new Set(framedBoardRef.current.memberIdsOf(frameId));
    const { definition, issues } = compileBoardFlow(
      board.filter((node) => memberIds.has(node.id)).map((node) => ({ id: node.id, position: node.position, data: node.data as unknown as Record<string, unknown> })),
      edgesRef.current
        .filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target))
        .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null })),
      { resolveSubflow, stack: [sessionId] },
    );
    // The in-browser runner compiles the graph itself, so an unbuildable step has to be
    // reported the same way the cloud path reports it rather than reaching the engine.
    if (issues.length > 0) { setNotice(t(`flowIssue.${issues[0]!.messageKey}` as 'flowIssue.noSteps', issues[0]!.values ?? {})); return; }
    const projectId = canvasProjectNodes(board).map((node) => canvasProjectId(node.data))[0] ?? null;
    setEvermindBuild({ name: frame.data.title || t('flowStep.untitledFlow'), projectId, graph: definition });
  }, [resolveSubflow, sessionId, setNotice, t]);

  /**
   * Lay a starting Evermind pipeline out inside a frame.
   *
   * Eight steps nobody wants to place by hand, wired in the order the engine runs them,
   * dropped INSIDE the section that will build them — which is what makes the frame the
   * unit of a flow rather than a decoration around one.
   */
  const loadEvermindTemplate = useCallback((frameId: string, templateId: 'train-llm' | 'teach-code') => {
    const frame = nodesRef.current.find((node) => node.id === frameId);
    if (!frame) return;
    setNotice(t('flowStep.opening'));
    void loadTemplateGraph(templateId).then((graph) => {
      const unpacked = boardFlowFromDefinition(graph, { x: frame.position.x + 40, y: frame.position.y + 60 });
      const idByRef = new Map<string, string>();
      const stepNodes = unpacked.steps.map((step) => {
        const node = newNode('flowStep', step.position);
        idByRef.set(step.ref, node.id);
        node.data = { ...node.data, ...step.data } as CreationNodeData;
        return node;
      });
      setNodes((current) => current.map((node) => (node.id === frameId
        // The section grows to hold what was just put in it — containment is geometric,
        // so a frame that did not cover its own pipeline would not own it.
        ? { ...node, style: { ...node.style, width: Math.max(Number(node.style?.width) || 0, unpacked.frame.size.width + 80), height: Math.max(Number(node.style?.height) || 0, unpacked.frame.size.height + 80) } }
        : node)).concat(stepNodes));
      setEdges((current) => [
        ...current,
        ...unpacked.connections.flatMap((connection) => {
          const source = idByRef.get(connection.sourceRef);
          const dest = idByRef.get(connection.targetRef);
          return source && dest ? [{ id: crypto.randomUUID(), source, target: dest, type: connectionKind }] : [];
        }),
      ]);
      setNotice(t('flowStep.opened', { count: stepNodes.length }));
    }).catch((error: Error) => setNotice(errorText(error)));
  }, [connectionKind, setEdges, setNodes, setNotice, t, errorText]);

  /**
   * OPEN A LEGACY WORKFLOW CARD ON THE BOARD — the migration path for every workflow
   * authored before the canvas WAS the workflow.
   *
   * The card is REPLACED by the section it was standing in for: a frame holding one
   * `flowStep` object per step, wired the way the flow was wired, with a labeled edge
   * reattached to the outlet its label names. Replaced rather than kept beside it,
   * because a card and the steps it stands for both on the board is two editable copies
   * of one graph, and the one that would be saved is whichever was touched last.
   *
   * ── TWO SOURCES, ONE PLACEMENT ───────────────────────────────────────────────
   * A card either points at a SAVED definition (it was built once) or carries an
   * AUTHORED step list that never was. Both lower to the same board section —
   * `boardFlowFromDefinition` for the saved graph, `flowStepsFromCanvasSteps` for the
   * authored list — so the placement below is written once. That authored list used to
   * be lowered SERVER-side by `POST /api/workflow-definitions/from-canvas`: a SECOND
   * compiler, for a card whose only editor was a modal that no longer exists, producing
   * a definition nobody could then open or change. Opening is the only thing that
   * happens to a legacy card now, and the board's compiler is the only one.
   *
   * The definition id moves to the frame when there is one, so Build and Run keep
   * pointing at the same row and this is an OPEN rather than a fork.
   */
  const unpackWorkflow = useCallback((workflowId?: string) => {
    const target = resolveWorkflowNode(workflowId);
    if (!target || target.data.kind !== 'workflow') { setNotice(t('noticeNeedWorkflow')); return; }
    const targetId = target.id;
    /**
     * Draw the section this card stood for, and delete the card.
     *
     * `runTarget` and `approvalMode` travel WITH it. They used to be dropped here, so a
     * card reading "Approval required" unpacked into a section that compiled to a
     * definition with NO gate and ran unapproved — the failure migration 1092 exists to
     * prevent. The frame declares the same two controls the card does (see
     * `canvasKindSettings.simple.ts`), so carrying them across is a copy of one value,
     * not a translation between two vocabularies.
     */
    const placeFlow = (unpacked: UnpackedFlow, title: string, definitionId: string) => {
      const frame = newNode('frame', unpacked.frame.position);
      frame.style = { width: unpacked.frame.size.width, height: unpacked.frame.size.height };
      frame.zIndex = -1;
      frame.data = {
        ...frame.data,
        title,
        framePurpose: t('flowStep.framePurpose'),
        ...(typeof target.data.runTarget === 'string' && target.data.runTarget ? { runTarget: target.data.runTarget } : {}),
        ...(target.data.approvalMode === 'required' || target.data.approvalMode === 'autonomous'
          ? { approvalMode: target.data.approvalMode }
          : {}),
        ...(definitionId
          ? { resourceId: `workflow:${definitionId}`, resourceSubtype: 'definition', workflowExecutable: true }
          : {}),
      };
      const idByRef = new Map<string, string>();
      const stepNodes = unpacked.steps.map((step) => {
        const node = newNode('flowStep', step.position);
        idByRef.set(step.ref, node.id);
        node.data = { ...node.data, ...step.data } as CreationNodeData;
        return node;
      });
      setNodes((current) => [frame, ...current.filter((node) => node.id !== targetId), ...stepNodes]);
      setEdges((current) => [
        ...current.filter((edge) => edge.source !== targetId && edge.target !== targetId),
        ...unpacked.connections.flatMap((connection) => {
          const source = idByRef.get(connection.sourceRef);
          const dest = idByRef.get(connection.targetRef);
          return source && dest ? [{
            id: crypto.randomUUID(),
            source,
            target: dest,
            type: connectionKind,
            ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
            ...(connection.label ? { label: connection.label } : {}),
          }] : [];
        }),
      ]);
      setSelectedId(frame.id); setSelectedIds([frame.id]);
      setNotice(t('flowStep.opened', { count: stepNodes.length }));
    };

    const definitionId = typeof target.data.resourceId === 'string' && target.data.resourceId.startsWith('workflow:')
      ? target.data.resourceId.slice('workflow:'.length)
      : '';
    if (definitionId) {
      setNotice(t('flowStep.opening'));
      void workflowDefinitions.get(definitionId)
        .then((detail) => placeFlow(boardFlowFromDefinition(detail.definition, target.position), detail.name, detail.id))
        .catch((error: Error) => setNotice(errorText(error)));
      return;
    }
    // Never built, so there is no saved graph and the authored list IS the flow. A step
    // that names no action becomes one that SAYS what it still needs, on the board,
    // rather than being refused — refusing would strand the intention in JSON that no
    // surface can edit, which is the failure this whole change is about.
    const authored = Array.isArray(target.data.steps) ? target.data.steps : [];
    if (authored.length === 0) { setNotice(t('flowStep.nothingToOpen')); return; }
    placeFlow(
      flowStepsFromCanvasSteps(authored, target.position, {
        untitledStep: (position: number) => t('flowStep.untitledStep', { position }),
      }),
      target.data.title || t('flowStep.untitledFlow'),
      '',
    );
  }, [connectionKind, resolveWorkflowNode, setEdges, setNodes, setNotice, t, errorText]);

  /**
   * BUILD WHAT IS DRAWN — and there is exactly one thing that compiles a canvas.
   *
   * A frame's steps ARE the definition, so a frame is dispatched to the board compiler.
   * Dispatched HERE rather than at each call site so Run, the section's own Build and
   * Brain's `canvas_build_workflow` all reach the same one.
   *
   * A legacy `workflow` card has no build path of its own any more. Its authored list
   * was lowered by a second compiler on the server for a card whose only editor was a
   * modal that no longer exists, so building one minted a definition that nobody could
   * subsequently open or change. It is OPENED onto the board first, and from there it is
   * an ordinary section that this compiler builds like any other.
   */
  const compileWorkflow = useCallback(async (workflowId?: string): Promise<string | null> => {
    const target = resolveWorkflowNode(workflowId);
    if (!target) { setNotice(t('noticeNeedWorkflow')); return null; }
    if (target.data.kind === 'frame') return buildFlowFromFrame(target.id);
    setNotice(t('flowStep.openToBuild'));
    return null;
  }, [buildFlowFromFrame, resolveWorkflowNode, setNotice, t]);

  const runWorkflow = useCallback((workflowId?: string) => {
    if (!canRun) { setNotice(t('noticeNeedRunnerAccess')); return; }
    const target = resolveWorkflowNode(workflowId);
    if (!target) { setNotice(t('noticeNeedWorkflow')); return; }
    const targetId = target.id;
    // A run record is a past execution, not something that can be run again.
    if (persistence === 'server' && target.data.workflowExecutable === false) {
      setNotice(t('noticeWorkflowRunRecord'));
      return;
    }
    // A draft that has never been built has nothing to run. It is BUILT first —
    // and if it cannot be built, the run stops here with the reasons on the card.
    // The old code instead waited 1400ms and wrote a `delivered` deliverable with
    // `validation: passed`, so a workflow that had never executed anything
    // reported "Complete". Nothing here may report success it did not observe.
    const linkedId = target.data.resourceId?.startsWith('workflow:') ? target.data.resourceId.slice('workflow:'.length) : '';
    void (async () => {
      const definitionId = linkedId || await compileWorkflow(targetId);
      if (!definitionId) return;
      const started: CreationDeliverable = { id: crypto.randomUUID(), action: 'run', artifactKind: 'workflow-run', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-workflows' };
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', deliverables: withCreationDeliverable(node.data, started) } } : node));
      setNotice(t('noticeStartingWorkflow'));
      await workflowDefinitions.get(definitionId).then((definition) => {
        if (!definition.runTargetRuntime) throw new Error('Choose a run target in the Workflow inspector before running it');
        return workflowDefinitions.run(definitionId, {
          runtime: definition.runTargetRuntime,
          agentHostId: definition.runTargetAgentHostId,
          cloudAgentRef: definition.runTargetCloudAgentRef,
        });
      }).then((run) => {
        // A definition whose card says "Approval required" answers with a real
        // pending approval INSTEAD of a run. The card says exactly that. The
        // regression this file's comment above describes — a 1400ms timer writing
        // `delivered` + `validation: passed` for a workflow that never executed —
        // is the same lie a "Running" card would tell here, so the deliverable
        // records `not_run` and nothing polls for a run that was never started.
        if (run.status === 'pending') {
          const awaiting: CreationDeliverable = { ...started, resourceRef: `approval:${run.approvalId}`, validation: { status: 'not_run', detail: run.reason } };
          setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Awaiting approval', workflowApprovalId: run.approvalId, deliverables: withCreationDeliverable(node.data, awaiting) } } : node));
          setNotice(run.reason);
          return;
        }
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: run.workflowId, workflowTaskCount: run.taskCount, deliverables: withCreationDeliverable(node.data, { ...started, resourceRef: `workflow-run:${run.workflowId}`, metadata: { taskCount: run.taskCount } }) } } : node));
        setNotice(t('noticeWorkflowStarted', { count: run.taskCount }));
        const pollRun = (remaining: number) => {
          if (remaining <= 0) return;
          window.setTimeout(() => {
            void workflowDefinitions.runs(definitionId).then((runs) => {
              const currentRun = runs.find((candidate) => candidate.id === run.workflowId);
              if (!currentRun) { pollRun(remaining - 1); return; }
              const normalized = currentRun.status.toLowerCase();
              const terminal = ['completed', 'complete', 'failed', 'cancelled', 'canceled'].includes(normalized);
              const label = normalized === 'completed' || normalized === 'complete' ? 'Complete' : normalized === 'failed' ? 'Run failed' : normalized === 'cancelled' || normalized === 'canceled' ? 'Cancelled' : currentRun.status;
              setNodes((nodesNow) => nodesNow.map((node) => {
                if (node.id !== targetId) return node;
                const terminalDeliverable: CreationDeliverable | null = terminal ? { ...started, status: normalized === 'completed' || normalized === 'complete' ? 'delivered' : 'failed', completedAt: currentRun.completedAt || new Date().toISOString(), resourceRef: `workflow-run:${run.workflowId}`, validation: { status: normalized === 'completed' || normalized === 'complete' ? 'passed' : 'failed', detail: `Workflow ${currentRun.status}` }, metadata: { taskCount: run.taskCount }, ...(!(normalized === 'completed' || normalized === 'complete') ? { error: `Workflow ${currentRun.status}` } : {}) } : null;
                return { ...node, data: { ...node.data, status: label, workflowRunStatus: currentRun.status, workflowCompletedAt: currentRun.completedAt, ...(terminalDeliverable ? { deliverables: withCreationDeliverable(node.data, terminalDeliverable) } : {}) } };
              }));
              if (terminal) setNotice(t('noticeWorkflowStatus', { status: label.toLowerCase() }));
              else pollRun(remaining - 1);
            }).catch(() => pollRun(remaining - 1));
          }, 2_000);
        };
        pollRun(30);
      }).catch((error) => {
        const message = errorText(error);
        const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Run failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        setNotice(message);
      });
    })();
  }, [canRun, compileWorkflow, errorText, persistence, resolveWorkflowNode, setNodes, t]);

  const saveAgent = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'agent') return;
    const ref = selectedNode.data.resourceId?.startsWith('agent:') ? selectedNode.data.resourceId.slice('agent:'.length) : '';
    if (!ref && persistence === 'local') { requireAccount('agent', t('saveCollaborator'), t('saveCollaboratorGate')); return; }
    const personality = typeof selectedNode.data.personality === 'string' ? selectedNode.data.personality.trim() : '';
    const direction = typeof selectedNode.data.instructions === 'string' ? selectedNode.data.instructions.trim() : selectedNode.data.subtitle || '';
    const bio = [personality, direction].filter(Boolean).join('\n\n');
    const baseModel = selectedNode.data.model && selectedNode.data.model !== 'auto' ? String(selectedNode.data.model) : undefined;
    const input = { name: selectedNode.data.title, title: selectedNode.data.role || selectedNode.data.title, bio, skills: Array.isArray(selectedNode.data.tools) ? selectedNode.data.tools.map(String) : undefined, baseModel };
    setNotice(ref ? t('savingAgentSettings') : t('creatingWorkforceAgent'));
    void (ref ? updateAgent(ref, input) : createCloudAgent(input))
      .then((saved) => {
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, resourceId: `agent:${saved.id}`, status: 'Configured' } } : node));
        setNotice(ref ? t('agentSettingsSaved') : t('agentCreatedReady'));
      })
      .catch((error) => setNotice(faultText(error, t('agentSettingsSaveFailed'))));
  }, [persistence, requireAccount, selectedNode, setNodes, t]);

  /**
   * Open the ship-to-device panel for a game object.
   *
   * Guarded here rather than inside the panel so the two things that make it
   * impossible are said in the canvas's own voice: a guest session has no
   * project to write files into, and a game with no connected project has
   * nowhere to publish to. The panel itself stays a pure view of a project.
   */
  const openGamePanel = useCallback((gameId: string) => {
    const target = nodes.find((node) => node.id === gameId && node.data.kind === 'game');
    if (!target) { setNotice(t('game.selectFirst')); return; }
    if (persistence !== 'server') {
      requireAccount('publish', t('game.accountTitle'), t('game.accountBody'));
      return;
    }
    setGameShipFocus(gameId);
  }, [nodes, persistence, requireAccount, t]);

  /**
   * Open the sell-it panel for one object, or for the whole board.
   *
   * Guarded here for the same reason `openGamePanel` is: a guest session has
   * nothing on a server to publish FROM, and the honest place to say so is the
   * canvas rather than a panel that would open onto an error. The panel itself
   * stays a pure view of a saved session.
   */
  const openPublishPanel = useCallback((nodeId?: string) => {
    if (persistence !== 'server' || !sessionId) {
      requireAccount('publish', t('publish.accountTitle'), t('publish.accountBody'));
      return;
    }
    setPublishFocus(nodeId ?? '');
  }, [persistence, requireAccount, sessionId, t]);

  /**
   * Build → Stage → Live for one card.
   *
   * Gated on the same account requirement as publishing, and for the same reason:
   * a release is a snapshot in the object registry, and a board saved only to this
   * device has nowhere to keep one.
   */
  const openReleasesPanel = useCallback((nodeId?: string) => {
    if (persistence !== 'server' || !sessionId) {
      requireAccount('publish', t('publish.accountTitle'), t('publish.accountBody'));
      return;
    }
    setReleaseFocus(nodeId ?? '');
  }, [persistence, requireAccount, sessionId, t]);

  /** The project a game ships into, and the game as it stands right now. */
  const gamePanelTarget = useMemo(() => {
    const target = gameShipFocus ? nodes.find((node) => node.id === gameShipFocus) : null;
    if (!target) return null;
    const connectedProject = connectedCanvasProjectNode(nodes, edges, target.id);
    return {
      projectId: connectedProject ? canvasProjectId(connectedProject.data) : null,
      game: gamePayloadFrom(target.data),
    };
  }, [edges, gameShipFocus, nodes]);

  /** The publish itself, once the target project is known. Split from
   *  `publishWebsite` so provisioning a project on demand does not fork the
   *  delivery/outcome bookkeeping into a second copy. */
  const publishWebsiteTo = useCallback((target: CreationFlowNode, projectId: number) => {
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'publish', artifactKind: 'website', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-sites', resourceRef: `project:${projectId}` };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publishing…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'started', artifactId: target.id, projectId: Number(projectId) }).catch(() => undefined);
    const subdomain = typeof target.data.subdomain === 'string' ? target.data.subdomain : undefined;
    return publishSite(projectId, buildWebsiteAssets(target.data), subdomain).then((site) => {
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), url: site.url, pathUrl: site.pathUrl, mimeType: 'text/html', resourceRef: `site:${site.subdomain}`, validation: { status: 'passed', detail: `${site.assetCount} assets published (${site.totalBytes} bytes)` }, metadata: { versionToken: site.versionToken, assetCount: site.assetCount, totalBytes: site.totalBytes } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Published', url: site.url, siteUrl: site.url, pathUrl: site.pathUrl, subdomain: site.subdomain, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      setNotice(t('noticeWebsitePublished', { url: site.url }));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'succeeded', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { url: site.url, versionToken: site.versionToken } }).catch(() => undefined);
    }).catch((error) => {
      const message = errorText(error);
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'failed', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [errorText, sessionId, setNodes, t]);

  /**
   * The canonical project an object acts against, PROVISIONING one when the board
   * has none yet.
   *
   * Brain authors a Website end to end and never creates a Project object, so
   * Publish used to dead-end on `noticeConnectWebsite` — naming a connection the
   * user had no way to know they needed, on the flagship Idea→Real demo. Publishing
   * is precisely the moment a board earns a real tenant project, so one is created
   * here and placed on the board as a canonical `project` object wired to the source,
   * which means every LATER action (including the second publish) resolves it through
   * `connectedCanvasProjectNode` the ordinary way and no second project is created.
   * Callers gate on `persistence === 'server'` first: an anonymous canvas has no
   * tenant to provision into.
   */
  const ensureCanvasProject = useCallback(async (sourceId: string, name: string): Promise<number> => {
    const connected = connectedCanvasProjectNode(nodes, edges, sourceId);
    const connectedId = connected ? canvasProjectId(connected.data) : null;
    if (connectedId != null) return connectedId;
    const source = nodes.find((node) => node.id === sourceId);
    // THE BOARD MAY ALREADY BE A PROJECT. "Make this a project" writes the identity
    // link and claims the address — so a board that had just been converted looked
    // project-less here and the very next publish provisioned a SECOND project and
    // shipped the site to an address the creator never chose. The link is READ
    // (cached, and invalidated by the conversion itself) rather than inferred from
    // what happens to be drawn on the board.
    //
    // NO CARD IS DRAWN on this branch: conversion places the project card server-side
    // (`placeCanvasObject`) and this board adopts it live. Drawing a second one here
    // would race that adoption for the same resource.
    const appProject = await embeddedAppsApi.sessionAppState(sessionId)
      .then((state) => state.app)
      .catch(() => null);
    if (appProject) return appProject.projectId;
    const project = await createProject({ name: name.trim().slice(0, 120) || 'Untitled project', origin: 'canvas' });
    // Left of the object it serves, so the edge reads container → thing, and far
    // enough out that the two cards do not overlap on a fresh board.
    const node = newNode('project', source ? { x: source.position.x - 380, y: source.position.y } : { x: 200, y: 200 });
    node.data = { ...node.data, ...canvasProjectPatch(project) };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setEdges((current) => addEdge({ id: crypto.randomUUID(), source: node.id, target: sourceId, type: connectionKind }, current));
    return project.id;
  }, [connectionKind, edges, nodes, sessionId, setEdges, setNodes]);

  const publishWebsite = useCallback((websiteId?: string) => {
    const target = nodes.find((node) => node.id === websiteId && node.data.kind === 'website')
      ?? (selectedNode?.data.kind === 'website' ? selectedNode : nodes.find((node) => node.data.kind === 'website'));
    if (!target) { setNotice(t('noticeNeedWebsite')); return; }
    if (persistence !== 'server') { requireAccount('publish', 'Create an account to publish', 'Save this session to publish the Website as a live Builderforce site.'); return; }
    setNotice(t('noticePublishingWebsite'));
    void ensureCanvasProject(target.id, target.data.title)
      .then((projectId) => publishWebsiteTo(target, projectId))
      .catch((error) => {
        const message = error instanceof Error ? error.message : t('noticeWebsiteProjectFailed');
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed' } } : node));
        setNotice(message);
      });
  }, [ensureCanvasProject, nodes, persistence, publishWebsiteTo, requireAccount, selectedNode, setNodes, t]);

  /**
   * Open a Builder object's workspace on the board, creating its backing legacy
   * build record first when the object is not bound yet. Creation goes through
   * the existing `/api/ide-projects` compatibility route, so the workspace is
   * seeded with its modality's starter template and opens runnable — the
   * in-browser website/app builder, on the canvas.
   */
  const openBuild = useCallback((buildId?: string) => {
    const target = nodes.find((node) => node.id === buildId && node.data.kind === 'build')
      ?? (selectedNode?.data.kind === 'build' ? selectedNode : nodes.find((node) => node.data.kind === 'build'));
    if (!target) { setNotice(t('build.selectFirst')); return; }
    const bound = canvasBuildBinding(target.data);
    if (bound) { setBuildFocus({ nodeId: target.id, storageProjectId: bound.storageProjectId }); return; }
    if (persistence !== 'server') { requireAccount('open', t('build.gateTitle'), t('build.gateDescription')); return; }
    if (creatingBuild) return;
    setCreatingBuild(true);
    setNotice(t('build.creating'));
    const container = connectedCanvasProjectNode(nodes, edges, target.id);
    void createCanvasBuild({
      title: target.data.title,
      modality: canvasBuildModality(target.data),
      containerProjectId: container ? canvasProjectId(container.data) : null,
    })
      .then((ide) => {
        const patch = canvasBuildPatch(ide);
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, ...patch } } : node));
        setBuildFocus({ nodeId: target.id, storageProjectId: ide.storageProjectId });
        setNotice(t('build.created'));
      })
      .catch((error) => setNotice(faultText(error, t('build.createFailed'))))
      .finally(() => setCreatingBuild(false));
  }, [creatingBuild, edges, nodes, persistence, requireAccount, selectedNode, setNodes, t]);

  /** Bind a Builder object to a legacy build record that already exists, instead of
   *  provisioning a second workspace for work that is already under way. */
  const attachBuild = useCallback((nodeId: string, ide: IdeProject) => {
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...canvasBuildPatch(ide) } } : node));
    setBuildFocus({ nodeId, storageProjectId: ide.storageProjectId });
    setNotice(t('build.attached'));
  }, [setNodes, t]);

  /**
   * Delete the build record a Builder object provisioned, and return the object to
   * its unbound state. Removing the OBJECT deliberately leaves the workspace alone
   * — a build record is a first-class child of a Project and outlives the session
   * that spawned it — so this is the explicit way to discard the files too.
   */
  const deleteBuildWorkspace = useCallback(async (nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    const binding = target ? canvasBuildBinding(target.data) : null;
    if (!target || !binding) return;
    if (!(await confirm({ message: t('build.deleteConfirm', { title: target.data.title }), destructive: true }))) return;
    try {
      await deleteIdeProject(binding.ideProjectId);
      setBuildFocus((current) => current?.nodeId === nodeId ? null : current);
      setNodes((current) => current.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, resourceId: undefined, ideProjectId: undefined, storageProjectId: undefined, storageProjectPublicId: undefined, siteUrl: undefined, url: undefined, pathUrl: undefined, status: 'Not created' } }
        : node));
      setNotice(t('build.workspaceDeleted'));
    } catch (error) {
      setNotice(faultText(error, t('build.deleteWorkspaceFailed')));
    }
  }, [confirm, nodes, setNodes, t]);

  /**
   * Grow an authored Website object into a real codebase: add a Builder object
   * beside it, connect the two, and open the workspace. The static site stays
   * publishable while the code project takes over — no object loses its contract.
   */
  const buildWebsiteWithCode = useCallback((websiteId: string) => {
    const source = nodes.find((node) => node.id === websiteId);
    if (!source) return;
    const existing = nodes.find((node) => node.data.kind === 'build'
      && edges.some((edge) => (edge.source === websiteId && edge.target === node.id) || (edge.target === websiteId && edge.source === node.id)));
    if (existing) { openBuild(existing.id); return; }
    const build = newNode('build', nextCanvasObjectPosition(nodes, { x: source.position.x + 520, y: source.position.y }, layoutViewportRef.current(), 'build'));
    build.data = { ...build.data, title: source.data.title, modality: canvasBuildModality(source.data) };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [build])]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: websiteId, target: build.id, type: 'smoothstep', label: t('build.edgeLabel'), data: { connectionKind: 'delivery' } }]);
    setSelectedId(build.id);
    setSelectedIds([build.id]);
    setNotice(t('build.addedFromWebsite'));
  }, [edges, nodes, openBuild, setEdges, setNodes, t]);

  const generateVideo = useCallback((videoId?: string) => {
    const target = nodes.find((node) => node.id === videoId && node.data.kind === 'video')
      ?? (selectedNode?.data.kind === 'video' ? selectedNode : nodes.find((node) => node.data.kind === 'video'));
    if (!target) { setNotice(t('noticeNeedVideo')); return; }
    if (persistence !== 'server') { requireAccount('generate', 'Create an account to generate video', 'Save this session to run a published Evermind video model.'); return; }
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'generate', artifactKind: 'video', status: 'running', createdAt: new Date().toISOString(), provider: 'evermind' };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generating…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice(t('noticeGeneratingVideo'));
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'started', artifactId: target.id }).catch(() => undefined);
    void listEvermindModels().then((models) => {
      const configured = typeof target.data.modelSlug === 'string' ? target.data.modelSlug : typeof target.data.model === 'string' ? target.data.model : '';
      const model = models.find((candidate) => candidate.slug === configured || candidate.name === configured) ?? models[0];
      if (!model) throw new Error('Publish an Evermind video model before generating this deliverable');
      return generateEvermindMedia(model.slug, { prompt: typeof target.data.prompt === 'string' ? target.data.prompt : target.data.content as string | undefined, maxFrames: typeof target.data.maxFrames === 'number' ? target.data.maxFrames : 16 }).then((media) => ({ media, model }));
    }).then(({ media, model }) => {
      const previewUrl = media.frames[0] ? mediaFrameDataUrl(media.frames[0], media.width, media.height, media.channels) : null;
      const aiFrameDuration = 1 / Math.min(12, Math.max(1, media.frameCount));
      const aiSources: CanvasVideoSource[] = media.frames.flatMap((frame, index) => {
        const url = mediaFrameDataUrl(frame, media.width, media.height, media.channels);
        return url ? [{
          id: crypto.randomUUID(),
          kind: 'image' as const,
          captureKind: 'ai' as const,
          url,
          fileName: `${target.data.title}-${index + 1}.png`,
          mimeType: 'image/png',
          durationSeconds: aiFrameDuration,
          width: media.width,
          height: media.height,
        }] : [];
      });
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), mimeType: media.modality === 'video' ? 'application/x-builderforce-video-frames' : 'image/png', resourceRef: media.model, validation: { status: media.frameCount > 0 ? 'passed' : 'failed', detail: `${media.frameCount} ${media.width}×${media.height} frames generated` }, metadata: { modelSlug: model.slug, frameCount: media.frameCount, width: media.width, height: media.height, channels: media.channels, usage: media.usage } };
      setNodes((current) => current.map((node) => {
        if (node.id !== target.id) return node;
        const priorSources = canvasVideoSourcesFrom(node.data.videoSources);
        const nextTimeline = aiSources.reduce((value, source) => appendCanvasVideoSource(value, source, 'visual'), canvasVideoTimelineFrom(node.data.videoTimeline));
        return { ...node, data: { ...node.data, status: 'Generated · Editable', modelSlug: model.slug, frameCount: media.frameCount, videoWidth: media.width, videoHeight: media.height, generatedFrames: media.frames, videoSources: [...priorSources, ...aiSources], videoTimeline: nextTimeline, duration: canvasVideoDuration(nextTimeline), ...(previewUrl ? { videoUrl: previewUrl } : {}), deliverables: withCreationDeliverable(node.data, delivered) } };
      }));
      setNotice(t('noticeVideoGenerated', { frames: media.frameCount, model: model.name }));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'succeeded', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { model: model.slug, frameCount: media.frameCount } }).catch(() => undefined);
    }).catch((error) => {
      const message = errorText(error);
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generation failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'failed', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [errorText, nodes, persistence, requireAccount, selectedNode, sessionId, setNodes]);

  const runCreativeAction = useCallback((objectId?: string, action = 'generate') => {
    const target = nodes.find((node) => node.id === objectId && CREATIVE_GENERATOR_KINDS.has(node.data.kind))
      ?? (selectedNode && CREATIVE_GENERATOR_KINDS.has(selectedNode.data.kind) ? selectedNode : undefined);
    if (!target) { setNotice(t('creativeSelectFirst')); return; }
    const existingUrl = typeof target.data.outputUrl === 'string' ? target.data.outputUrl : '';
    if ((action === 'preview' || action === 'export') && existingUrl) {
      // A browser refuses to open a `data:` URL in a top-level tab, so both paths
      // go through a navigable URL. It is revoked on a timer rather than at once:
      // revoking it before the new tab has read it is the same blank page.
      const navigable = navigableArtifactUrl(existingUrl);
      if (action === 'preview') window.open(navigable, '_blank', 'noopener,noreferrer');
      else {
        const anchor = document.createElement('a'); anchor.href = navigable;
        anchor.download = typeof target.data.outputFileName === 'string' ? target.data.outputFileName : `${target.data.title}.artifact`;
        anchor.click();
      }
      if (navigable !== existingUrl) window.setTimeout(() => URL.revokeObjectURL(navigable), 60_000);
      setNotice(action === 'preview' ? t('creativePreviewOpened') : t('creativeDownloaded'));
      return;
    }
    /**
     * The generator for this kind, best first.
     *
     * A creative brief has to produce the thing described in it, so the object goes
     * to a real generator: the tenant's own published Evermind model renders the
     * pixels, and the server generator authors the geometry, the game, the resume,
     * the script. The browser baseline stays as the LAST answer, not the only one —
     * it is what a local session, an unavailable model or a failed call falls back
     * to, so a creative object always ends up with a real, portable file.
     */
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const kind = target.data.kind;
    // THE BRAND THIS ARTIFACT ANSWERS TO, resolved once and given to every generator
    // below. Undefined on a board with no `brandKit`, which composes exactly as it did
    // before — see `marketing.ts` for the three resolution rules and why an unresolved
    // binding composes unbranded rather than borrowing the other kit.
    const brand = brandForNode(target, nodes);
    const started: CreationDeliverable = { id: deliveryId, action, artifactKind: kind, status: 'running', createdAt: new Date().toISOString() };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: t('creativeGenerating'), deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice(t('creativeGenerating'));
    if (persistence === 'server') {
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: `creative.${action}`, phase: 'started', artifactId: target.id }).catch(() => undefined);
    }

    const generate = async (): Promise<CreativeArtifact> => {
      if (persistence === 'server' && EVERMIND_CREATIVE_KINDS.has(kind)) {
        const models = await listEvermindModels();
        const configured = typeof target.data.modelSlug === 'string' ? target.data.modelSlug : '';
        const model = models.find((candidate) => candidate.slug === configured || candidate.name === configured) ?? models[0];
        if (!model) throw new Error(t('creativeNoMediaModel'));
        const media = await generateEvermindMedia(model.slug, {
          prompt: creativeBrief(target.data, brand),
          maxFrames: kind === 'animation' ? 24 : 1,
        });
        const rendered = evermindMediaArtifact(target.data, media, model.slug);
        if (!rendered) throw new Error(t('creativeNoFrames'));
        return rendered;
      }
      if (persistence === 'server' && SERVER_CREATIVE_KINDS.has(kind)) return generateServerCreativeArtifact(target.data, brand);
      return { ...buildBrowserCreativeArtifact(target.data, brand), provider: 'builderforce-browser' };
    };

    void generate()
      .then((artifact) => ({ artifact, fellBack: false }))
      // A generator that is unavailable must not leave the object empty: the
      // browser baseline is a real file, and saying which one produced it is the
      // difference between a fallback and a silent downgrade.
      .catch(() => ({ artifact: { ...buildBrowserCreativeArtifact(target.data, brand), provider: 'builderforce-browser' } as CreativeArtifact, fellBack: true }))
      .then(({ artifact, fellBack }) => {
        // ── THE CHECK HALF OF THE BRAND BINDING ────────────────────────────────
        // The directive told the generator what it may not claim. This asks whether it
        // listened. An instruction a model ignored and nothing verified is precisely the
        // on-brand-BY-REVIEW failure the binding exists to replace, so a violated claim
        // fails the deliverable's validation and NAMES the phrase — a warning nobody can
        // act on is the same product with a paper trail.
        const violations = brandViolationsIn([artifact.summary, artifact.fileName, target.data.prompt, target.data.content].join(' '), target, nodes);
        const delivered: CreationDeliverable = {
          ...started, artifactKind: artifact.artifactKind, status: 'delivered', completedAt: new Date().toISOString(),
          url: artifact.url, mimeType: artifact.mimeType, fileName: artifact.fileName, provider: artifact.provider,
          validation: violations.length
            ? { status: 'failed', detail: t('brandClaimViolation', { claims: violations.join('; ') }) }
            : { status: 'passed', detail: artifact.validationDetail },
          metadata: { outputFormat: artifact.outputFormat, capabilityId: target.data.capabilityId, ...(artifact.model ? { model: artifact.model } : {}) },
        };
        // The tile shows the preview the artifact came with, and nothing when it
        // has none — a stale thumbnail from an earlier generation would
        // misdescribe the file that is now attached.
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: {
          ...node.data,
          status: action === 'apply' ? t('creativeApplied') : t('creativeGeneratedStatus'),
          outputUrl: artifact.url,
          outputFormat: artifact.outputFormat,
          outputFileName: artifact.fileName,
          outputMimeType: artifact.mimeType,
          provider: artifact.provider,
          ...(artifact.summary ? { subtitle: artifact.summary } : {}),
          thumbnailUrl: artifact.previewImageUrl ?? '',
          deliverables: withCreationDeliverable(node.data, delivered),
        } } : node));
        setNotice(violations.length
          ? t('brandClaimViolation', { claims: violations.join('; ') })
          : fellBack ? t('creativeGeneratedOffline', { file: artifact.fileName }) : t('creativeGenerated', { file: artifact.fileName }));
        if (persistence === 'server') {
          void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: `creative.${action}`, phase: 'succeeded', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { provider: artifact.provider, outputFormat: artifact.outputFormat } }).catch(() => undefined);
        }
      });
  }, [nodes, persistence, selectedNode, sessionId, setNodes, t]);

  /**
   * The one export path for an authored object. The inspector's buttons, Brain's
   * `export` action, and the Files library all call this, so the file that lands
   * in Downloads, the deliverable recorded on the object, and the row the library
   * lists are produced once and cannot disagree.
   */
  const exportArtifact = useCallback(async (nodeId: string, action: CanvasExportAction): Promise<string> => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return t('exportFailed');
    // THE enforcement point for the export boundary. The button row hides the formats
    // for a restricted card, but the AI tool path and the drag-to-desktop path call this
    // directly with `defaultExportAction`, so the refusal has to live where the bytes are
    // written rather than where the buttons are drawn.
    if (!objectMayCross(target, 'export')) return t('exportRestricted');
    // The second gate, and a different question: confidentiality asks whether this CARD
    // may leave, the use policy asks whether these ROWS may be used this way. A dataset
    // classified as personal data and collected for one purpose does not become
    // exportable because somebody with edit rights clicked Download — the classification
    // has to be able to refuse, or it is documentation rather than governance.
    // `dataUse`, not `usePolicy`: the latter was never in `MUTABLE_FIELDS.dataset` and no
    // tool or importer ever wrote it, so this gate was reading `undefined` on every dataset
    // that has ever existed. See `dataGovernance.ts` for the merge that closed it.
    const useGate = evaluateDatasetUse('export', normalizeClassifications(target.data.classifications), normalizeUsePolicy(target.data.dataUse));
    if (!useGate.allowed) { setNotice(useGate.reason ?? t('exportRestricted')); return useGate.reason ?? t('exportRestricted'); }
    const markdown = canvasObjectMarkdown(target.data);
    const base = safeDownloadName(target.data.title);
    const exportRefusals = {
      noRows: () => new Error(t('noTabularRows')),
      unmasked: (columns: string[]) => new Error(t('exportUnmaskedColumns', { columns: columns.join(', ') })),
    };
    try {
      if (action === 'copy') return await copyTextToClipboard(markdown) ? t('copiedToClipboard') : t('clipboardUnavailable');
      const diagram = canvasDiagram(target.data);
      let fileName = `${base}.${EXPORT_EXTENSION[action as Exclude<CanvasExportAction, 'copy' | 'diagram'>] ?? 'md'}`;
      // Set only when the renderer refuses THIS caller — a guest out of daily
      // downloads. Decided by the attempt, not guessed from the session, because
      // a guest CAN render: the export surface takes a guest token.
      let degraded = false;
      // Set when the PDF was opened in a print dialog rather than downloaded, so
      // the deliverable records the provider that actually produced it.
      let printed = false;

      if (action === 'markdown') downloadText(markdown, fileName, 'text/markdown');
      if (action === 'html') {
        const renderedResume = target.data.kind === 'resume' ? renderedCanvasResume(target.data) : null;
        downloadText(renderedResume ? resumeHtmlFile(target.data.title, renderedResume) : markdownHtmlDocument(target.data.title, markdown), fileName, 'text/html');
      }
      if (action === 'csv') {
        const sheet = exportableSheet(target.data, exportRefusals);
        exportCsv(toCsv(sheet.columns, sheet.rows), fileName);
      }
      if (action === 'diagram') {
        if (!diagram) throw new Error(t('noDiagramSource'));
        // Extension and MIME come from the notation row, never from a guess:
        // a Mermaid diagram downloaded as `.drawio` is a file nothing opens.
        const notation = diagramNotation(diagram.format);
        if (!notation) throw new Error(t('noDiagramSource'));
        fileName = `${base}.${notation.extensions[0]}`;
        downloadText(diagram.source, fileName, notation.mimeType);
      }
      if (action === 'svg') {
        // The drawing that is ON the board, not a second rendering of its source.
        const svg = canvasObjectSvg(target.data, nodeId);
        if (!svg) throw new Error(t('noRenderedDrawing'));
        downloadText(svg, fileName, 'image/svg+xml');
      }
      if (SERVER_RENDERED_ACTIONS.has(action)) {
        const sheet = action === 'xlsx' ? exportableSheet(target.data, exportRefusals) : null;
        try {
          if (action === 'docx') {
            const renderedResume = target.data.kind === 'resume' ? renderedCanvasResume(target.data) : null;
            await exportDocx(markdown, target.data.title, {
              ...(renderedResume ? { theme: {
                accent: renderedResume.template.accent,
                font: renderedResume.template.font,
                density: renderedResume.template.density,
                columns: renderedResume.template.columns,
              } } : {}),
              // A document that arrived as a dropped .docx is EDITED, not
              // regenerated: its own package is reopened and the new body
              // written into it, so the file that comes back keeps the source's
              // theme, numbering and section layout. See exportApi.
              ...(typeof target.data.sourceFileKey === 'string' ? { sourceFileKey: target.data.sourceFileKey } : {}),
            });
          }
          if (action === 'pptx') await exportPptx(markdown, target.data.title);
          if (action === 'xlsx') await exportXlsx(sheet!.columns, sheet!.rows, target.data.title);
        } catch (error) {
          // Only a credential/allowance refusal degrades. A malformed payload or
          // a render fault is a real failure and must surface as one.
          if (!(error instanceof OfficeExportUnavailableError)) throw error;
          degraded = true;
          fileName = `${base}.${action === 'xlsx' ? 'csv' : 'md'}`;
          if (action === 'xlsx') exportCsv(toCsv(sheet!.columns, sheet!.rows), fileName);
          else downloadText(markdown, fileName, 'text/markdown');
        }
      }
      if (action === 'pdf') {
        // A picture or a paged visual layout is DRAWN, so it goes through the
        // browser's print pipeline — that is the only thing that can render what
        // is on the board. A document is WRITTEN, so `/api/exports/pdf` produces
        // the bytes: a print dialog is not an export, because it needs a human at
        // a keyboard and gives each browser a different file.
        if (pdfExportStrategy(target.data.kind) === 'print') {
          if (!printCanvasObject(target.data, canvasObjectSvg(target.data, nodeId))) throw new Error(t('printUnavailable'));
          printed = true;
        } else {
          try {
            await exportPdf(markdown, target.data.title, { footer: target.data.title });
          } catch (error) {
            // Same rule as the Office renderers: only a credential/allowance
            // refusal degrades — and here the degrade is the print pipeline,
            // which still puts a PDF in the visitor's hands.
            if (!(error instanceof OfficeExportUnavailableError)) throw error;
            if (!printCanvasObject(target.data, canvasObjectSvg(target.data, nodeId))) throw new Error(t('printUnavailable'));
            printed = true;
          }
        }
      }
      if (action === 'spec') {
        // The runnable file the whole "write me tests" request was for. A plan
        // exports every case connected to it as ONE spec file, because that is how
        // someone actually takes a suite away — not one download per card.
        const source = canvasSpecSource(target, nodes, edges);
        if (!source) throw new Error(t('noGeneratedSpec'));
        downloadText(source, fileName, EXPORT_MIME.spec);
      }
      if (action === 'json') {
        // A test plan's JSON is its RELEASE EVIDENCE, not a dump of its node data —
        // the exact shape `qa-e2e/src/canvas-release-audit.ts` audits. That is what
        // turns the gate from "whatever someone typed into a file" into the runs and
        // defects that are actually on the board. Every other kind exports itself.
        const evidence = target.data.kind === 'testPlan'
          ? releaseEvidence(
            { title: target.data.title, targetUrl: String(target.data.targetUrl ?? ''), exitCriteria: normalizeExitCriteria(target.data.exitCriteria) },
            releaseGateEvidence(target, nodes, edges),
            new Date().toISOString(),
          )
          : { kind: target.data.kind, title: target.data.title, data: target.data };
        downloadJson(evidence, fileName);
      }
      if (action === 'scorm') downloadBlob(new Blob([buildScormPackage(courseFromNode(target.data), target.data.title)], { type: EXPORT_MIME.scorm }), fileName);

      const delivered: CreationDeliverable = {
        id: crypto.randomUUID(), action: 'export', artifactKind: action, status: 'delivered',
        createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        provider: degraded ? 'browser-office-fallback'
          : printed ? 'browser-print'
          : SERVER_RENDERED_ACTIONS.has(action) || action === 'pdf' ? 'builderforce-office-export'
          : 'browser-download',
        fileName,
        mimeType: action === 'diagram'
          ? (diagram?.format === 'mermaid' ? 'text/vnd.mermaid' : 'application/vnd.jgraph.mxfile')
          : degraded ? (action === 'xlsx' ? EXPORT_MIME.csv : EXPORT_MIME.markdown) : EXPORT_MIME[action],
        validation: { status: 'passed', detail: 'Export generated and download started' },
      };
      setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      if (printed) return t('printOpened');
      // A guest session cannot reach the authenticated Office renderer, so say
      // what actually landed in Downloads and point at the export that DOES work
      // there, rather than reporting a Word file that was never produced.
      return degraded ? (action === 'xlsx' ? t('csvDownloadedSignInForExcel') : t('markdownDownloadedUsePdf')) : t('downloadReady');
    } catch (error) {
      return error instanceof Error ? error.message : t('exportFailed');
    }
  }, [nodes, setNodes, t]);

  /** Every file this session holds, derived from the objects themselves so a new
   * document, deck, diagram, or sheet appears in the library the moment Brain
   * authors it — no separate registration step to forget. */
  const sessionFiles = useMemo(() => canvasFiles(nodes), [nodes]);

  /**
   * Put the reader in front of one object, from wherever they are.
   *
   * Selecting a node, clearing the inspector and flying the viewport to it were three
   * calls spelled out inline by the Files library; the app surface's "open the card"
   * needs the identical four, plus the one the library did not need — HANDING THE BOARD
   * BACK. A surface that has taken the centre is the one place where selecting a node
   * changes nothing you can see, so "reveal" has to include leaving.
   */
  const revealObject = useCallback((nodeId: string) => {
    setSurface('graph');
    setInspectorFocus(null);
    setSelectedId(nodeId);
    setSelectedIds([nodeId]);
    void flowRef.current?.fitView({ nodes: [{ id: nodeId }], padding: .35, maxZoom: 1.1, duration: 320 });
  }, [setSurface]);
  revealObjectRef.current = revealObject;

  /**
   * WHAT THIS BOARD IS, as a walk. Derived from the board's own objects and
   * connections by `canvasWalkthroughStops` — one stop per kind, in dependency
   * order — so the running order is never a hand-maintained list that a new
   * object kind quietly falls out of.
   *
   * Memoised on the board: it is otherwise recomputed on every object edit, and
   * the grouping walks the graph. An empty result means there is nothing worth
   * walking, and that one fact answers BOTH whether the offer appears and whether
   * the command bar draws the button — see the `walkthrough` handler.
   */
  const walkthroughStops = useMemo(
    () => canvasWalkthroughStops(nodes, edges.map((edge) => ({ source: edge.source, target: edge.target }))),
    [edges, nodes],
  );
  const walkthroughRef = useRef<CanvasWalkthroughHandle>(null);

  /** A file the library offers: a delivered artifact opens, an authored object
   * exports through the path above. */
  const downloadCanvasFile = useCallback((file: CanvasFile) => {
    if (file.url) {
      const navigable = navigableArtifactUrl(file.url);
      const anchor = document.createElement('a');
      anchor.href = navigable;
      anchor.download = file.name;
      anchor.click();
      if (navigable !== file.url) window.setTimeout(() => URL.revokeObjectURL(navigable), 60_000);
      setNotice(t('downloadReady'));
      return;
    }
    const target = nodes.find((node) => node.id === file.nodeId);
    if (target) void exportArtifact(file.nodeId, defaultExportAction(target.data.kind)).then(setNotice);
  }, [exportArtifact, nodes, t]);

  /**
   * Evaluate a test plan's exit criteria against the evidence ON THE BOARD.
   *
   * ── WHY THIS IS DERIVED AND NEVER AUTHORED ───────────────────────────────────
   * The Creation Canvas release gate was a hand-edited `canvas-release-evidence.json`
   * whose only real validation was that the `REPLACE_` placeholder had been deleted —
   * so it certified whatever someone typed. The same criteria are worth gating on;
   * what was wrong was where the numbers came from.
   *
   * So `gateVerdict` is absent from `MUTABLE_FIELDS.testPlan` (a model that could
   * write its own verdict could report a release green that nothing ran), and this is
   * its only writer. The evidence itself comes from `releaseGateEvidence`, which the
   * JSON export also reads — one definition of "an open defect", two consumers.
   */
  const evaluateReleaseGate = useCallback((planId: string) => {
    const plan = nodes.find((node) => node.id === planId && node.data.kind === 'testPlan');
    if (!plan) return;
    const evidence = releaseGateEvidence(plan, nodes, edges);
    const connected = new Set(edges.filter((edge) => edge.source === plan.id).map((edge) => edge.target));
    const verdict = planGateVerdict(normalizeExitCriteria(plan.data.exitCriteria), evidence);
    setNodes((current) => current.map((node) => node.id === plan.id
      ? {
        ...node,
        data: {
          ...node.data,
          gateVerdict: verdict,
          passRate: evidence.runs[0]?.passRate ?? null,
          caseCount: nodes.filter((candidate) => candidate.data.kind === 'testCase' && connected.has(candidate.id)).length,
        },
      }
      : node));
    setNotice(t('noticeGateEvaluated', { score: verdict.score }));
  }, [edges, nodes, setNodes, t]);

  /**
   * A CARD ACT — `invoice.issue`, `offer.hire`, `submission.mark`, and seven more.
   *
   * Ten `useCallback`s used to live here, one per act, each repeating the same six
   * steps: find the card by id and kind, refuse without an account, validate its
   * fields, do the work, stamp the result back, say what happened. They are now
   * registry entries owned by the contexts they belong to — finance, hiring,
   * teaching — and this is the ONE place the board is mutated on their behalf.
   *
   * The dispatch below asks `cardActFor` FIRST rather than calling this and
   * checking, because the chain it sits in is synchronous and "did an act answer"
   * has to be known before the next `else if` is considered.
   */
  // The runner itself now lives in `cardActRunner.tsx` and is PUBLISHED to the board
  // rather than held in this closure, so a surface that wants a button for an act reads
  // it from context instead of being handed a callback threaded through the inspector's
  // prop list. This binding is the only thing that stays here: applying an outcome is
  // still the one place the board is mutated on an act's behalf.
  const cardActBoard = useMemo<CardActBoardBinding>(() => ({
    objects: () => nodesRef.current,
    create: newNode,
    setNodes,
    setEdges,
    setNotice,
    persistence,
    t: canvasText,
  }), [persistence, setEdges, setNodes, setNotice, canvasText]);
  const runCardActOnObject = useCardActRunnerFor(cardActBoard);

  /**
   * The poll's four acts, run from the BOARD rather than from the room.
   *
   * The facilitation surface has the same four buttons, and both call the same two
   * endpoints through the same card reading (`pollPublishBody`) — a second reading of
   * what `options` means would be a second poll out of one card, and the one that drifts
   * is the one reached through a model rather than through a person.
   *
   * `publish` ends by OPENING the surface: the next thing that happens after a poll is
   * published is a room being asked to answer it, and leaving the facilitator on the
   * board with an address they cannot read out is the wrong place to stop.
   */
  const runPollAction = useCallback(async (nodeId: string, action: string) => {
    const target = nodesRef.current.find((node) => node.id === nodeId);
    if (!target) return;
    // A poll reaches real people at a public address, which is a tenant resource. A
    // local board has no tenant, so this is the account gate rather than a failure.
    if (persistence !== 'server') { requireAccount('publish', tPoll('accountTitle'), tPoll('accountBody')); return; }
    try {
      if (action === 'publish') {
        const result = await publishPoll(pollPublishBody(target.data, nodeId));
        updateNodeData(nodeId, {
          questionSetId: result.questionSetId,
          joinUrl: pollJoinUrl(result.slug),
          status: tPoll('statusOpen'),
        } as Partial<CreationNodeData>);
        setSurface('facilitate', nodeId);
        setNotice(tPoll('noticePublished'));
        return;
      }
      const questionSetId = typeof target.data.questionSetId === 'string' ? target.data.questionSetId : '';
      if (!questionSetId) { setNotice(tPoll('noticePublishFirst')); return; }
      const next = await setPollState(questionSetId, action === 'open'
        ? { status: 'open' }
        : action === 'close'
          ? { status: 'closed' }
          // `reveal` shows the room the count. Deliberately one-way here: hiding it again
          // is a facilitation move made in front of the room, on the surface, not
          // something a model should be able to do to a screen people are reading.
          : { showResultsLive: true });
      updateNodeData(nodeId, {
        showResultsLive: next.showResultsLive,
        status: next.status === 'open' ? tPoll('statusOpen') : tPoll('statusClosed'),
      } as Partial<CreationNodeData>);
      setNotice(next.status === 'open' ? tPoll('noticeVotingOpen') : tPoll('noticeVotingClosed'));
    } catch (error) {
      setNotice(faultText(error, tPoll('publishFailed')));
    }
  }, [persistence, requireAccount, setSurface, tPoll, updateNodeData]);

  useEffect(() => {
    const pending = pendingBrainActions[0];
    if (!pending) return;
    const target = nodes.find((node) => node.id === pending.objectId);
    if (!target) { setPendingBrainActions((current) => current.slice(1)); return; }
    if (selectedId !== target.id) {
      setSelectedId(target.id);
      setSelectedIds([target.id]);
      return;
    }
    const finish = () => setPendingBrainActions((current) => current.slice(1));
    if (target.data.kind === 'workflow' && pending.action === 'build') void compileWorkflow(target.id);
    else if (target.data.kind === 'workflow' && pending.action === 'run') runWorkflow(target.id);
    else if (target.data.kind === 'website' && pending.action === 'publish') publishWebsite(target.id);
    else if (target.data.kind === 'build' && pending.action === 'open') openBuild(target.id);
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
    finish();
  }, [compareProjects, compileWorkflow, convertObjectToDiagram, deliverMockup, evaluateEvermind, evaluateReleaseGate, expandMockupSet, expandProject, exportArtifact, generateVideo, nodes, openBuild, openEvermindTraining, pendingBrainActions, plotDataset, profileDataset, publishWebsite, runCardActOnObject, runCreativeAction, runPollAction, runWorkflow, selectedId, setEdges, setNodes, setNotice, startStandup, t, visualizeDataset]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    // A LOCAL board has a history too, now. It used to be told to sign in — on the one
    // surface where an agent is most likely to have just rewritten half the board.
    if (persistence !== 'server') { setLocalCheckpoints(localCheckpointSummaries(sessionId)); return; }
    void creationSessionsApi.history.list(sessionId).then((result) => setHistory(result.snapshots))
      .catch((error) => setNotice(faultText(error, t('noticeLoadHistoryFailed'))));
  }, [persistence, sessionId]);

  const restoreLocalCheckpoint = useCallback((checkpointId: string) => {
    if (!canEdit) return;
    const checkpoint = readLocalCheckpoint(sessionId, checkpointId);
    // A checkpoint can genuinely vanish — another tab trimmed the stack under the quota
    // rule — so this reports rather than throwing on a null the panel just listed.
    if (!checkpoint) { setNotice(t('noticeRestoreRevisionFailed')); setLocalCheckpoints(localCheckpointSummaries(sessionId)); return; }
    setNodes(checkpoint.nodes);
    setEdges(checkpoint.edges);
    setHistoryOpen(false);
    setNotice(t('noticeCheckpointRestored', { label: checkpoint.label }));
  }, [canEdit, sessionId, setEdges, setNodes, t]);

  const restoreRevision = useCallback((targetRevision: number) => {
    if (!canEdit || persistence !== 'server') return;
    setNotice(t('noticeRestoringRevision', { revision: targetRevision }));
    void creationSessionsApi.history.get(sessionId, targetRevision).then((snapshot) => {
      const restored = flowFromSnapshotGraph(snapshot.graph);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setHistoryOpen(false);
      setNotice(t('noticeRevisionRestored', { revision: targetRevision }));
    }).catch((error) => setNotice(faultText(error, t('noticeRestoreRevisionFailed'))));
  }, [canEdit, persistence, sessionId, setEdges, setNodes]);

  /**
   * Name a checkpoint.
   *
   * The name comes from an INPUT IN THE PANEL rather than from `window.prompt`, which is
   * what this was. Two things were wrong with the prompt and only one of them is style:
   * it was a native dialog on a product whose own convention forbids them, and its label
   * was the hardcoded English string `'Name this checkpoint'` sitting in a component
   * whose every other string goes through `useTranslations` — so four of the five
   * supported locales were shown an English prompt at the moment they were asked to
   * name something. An inline field also lets a person SEE the list they are adding to
   * while they name the entry, which a modal cannot.
   */
  const createCheckpoint = useCallback(() => {
    const label = checkpointName.trim();
    if (!canEdit || !label) return;
    if (persistence !== 'server') {
      const saved = saveLocalCheckpoint(sessionId, label, { nodes, edges });
      // `null` means not even one checkpoint fit — the honest signal that this board
      // cannot be checkpointed on this device, rather than a silent no-op.
      if (!saved) { setNotice(t('noticeCheckpointStorageFull')); return; }
      setLocalCheckpoints(saved);
      setCheckpointName('');
      setNotice(t('noticeCheckpointSaved', { label }));
      return;
    }
    void creationSessionsApi.history.checkpoint(sessionId, label).then(() => {
      setCheckpointName('');
      setNotice(t('noticeCheckpointSaved', { label }));
      return creationSessionsApi.history.list(sessionId);
    }).then((result) => setHistory(result.snapshots)).catch((error) => setNotice(faultText(error, t('noticeSaveCheckpointFailed'))));
  }, [canEdit, checkpointName, edges, nodes, persistence, sessionId, t]);

  const exportSession = useCallback(() => {
    const filename = `${safeDownloadName(title)}.builderforce-canvas.json`;
    setNotice(t('noticePreparingExport'));
    if (persistence === 'local') {
      downloadJson({
        format: 'builderforce.creation-session.v1', exportedAt: new Date().toISOString(),
        session: { id: sessionId, title, persistence: 'local' }, nodes, edges, timeline,
        viewport: flowRef.current?.getViewport() ?? viewportRef.current,
      }, filename);
      setNotice(t('noticeExportDownloaded'));
      return;
    }
    void creationSessionsApi.export(sessionId).then((payload) => {
      downloadJson(payload, filename);
      setNotice(t('noticeExportDownloaded'));
    }).catch((error) => setNotice(faultText(error, t('noticeExportFailed'))));
  }, [edges, nodes, persistence, sessionId, timeline, title]);

  const minimapColor = useCallback((node: CreationFlowNode) => {
    // The board's own identity hues, declared beside the rest of its palette in
    // CreationCanvas.module.css — see PRD 21 §2.6 rule 9. Four pitch kinds share
    // one hue because they are four faces of one object.
    const colors: Partial<Record<CreationObjectKind, string>> = { workflow: 'var(--canvas-obj-workflow)', website: 'var(--canvas-obj-website)', dashboard: 'var(--canvas-obj-dashboard)', agent: 'var(--canvas-obj-agent)', staff: 'var(--canvas-obj-staff)', evaluation: 'var(--canvas-obj-evaluation)', evermind: 'var(--canvas-obj-evermind)', projectComparison: 'var(--canvas-obj-comparison)', pitch: 'var(--canvas-obj-pitch)', pitchScorecard: 'var(--canvas-obj-pitch)', pitchQa: 'var(--canvas-obj-pitch)', pitchApplication: 'var(--canvas-obj-pitch)' };
    return colors[node.data.kind] ?? 'var(--canvas-obj-unknown)';
  }, []);
  const cleanLayout = useCanvasCleanLayout({ boardRef: flowWrapRef, instanceRef: flowRef, setNodes, edges, padding: .16, maxZoom: .9 });
  /**
   * The board-level half of the `blocks` edge (see its doc comment in
   * `CREATION_CONNECTION_KINDS`): the same `analyzeDependencies` primitive the PMO
   * initiative layer runs (`portfolioRollup.ts#computeDependencyAnalysis`), applied to
   * this board's own `task` nodes joined by `blocks` edges. `done` is the only closed
   * status in the task vocabulary (`TaskInspectorSection`'s own status list) — nothing
   * else in that list is ever treated as terminal elsewhere in the product. Weight is
   * `storyPoints` when a task carries one, so the critical path ranks by estimated
   * effort rather than by card count, same reasoning the PMO layer's own weight has.
   */
  const taskDependencyAnalysis = useMemo<DependencyAnalysis>(() => analyzeDependencies(
    nodes.filter((node) => node.data.kind === 'task').map((node) => ({
      id: node.id, status: typeof node.data.status === 'string' ? node.data.status : null,
      weight: typeof node.data.storyPoints === 'number' && node.data.storyPoints > 0 ? node.data.storyPoints : 1,
    })),
    edges.filter((edge) => edge.data?.connectionKind === 'blocks').map((edge) => ({ fromId: edge.source, toId: edge.target })),
    (status) => status !== 'done',
  ), [nodes, edges]);
  const criticalPathTaskIds = useMemo(() => new Set(taskDependencyAnalysis.criticalPath), [taskDependencyAnalysis]);
  const renderedNodes = useMemo(() => nodes.map((node) => {
    const attachedEvermind = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string' && /^evermind:\d+$/.test(node.data.resourceId);
    const live = evermindLiveByNodeId[node.id];
    const liveNode = attachedEvermind ? { ...node, data: { ...node.data, ...(live ?? { evermindLoading: true, status: 'Syncing project…' }) } } : node;
    const agentRef = liveNode.data.kind === 'agent' ? liveNode.data.resourceId?.match(/^agent:(.+)$/)?.[1] : undefined;
    const latestAgentReply = liveNode.data.kind === 'agent' ? [...timeline].reverse().find((message) => {
      const author = message.metadata?.authoredBy;
      return author?.kind === 'agent' && (author.ref === agentRef || author.ref === liveNode.id || author.name === liveNode.data.title);
    }) : undefined;
    const withCollaboration = liveNode.data.kind === 'agent' && (activeAgentIds.has(liveNode.id) || latestAgentReply)
      ? { ...liveNode, data: { ...liveNode.data, ...(activeAgentIds.has(liveNode.id) ? { collaborationState: 'thinking' } : {}), ...(latestAgentReply ? { collaborationReply: latestAgentReply.body, collaborationReplyAt: latestAgentReply.createdAt } : {}) } }
      : liveNode;
    const hasDatasetConnection = ['chart', 'dashboard', 'report'].includes(withCollaboration.data.kind) && edges.some((edge) => {
      const otherId = edge.source === withCollaboration.id ? edge.target : edge.target === withCollaboration.id ? edge.source : null;
      return otherId != null && nodes.some((candidate) => candidate.id === otherId && ['dataset', 'table', 'spreadsheet'].includes(candidate.data.kind));
    });
    const withLiveData = hasDatasetConnection && /connect a dataset/i.test(String(withCollaboration.data.status || ''))
      ? { ...withCollaboration, data: { ...withCollaboration.data, status: 'Dataset connected' } }
      : withCollaboration;
    // `taskDependencyAnalysis`'s board-wide read, folded onto the one task it is
    // about — the card's own render never recomputes the graph, it just reads the
    // verdict already computed once above, same as `activeAgentIds`/`hasDatasetConnection`.
    const withBlockedFlag = withLiveData.data.kind === 'task' && taskDependencyAnalysis.isBlocked[withLiveData.id]
      ? { ...withLiveData, data: { ...withLiveData.data, isBlocked: true } }
      : withLiveData;
    const withPlacement = withBlockedFlag.data.placementHidden === true ? { ...withBlockedFlag, hidden: !showHidden, style: showHidden ? { ...withBlockedFlag.style, opacity: .42 } : withBlockedFlag.style } : withBlockedFlag;
    // The outline search's board half — see `outlineHighlightIds`'s own comment.
    return dockPanel === 'outline' && outlineHighlightIds && !outlineHighlightIds.has(withPlacement.id)
      ? { ...withPlacement, style: { ...withPlacement.style, opacity: .18 } }
      : withPlacement;
  }), [activeAgentIds, dockPanel, edges, evermindLiveByNodeId, nodes, outlineHighlightIds, showHidden, taskDependencyAnalysis, timeline]);
  /**
   * The 3D view reads the SAME nodes the board renders, minus the ones the board
   * is currently hiding — a mode that quietly resurrects hidden objects would
   * report a different canvas than the one the user is working on.
   */
  /** Paints `taskDependencyAnalysis`'s critical path onto the board: the `blocks`
   *  edges connecting two critical-path tasks get a heavier, accented stroke instead
   *  of the shared default — the first per-edge styling this board does, so it is
   *  additive over `defaultEdgeOptions` rather than replacing it. */
  const renderedEdges = useMemo(() => edges.map((edge) => edge.data?.connectionKind === 'blocks' && criticalPathTaskIds.has(edge.source) && criticalPathTaskIds.has(edge.target)
    ? { ...edge, animated: true, style: { ...edge.style, stroke: 'var(--error-text)', strokeWidth: 3 } }
    : edge), [edges, criticalPathTaskIds]);
  /**
   * Frames, applied. Collapsed sections hide what they hold (and their connections
   * re-point at the chip), and a focused frame shows only its own section — the
   * canvas within a canvas. See `useFramedBoard`.
   */
  const framedBoard = useFramedBoard(renderedNodes, renderedEdges, frameFocus);
  // eslint-disable-next-line react-hooks/refs
  framedBoardRef.current = framedBoard;
  const threeDNodes = useMemo(() => framedBoard.nodes.filter((node) => node.hidden !== true), [framedBoard]);
  const describeThreeD = useCallback((node: CreationFlowNode): Canvas3DDescriptor => {
    const definition = creationObjectDefinition(node.data.kind);
    const comparisonModel = typeof node.data.comparisonModel === 'string' ? node.data.comparisonModel : '';
    const comparisonPrompt = typeof node.data.comparisonPrompt === 'string' && !comparisonModel;
    return {
      label: node.data.title || t(`object.${node.data.kind}`),
      sublabel: node.data.status || node.data.subtitle,
      group: comparisonModel
        ? t('comparison.modelLayer', { model: comparisonModel })
        : comparisonPrompt ? t('comparison.promptLayer') : t(`group.${definition.group}`),
      icon: definition.icon,
      accent: typeof node.data.accent === 'string' ? node.data.accent : minimapColor(node),
      // A generated object carries a picture of what it produced — a rendered
      // mesh, a drawn profile, an image. In 3D that is the point of the card.
      preview: creativePreviewImageUrl(node.data) ?? undefined,
      // A model is handed over as geometry, not as a picture of geometry: the 3D
      // view redraws it from wherever the camera ends up, so turning the scene
      // turns the object instead of sliding a photograph of it around.
      geometry: creativeMeshGeometry(node.data) ?? undefined,
      // Where the user has put this object through depth, if they have. It rides
      // in the object's own content, so it survives a reload and a share exactly
      // like its position on the flat board does.
      depthOffset: canvas3dDepthOffset(node),
      locked: !canvasPlacementUnlocked(node),
    };
  }, [minimapColor, t]);
  /**
   * WHAT STANDS IN THE ROOM besides the session: every 3D creation on the board —
   * games, worlds, AI scenes and models (see `lib/canvas/roomCreations.ts`). Opening
   * one records the room as its origin, so its way back lands in the room.
   */
  const roomCreations = useMemo(() => roomCreationsOf(nodes), [nodes]);
  const openRoomCreation = useCallback((creation: RoomCreation) => {
    if (creation.surface) setSurface(creation.surface, creation.id, 'room');
  }, [setSurface]);
  const selectThreeDObject = useCallback((id: string) => {
    setInspectorFocus(null);
    setSelectedId(id);
    setSelectedIds([id]);
  }, []);
  /**
   * WHAT THE ROOM'S SESSION IS MADE FROM.
   *
   * The same four things `Canvas3DView` is handed, as one memoised input: a card is
   * the same card whether it is a miniature on the table or full size in the
   * projection, so its label, its colour and the picture of what it produced are
   * answered once by `describeThreeD`. The room lays it out itself, and only while
   * the diorama is drawn — this memo is an object, not a layout.
   */
  const roomSceneInput = useMemo<Canvas3DSceneInput<CreationFlowNode>>(() => ({
    nodes: threeDNodes,
    edges,
    describe: describeThreeD,
    measure: canvasNodeDimensions,
    depthMode: comparisonModelIds.length >= 2 ? 'group' : 'flow',
  }), [comparisonModelIds.length, describeThreeD, edges, threeDNodes]);
  /**
   * Objects moved in the 3D space, written straight back to the board.
   *
   * There is one set of positions, not a 3D copy of them: across the plane the
   * move IS the board position, and through depth it is how far the object
   * floats off the layer its dependencies put it on. So an object dragged in the
   * space is where the user left it on the flat canvas too, and is saved by the
   * same autosave that persists any other placement.
   */
  const moveThreeDObjects = useCallback((moves: readonly Canvas3DMove[]) => {
    if (!canEdit) return;
    setNodes((current) => applyCanvas3DMoves(current, moves, canvasPlacementUnlocked));
  }, [canEdit, setNodes]);
  /**
   * Zoom and fit mean the scene while it is up, and the flat board otherwise —
   * the phone-sized action stack keeps the same buttons in both views instead of
   * leaving three dead controls behind whenever 3D opens.
   */
  const zoomInAction = useCallback(() => {
    if (threeDControls) threeDControls.zoomIn(); else void flowRef.current?.zoomIn({ duration: 180 });
  }, [threeDControls]);
  const zoomOutAction = useCallback(() => {
    if (threeDControls) threeDControls.zoomOut(); else void flowRef.current?.zoomOut({ duration: 180 });
  }, [threeDControls]);
  const fitViewAction = useCallback(() => {
    if (threeDControls) threeDControls.resetView(); else void flowRef.current?.fitView({ padding: .18, maxZoom: .9, duration: 260 });
  }, [threeDControls]);
  /**
   * Export from a card, at the identity React Flow needs.
   *
   * `exportArtifact` closes over `nodes`, so a card holding it directly would
   * either export a stale document or force `nodeTypes` to change on every board
   * edit — remounting every Object. The ref keeps the callback stable while
   * always running the newest closure, so a paragraph typed a moment ago is in
   * the file.
   */
  const exportRef = useRef(exportArtifact);
  exportRef.current = exportArtifact;
  const exportFromNode = useCallback((nodeId: string, action: CanvasExportAction) => {
    void exportRef.current(nodeId, action).then(setNotice);
  }, []);
  const evaluateCanvasRef = useRef(evaluateCanvas);
  evaluateCanvasRef.current = evaluateCanvas;
  /**
   * Turns typed while Brain is working.
   *
   * The composer stays live for the whole run (see the `ChatInput` below): a turn
   * typed mid-run is HELD and sent the moment the current one finishes, so a long
   * research turn never means a dead input box. Shared with the Brain panel — one
   * queueing rule for every composer in the product.
   */
  /** Assigned below, once `startCanvasTurn` exists — the queue and the board
   *  callbacks both need the newest closure without re-registering. */
  const startCanvasTurnRef = useRef<(text?: string) => void>(() => {});
  const queuedTurns = useQueuedTurns({
    running: thinking,
    // Flushed turns take the same door every other turn takes — see
    // `startCanvasTurn`. Re-queueing is impossible here: the queue only flushes
    // once the run it was held behind has finished.
    send: (text) => startCanvasTurnRef.current(text),
    resetKey: sessionId,
  });
  /**
   * STOP. Interrupts the in-flight turn: the model stream is aborted, the loop
   * refuses to start another round-trip or tool, and anything the user had queued
   * behind it is dropped — they stopped the conversation, not just this sentence.
   *
   * The UI unwinds HERE rather than in the run's rejection handler, because a tool
   * already in flight can take seconds to settle and a Stop that leaves the board
   * saying "Executing…" is not a stop.
   */
  const stopCanvasRun = useCallback(() => {
    const run = canvasRunRef.current;
    // `thinking` is the authority on whether there is anything to stop: a settled
    // run can leave its handle behind, and a Stop that narrates an interruption
    // nobody was waiting on is worse than an inert button.
    if (!run || !thinking) return;
    canvasRunRef.current = null;
    run.abort.abort();
    queuedTurns.clear();
    setThinking(false);
    setActiveAgentIds(new Set());
    setBrainRunStartedAt(null);
    setNotice(t('noticeBrainStopped'));
    appendTimeline('system', t('noticeBrainStopped'), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds] }, `${run.requestMessageId}:stopped`);
    if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, {
      correlationId: run.requestMessageId, action: 'prompt.evaluate', phase: 'failed', actorType: 'user',
      durationMs: performance.now() - run.startedAt, metadata: { stopped: true },
    }).catch(() => undefined);
  }, [appendTimeline, persistence, queuedTurns, resolvedScopeMode, scopedNodeIds, sessionId, t, thinking]);
  /**
   * THE ONE DOOR every user-initiated turn goes through — the composer, "Send
   * again" on a transcript message, an object handing Brain a request.
   *
   * A turn offered while Brain is still working joins the queue instead of being
   * refused, which is what lets the composer stay enabled. `evaluateCanvas` drops
   * a turn on the floor while `thinking` (it is single-flight), so anything that
   * bypasses this door is silently ignored mid-run.
   */
  const startCanvasTurn = useCallback((text?: string) => {
    const value = (text ?? prompt).trim();
    if (!value || !assistantGate.assistantAllowed) return; // a closed-book assessment refuses every turn, composer or not
    if (queuedTurns.submit(value)) {
      if (text === undefined) setPrompt('');
      return;
    }
    evaluateCanvasRef.current(text);
  }, [assistantGate.assistantAllowed, prompt, queuedTurns]);
  // eslint-disable-next-line react-hooks/refs
  startCanvasTurnRef.current = startCanvasTurn;
  const tailorResumeFromNode = useCallback((nodeId: string, request: string) => {
    setSelectedId(nodeId);
    setSelectedIds([nodeId]);
    setScopeMode('selection');
    // Selection/scope are React state. Start the turn after that state commits so
    // the Recruiter receives the intended résumé, not the previous canvas scope.
    window.setTimeout(() => startCanvasTurnRef.current(`Target Canvas resume object ID: ${nodeId}\n\n${request}`), 0);
  }, []);
  const detachResumeFromNode = useCallback((nodeId: string, detachedData: Partial<CreationNodeData>) => {
    const detachedId = crypto.randomUUID();
    setNodes((current) => {
      const source = current.find((node) => node.id === nodeId);
      if (!source) return current;
      return [...current, { ...source, id: detachedId, selected: true, position: { x: source.position.x + 64, y: source.position.y + 64 }, data: { ...source.data, ...detachedData } }];
    });
    setSelectedId(detachedId);
    setSelectedIds([detachedId]);
  }, [setNodes]);
  const createResumeShare = useCallback(async (nodeId: string, kind: 'view' | 'embed') => {
    if (persistence !== 'server') throw new Error(t('resumeShareSaveFirst'));
    const share = await creationSessionsApi.resumeShares.create(sessionId, nodeId);
    const path = kind === 'embed' ? share.embedPath : share.viewPath;
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setNotice(t(kind === 'embed' ? 'resumeEmbedCopied' : 'resumeLinkCopied'));
  }, [persistence, sessionId, t]);
  const listResumeShares = useCallback((nodeId: string) => persistence === 'server'
    ? creationSessionsApi.resumeShares.list(sessionId, nodeId).then((result) => result.shares)
    : Promise.resolve([]), [persistence, sessionId]);
  const revokeResumeShare = useCallback(async (nodeId: string, shareId: string) => {
    await creationSessionsApi.resumeShares.revoke(sessionId, nodeId, shareId);
    setNotice(t('resumeShareRevoked'));
  }, [sessionId, t]);
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
  const runWorkflowRef = useRef(runWorkflow);
  runWorkflowRef.current = runWorkflow;
  const runWorkflowFromNode = useCallback((nodeId: string) => { runWorkflowRef.current(nodeId); }, []);
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
  const openBuiltinAgentSurfaceRef = useRef(openBuiltinAgentSurface);
  openBuiltinAgentSurfaceRef.current = openBuiltinAgentSurface;
  const openBuiltinAgentSurfaceFromNode = useCallback((nodeId: string, intent: BuiltinAgentSurfaceIntent) => {
    openBuiltinAgentSurfaceRef.current(nodeId, intent);
  }, []);
  // Brain reaches its Object through BrainSurfaceProvider, not through this memo:
  // a per-token dependency here would hand React Flow a new nodeTypes object and
  // remount every Object on the board on every streamed word.
  const canvasNodeTypes = useMemo<NodeTypes>(() => ({
    creation: (props) => <CreationNode {...props} canRun={canRun} onRun={runWorkflowFromNode} onExport={exportFromNode} onOpenBuiltinAgent={openBuiltinAgentSurfaceFromNode} onOpenPanel={openNodePanel} onInsertFrom={openInsertPicker} onOpenSurface={(nodeId, surface) => setSurface(surface, nodeId)} onOpenFrame={openFrame} onRevealObject={revealObject} {...(cardsEditable ? { onEditData: updateNodeData, onMoveDeal: moveDealFromNode, onDeleteNode: deleteNodeFromCard } : {})} onOpenDetails={(nodeId, focus) => {
      setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
      // Asking for a specific section (knowledge, test, evaluation, delivery) is asking
      // for the WIDE panel directly — the short one has no such section to scroll to.
      setSelectedId(nodeId); setSelectedIds([nodeId]); openNodeInspector(nodeId, focus || null);
    }} />,
  }), [canRun, cardsEditable, deleteNodeFromCard, exportFromNode, moveDealFromNode, openBuiltinAgentSurfaceFromNode, openFrame, openInsertPicker, openNodeInspector, openNodePanel, runWorkflowFromNode, setSurface, updateNodeData]);
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
  const buildDiagnostics = useCallback(async () => buildCreationCanvasDiagnosticsReport({
    sessionId, title, persistence, role: sessionRole, revision: revision.current, realtimeState,
    // Objects are passed WHOLE: the report decides which fields explain whether
    // an object can act, so every caller reports the same evidence rather than
    // each one choosing a different subset (which is how the field that mattered
    // — a workflow's step count — came to be missing).
    objects: nodes.map((node) => ({ id: node.id, data: node.data as Record<string, unknown> })),
    connectionCount: edges.length,
    selectedObjectIds: effectiveSelectedIds,
    hiddenObjectCount: nodes.filter((node) => node.data.placementHidden === true).length,
    lockedObjectCount: nodes.filter((node) => node.data.placementLocked === true).length,
    redactedObjectCount: nodes.filter((node) => node.data.redacted === true).length,
    canonicalResourceCount: nodes.filter((node) => !!node.data.resourceId).length,
    memberCount: persistence === 'local' ? 1 : allMembers.length,
    pendingInvitationCount: pendingInvitations.length,
    unsavedChanges: currentGraph.current !== lastSavedGraph.current,
    saveInFlight: saveInFlight.current,
    undoDepth: undoStack.current.length,
    timeline: timeline.map((message) => ({ role: message.messageRole === 'assistant' ? 'Brain' : message.messageRole, body: message.body, createdAt: message.createdAt })),
    brain: { scope: resolvedScopeMode, thinking, proposedChangeCount: proposedChanges.length, actionCount: canvasActions.length },
    brainRuntime: {
      selection: modelSelection,
      mode: sessionMode,
      memoryEnabled,
      autoApply: autoApplyRef.current,
      runStartedAt: brainRunStartedAt == null ? null : new Date(brainRunStartedAt).toISOString(),
      scope: resolvedScopeMode,
      scopedObjectIds: [...scopedNodeIds],
      availableTools: canvasActions.map((action) => action.name),
      disabledModels: [...brainRuntime.current.disabledModels],
      completions: [...brainRuntime.current.completions],
    },
    trace: brainTrace.map((event) => ({
      ts: event.ts, category: event.category, label: event.label,
      ok: event.isError === true ? false : null,
      detail: [event.args === undefined ? '' : `args=${safeTraceJson(event.args)}`, event.result === undefined ? '' : `result=${safeTraceJson(event.result)}`].filter(Boolean).join(' '),
    })),
    // What the person and the agent DID, with durations — the evidence that lets
    // the report explain how the board got into the state it is in, rather than
    // only restating that state back to whoever is already looking at it.
    actions: journal.current.entries(),
    // How much of the board the last turn could actually see. A turn scoped to a
    // selection is why "I don't see that file anywhere on the canvas" could be
    // said about a file that was on the canvas.
    scopedObjectCount: scopedNodes.length,
  }, await captureDiagnosticsContext()), [allMembers.length, brainRunStartedAt, brainTrace, canvasActions, edges.length, effectiveSelectedIds, memoryEnabled, modelSelection, nodes, pendingInvitations.length, persistence, proposedChanges.length, realtimeState, resolvedScopeMode, scopedNodeIds, scopedNodes.length, sessionId, sessionMode, sessionRole, thinking, timeline, title]);

  /**
   * Unlike `buildDiagnostics` above (all in-memory canvas state), this reads
   * the server's ledger for the session — fetched fresh on click, per
   * `CopyButton`'s `getText` contract, since a paste should reflect the latest
   * proof outcomes rather than whatever was true when the panel opened.
   */
  const buildProofJourneyDiagnostics = useCallback(async () => {
    const [journey, context] = await Promise.all([
      creationSessionsApi.proofJourney(sessionId),
      captureDiagnosticsContext(),
    ]);
    return buildProofJourneyDiagnosticsReport(journey, context);
  }, [sessionId]);

  /**
   * The diagnostics control does the whole job in one click: the report is on the
   * clipboard (ready to paste into a bug report) before the panel finishes opening,
   * so nobody has to find a second "Copy" button to report what they are looking at.
   *
   * Assembling the report is a real operation — it reads the board, the transcript and
   * the build stamp — so it can fail, and a failure used to be swallowed whole: the
   * rejection escaped into `void`, no toast was raised, and the click looked like a
   * button that was never wired up. The one control people reach for when something is
   * already wrong is the last one allowed to fail silently, so a throw is reported as
   * itself and the panel stays open with the state that is on screen.
   */
  const openDiagnostics = useCallback(async () => {
    setDiagnosticsOpen(true);
    setHistoryOpen(false);
    setOutcomeMetricsOpen(false);
    let report: string;
    try {
      report = await buildDiagnostics();
    } catch (error) {
      toast.error(t('diagnosticsBuildFailed', { reason: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (await copyTextToClipboard(report)) toast.success(t('diagnosticsCopied'));
    else toast.error(t('diagnosticsCopyFailed'));
  }, [buildDiagnostics, t, toast]);

  const openOutcomeMetrics = useCallback(() => {
    setOutcomeMetricsOpen(true);
    setOutcomeMetricsError(null);
    if (persistence === 'local') return;
    setOutcomeMetricsLoading(true);
    void creationSessionsApi.outcomeMetrics(sessionId)
      .then(setOutcomeMetrics)
      .catch((error) => setOutcomeMetricsError(faultMessage(error, t('noticeOutcomeMetricsFailed'))))
      .finally(() => setOutcomeMetricsLoading(false));
  }, [persistence, sessionId]);

  const brainNode = nodes.find((node) => node.data.kind === 'chat') ?? null;
  /**
   * Where the ONE Brain surface actually renders.
   *
   * Inline means "inside the Brain Object on the graph" — and every surface but the
   * board replaces the flat view rather than floating over it, so while one is up there
   * is no Object to render into and an inline Brain simply vanished: no transcript, no
   * tabs, no controls, and nothing on screen offering a way back to it. A boardless
   * surface therefore places Brain on the edge, which is the placement that survives
   * losing the board. The stored preference is untouched, so coming back to the board
   * puts Brain back in its Object.
   *
   * The exception is the surface that IS the conversation: it renders the transcript
   * itself, so the edge dock stands down entirely rather than putting the same live
   * conversation on screen twice — see `brainIsSurface` below.
   */
  const brainPlacement: BrainDockMode = surfaceDef.showsBoard ? brainDock.mode : 'docked';
  // An inline Brain IS an Object on the board, so only a docked one is reserved.
  const brainDockReserved = brainDockReservedWidth({ ...brainDock, mode: brainPlacement });
  const brainMessages = useMemo<BrainMessage[]>(() => timeline.map((message, index) => ({
    id: index + 1,
    seq: index + 1,
    role: message.messageRole,
    content: message.body,
    metadata: message.metadata?.authoredBy ? JSON.stringify({ authoredBy: message.metadata.authoredBy }) : null,
    createdAt: message.createdAt,
  })), [timeline]);

  /**
   * WHO IS HERE — the one roster, read by the command bar's collapsed cluster AND
   * the chat surface's header. A shared free session's roster is REAL members; a
   * local one falls back to the room's live guests, then to just "you". Computed
   * once so both surfaces can never show a different answer to the same question.
   */
  const rosterMembers = useMemo(
    () => (persistence !== 'local'
      ? members
      : inRoom && sharedRoom.roster.length
        ? sharedRoom.roster
        : [{ userId: 'local', displayName: t('you'), role: 'owner' as const }]),
    [inRoom, members, persistence, sharedRoom.roster, t],
  );
  /**
   * Which roster row is the viewer — the same three branches `rosterMembers` takes.
   * A local canvas's lone row is `local`, not an account id; a shared guest room
   * answers for its own rows (`sharedRoom.selfId` — the one row wearing this
   * browser's name, and nobody when two guests chose the same name).
   */
  const rosterSelfId = useMemo(() => {
    if (persistence !== 'local') return currentUserId;
    if (rosterMembers.length === 1 && rosterMembers[0]!.userId === 'local') return 'local';
    return sharedRoom.selfId;
  }, [currentUserId, persistence, rosterMembers, sharedRoom.selfId]);

  /**
   * WHO IS WORKING ON THIS BOARD — the agent cards on it, read once (`boardAgents`).
   * The bar's team strip rings those seats and the room stands them at the table, so
   * the board, the strip and the room give one answer.
   */
  const seatedAgents = useMemo(() => boardAgents(nodes), [nodes]);
  const roomOccupants = useMemo(
    () => [...rosterMembers, ...boardAgentOccupants(seatedAgents)],
    [rosterMembers, seatedAgents],
  );
  // What each agent at the table is saying this turn, drawn over its head in the room.
  const roomSpeechBySeat = useMemo(
    () => roomSpeech(timeline, seatedAgents, activeAgentIds),
    [activeAgentIds, seatedAgents, timeline],
  );
  // A room speech bubble asked to show the full reply. Nonce so a second click on
  // the same bubble still jumps; the dock may already be open on that turn.
  const [brainReveal, setBrainReveal] = useState<{ id: number; nonce: number } | null>(null);
  const revealSpeechInChat = useCallback((messageId: number) => {
    openBrainDock();
    setBrainReveal((current) => ({ id: messageId, nonce: (current?.nonce ?? 0) + 1 }));
  }, [openBrainDock]);
  // The board as the room's stations and a framed third-party widget read and edit it.
  const boardBridge = useCanvasBoardBridgeFor({ sessionId, title, persistence, objects: nodes, act: cardActBoard, patch: cardsEditable ? updateNodeData : null, remove: cardsEditable ? deleteObjects : null, selfId: rosterSelfId, occupants: roomOccupants });
  // Who is walking which space — a level played in the room, a game on its own surface.
  // Published once, read by any walker by object id (`useSpacePresence`).
  const spacePresence = useMemo<CanvasSpacePresenceValue>(
    () => ({ live: livePresence, selfId: rosterSelfId, members: rosterMembers, send: sendPresence }),
    [livePresence, rosterMembers, rosterSelfId, sendPresence],
  );

  const brainSurfaceOpen = !presentMode && brainDock.open;
  /**
   * Brain turns a COLLABORATOR started. Every Brain surface narrates one — the
   * thinking animation and its elapsed clock — so the whole board sees Brain
   * working, not just the person who asked. This viewer's own run wins when there
   * is one: it is the one carrying the trace and the Stop.
   */
  const peerRuns = useMemo(() => peerBrainRuns(livePresence, presenceSelfId, Date.now()), [livePresence, presenceSelfId]);
  const peerRunStartedAt = peerRuns[0]?.startedAt ?? null;
  const brainRunning = thinking || peerRunStartedAt !== null;
  const brainRunShownStartedAt = thinking ? brainRunStartedAt : peerRunStartedAt;
  // Read off the LIVE roster, so "is writing" and "asked Brain" move at relay speed
  // rather than waiting for the next presence poll.
  const brainCollaborators = useMemo(() => {
    const asking = new Set(peerRuns.map((run) => run.userId));
    return liveMembers
      .filter((member) => member.userId !== presenceSelfId)
      .map((member) => (asking.has(member.userId) ? { ...member, askingBrain: true } : member));
  }, [liveMembers, peerRuns, presenceSelfId]);
  /**
   * "Send again" on a transcript message — the same path a typed prompt takes, so a
   * replay is scoped, queued and narrated identically to the original turn. Read
   * through the ref so the callback identity never changes: <BrainTimeline> is
   * memoized, and a fresh closure here would re-parse the whole transcript per token.
   */
  const replayBrainMessage = useCallback((message: BrainMessage) => {
    startCanvasTurnRef.current(message.content);
  }, []);
  /**
   * Rate a Brain reply on this board.
   *
   * The Canvas has no Brain chat and therefore no brain-message id, so it posts to
   * the surface-agnostic ratings endpoint keyed on the transcript's own stable
   * `clientMessageId`. The model and the tool come off the message we stamped at
   * append time (`lastTurnProvenance`), which is what makes a press on a reloaded
   * board still attributable rather than anonymous.
   */
  const [brainRatings, setBrainRatings] = useState<Record<number, 1 | -1>>({});
  const rateBrainMessage = useCallback((message: BrainMessage, rating: 1 | -1 | 0) => {
    const entry = timeline[message.id - 1];
    const model = entry?.metadata?.model;
    if (!entry || !model) return;
    setBrainRatings((prev) => {
      const next = { ...prev };
      if (rating === 0) delete next[message.id];
      else next[message.id] = rating;
      return next;
    });
    void llmApi.rateAction({
      surface: 'canvas',
      subjectKind: 'turn',
      subjectRef: `canvas:${sessionId}:${entry.clientMessageId}`,
      resolvedModel: model,
      // The LAST tool of the turn is the one the reply is reporting on, so it is the
      // one the verdict is about.
      toolName: entry.metadata?.tools?.[entry.metadata.tools.length - 1] ?? null,
      projectId: evermindProjectId ?? null,
      rating,
    }).catch(() => { /* telemetry: a lost rating must never disturb the board */ });
  }, [evermindProjectId, sessionId, timeline]);
  /**
   * Exactly one surface renders the conversation. When it is inline, the Brain Object
   * reads this and becomes the chat; the edge dock is not rendered at all. Feeding both
   * placements from ONE value is what guarantees the board can never show two.
   */
  /**
   * The conversion CTA a refused guest turn arms. Built once and handed to BOTH
   * Brain placements, so the button appears wherever the visitor is reading the
   * refusal — and returns them to THIS canvas, which is the promise the copy makes.
   */
  const guestSignupPrompt = useMemo<GuestSignupPrompt | null>(() => (guestLimit === null ? null : {
    next: `/create/${sessionId}`,
    onAccept: () => trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: canvasSurface(), action: 'guest_limit' } }),
  }), [guestLimit, sessionId]);
  /**
   * HOW MANY REPLIES LANDED BEHIND A CLOSED BRAIN — the number the launcher pill wears
   * and the Brain Object reads off the context below. See `useBrainUnreadReplies` for
   * what "unread" means and why the mark is taken while the surface is open.
   */
  const brainUnreadReplies = useBrainUnreadReplies(brainMessages, brainSurfaceOpen);
  const brainSurface = useMemo<BrainSurfaceContextValue>(() => ({
    open: brainSurfaceOpen,
    unreadReplies: brainUnreadReplies,
    canOpen: !presentMode,
    mode: brainPlacement,
    showExecutionDetail: brainDock.showExecutionDetail,
    running: brainRunning,
    runStartedAt: brainRunShownStartedAt,
    messages: brainMessages,
    trace: brainTrace,
    nodes,
    edges,
    collaborators: brainCollaborators,
    joinedCollaborator,
    onReplayMessage: replayBrainMessage,
    // A guest board has no tenant to file a rating against, so the thumbs hide
    // rather than pretend — the component decides its own visibility from this.
    ...(persistence === 'server' ? { onRateMessage: rateBrainMessage, ratings: brainRatings } : {}),
    guestSignup: guestSignupPrompt,
    onOpen: (nodeId) => { setSelectedId(nodeId); setSelectedIds([nodeId]); openBrainDock(); },
    onModeChange: (mode) => updateBrainDock({ mode }),
    onExecutionDetailChange: (showExecutionDetail) => updateBrainDock({ showExecutionDetail }),
    onClose: () => updateBrainDock({ open: false }),
  }), [
    brainCollaborators, brainDock.showExecutionDetail, brainMessages, brainPlacement, brainRatings, brainRunShownStartedAt,
    brainRunning, brainSurfaceOpen, brainTrace, brainUnreadReplies, edges, guestSignupPrompt, joinedCollaborator, nodes,
    openBrainDock, persistence, presentMode, rateBrainMessage, replayBrainMessage, updateBrainDock,
  ]);

  /* The prompt sits bottom-centre, where every chat product people already use puts it,
     and is deliberately NOT part of the Brain surface: it stays reachable whether Brain
     is inline in its Object, docked to either edge, or closed entirely. */
  const canvasUsesTwilio = twilioPromptSelected || nodes.some((node) => (
    Array.isArray(node.data.steps) && node.data.steps.some((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
      const connector = (step as Record<string, unknown>).connector;
      return typeof connector === 'string' && (connector === 'twilio' || connector.startsWith('twilio-'));
    })
  ));

  const promptStarter = !presentMode && <div className={styles.promptStarter} data-tour="creation-prompt-starter">
    {/* One menu, every source. A prompt seeds the composer, a pack lands on the
        board, and an installable template opens its guided setup — dispatched by
        `applyTemplateEntry` so this surface never branches on where an entry
        came from. The executive execution contract now rides on the entry, so
        it no longer has to be re-composed here. */}
    <PromptUseCasePicker placement="top" align="end" onSelect={(entry) => {
      applyTemplateEntry(entry, {
        onPrompt: (nextPrompt) => {
          setPrompt(nextPrompt);
          if (entry.id === 'twilio-ai-journey') setTwilioPromptSelected(true);
        },
        onPack: (template) => applyTemplate(template),
        onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`),
      });
    }} />
  </div>;

  // WHERE THE ONE COMPOSER GOES. When Brain IS the surface (chat) there is no dock to
  // join and no board to hand the space back to, so it stays floating and open whatever
  // the stored preference says. `docked` renders it INSIDE the Brain panel's column, so
  // it only holds while that panel is on screen — otherwise the preference is untouched
  // and the prompt floats until the panel comes back.
  const brainDockDrawn = brainSurfaceOpen && brainPlacement === 'docked' && !surfaceDef.brainIsSurface;
  /**
   * A surface the EMBEDDING HOST supplies owns its whole centre, input included: its
   * runtime is somewhere this component cannot reach (in VS Code, the extension host),
   * so a composer wired to the in-page `evaluateCanvas` would be a second, quieter way
   * to start a turn that behaves differently from the one the reader can see.
   */
  const hostOwnsSurface = !!hostSurfaces?.[surface];
  const effectivePromptPlacement: CanvasPromptPlacement = hostOwnsSurface
    ? 'closed'
    : surfaceDef.brainIsSurface
      ? 'float'
      : promptPlacement === 'docked' && !brainDockDrawn ? 'float' : promptPlacement;
  const promptInBrainPanel = effectivePromptPlacement === 'docked';
  /**
   * THE ONE COMPOSER. Its markup, its height, its resize grip and its drag offset are
   * `CanvasComposer`'s. What stays here is what only the host knows: where the box is
   * PLACED, what its verbs DO, and the `ChatInput` wiring.
   */
  const composer = !presentMode && effectivePromptPlacement !== 'closed' && <CanvasComposer
    placement={promptInBrainPanel ? 'docked' : 'float'}
    intents={surfaceDef.composerIntents}
    // The same gate the scratchpad's own form used: a viewer who cannot add cards is
    // offered Ask alone rather than a verb that would silently do nothing.
    editable={cardsEditable}
    // Opening the conversation on a phone means you are talking to it.
    {...(phoneViewport && brainSurfaceOpen ? { preferIntent: 'ask' as const } : {})}
    onAsk={() => startCanvasTurn()}
    onCaptureIdea={captureIdeaFromComposer}
    // Measured ONLY while it floats over the board; docked it is the Brain panel's last
    // row rather than the board's chrome, and the band reserved for it is zero.
    {...(promptInBrainPanel ? {} : { hostRef: composerDockRef })}
    leading={<CanvasActionsTrigger open={actionsOpen} onToggle={() => setActionsOpen((open) => !open)} />}
    starter={promptStarter || undefined}
    activity={<BrainActivityIndicator
      running={thinking}
      trace={brainTrace}
      startedAt={brainRunStartedAt}
      variant="composer"
    />}
    // Neither control means anything once Brain IS the surface: there is nothing to dock
    // into and no board to hand the composer's space back to.
    {...(surfaceDef.brainIsSurface ? {} : {
      dockControls: {
        docked: promptPlacement === 'docked',
        // Docking puts the prompt in the Brain panel, so it OPENS that panel: a control
        // whose effect is invisible until you find the launcher reads as one that did nothing.
        onToggleDock: () => {
          const next = promptPlacement === 'docked' ? 'float' : 'docked';
          setPromptPlacement(next);
          if (next === 'docked' && !brainDockDrawn) updateBrainDock({ open: true, mode: 'docked' });
        },
        onClose: () => setPromptPlacement('closed'),
      },
    })}
    input={{
      value: prompt,
      onChange: setPrompt,
      // NEVER disabled while Brain works: an empty composer offers Stop, typing queues the
      // next turn. A box greyed out for a research turn is how a canvas reads as hung.
      running: thinking,
      onStop: stopCanvasRun,
      queuedCount: queuedTurns.count,
      contextControls: <label className={styles.scopeChip}>⌁ <span className="sr-only">{t('brainScope')}</span><select aria-label={t('brainScope')} value={scopeMode} onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)}><option value="auto">{scopeLabel}</option><option value="canvas">{t('entireCanvas')}</option><option value="selection" disabled={!effectiveSelectedIds.length}>{effectiveSelectedIds.length > 1 ? t('selectedObjects', { count: effectiveSelectedIds.length }) : t('selectedObject')}</option><option value="connected" disabled={!effectiveSelectedIds.length}>{t('connectedScope')}</option><option value="frame" disabled={selectedNode?.data.kind !== 'frame'}>{t('currentFrame')}</option></select></label>,
      onAttach: attachCanvasArtifact,
      onAddContext: openObjectPicker,
      autoMode: autoApply,
      onAutoModeChange: setAutoApplyMode,
      modelSelection,
      modelOptions: canvasModelOptions,
      onModelSelectionChange: setModelSelection,
      modelIdentity,
      // Mode and memory live in the `/` menu, whose trigger names the armed mode — this
      // row had grown to eight unlabelled circles on a phone.
      chatMode: sessionMode,
      onChatModeChange: setSessionMode,
      memoryEnabled,
      onMemoryChange: setMemoryMode,
      memoryUnavailableReason: evermindProjectId == null || persistence !== 'server' ? t('memoryNeedsProject') : undefined,
    }}
  />;

  /**
   * What each session action DOES. The registry owns the rest — the glyph, the name, the
   * cluster it belongs to and whether a phone keeps it in the bar or in the ••• sheet —
   * so this map is behaviour only, and the desktop bar and the phone sheet are driven by
   * the same entry rather than by two copies of the same `onClick`.
   */
  // The standup beside the call. The hook resolves the project (scope, then this
  // board's), owns the ceremony and asks the agents at the table for their updates
  // through the ordinary turn path; this file learns one handler.
  const standupAction = useCanvasStandupAction({
    members: rosterMembers, agents: seatedAgents, boardProjectId,
    ceremonyEnabled: hasAccount, onError: setNotice, onAgentRound: startCanvasTurn,
  });
  const sessionActionHandlers: Record<CanvasSessionActionId, CanvasSessionActionHandler> = (() => {
    // Every one of these can be pressed from the command bar, the phone's "+" sheet, or
    // (for a few) the board menu, and a sheet that stays open over the panel it just
    // opened is a sheet in the way. Wrapping once here is what keeps that true for an
    // action added later.
    const act = (run: () => void, active?: boolean): CanvasSessionActionHandler =>
      ({ run: () => { setMoreOpen(false); setRealOpen(false); closeActionsSheet(); run(); }, active });
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
      walkthrough: { ...act(() => walkthroughRef.current?.open()), available: walkthroughStops.length > 0 },
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
      publish: act(() => openReleasesPanel(), releaseFocus !== null),
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
  })();

  /**
   * THE INVITE SHEET — opened by the roster's own trailing chip now (`.rosterInvite`
   * in `CanvasCommandBar`), so it is built here and handed down as its own prop
   * rather than nested inside `handoffChrome`: the panel anchors `right:0` against
   * whichever `position:relative` box renders it, and that box has to be the one
   * sitting right under the button that opened it, not the doors-out group at the
   * OTHER end of the bar.
   */
  const inviteMenu = shareOpen ? <div className={styles.shareMenu} role="dialog" aria-label={t('inviteCollaborators')}>
    <div className={styles.shareMenuHeader}>
      <strong>{t('inviteCollaborators')}</strong>
      <button type="button" className={styles.shareMenuClose} aria-label={t('closeInvitationPanel')} onClick={() => setShareOpen(false)}>×</button>
    </div>
    <p>{persistence === 'local' ? (inRoom ? t('sharedLiveHint') : t('sharedInviteHint')) : t('invitedCanBuild')}</p>
    {/* NO ACCOUNT: invite by link into a shared free session. Everyone edits
        the same board and shares one free-message allowance; signing up is
        offered as the way to KEEP it, not as the price of sharing it. */}
    {persistence === 'local' ? (sharedRoom.code ? <>
      <GuestInviteLink code={sharedRoom.code} surface="canvas" full={sharedRoom.full} />
      <div className={styles.shareRoomPeople} aria-label={t('sharedPeopleHere', { count: sharedRoom.participants.length })}>
        {sharedRoom.participants.map((person) => <span key={`${person.name}-${person.joinedAt}`}>{person.name}{person.isHost ? ` ${t('sharedHostTag')}` : ''}</span>)}
      </div>
      <div className={styles.shareRoomActions}>
        <button type="button" onClick={() => void sharedRoom.leave()}>{t('sharedStopSharing')}</button>
        <button type="button" onClick={() => requireAccount('save', t('gateSaveSessionTitle'), t('gateSaveBody'))}>{t('sharedSaveToKeep')}</button>
      </div>
      {/* No call button here. "Get someone in here" and "talk to them" are one
          errand, but they are not one CONTROL: the call is a session action in
          the bar on every surface and in both auth states, and a second copy in
          this panel would be one decision with two homes. */}
    </> : <button disabled={sharedRoom.busy} onClick={() => void sharedRoom.start()}>{sharedRoom.busy ? t('sharedStarting') : t('sharedStart')}</button>) : <>
      {/* SIGNED IN, and the link half of sharing — the half that did not exist.
          A logged-out visitor could always start a room and send the URL; the moment
          somebody signed up, "share this" became an address field and an email the
          recipient had to sign in to redeem. Both motions live here now, in this order,
          because the link is the one that works when all you have is a chat window.
          The panel is owner-gated and decides that itself. */}
      <CanvasInviteLinkPanel sessionId={sessionId} role={sessionRole} />
      <div><input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder={t('emailPlaceholder')} /><select aria-label={t('invitationRole')} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as CreationSessionSummary['role'])}><option value="viewer">{t('roleViewer')}</option><option value="commenter">{t('roleCommenter')}</option><option value="editor">{t('roleEditor')}</option><option value="runner">{t('roleRunner')}</option><option value="owner">{t('roleOwner')}</option></select><button disabled={!inviteEmail.trim()} onClick={() => { void creationSessionsApi.invite(sessionId, { email: inviteEmail.trim() }, inviteRole).then(async (result) => { if ('acceptPath' in result) { await copyTextToClipboard(`${canvasWebOrigin()}${result.acceptPath}`); setPendingInvitations((current) => [...current.filter((item) => item.id !== result.invitationId), { id: result.invitationId, email: result.email, role: result.role as CreationSessionSummary['role'], expiresAt: result.expiresAt, acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString() }]); setNotice(result.emailSent ? t('invitationEmailed') : t('invitationSavedLinkCopied')); } else { const detail = await creationSessionsApi.get(sessionId); setAllMembers(detail.members); setNotice(result.emailSent ? t('collaboratorInvitedEmail') : t('collaboratorInvited')); } setInviteEmail(''); }).catch((error) => setNotice(faultText(error, t('inviteFailed')))); }}>{t('invite')}</button></div>
      {sessionRole === 'owner' && <div aria-label={t('sessionMembers')}>{allMembers.map((member) => <div key={member.userId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span>{member.displayName || t('collaborator')}{member.userId === currentUserId ? ` ${t('youSuffix')}` : ''}</span>
        <select aria-label={t('roleFor', { name: member.displayName || member.userId })} value={member.role} onChange={(event) => { const role = event.target.value as CreationSessionSummary['role']; void creationSessionsApi.members.update(sessionId, member.userId, role).then(() => setAllMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item))).catch((error) => setNotice(faultText(error, t('roleUpdateFailed')))); }}><option value="viewer">{t('roleViewer')}</option><option value="commenter">{t('roleCommenter')}</option><option value="editor">{t('roleEditor')}</option><option value="runner">{t('roleRunner')}</option><option value="owner">{t('roleOwner')}</option></select>
        <button type="button" disabled={member.userId === currentUserId} aria-label={t('removeMember', { name: member.displayName || t('member') })} onClick={() => { void creationSessionsApi.members.remove(sessionId, member.userId).then(() => setAllMembers((current) => current.filter((item) => item.userId !== member.userId))).catch((error) => setNotice(faultText(error, t('memberRemovalFailed')))); }}>×</button>
      </div>)}{!!pendingInvitations.length && <div aria-label={t('pendingInvitations')} style={{ marginTop: 10 }}><strong>{t('pendingInvitations')}</strong>{pendingInvitations.map((invitation) => <div key={invitation.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span>{invitation.email}</span><small>{invitation.role}</small><button type="button" aria-label={t('revokeInvitation', { email: invitation.email })} onClick={() => { void creationSessionsApi.invitations.revoke(sessionId, invitation.id).then(() => { setPendingInvitations((current) => current.filter((item) => item.id !== invitation.id)); setNotice(t('invitationRevoked')); }).catch((error) => setNotice(faultText(error, t('invitationRevokeFailed')))); }}>×</button>
      </div>)}</div>}</div>}
    </>}
    <small>{t('accessLabel', { access: persistence === 'local' ? (inRoom ? t('sharedAnyoneWithLink') : t('privateOnDevice')) : inviteRole })}</small>
    {/* The other side of the same link: somebody who took one and declined to sign up.
        They are a real member of this board, so this is an offer of a workspace of
        their own — never a wall. It shows itself only to a guest identity. */}
    <GuestCollaboratorNotice />
  </div> : null;

  /**
   * PUBLISH, and the overflow that holds everything a phone cannot fit.
   *
   * Invite used to live here too, worded and beside Publish. It now draws as the
   * trailing chip on the roster itself (`chrome: 'roster'` in
   * `canvasSessionActions.ts`, rendered by `CanvasCommandBar`'s own
   * `CanvasSessionActions variant="roster"`) — a glyph the same size as the avatars it
   * follows, because "who is here" and "bring someone else in" read as one group, not
   * two: the word was the only thing telling them apart, and it was telling a lie
   * about how separate they were.
   *
   * ── WHY THIS LIVES IN THE BAR NOW, NOT THE HEADER ────────────────────────────────
   * It used to portal into the application header's own top-right corner — a DOM slot
   * (`lib/canvas/CanvasChromeSlot.tsx`, since removed) that let the row escape into
   * whichever header the shell had mounted, `MarketingHeader` signed out or `TopBar`
   * signed in. That solved one collision (two bars of controls fourteen pixels apart) by
   * creating a smaller one: the header's OWN cluster — cart, theme, sign-in-or-out — sat
   * beside a row that belonged to the canvas, not the shell, so a visitor read one corner
   * as two systems that happened to share it. It also meant Publish/••• read differently
   * signed in versus signed out, because the two headers are structurally different
   * chromes, not a swapped button or two.
   *
   * The bar already answers "what can I do to this canvas" for every other action; this
   * is answered the same way now, kept a visual step apart — a divider, not a border of
   * its own — from the glyphs beside it.
   */
  /**
   * MAKE IT REAL — the ONE worded control on the bar, and every door out beneath it.
   *
   * The bar used to carry two worded buttons side by side: *Make it real* opened the
   * proof picker and *Publish* opened the release lifecycle. Two words at the same weight
   * that both mean "ship it" read as a fork, and nothing on the bar said which fork was
   * which — so the doors are rows under one trigger now. `chrome: 'door'` in
   * `canvasSessionActions.ts` is what files an action here, so a door added later lands
   * in this menu without this file being edited.
   *
   * The two rows that are NOT registry actions are here for the same reason the registry
   * ones are: *Make this a project* is a door out (a board becomes one project, ever) and
   * self-gates to nothing on a local board or for a viewer; *Export* is the door that
   * needs no server at all. Both used to be filed in the ••• sheet under headings
   * ("Create and view", "Session tools") that grouped them with things they have nothing
   * to do with.
   *
   * It closes the REACH group on the bar, because putting the result in front of people
   * is what Reach means and a door out is the last thing you do in it.
   */
  const makeItRealChrome = (
      <div className={styles.handoffGroup} data-testid="canvas-handoff">
          <button
            type="button"
            className={styles.sessionActionLabelled}
            data-testid="canvas-make-it-real"
            aria-expanded={realOpen}
            aria-haspopup="menu"
            title={t('proveThisIdeaTitle')}
            onClick={() => { setRealOpen((value) => !value); setMoreOpen(false); setShareOpen(false); }}
          ><ProveIdeaIcon /><span>{t('proveThisIdea')}</span><i aria-hidden><DisclosureIcon /></i></button>
          {realOpen && <CanvasMenuSheet title={t('proveThisIdea')} testId="canvas-make-it-real-menu" role="menu" onClose={closeRealMenu}>
            <CanvasSessionActions variant="doors" surface={surface} collapsed={barCollapsed} handlers={sessionActionHandlers} />
            {/* Turn the board into a project. Self-gating: a local board, a viewer, and
                a board that is not yet an app and cannot become one all render nothing,
                so the sheet asks it nothing and the section never holds a dead row. The
                sheet closes when the drawer it opened is dismissed, not when the row is
                pressed — closing on press would unmount the drawer with it. */}
            <CanvasAppPanel
              sessionId={persistence === 'server' ? sessionId : null}
              onOpenChange={(panelOpen) => { if (!panelOpen) setRealOpen(false); }}
            />
            <button onClick={() => { exportSession(); setRealOpen(false); }}><span aria-hidden>↓</span>{t('exportCanvas')}</button>
          </CanvasMenuSheet>}
      </div>
  );

  /**
   * THE BOARD MENU — the ••• trigger and its sheet, wherever that sheet is hosted.
   *
   * Everything in it is done to the BOARD rather than to the work: how you are looking
   * at it, what it is made of, where its history went. That is why the group it hangs
   * under on the desktop bar has a caption of its own instead of a stage's — a control
   * that answers no stage's question must not be given a stage's name, which is how the
   * old `Tools` shelf formed. The body itself, and the reasoning for what is in it, is
   * `CanvasBoardMenuBody`.
   *
   * ── ONE HOST AT A TIME ──────────────────────────────────────────────────────────
   * On a desktop it is contributed to the command bar's `Board` group. A phone does not
   * draw that bar, so this whole node is handed to the canvas app bar instead. Passed to
   * exactly one of the two (`phoneViewport`), never rendered in both and hidden in one:
   * `display:none` would leave two ••• buttons and two sheets in one document.
   */
  const boardMenuChrome = (
      <span className={styles.handoffGroup} data-testid="canvas-board-menu">
          <button type="button" className={styles.sessionActionButton} aria-expanded={moreOpen} aria-haspopup="menu" aria-label={t('moreActions')} title={t('moreActions')} onClick={() => { setMoreOpen((value) => !value); setShareOpen(false); setRealOpen(false); }}><MoreActionsIcon /></button>
          {/* NO SAVE BUTTON HERE: a guest board is kept by taking an account, and the
              header's CTA already becomes "Keep your work" the moment this browser holds
              a local board. The pill SAYS where the board lives; saying it is not the
              same as offering it twice. */}
          {moreOpen && <CanvasMenuSheet
            title={t('moreActions')}
            testId="canvas-more-menu"
            // The SAME node, two hosts: anchored above the command bar's ••• on a
            // desktop, and a full-width sheet under the canvas app bar on a phone —
            // where "above the button that opened me" would be off the top of the
            // screen, because that button is in the top bar rather than the bottom one.
            placement={phoneViewport ? 'sheet' : 'popover'}
            onClose={closeMoreMenu}
          >
            {/* ONE body, two hosts — `CanvasBoardMenuBody`. Its phone-only session-action
                section is gone: it carried what a 360px command bar could not fit, and
                that bar is not drawn at this width any more. */}
            <CanvasBoardMenuBody
              showsBoard={surfaceDef.showsBoard}
              view={{
                onZoomIn: zoomInAction,
                onZoomOut: zoomOutAction,
                onFit: fitViewAction,
                onArrange: cleanLayout,
                minimapOpen,
                onToggleMinimap: () => setMinimapOpen((open) => !open),
                marquee: canvasGesture === 'select',
                onToggleGesture: () => setCanvasGesture((current) => (current === 'select' ? 'pan' : 'select')),
                threeD: threeDControls,
              }}
              panels={{ open: dockPanel, onToggle: toggleDockPanel, allow: connectedAccountGate }}
              create={{
                onTemplates: () => setTemplateOpen(true),
                onConversation: () => setConversationOpen((value) => !value),
              }}
              session={{
                onHistory: openHistory,
                onTutorial: sectionTour.openOffer,
                hiddenShown: showHidden,
                onToggleHidden: () => setShowHidden((value) => !value),
                onBranch: createBranch,
                ...(branchParentId ? { onMerge: prepareMerge } : {}),
              }}
              connectors={{
                kind: connectionKind,
                onKindChange: setConnectionKind,
                style: connectionStyle,
                onStyleChange: setConnectionStyle,
              }}
              onDismiss={closeMoreMenu}
            />
          </CanvasMenuSheet>}
          {templateOpen && <div className={styles.templateMenu}>
            <header><div><strong>{t('canvasTemplates')}</strong><small>{t('marketplacePacks')}</small></div><button onClick={() => setTemplateOpen(false)} aria-label={t('closeTemplates')}>×</button></header>
            <div className={styles.templateFilters}><input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder={t('searchTemplates')} aria-label={t('searchTemplates')} /><select value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value as typeof templateCategory)} aria-label={t('filterTemplateCategory')}><option value="all">{t('allCategories')}</option><option value="pack">{t('templateCategoryObjectPack')}</option><option value="workspace">{t('templateCategoryAutomation')}</option><option value="prompt">{t('templateCategoryPrompt')}</option></select><select value={templateKind} onChange={(event) => setTemplateKind(event.target.value as typeof templateKind)} aria-label={t('filterTemplateKind')}><option value="all">{t('allMediaKinds')}</option>{[...new Set(CREATION_TEMPLATES.flatMap((template) => template.objects.map((object) => object.kind)))].sort().map((kind) => <option key={kind} value={kind}>{t(`object.${kind}`)}</option>)}</select></div>
            {/* ONE catalogue. This browser used to iterate `CREATION_TEMPLATES`
                with its own search and its own category names, while the prompt
                picker below iterated a different list entirely — so a person
                could not find an installable automation from here at all. Both
                now render `useTemplateCatalog` and dispatch through
                `applyTemplateEntry`. The object-kind filter still applies only
                to packs, because only a pack HAS object kinds. */}
            {templateEntries
              .filter((entry) => templateCategory === 'all'
                || (templateCategory === 'pack' && entry.source === 'pack')
                || (templateCategory === 'workspace' && entry.source === 'workspace')
                || (templateCategory === 'prompt' && (entry.source === 'canvas' || entry.source === 'executive')))
              .filter((entry) => templateKind === 'all' || (entry.action.kind === 'pack' && entry.action.template.objects.some((object) => object.kind === templateKind)))
              .filter((entry) => matchesTemplateQuery(entry, templateSearch))
              .map((entry) => <button key={entry.id} onClick={() => { applyTemplateEntry(entry, { onPrompt: (nextPrompt) => { setPrompt(nextPrompt); setTemplateOpen(false); }, onPack: (template) => applyTemplate(template), onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`) }); }}><b>{entry.name}</b><small>{entry.action.kind === 'pack' ? t('templateMeta', { category: entry.categoryLabel, count: entry.action.template.objects.length }) : entry.categoryLabel}</small><span>{entry.summary}</span><i>{entry.keywords.slice(0, 6).join(' · ')}</i></button>)}
            {!!serverTemplates.length && <><h4>{t('savedAccount')}</h4>{serverTemplates.map((template) => <button key={template.id} onClick={() => applyServerTemplate(template)}><b>{template.name}</b><small>{template.visibility === 'tenant' ? t('sharedWithTenant') : t('private')} · {template.category}</small><span>{template.description}</span></button>)}</>}
            {!!framePresets.length && <><h4>{t('reusableFrames')}</h4>{framePresets.map((preset) => <button key={preset.id} onClick={() => addFramePreset(preset)}><b>{preset.name}</b><small><span>{t('privateCustomFrame')}</span> · {t('thisDevice')}</small></button>)}</>}
          </div>}
      </span>
  );

  return (
    // Published to the whole shell, not just the board: the Brain surface's controls
    // render in three places and each needs the same answer to "is there a board to move
    // this conversation into?". One provider, read where it is needed.
    <CanvasSurfaceProvider value={surface}>
    {/* Same reasoning for the card-act runner: a card's action button is drawn deep in
        the inspector, and handing it a callback would have meant one more entry in a
        prop list that already carries fifty. Published once, read where it is needed. */}
    <CardActProvider runner={runCardActOnObject}><CanvasBoardBridgeProvider value={boardBridge}><CanvasSpacePresenceProvider value={spacePresence}><CanvasDiagnosticsProvider value={buildDiagnostics}>
    <div
      ref={shellRef}
      className={`${styles.canvasShell} app-full-height`}
      data-fullscreen={fullscreen ? 'true' : 'false'}
      data-host={hostSurfaces ? 'editor' : undefined}
      style={{
        // The dock owns one edge of the board; every other floating panel is pushed in
        // by exactly its width so nothing can ever sit underneath it.
        //
        // Declared on the SHELL rather than on the board, which is where it used to live:
        // the chrome now floats as a sibling of the board rather than inside it, so a
        // reservation that only the board could see would have let the session pill and
        // the command bar be the two things that DO sit underneath the dock.
        '--brain-dock-left': `${brainDock.side === 'left' ? brainDockReserved : 0}px`,
        '--brain-dock-right': `${brainDock.side === 'right' ? brainDockReserved : 0}px`,
      } as CSSProperties}
    >
      {/* ── THE FLOATING CHROME ────────────────────────────────────────────────────
          No chrome band: the board takes the whole shell and each piece floats over it
          in the region `lib/canvasChrome.ts` gives it — is the work safe (top left), how
          it is READ and which phase it is in (top centre), and what you DO to it,
          including how work LEAVES it (the one bar, bottom centre). A phone replaces the
          top two with its own app bar; see below. */}
      {/* THE PHONE'S APP CHROME — a 52px canvas app bar over a worded surface strip,
          drawn in place of the shell's header on a stage route (`AppShell`,
          `data-phone-chrome="stage"`). Stands down above 767px, where the floating cards
          below are the chrome instead. See `CanvasPhoneAppBar` for what is on it.

          The ref measures the bar AND the strip together — everything below has to clear
          both — and exactly one of this wrapper and the desktop card is ever handed it,
          because the other is `display:none` and a hidden box measures zero. */}
      <div
        ref={phoneViewport ? topChromeSpaceRef : undefined}
        className={styles.canvasPhoneChrome}
      >
        <CanvasPhoneAppBar
          title={title}
          phase={phase}
          onPhaseChange={setPhase}
          surface={surface}
          onSurfaceChange={setSurface}
          roster={rosterMembers}
          {...(sessionActionHandlers.share.available === false || sessionActionHandlers.share.disabled
            ? {}
            : { onOpenRoster: sessionActionHandlers.share.run })}
          // ONE host at a time for each sheet: handing them to both chromes and hiding
          // one would put two copies of each in the document.
          {...(phoneViewport ? { inviteMenu, boardMenu: boardMenuChrome } : {})}
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
      {canvasChromeShows('surfaces', barCollapsed) && <div ref={phoneViewport ? undefined : topChromeSpaceRef} className={`${styles.floatCard} ${styles.surfaceChips}`}>
        <PhaseModalitySelector phase={phase} onPhaseChange={setPhase} surface={surface} onSurfaceChange={setSurface} />
      </div>}

      {/* THE object panel — config, schedule, messages or persona short, or the object's
          whole inspector wide, from one shell anchored to one card.

          There is no second surface. The inspector used to be a full-height rail on the
          far side of the board, and every value, every setting and the activity log lived
          over there with nothing tying them to the card being edited. The panel widens in
          place instead, so what you are editing is never in question.

          The wide body is passed as CHILDREN rather than built inside the panel: its
          actions (deliver a mockup, import a dataset, publish a site, compare projects)
          are the board's, and handing the panel forty callbacks to forward would make it
          a second copy of this component's surface area. */}
      {nodePanel && !presentMode && (() => {
        const target = nodes.find((node) => node.id === nodePanel.nodeId);
        if (!target) return null;
        // `chat` has its own surface and no inspector at all — it must never open wide.
        const expanded = nodePanel.expanded && target.data.kind !== 'chat';
        const panel = nodePanel.panel ?? canvasNodeSettingsPanel(target.data.kind);
        // The anchor is DERIVED, not frozen when the panel opened: the clamp that keeps
        // the panel on screen depends on which of the two widths is showing, and the width
        // changes while it is open. A panel opened without a box (an action that had no
        // event to take a rectangle from) draws at the fallback for one frame, until the
        // layout effect above measures the card.
        const width = expanded ? NODE_PANEL_WIDE_WIDTH : NODE_PANEL_WIDTH;
        const anchor = nodePanel.box
          ? anchorFrom(nodePanel.box, width)
          : { x: Math.max(12, window.innerWidth - width - 24), y: 96 };
        return <CanvasNodePanel
          panel={panel}
          nodeId={nodePanel.nodeId}
          data={target.data}
          anchor={anchor}
          messages={canvasNodeMessages(target.data, { emptyShell: emptyShellProblem(target.data.kind, target.data as Record<string, unknown>) !== null })}
          editable={canEdit && !lockBlocked}
          onChange={(patch) => updateNodeData(nodePanel.nodeId, patch)}
          onClose={() => { setNodePanel(null); setInspectorFocus(null); }}
          expanded={expanded}
          onToggleExpanded={() => setNodePanel((current) => (current ? { ...current, expanded: !current.expanded } : current))}
          onOpenSurface={(surface) => setSurface(surface, nodePanel.nodeId)}
        >{expanded ? <Inspector node={target} nodes={nodes} edges={edges} focus={inspectorFocus} timeline={timeline} brainTrace={brainTrace} sessionId={sessionId} persistence={persistence} role={sessionRole} editable={canEdit && !lockBlocked} members={members} onChange={(patch) => updateNodeData(target.id, patch)} onWebsiteViewportChange={(viewport) => updateWebsiteViewport(target.id, viewport)} onRun={() => runWorkflow(target.id)} onPublishWebsite={() => publishWebsite(target.id)} onOpenBuild={() => openBuild(target.id)} onAttachBuild={(ide) => attachBuild(target.id, ide)} onDeleteBuildWorkspace={() => deleteBuildWorkspace(target.id)} onBuildWebsiteWithCode={() => buildWebsiteWithCode(target.id)} creatingBuild={creatingBuild} onGenerateVideo={() => generateVideo(target.id)} onRunCreativeAction={(action) => runCreativeAction(target.id, action)} onShipGame={() => openGamePanel(target.id)} onPublishListing={() => openPublishPanel(target.id)} onOpenReleases={() => openReleasesPanel(target.id)} onUnpackWorkflow={() => unpackWorkflow(target.id)} onBuildWorkflow={() => { void compileWorkflow(target.id); }} onBuildFlow={() => { void buildFlow(target.id); }} onOpenEvermindBuild={() => openEvermindBuild(target.id)} onLoadEvermindTemplate={(templateId) => loadEvermindTemplate(target.id, templateId)} onRemoveConnection={(edgeId) => setEdges((current) => current.filter((edge) => edge.id !== edgeId))} onSaveAgent={saveAgent} onOpenBuiltinAgent={(intent) => openBuiltinAgentSurfaceFromNode(target.id, intent)} onAddAgentKnowledge={(content) => addAgentKnowledge(target.id, content)} onRunAgentTest={(testPrompt, expected) => runAgentTest(target.id, testPrompt, expected)} onSaveFramePreset={saveFramePreset} onExpandProject={expandProject} onLoadProjectQuality={loadProjectQuality} onCompareProjects={compareProjects} onDeliverMockup={deliverMockup} onExpandMockupSet={expandMockupSet} onImportDataset={importDataset} onVisualizeDataset={visualizeDataset} onPlotDataset={plotDataset} onProfileDataset={profileDataset} onAttachEvermindProject={attachEvermindProject} onExpandEvermindPipeline={expandEvermindPipeline} onTrainEvermind={openEvermindTraining} onStartStandup={startStandup} onConvertDiagram={async (format, diagramId) => { const result = await convertObjectToDiagram(target.id, format, diagramId); return result.ok ? t(diagramId && diagramId !== '__new__' ? 'diagramAddedStatus' : 'diagramCreatedStatus') : result.error || t('drawioAppendFailed'); }} onExportArtifact={(action) => exportArtifact(target.id, action)} onAskBrain={(request) => { openBrainDock(); evaluateCanvas(request); }} onResumeTailor={tailorResumeFromNode} onResumeDetach={detachResumeFromNode} onResumeShare={createResumeShare} onResumeSharesList={listResumeShares} onResumeShareRevoke={revokeResumeShare} /> : null}</CanvasNodePanel>;
      })()}

      {/* ONE picker, two doors: a node's `+` (insert, connected) and everything else
          (add) — the command bar's category circles, the board's own toggle, the
          composer's "add context" row, the large-canvas notice's "Frame" button. This
          replaced a hand-rolled palette aside that read the same registry through a
          second, drifting rendering of it. Contents from `CREATION_PALETTE_GROUPS`, so
          it can never fall behind the object registry. */}
      {objectPicker && <CanvasObjectPicker
        anchor={objectPicker.anchor}
        {...(objectPicker.group ? { group: objectPicker.group } : {})}
        {...(objectPicker.fromNodeId ? { fromNodeId: objectPicker.fromNodeId } : {})}
        onPick={pickObject}
        // Carry a row out of the picker and put it where it goes. On a board, WHERE
        // something lands is half the authoring — a picker that could only be clicked
        // made every placement a click followed by a drag.
        onDragStart={(choice, event) => { event.dataTransfer.setData(DND_MIME, choice); event.dataTransfer.effectAllowed = 'copy'; }}
        onClose={() => setObjectPicker(null)}
      />}

      {/* THE bar. Everything you can do to what you are looking at, in one floating card
          — including whatever the SURFACE contributed, so an app's Run, its readings and
          the address it is running at land here rather than in a second toolbar of their
          own. See `CanvasCommandBar` for why one bar and why the bottom. */}
      {/* NOT DRAWN ON A PHONE AT ALL, and the distinction from `display:none` is
          load-bearing: a hidden box measures zero from the TOP of the viewport rather
          than zero height, so `--canvas-command-bar-space` would push the composer most
          of a screen up — and its ••• sheet and invite panel would each exist twice in
          one document. The composer's "+" opens the same registry instead. */}
      {!phoneViewport && <CanvasCommandBar
        // Its measured height becomes the band the prompt floats above. See the ref's
        // declaration: this used to be a literal that the App surface's own controls
        // overran, which is how the bar came to be drawn on top of the prompt.
        hostRef={commandBarSpaceRef}
        surface={surface}
        collapsed={barCollapsed}
        onToggleCollapse={() => setBarCollapsed(!barCollapsed)}
        handlers={sessionActionHandlers}
        makeItReal={makeItRealChrome}
        boardMenu={boardMenuChrome}
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
        roster={
          /* WHO IS HERE is the single most important thing a folded bar can still say.
             A collapsed roster is a team nobody can see is working, and on a shared
             board that is somebody editing next to people they cannot see. */
          <div className={styles.collaborators} aria-label={t('activeCollaborators')} data-tour="creation-collaborators">
            {rosterMembers.slice(0, 4).map((member, index) => <button key={member.userId} type="button" data-typing={'typing' in member && member.typing ? 'true' : 'false'} aria-pressed={followingUserId === member.userId} title={`${member.displayName || t('collaborator')} · ${member.role}${'typing' in member && member.typing ? ` · ${t('writingPrompt')}` : ''}${member.userId !== currentUserId ? ` · ${t('clickToFollow')}` : ''}`} onClick={() => { if (member.userId !== currentUserId && member.userId !== 'local') setFollowingUserId((current) => current === member.userId ? null : member.userId); }} className={memberAvatarClass(index, { pink: styles.avatarPink, orange: styles.avatarOrange, green: styles.avatarGreen })}>{memberInitials(member.displayName)}</button>)}
            {/* The roster's `+` used to open the invite sheet — the same sheet the
                Share button opens, which is one decision with two controls and the
                exact failure the surface registry was written to prevent. The roster
                now only reports who is here; Share is the door. */}
          </div>
        }
        // Moving around the board, folded out of the left-edge rail. The rail was the
        // last toolbar competing with this bar, and it split "what can I do to this
        // canvas" across two floating elements with nothing saying why.
        onTogglePrompt={presentMode || surfaceDef.brainIsSurface ? undefined : () => setPromptPlacement(toggledCanvasPromptPlacement(promptPlacement))}
        promptOpen={effectivePromptPlacement !== 'closed'}
        // The always-on seats, folded out of the shell's footer band and into the one
        // bar. Same component, same roster endpoint, same drag-to-board payload — the
        // band simply stands down on a stage route and draws itself here instead.
        team={<TeamBar variant="bar" onBoard={seatedAgents} />}
        extras={canvasChromeShows('actions', barCollapsed) ? <>
          <TwilioCanvasSetup active={canvasUsesTwilio} />
          {/* Editor-only capture actions. Renders nothing on the web — it asks the
              host port whether an editor is present rather than being told. */}
          <CanvasHostActions
            selectedNode={selectedNode ?? null}
            disabled={!canEdit || lockBlocked}
            onCapture={addHostCapture}
            onError={setNotice}
          />
        </> : undefined}
      />}

      {/* THE GATE ASKS FOR WHAT IS ACTUALLY MISSING. Every caller writes signup-framed
          copy because `persistence === 'local'` was read as "no account" — so a
          signed-in user on an unsaved board was told to create the account they were
          already using, and the only button offered took them to /register. What they
          are actually missing is a SAVED SESSION for the action to point at, and
          `claimLocalDraft` already turns this board into one. One branch here rather
          than eight rewritten call sites: the callers say which action needs it, the
          gate decides how to ask. */}
      {accountGate && <div className={styles.accountGateBackdrop} role="presentation">
        <section className={styles.accountGate} role="dialog" aria-modal="true" aria-labelledby="canvas-account-gate-title">
          <button type="button" className={styles.accountGateClose} aria-label={t('closeAccountPrompt')} onClick={() => setAccountGate(null)}>×</button>
          <span className={styles.accountGateIcon} aria-hidden><Icon name="sparkles" size={20} /></span>
          <small>{t('keepMomentum')}</small>
          <h2 id="canvas-account-gate-title">{hasAccount ? t('gateSignedInTitle') : accountGate.title}</h2>
          <p>{hasAccount ? t('gateSignedInBody', { action: accountGate.action }) : accountGate.description}</p>
          <div className={styles.accountGateBenefits}><span>{`✓ ${t('gateBenefitKeep')}`}</span><span>{`✓ ${t('gateBenefitUnlock')}`}</span><span>{`✓ ${t('gateBenefitCollaborate')}`}</span></div>
          {hasAccount ? (
            <div className={styles.accountGateActions}>
              <button type="button" className={styles.primaryButton} disabled={claimingDraft} onClick={() => {
                trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: canvasSurface(), action: accountGate.action } });
                setClaimingDraft(true);
                void claimLocalDraft(sessionId)
                  .then((claimed) => { if (claimed) canvasNavigate(`/create/${claimed.sessionId}`); else setNotice(t('noticeSaveToAccountFailed')); })
                  .catch((error) => setNotice(faultText(error, t('noticeSaveToAccountFailed'))))
                  .finally(() => { setClaimingDraft(false); setAccountGate(null); });
              }}>{claimingDraft ? t('noticeSavingToAccount') : t('gateSaveToAccount')}</button>
            </div>
          ) : (
            // The SAME pair of buttons the Brain surface offers a guest who ran out
            // of free turns — one component, so the two never drift on wording or
            // on carrying this canvas through sign-up.
            <GuestSignupCta
              layout="actions"
              prompt={{
                next: `/create/${sessionId}`,
                onAccept: () => trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: canvasSurface(), action: accountGate.action } }),
              }}
            />
          )}
          <button type="button" className={styles.accountGateLater} onClick={() => setAccountGate(null)}>{t('notNowKeepLocal')}</button>
        </section>
      </div>}

      <div
        ref={flowWrapRef}
        className={styles.flowWrap}
        data-tour="creation-board"
        data-brain-side={brainDockReserved > 0 ? brainDock.side : 'none'}
        // A phone renders the DOCKED placement as one bottom sheet, so what the board
        // loses there is the bottom edge — not a side. The phone layout moves the
        // board controls off that edge from this, not from the side. An inline Brain
        // is an Object on the board and takes no edge, so it must not set this.
        //
        // It is the SAME condition that decides whether the dock is drawn at all
        // (`brainDockDrawn`), which it was not before: a surface that IS the conversation
        // stands the dock down, and the attribute still claimed the edge — so on a phone
        // the board's rail moved up to `top:56px` to clear a sheet that was not there,
        // and landed on the conversation's own header.
        data-brain-open={brainDockDrawn ? 'true' : 'false'}
        // The active surface, published to the stylesheet. It keys on "not the board"
        // rather than on any single id, so a new runtime suppresses the flat viewport,
        // the palette and the remote cursors without a new rule being written for it.
        data-view={surface}
        data-cursor-mode={drawingMode ? 'draw' : 'pan'} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={() => { cursorRef.current = null; drawingPoints.current = []; sendPresence({ cursor: null }); }} onDragEnter={onCanvasDragEnter} onDragLeave={onCanvasDragLeave} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        {fileDragging && <div className={styles.fileDropOverlay} role="status" aria-live="polite">
          <div>
            <span aria-hidden>⇩</span>
            <strong>{canEdit ? t('dropFilesTitle') : t('roleCannotEdit')}</strong>
            {canEdit && <small>{t('dropFilesHint')}</small>}
          </div>
        </div>}
        {/* The pen tray. It exists only while drawing is on, and every choice on
            it is made BEFORE the stroke — which is the difference between a
            drawing tool and a colour picker you find afterwards in a side panel. */}
        {drawing && <div className={styles.drawingToolbar} role="toolbar" aria-label={t('drawing.toolbar')}>
          {DRAWING_TOOLS.map((tool) => <button
            key={tool}
            type="button"
            aria-pressed={drawing.tool === tool}
            title={t(`drawing.tool.${tool}` as 'drawing.tool.pen')}
            onClick={() => setDrawing((current) => { const next = { ...(current ?? DEFAULT_DRAWING_PREFERENCES), tool }; writeDrawingPreferences(next); return next; })}
          ><span aria-hidden>{DRAWING_TOOL_GLYPH[tool]}</span><b>{t(`drawing.tool.${tool}` as 'drawing.tool.pen')}</b></button>)}
          <label className={styles.drawingColor}>{t('drawing.color')}<input
            type="color"
            value={drawing.color.startsWith('#') ? drawing.color : DRAWING_FALLBACK_HEX}
            onChange={(event) => setDrawing((current) => { const next = { ...(current ?? DEFAULT_DRAWING_PREFERENCES), color: event.target.value }; writeDrawingPreferences(next); return next; })}
          /></label>
          <label className={styles.drawingWidth}>{t('drawing.width')}<input
            type="range" min="1" max="12" value={drawing.width}
            onChange={(event) => setDrawing((current) => { const next = { ...(current ?? DEFAULT_DRAWING_PREFERENCES), width: Number(event.target.value) }; writeDrawingPreferences(next); return next; })}
          /></label>
          <button type="button" className={styles.drawingDone} onClick={() => setDrawing(null)}>{t('stopDrawing')}</button>
        </div>}
        {/* THE PRESENTATION CONTROL — the only chrome present mode ADDS rather than hides.
            It self-gates on there being a sequence at all: a board with no frames has
            nothing to walk, and present mode there behaves exactly as it always has.
            The presenter's camera is the transport (see `goToPresentationStep`), so
            every follower moves with these buttons for free. */}
        {presentMode && presentationSteps.length > 0 && <div className={styles.presentBar} aria-label={t('presentSequence')}>
          <button
            type="button"
            onClick={() => movePresentation(-1)}
            disabled={presentStep <= 0}
            aria-label={t('presentPrevious')}
          ><span aria-hidden>‹</span></button>
          <span className={styles.presentPosition}>
            <b>{t('presentPosition', { index: presentStep + 1, total: presentationSteps.length })}</b>
            {presentationStepAt(presentationSteps, presentStep)?.title
              ? <small>{presentationStepAt(presentationSteps, presentStep)?.title}</small>
              : null}
          </span>
          <button
            type="button"
            onClick={() => movePresentation(1)}
            disabled={presentStep >= presentationSteps.length - 1}
            aria-label={t('presentNext')}
          ><span aria-hidden>›</span></button>
          <button type="button" className={styles.presentExit} onClick={() => setPresentMode(false)}>{t('exitPresentation')}</button>
        </div>}
        {/* Both of these are chrome ABOUT the objects on this canvas — what is selected,
            and how many there are. They gate on whether the objects are on screen at
            all, not on which surface is drawn: the 3D space shows them and keeps both,
            the conversation shows none and would otherwise float a toolbar for things
            the reader cannot see. */}
        {!presentMode && objectsOnScreen && effectiveSelectedIds.length > 0 && <div className={styles.selectionToolbar} aria-label={t('selectionActions')}>
          <span>{t('selectedCount', { count: effectiveSelectedIds.length })}</span>
          <button onClick={focusSelection}>{t('focus')}</button>
          <button onClick={duplicateSelection} disabled={!canEdit}>{t('duplicate')}</button>
          {effectiveSelectedIds.length > 1 && <button onClick={alignSelection} disabled={!canEdit}>{t('align')}</button>}
          {effectiveSelectedIds.length > 1 && <button onClick={frameSelection} disabled={!canEdit}>{t('frame')}</button>}
          <button onClick={togglePlacementLock} disabled={!canEdit}>{effectiveSelectedIds.some((id) => nodes.find((node) => node.id === id)?.data.placementLocked !== true) ? t('lock') : t('unlock')}</button>
          <button onClick={toggleHidden} disabled={!canEdit}>{t('hide')}</button>
          {/* The one action a person reaches for that this bar did not offer. It has to
              be HERE and not only on the card, because the kinds with no header row of
              their own — a sticky, an annotation, a docked conversation — have nowhere
              to draw a trash, and a selection of twelve objects has no single card to
              press it on. Last in the row and styled apart: the destructive one should
              not be adjacent to Duplicate by accident. */}
          <button className={styles.selectionDelete} onClick={deleteSelection} disabled={!canEdit} data-testid="canvas-selection-delete">{t('delete')}</button>
        </div>}
        {/* You are inside a section, and here is the way out. A bar rather than a
            dialog on purpose: the board is still the board, and every control that
            worked a moment ago still works. */}
        {frameFocus && <div className={styles.frameFocusBar} role="status" data-testid="canvas-frame-focus">
          <b>{nodes.find((node) => node.id === frameFocus)?.data.title || t('frameSection.section')}</b>
          <span>{t('frameSection.holds', { count: framedBoard.memberIdsOf(frameFocus).length })}</span>
          <button type="button" onClick={exitFrame}>{t('frameSection.exit')}</button>
        </div>}
        {loadingSession && <div className={styles.canvasSkeleton} role="status" aria-live="polite"><span /><span /><span /><b>{t('loadingSession')}</b></div>}
        {objectsOnScreen && nodes.length > 100 && <div className={styles.performanceNotice} role="status"><strong>{t('largeSession', { count: nodes.length })}</strong><span>{t('largeSessionHint')}</span><button type="button" onClick={openObjectPicker}>{t('frame')}</button></div>}
        <BrainSurfaceProvider value={brainSurface}>
        <ReactFlow<CreationFlowNode, Edge>
          nodes={framedBoard.nodes}
          edges={framedBoard.edges}
          nodeTypes={canvasNodeTypes}
          onNodesChange={onCanvasNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          {...connectionProps}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          onPaneClick={clearSelection}
          onMoveEnd={onViewportChange}
          onInit={(instance) => { flowRef.current = instance; if (pendingViewport.current) void instance.setViewport(pendingViewport.current); }}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: CANVAS_FIT_MIN_ZOOM }}
          minZoom={CANVAS_FIT_MIN_ZOOM}
          maxZoom={1.6}
          defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--canvas-edge)', strokeWidth: 1.5 } }}
          nodesDraggable={canEdit && !drawingMode}
          nodesConnectable={canEdit && !drawingMode}
          elementsSelectable
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          // Pan/marquee, drag threshold and pinch behaviour come from ONE pure decision
          // (`canvasPointerMode.ts`) rather than being spelled out here, so they can be
          // asserted without mounting the board.
          {...interactionProps}
          proOptions={{ hideAttribution: true }}
          onlyRenderVisibleElements
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--creation-dot)" />
          {/* Inside the flow, so the pane's own transform moves them: a cursor
              layer that lives outside the viewport is only ever correct until the
              first pan. */}
          <RemoteCursors members={liveMembers} currentUserId={presenceSelfId} />
          <CanvasCommands
            minimapOpen={minimapOpen}
            setMinimapOpen={setMinimapOpen}
            onCleanLayout={cleanLayout}
            minimapNodeColor={minimapColor as (node: Node) => string}
            minimapMaskColor="var(--creation-minimap-mask, rgba(244,248,253,.72))"
            // All this gates now is the mini map, which is a map OF the flat board: it
            // stands down wherever that board is not what is being drawn, because the 3D
            // scene is its own map and a conversation has nothing to map. That is why it
            // reads the board flag rather than the 3D id.
            threeDActive={!surfaceDef.showsBoard}
            // `onToggleThreeD` is deliberately NOT passed: it would draw a second control
            // for the decision the surface switcher already owns.
            // NO RAIL, on any surface. Zoom, fit, arrange, the mini map toggle,
            // pan/marquee, Files, the outline and the scene's own depth/layer commands are
            // all contributed to the ONE command bar below (`view`). The rail used to stand
            // down on the flat board ONLY, which meant this canvas showed one bar on the
            // board and two toolbars on every other surface — the bottom-left corner panel
            // this removes. The other two canvases that share this component keep their
            // rail: they have no bar of their own for it to move into.
            hideRail
          />
        </ReactFlow>
        </BrainSurfaceProvider>

        {/* NOTHING FLOATS OVER THE BOARD HERE ANY MORE.
            The phone's surface switcher used to be an icon COLUMN parked in this
            corner — five unlabelled glyphs over the surface's own heading, with a rule
            that laid them down in a row ACROSS that heading whenever the Brain sheet
            opened. It is `CanvasSurfaceStrip` now, worded, in its own band under the
            canvas app bar at the top of the shell. "Add to canvas" left this corner
            earlier and for the same reason: one door onto the picker, on the bar. */}

        {/* The runtime that takes the centre. The board itself is not in the map — it is
            the React Flow tree above, rendered unconditionally so the viewport, the
            selection and every node's state survive a trip through another surface and
            back. Adding a runtime is a key here plus an entry in `canvasSurfaces.ts`. */}
        <CanvasSurfaceRouter
          surface={surface}
          hostSurfaces={hostSurfaces}
          surfaces={{
            // The AI scene: a `scene` object's generation panel, entered from its card.
            // Object-scoped like the runtimes below, so `surfaceNode` going null is what
            // the effect above turns back into the board.
            scene3d: surfaceNode && surfaceNode.data.kind === 'scene' ? <CanvasSceneGeneratorPanel
              objectId={surfaceNode.id}
              data={surfaceNode.data}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            // The zero-object case of this canvas: the same transcript, the same
            // composer, no board. Objects Brain creates during the conversation land on
            // the board behind it, which is what the footer's live count offers.
            chat: <CanvasChatSurface
              showExecutionDetail={brainDock.showExecutionDetail}
              onExecutionDetailChange={(showExecutionDetail) => updateBrainDock({ showExecutionDetail })}
              onOpenBoard={() => setSurface('graph')}
              objectCount={nodes.length}
              participants={rosterMembers}
              messages={brainMessages}
              revealMessage={brainReveal}
              trace={brainTrace}
              running={brainRunning}
              runStartedAt={brainRunShownStartedAt}
              node={brainNode}
              nodes={nodes}
              edges={edges}
              collaborators={brainCollaborators}
              joinedCollaborator={joinedCollaborator}
              onReplayMessage={replayBrainMessage}
              onRateMessage={brainSurface.onRateMessage}
              ratings={brainSurface.ratings}
              guestSignup={guestSignupPrompt}
            />,
            // The session read as ONE application. Board-scoped, so unlike the four
            // below it takes the nodes rather than a single object: `backend/server.js`,
            // `frontend/index.html` and the page they render are three cards and one
            // artifact, and there is no card to enter it from.
            app: <CanvasAppSurface
              nodes={nodes}
              onExit={() => setSurface('graph')}
              onOpenObject={revealObject}
              // Set when the reader arrived by opening a SITE, so the App modality shows
              // that same object rather than the entry file it would otherwise guess.
              focusNodeId={appTarget}
            />,
            // What the session is worth, read back. Board-scoped for the same reason
            // `app` is — the metrics are about the whole session, not one card.
            insights: <CanvasInsightsSurface onExit={() => setSurface('graph')} />,
            // The idea scratchpad — board-scoped like `insights`. It reads the `idea` cards
            // straight off `nodes` and writes back through the SAME two board mutations every
            // other surface uses, so a captured line is a card on this board and nowhere else.
            // A viewer who cannot edit gets the list with capture disabled, not a missing input.
            ideas: <CanvasIdeasSurface
              nodes={nodes}
              onOpenObject={revealObject}
              onExit={() => setSurface('graph')}
              {...(cardsEditable ? {
                onCreate: (kind: 'idea' | 'customerInterview' | 'form', data: Partial<CreationNodeData>) => { appendAtCenter(kind, data); },
                onUpdate: updateNodeData,
              } : {})}
            />,
            // THE ROOM, with the session in it — board-scoped like `app` and `insights`.
            // It is handed the roster and live presence the host already holds (no second
            // answer to "who is here") and the projection's input, drawn small on the table
            // and full size through `renderSession`, whose (X) and Escape minimise it. Its
            // stations read the board through `CanvasBoardBridgeProvider`, not props.
            room: <CanvasRoomSurface
              sessionId={sessionId}
              sessionTitle={title}
              members={roomOccupants}
              speech={roomSpeechBySeat}
              onSelectSpeech={revealSpeechInChat}
              currentUserId={rosterSelfId}
              live={livePresence}
              onPresence={sendPresence}
              sceneInput={roomSceneInput}
              // The faces are the board's own cards, and some of them read the Brain
              // surface — whose provider wraps the board, not the surfaces — so the
              // session brings the same one with it.
              renderSession={({ onMinimize, exitLabel }) => <BrainSurfaceProvider value={brainSurface}><Canvas3DView
                nodes={threeDNodes}
                edges={edges}
                describe={describeThreeD}
                renderCard={renderThreeDCard}
                measure={canvasNodeDimensions}
                selectedIds={effectiveSelectedIds}
                onSelect={selectThreeDObject}
                onMove={canEdit ? moveThreeDObjects : undefined}
                onExit={onMinimize}
                exitLabel={exitLabel}
                initialDepthMode={roomSceneInput.depthMode}
              /></BrainSurfaceProvider>}
              creations={roomCreations}
              onOpenCreation={openRoomCreation}
              // A designed room goes on sale through the same publish panel as any card.
              {...(canEdit ? { onPublishRoom: openPublishPanel } : {})}
              sessionInitiallyOpen={comparisonModelIds.length >= 2}
              onExit={() => setSurface('graph')}
            />,
            // The five medium runtimes. Each takes the object the surface is ABOUT, so
            // each is rendered only when one resolves — `surfaceNode` going null is what
            // the effect above turns back into the board.
            page: surfaceNode ? <CanvasPageSurface
              data={surfaceNode.data}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
              onTailor={(prompt: string) => tailorResumeFromNode(surfaceNode.id, prompt)}
              onDetach={(patch: Partial<CreationNodeData>) => detachResumeFromNode(surfaceNode.id, patch)}
              shareActions={{
                create: (kind: 'view' | 'embed') => createResumeShare(surfaceNode.id, kind),
                list: () => listResumeShares(surfaceNode.id),
                revoke: (shareId: string) => revokeResumeShare(surfaceNode.id, shareId),
              }}
            /> : null,
            play: surfaceNode ? <CanvasPlaySurface
              data={surfaceNode.data}
              onExit={exitSurface}
              // Shipping opens OVER the surfacerather than replacing it: distribution is
              // a panel about a build you are still looking at.
              onShip={() => openGamePanel(surfaceNode.id)}
              // Who is on this canvas, and the canvas's OWN invite door — not a second
              // sharing model for games. Playing is when a person wants both.
              players={rosterMembers}
              onInvite={() => setShareOpen(true)}
              objectId={surfaceNode.id}
            /> : null,
            site: surfaceNode ? <CanvasSiteSurface
              data={surfaceNode.data}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            timeline: surfaceNode ? <CanvasTimelineSurface
              data={surfaceNode.data}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            world: surfaceNode ? <CanvasWorldView
              data={surfaceNode.data}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            // THE ROOM. Same object-scoped shape as the four above, and the same reason
            // for it: a poll's own axis is the people answering it, which is not a thing
            // a ~340px card can be. `objectId` goes down so the published question set
            // points back at the card it came from.
            facilitate: surfaceNode ? <CanvasFacilitateSurface
              data={surfaceNode.data}
              objectId={surfaceNode.id}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            // THE FORM. Twin of facilitate: the card is the draft, this is the room
            // the form is RUN from. Publish/collect/close go through CardActs so Brain
            // and a person cannot disagree about what the card's `questions` mean.
            form: surfaceNode ? <CanvasFormSurface
              data={surfaceNode.data}
              objectId={surfaceNode.id}
              onExit={exitSurface}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            // THE MONTH. It used to be a BOARD surface in the rail — one grid welded to
            // one reading of one board. A calendar is a thing a person can have several
            // of (releases, sends, leave, on-call) and a rail entry is a mode you can
            // only be in one of, so the reading became a value on a `calendar` object and
            // this became the surface that object opens at full size.
            //
            // Note how little the host assembles: the calendar resolves its own source,
            // reads its own window and routes its own writes. That is deliberate — this
            // file is the standing god class, and "know how the calendar fetches" is the
            // kind of knowledge that made it one.
            calendar: surfaceNode ? <CanvasCalendarSurface
              data={surfaceNode.data}
              nodes={nodes}
              onExit={exitSurface}
              onOpenObject={revealObject}
              {...(cardsEditable ? {
                onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch),
                onEditObject: updateNodeData,
              } : {})}
            /> : null,
          }}
        />

        {dockPanel === 'files' && <CanvasFilesPanel
          files={sessionFiles}
          onOpen={revealObject}
          onDownload={downloadCanvasFile}
          onClose={closeDockPanel}
          onImportFile={(file) => addFilesToCanvas([file], undefined, 'drive_import')}
          returnTo={`/create/${sessionId}`}
          onRequireAccount={connectedAccountGate}
        />}
        {gameShipFocus && gamePanelTarget && <CanvasGamePanel
          open
          onClose={() => setGameShipFocus(null)}
          projectId={gamePanelTarget.projectId}
          game={gamePanelTarget.game}
          onNotice={setNotice}
        />}
        {/* Always mounted: a walkthrough survives its own panel being closed. */}
        <CanvasTalktrackPanel
          open={talktrackOpen}
          onClose={() => setTalktrackOpen(false)}
          boardTitle={title}
          focus={selectedNode ? { id: selectedNode.id, title: selectedNode.data.title } : null}
          disabled={!canEdit || lockBlocked}
          onCapture={addHostCapture}
          onNotice={setNotice}
        />
        {publishFocus !== null && sessionId && <CanvasPublishPanel
          open
          onClose={() => setPublishFocus(null)}
          sessionId={sessionId}
          focusObjectId={publishFocus || null}
          onNotice={setNotice}
        />}
        {releaseFocus !== null && sessionId && <CanvasReleasesPanel
          open
          onClose={() => setReleaseFocus(null)}
          sessionId={sessionId}
          objectId={releaseFocus || null}
          onNotice={setNotice}
        />}
        {dockPanel === 'miro' && <CanvasMiroPanel
          onImport={importMiroBoard}
          onClose={closeDockPanel}
          // `/settings/integrations`, not `/settings/connectors` — the latter does not
          // exist, and a "Connect Miro" button that 404s is worse than no button.
          // `ConnectorsGallery` lives on this page under the connectors category, which
          // is where a `miro` connection is actually created. No deep-link query here:
          // the page keeps its category and search in local state and reads no params,
          // so `?category=connectors` would be a promise the destination does not keep.
          connectHref="/settings/integrations"
        />}
        {dockPanel === 'social' && <CanvasSocialPanel
          onAddFeed={addSocialFeedToBoard}
          onAddCampaign={addSocialCampaignToBoard}
          boardMedia={boardMedia}
          onClose={closeDockPanel}
        />}
        {dockPanel === 'ads' && <CanvasAdsPanel onClose={closeDockPanel} />}
        {dockPanel === 'outline' && <CanvasOutlinePanel
          nodes={nodes}
          edges={edges}
          onFocus={(nodeId, rect) => { setSelectedId(nodeId); setSelectedIds([nodeId]); openNodePanel(nodeId, 'config', rect); }}
          onClose={closeDockPanel}
          onVisibleChange={setOutlineHighlightIds}
        />}

        {buildFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label={t('build.focusLabel')}>
          <header><div><strong>{t('build.focusTitle')}</strong><small>{t('build.focusHint')}</small></div><button type="button" onClick={() => setBuildFocus(null)} aria-label={t('build.closeBuilder')}>×</button></header>
          <div className={styles.buildFocusBody}>
            <CanvasBuildPanel
              storageProjectId={buildFocus.storageProjectId}
              initialChatId={initialBuildChatId}
              initialTicket={initialBuildTicket ?? undefined}
              onClose={() => setBuildFocus(null)}
              onProjectRenamed={(name) => setNodes((current) => current.map((node) => node.id === buildFocus.nodeId ? { ...node, data: { ...node.data, title: name } } : node))}
            />
          </div>
        </section>}

        {/* The in-browser Evermind runner, over the section that holds the build steps.
            A panel rather than a modal, like every other canvas surface — the board it
            is reporting on stays visible behind it. */}
        {evermindBuild && <EvermindBuildPanel
          open
          onClose={() => setEvermindBuild(null)}
          graph={evermindBuild.graph}
          workflowName={evermindBuild.name}
          projectId={evermindBuild.projectId}
        />}
        {trainingFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label={t('evermindAdapterStudio')}>
          <header><div><strong>{t('trainEvermindOnCanvas')}</strong><small>{t('trainEvermindHint')}</small></div><button type="button" onClick={() => setTrainingFocus(null)} aria-label={t('closeAdapterStudio')}>×</button></header>
          <div className={styles.workflowFocusBody} style={{ overflow: 'auto', background: 'var(--bg-elevated)', justifyContent: 'center', padding: 20 }}>
            <AITrainingPanel
              projectId={trainingFocus.projectId}
              initialDataMode={trainingFocus.localOnly ? 'local-only' : 'workspace'}
              workspaceEnabled={!trainingFocus.localOnly}
              onJobCompleted={(job) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Adapter trained', trainingJobId: job.id, adapterArtifact: job.r2_artifact_key, model: job.base_model, loraRank: job.lora_rank } } : node));
                setNotice(t('adapterTrained'));
              }}
              onLocalArtifactCompleted={(artifact) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Local adapter trained', adapterArtifact: `local://${artifact.filename}`, trainableParams: artifact.trainableParams } } : node));
                setNotice(t('localAdapterTrained'));
              }}
              onModelPublished={(model) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Published', model: model.ref, modelSlug: model.slug, evermindRef: model.evermindRef, publishedAt: new Date().toISOString() } } : node));
                setNotice(t('noticeEvermindPublished', { ref: model.ref }));
              }}
            />
          </div>
        </section>}

        {/* ONE history panel over TWO stores. A saved board restores a server revision;
            a local one restores a checkpoint held in this browser (`creationCheckpoints.ts`).
            The verbs, the layout and the empty state are shared — only the row source
            and the identifier differ, which is exactly as much as genuinely differs. */}
        {historyOpen && <aside className={styles.historyPanel}>
          <header>
            <div>
              <strong>{t('versionHistory')}</strong>
              <small>{persistence === 'server' ? t('versionHistoryHint') : t('versionHistoryLocalHint')}</small>
            </div>
            <button onClick={() => setHistoryOpen(false)} aria-label={t('closeHistory')}>×</button>
          </header>
          <form
            className={styles.checkpointForm}
            onSubmit={(event) => { event.preventDefault(); createCheckpoint(); }}
          >
            {/* `aria-label` rather than a visually-hidden <label>: this stylesheet has no
                sr-only utility, and inventing one for a single field is a second way to
                hide text that the next person has to discover. The placeholder is a
                HINT and is never the accessible name — a placeholder disappears the
                moment somebody types, which is precisely when they might ask what the
                field was for. */}
            <input
              aria-label={t('checkpointNameLabel')}
              value={checkpointName}
              onChange={(event) => setCheckpointName(event.target.value)}
              placeholder={t('checkpointNamePlaceholder')}
              maxLength={120}
              disabled={!canEdit}
            />
            <button type="submit" className={styles.primaryButton} disabled={!canEdit || !checkpointName.trim()}>{t('nameCheckpoint')}</button>
          </form>
          <div>
            {persistence === 'server'
              ? (history.length
                ? history.map((snapshot) => <button key={snapshot.revision} onClick={() => restoreRevision(snapshot.revision)} disabled={!canEdit}>
                  <b>{snapshot.label || t('revisionLabel', { revision: snapshot.revision })}</b>
                  <span>{t('revisionMeta', { revision: snapshot.revision, at: fmt.dateTime(snapshot.createdAt) })}</span>
                </button>)
                : <p>{t('noRevisions')}</p>)
              : (localCheckpoints.length
                ? localCheckpoints.map((checkpoint) => <button key={checkpoint.id} onClick={() => restoreLocalCheckpoint(checkpoint.id)} disabled={!canEdit}>
                  <b>{checkpoint.label}</b>
                  <span>{t('checkpointMeta', { count: checkpoint.objectCount, at: fmt.dateTime(checkpoint.at) })}</span>
                </button>)
                : <p>{t('noCheckpoints')}</p>)}
          </div>
        </aside>}
        {outcomeMetricsOpen && <aside className={`${styles.historyPanel} ${styles.outcomeMetricsPanel}`} aria-label={t('sessionOutcomeMetrics')}>
          <header><div><strong>{t('ideaToDelivery')}</strong><small>{outcomeMetrics ? t('sessionVsTenant', { count: outcomeMetrics.sampleSize }) : t('valueGenerated')}</small></div><span className={styles.panelHeaderActions}>{persistence === 'server' && <CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyProofJourneyDiagnostics')} getText={buildProofJourneyDiagnostics} />}<button onClick={() => setOutcomeMetricsOpen(false)} aria-label={t('closeOutcomeMetrics')}>×</button></span></header>
          {persistence === 'local' ? <div className={styles.outcomeEmpty}><span aria-hidden><Icon source="↗" size="1em" /></span><strong>{t('saveForBaseline')}</strong><p>{t('saveForBaselineHint')}</p><button className={styles.primaryButton} onClick={() => requireAccount('metrics', t('gateMetricsTitle'), t('gateMetricsBody'))}>{t('saveAndMeasure')}</button></div> : outcomeMetricsLoading ? <p role="status">{t('calculatingValue')}</p> : outcomeMetricsError ? <div className={styles.outcomeEmpty}><strong>{t('metricsUnavailable')}</strong><p>{outcomeMetricsError}</p><button className={styles.secondaryButton} onClick={openOutcomeMetrics}>{t('retry')}</button></div> : outcomeMetrics ? <div className={styles.outcomeMetricList}>
            {(() => {
              // The north star leads, then the acts of the method in order. A flat
              // list said "graded a kill condition" and "published something" were
              // the same kind of news, which is the one claim this method denies.
              const northStar = northStarMetric(outcomeMetrics.metrics, outcomeMetrics.northStarKey);
              const groups = groupOutcomeMetrics(outcomeMetrics.metrics, outcomeMetrics.families ?? []);
              const renderMetric = (metric: CreationOutcomeMetric) => {
                const change = compareOutcomeMetric(outcomeText, metric);
                return <article key={metric.key} className={styles.outcomeMetric}>
                  <div><strong title={outcomeMetricDefinition(outcomeText, metric)}>{outcomeMetricLabel(outcomeText, metric)}</strong><span>{formatOutcomeMetric(outcomeText, metric.current, metric.unit)}</span></div>
                  <small>{metric.baseline == null ? t('baselineGathering') : t('typicalValue', { value: formatOutcomeMetric(outcomeText, metric.baseline, metric.unit) })}{change.delta != null && change.delta !== 0 ? <em data-positive={change.favorable}>{change.favorable ? <Icon source="↗" size="1em" /> : <Icon source="↘" size="1em" />}</em> : null}</small>
                </article>;
              };
              return <>
                {northStar && <div className={styles.outcomeNorthStar}>
                  <b>{t('northStar')}</b>
                  <strong>{outcomeMetricLabel(outcomeText, northStar)}</strong>
                  <span>{formatOutcomeMetric(outcomeText, northStar.current, northStar.unit)}</span>
                  <small>{outcomeMetricDefinition(outcomeText, northStar)}</small>
                  <small>{compareOutcomeMetric(outcomeText, northStar).label}</small>
                </div>}
                {groups.map((group) => <section key={group.family.key}>
                  <h3 className={styles.outcomeFamily}>{outcomeFamilyLabel(outcomeText, group.family)}</h3>
                  {group.metrics.map(renderMetric)}
                </section>)}
              </>;
            })()}
          </div> : null}
          {/* The OTHER half. Everything above measures the PROCESS — how fast and
              how reliably this board produced something — which on its own is a
              productivity report. This reads the ATTRIBUTED facts beside it (the
              `session:`/`site:` dimensioned series the growth and canvas rollups
              already stamp), so the panel can also answer the question the founder
              actually opened it for: did the thing I built do anything for anyone. */}
          {persistence === 'server' && <CanvasAttributedOutcomes sessionId={sessionId} />}
          <footer><span>{t('correlationCoverage')}</span><small>{t('aggregatesScoped')}</small></footer>
        </aside>}
        {conversationOpen && <aside className={styles.historyPanel} aria-label={t('sessionConversation')}><header><div><strong>{t('sessionConversation')}</strong><small>{t('sessionConversationHint')}</small></div><span className={styles.panelHeaderActions}><CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyChatDiagnostics')} getText={buildDiagnostics} /><button onClick={() => setConversationOpen(false)} aria-label={t('closeConversation')}>×</button></span></header><div>{timeline.length ? timeline.map((message) => <article key={message.clientMessageId} style={{ padding: '9px 10px', borderBottom: '1px solid var(--border-subtle)' }}><strong style={{ textTransform: 'capitalize' }}>{message.metadata?.authoredBy?.name || (message.messageRole === 'assistant' ? 'Brain' : message.messageRole)}</strong><p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{message.body}</p><small>{fmt.dateTime(message.createdAt)}</small></article>) : <p>{t('brainEmpty')}</p>}</div></aside>}
        {diagnosticsOpen && <aside className={`${styles.historyPanel} ${styles.diagnosticsPanel}`} aria-label={t('canvasDiagnostics')}><header><div><strong>{t('diagnostics')}</strong><small>{t('diagnosticsHint')}</small></div><button onClick={() => setDiagnosticsOpen(false)} aria-label={t('closeDiagnostics')}>×</button></header><div className={styles.diagnosticsSummary}><dl><div><dt>{t('diagSession')}</dt><dd>{t('diagSessionValue', { persistence, revision: revision.current })}</dd></div><div><dt>{t('diagRealtime')}</dt><dd>{realtimeState}</dd></div><div><dt>{t('diagCanvas')}</dt><dd>{t('diagCanvasValue', { objects: nodes.length, connections: edges.length })}</dd></div><div><dt>{t('brain')}</dt><dd>{t('diagBrainValue', { state: thinking ? t('diagResponding') : t('diagReady'), actions: canvasActions.length })}</dd></div><div><dt>{t('diagScope')}</dt><dd>{resolvedScopeMode}</dd></div><div><dt>{t('diagAccess')}</dt><dd>{sessionRole}</dd></div></dl><CopyButton label={t('copyDiagnostics')} ariaLabel={t('copyCanvasDiagnostics')} getText={buildDiagnostics} /></div></aside>}

        {!!proposedChanges.length && <aside className={styles.changeSetPanel}><header><div><strong>{t('reviewBrainChanges')}</strong><small>{t('reviewBrainChangesHint')}</small></div><button onClick={rejectProposedChanges} aria-label={t('closeChangeSet')}>×</button></header><div>{proposedChanges.map((change) => <label key={change.id}><input type="checkbox" checked={acceptedProposalIds.has(change.id)} onChange={() => setAcceptedProposalIds((current) => { const next = new Set(current); if (next.has(change.id)) next.delete(change.id); else next.add(change.id); return next; })} /><span><b>{change.label}</b><small>{change.type.replace('.', ' ')}</small></span></label>)}</div><footer><button className={styles.secondaryButton} onClick={rejectProposedChanges}>{t('rejectAll')}</button><button className={styles.secondaryButton} disabled={!acceptedProposalIds.size} onClick={applyAndEnableAutoApply} title={t('applyAutoApplyHint')}>{t('applyAutoApply')}</button><button className={styles.primaryButton} disabled={!acceptedProposalIds.size} onClick={applyProposedChanges}>{t('applySelected', { count: acceptedProposalIds.size })}</button></footer></aside>}
        {mergeReview && <aside className={styles.mergePanel}><header><div><strong>{t('mergeBranch')}</strong><p>{t('mergeBranchHint')}</p></div><button onClick={() => setMergeReview(null)} aria-label={t('closeMergeReview')}>×</button></header>{mergeReview.items.map((item) => <label key={item.key}><b>{item.source.data.title}</b><small>{item.target ? t('mergeBothContain', { kind: item.source.data.kind }) : t('mergeNewFromBranch', { kind: item.source.data.kind })}</small>{item.target && <span><select aria-label={t('mergeChoiceFor', { title: item.source.data.title })} value={item.choice} onChange={(event) => setMergeReview((current) => current ? { ...current, items: current.items.map((candidate) => candidate.key === item.key ? { ...candidate, choice: event.target.value as 'branch' | 'parent' } : candidate) } : current)}><option value="branch">{t('useBranchVersion')}</option><option value="parent">{t('keepParentVersion')}</option></select></span>}</label>)}<button className={styles.primaryButton} onClick={applyMerge}>{t('applyReviewedMerge')}</button></aside>}

        {/* Docked ONLY. An inline Brain renders inside its Object on the graph, and a
            surface that IS the conversation renders it full-bleed, so rendering the edge
            panel alongside either would put the same live conversation on screen twice —
            the duplicate this placement model exists to prevent. */}
        {brainDockDrawn && <BrainDock
          // The prompt, when the reader has docked it — rendered as the panel's last row
          // rather than as a card parked under it. See `BrainDock`'s header.
          {...(promptInBrainPanel ? { composer, onUndockPrompt: () => setPromptPlacement('float') } : {})}
          mode={brainPlacement}
          side={brainDock.side}
          size={brainDock.size}
          width={brainDockWidth(brainDock)}
          showExecutionDetail={brainDock.showExecutionDetail}
          onModeChange={(mode) => updateBrainDock({ mode })}
          onSideChange={(side) => updateBrainDock({ side })}
          // Switching preset clears a stale drag width, so "expand" always expands.
          onSizeChange={(size) => updateBrainDock({ size, width: null })}
          onWidthChange={(width, commit) => updateBrainDock({ width }, commit)}
          onExecutionDetailChange={(showExecutionDetail) => updateBrainDock({ showExecutionDetail })}
          onClose={() => updateBrainDock({ open: false })}
          messages={brainMessages}
          revealMessage={brainReveal}
          trace={brainTrace}
          running={brainRunning}
          runStartedAt={brainRunShownStartedAt}
          node={brainNode}
          nodes={nodes}
          edges={edges}
          collaborators={brainCollaborators}
          joinedCollaborator={joinedCollaborator}
          onReplayMessage={replayBrainMessage}
          onRateMessage={brainSurface.onRateMessage}
          ratings={brainSurface.ratings}
          guestSignup={guestSignupPrompt}
        />}
        {/* Floating over the board. A docked prompt is not drawn here at all — it is a row
            inside the panel above, and rendering it in both places would mount the same
            live composer twice. */}
        {!promptInBrainPanel && composer}
        {/* The way back to a closed Brain, and the only thing that says a reply arrived
            while it was shut. An inline Brain with its Object still on the board offers
            its own way back, so this appears only when there is none.

            THE COUNT IS WHAT MAKES "BRAIN NEVER COVERS THE SURFACE" HONEST: on a phone
            the dock is a sheet the reader opens, and without a count "open it when you
            want it" means "open it every thirty seconds in case". It WINS the label when
            there is one — "Show Brain chat" beside a badge names itself twice. */}
        {!presentMode && !brainDock.open && !surfaceDef.brainIsSurface && (brainPlacement === 'docked' || !brainNode) && (() => {
          const label = brainUnreadReplies > 0
            ? t('brainLauncher.unread', { count: brainUnreadReplies })
            : thinking ? t('openBrainDockBusy') : t('openBrainDock');
          return <button
            type="button"
            className={styles.brainDockLauncher}
            data-testid="canvas-brain-launcher"
            data-side={brainDock.side}
            data-state={thinking ? 'running' : brainUnreadReplies > 0 ? 'unread' : 'idle'}
            aria-label={label}
            title={label}
            onClick={() => updateBrainDock({ open: true })}
          ><BrainMark running={thinking} size={14} />{brainUnreadReplies > 0 ? t('brainLauncher.unread', { count: brainUnreadReplies }) : t('brain')}</button>;
        })()}
        {/* THE PHONE'S COMMAND BAR: one sheet, opened from the composer's "+", holding
            every registry action under the same arc captions the desktop bar uses.
            Mounted only while open. */}
        {actionsOpen && <CanvasActionsSheet
          surface={surface}
          handlers={sessionActionHandlers}
          // The one door the registry does not own: the palette opens against the
          // pressed button's own screen rect, so the chrome that draws the button
          // contributes it — through the same `CanvasBarGroupSlots` seam the bar uses.
          slots={{
            idea: {
              lead: surface === 'graph' ? <button
                type="button"
                data-testid="canvas-actions-quick-add"
                aria-label={t('quickAdd')}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setActionsOpen(false);
                  setNodePanel(null);
                  setObjectPicker({ anchor: { x: Math.max(12, Math.min(rect.left, window.innerWidth - 412)), y: Math.max(12, rect.top - 330) } });
                }}
              ><span aria-hidden><AddObjectIcon /></span>{t('quickAdd')}</button> : undefined,
            },
          }}
          onClose={closeActionsSheet}
        />}
      </div>
      {/* TWO TOURS, TWO SUBJECTS. The one below teaches the CANVAS — dock, palette,
          Share — and is offered on somebody's first board. This one walks what the
          board CONTAINS, and is offered once per board that has enough on it to get
          lost in. Neither is a place the other's steps should have been added to:
          "where is the palette" and "what are these twenty-four things" are asked by
          different people at different moments. */}
      <CanvasWalkthrough
        ref={walkthroughRef}
        boardId={sessionId}
        audienceId={currentUserId || (persistence === 'local' ? 'guest' : null)}
        stops={walkthroughStops}
        busy={thinking}
        onReveal={revealObject}
      />
      <SectionTour
        phase={sectionTour.phase}
        step={sectionTour.step}
        steps={tourSteps}
        label={t('tourLabel')}
        offerTitle={t('tourOfferTitle')}
        offerBody={t('tourOfferBody')}
        startLabel={t('tourStart')}
        cancelLabel={t('tourCancel')}
        closeLabel={t('tourClose')}
        backLabel={t('back')}
        nextLabel={t('next')}
        finishLabel={t('startCreating')}
        stepLabel={(current) => t('tourStep', { step: current })}
        onStart={sectionTour.start}
        onCancel={sectionTour.cancel}
        onNext={() => sectionTour.next(tourSteps.length)}
        onBack={sectionTour.back}
        onStepChange={prepareTourStep}
      />
    </div>
    </CanvasDiagnosticsProvider></CanvasSpacePresenceProvider></CanvasBoardBridgeProvider></CardActProvider>
    </CanvasSurfaceProvider>
  );
}

export function CreationCanvas({ sessionId, persistence = 'server', initialFocusId, initialShareOpen, initialBuildOpen, initialBuildChatId, initialBuildTicket, initialPrompt, initialPresent, initialModelComparisonIds, stageActive = true, hostSurfaces, initialSurface, onExitToLibrary }: { sessionId: string; persistence?: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialBuildOpen?: boolean; initialBuildChatId?: number | null; initialBuildTicket?: { kind: string; ref: string } | null; initialPrompt?: string | null; initialPresent?: boolean; initialModelComparisonIds?: readonly string[]; stageActive?: boolean; /** Surfaces the embedding host implements itself — see `CanvasSurfaceRouter`. VS Code supplies `chat`, whose runs execute in the extension host. */ hostSurfaces?: CanvasSurfaceNodes; /** The surface this ENTRY asked for, above the stored preference — what "open my chat" means. */ initialSurface?: CanvasSurfaceId;
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
  return <ReactFlowProvider><Canvas3DControlsProvider><CanvasSurfaceActionsProvider><CanvasInner sessionId={sessionId} persistence={persistence} initialFocusId={initialFocusId} initialShareOpen={initialShareOpen} initialBuildOpen={initialBuildOpen} initialBuildChatId={initialBuildChatId} initialBuildTicket={initialBuildTicket} initialPrompt={initialPrompt} initialPresent={initialPresent} initialModelComparisonIds={initialModelComparisonIds} stageActive={stageActive} hostSurfaces={hostSurfaces} initialSurface={initialSurface} onExitToLibrary={onExitToLibrary} /></CanvasSurfaceActionsProvider></Canvas3DControlsProvider></ReactFlowProvider>;
}
