'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent } from 'react';
import dynamic from 'next/dynamic';
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
import { AccessibleOutlineIcon, AddObjectIcon, CANVAS_FIT_MIN_ZOOM, CanvasCommands, CanvasAdsIcon, CanvasFilesIcon, CanvasMiroIcon, CanvasSocialIcon, CleanLayoutIcon, ClosePaletteIcon, DepthIcon, DropToLayersIcon, FitViewIcon, LayerGuidesIcon, MarqueeSelectIcon, MinimapIcon, MoreActionsIcon, ResetViewIcon, useCanvasCleanLayout, ZoomInIcon, ZoomOutIcon } from '@/components/canvas/CanvasCommands';
import type { Canvas3DMove, Canvas3DViewProps } from '@/components/canvas/Canvas3DView';
import { Canvas3DControlsProvider, useCanvas3DControls } from '@/components/canvas/canvas3dControls';
import { canvasSurfaceDefinition, readCanvasSurface, writeCanvasSurface, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { canvasChromeShows, readCanvasBarCollapsed, writeCanvasBarCollapsed } from '@/lib/canvasChrome';
import { canvasApp } from '@/lib/canvasApp';
import { isTypingTarget } from '@/lib/keyboardTarget';
import { canvasNodeMessages, canvasNodeSettingsPanel, canvasPersonOrigin, isCanvasPersonKind, type CanvasNodePanelId } from '@/lib/canvasNodeAffordances';
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
import { CanvasSurfaceRouter } from './CanvasSurfaceRouter';
import { CanvasSurfaceSwitcher } from './CanvasSurfaceSwitcher';
import { CanvasSessionActions, type CanvasSessionActionHandler } from './CanvasSessionActions';
import { CanvasSessionPill } from './CanvasSessionPill';
import { RemoteCursors } from './RemoteCursors';
import { applyPresenceFrame, dropPresence, expirePresence, isPresenceFrame, mergeLivePresence, LIVE_PRESENCE_TTL_MS, PRESENCE_SEND_INTERVAL_MS, type LivePresenceMap } from '@/lib/canvas/livePresence';
import { CANVAS_PRESENCE_FRAME, type CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { CanvasCommandBar } from './CanvasCommandBar';
import { TeamBar } from '@/components/team/TeamBar';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import { CanvasChatSurface } from './CanvasChatSurface';
import { CanvasAppSurface } from './CanvasAppSurface';
import { CanvasPageSurface } from './CanvasPageSurface';
import { CanvasResumeEditor } from './CanvasResumeEditor';
import { CanvasPlaySurface } from './CanvasPlaySurface';
import { CanvasSiteSurface } from './CanvasSiteSurface';
import { CanvasTimelineSurface } from './CanvasTimelineSurface';
import { CanvasSurfaceProvider } from './canvasSurfaceContext';
import { CanvasSurfaceActionsProvider } from './canvasSurfaceActions';
import { applyCanvas3DMoves, canvas3dDepthOffset, type Canvas3DDescriptor } from '@/components/canvas/canvas3d';
import { CanvasOutlinePanel } from './CanvasOutlinePanel';
import { CanvasFilesPanel } from './CanvasFilesPanel';
import { CanvasMiroPanel } from './CanvasMiroPanel';
import type { MiroBoardSummary, MiroImportResult } from '@/lib/miroImport';
import { CanvasSocialPanel } from './CanvasSocialPanel';
import { CanvasAdsPanel } from './CanvasAdsPanel';
import { CanvasEmailComposer } from './CanvasEmailComposer';
import { CanvasHostActions } from './CanvasHostActions';
import { canvasNavigate, canvasSurface, canvasWebOrigin, type CanvasHostCapture } from '@/lib/canvasHost';
import { BrainDock } from './BrainDock';
import { BrainActivityIndicator } from './BrainActivityView';
import { brainDockReservedWidth, brainDockWidth, DEFAULT_BRAIN_DOCK_PREFERENCES, readBrainDockPreferences, writeBrainDockPreferences, type BrainDockMode, type BrainDockPreferences } from './brainDockPreferences';
import { BrainSurfaceProvider, type BrainSurfaceContextValue } from './brainSurfaceContext';
import { useToast } from '@/components/ToastProvider';
import { CreationNode, type CreationFlowNode } from './CreationNode';
import type { CreationNodeData, CreationObjectKind } from './types';
import { AUTHORED_DRAWING_STROKE, AUTHORED_WEBSITE_ACCENT } from './authoredColors';
import { DiagramConvertPanel } from './DiagramConvertPanel';
import styles from './CreationCanvas.module.css';
import { agileMetricsApi, ceremonySessionsApi, creationSessionsApi, llmApi, pmoApi, runtimeApi, specsApi, tasksApi, taskSpecsApi, toolsApi, workflowDefinitions, type CanvasResumeShare, type CreationOutcomeMetrics, type CreationSessionActivity, type CreationSessionComment, type CreationSessionDetail, type CreationSessionInvitation, type CreationSessionSummary, type CreationSnapshotSummary, type CreationTemplate as ServerCreationTemplate, type CreationTimelineMessage, type PmoScopeKind } from '@/lib/builderforceApi';
import { creationGraphFromSnapshot, creationStorageKey, localCreationSnapshot, readLocalCreationSession, writeLocalCreationSession, type LocalCreationSnapshot } from '@/lib/creationSessions';
import { answersComplete, defaultInput, questionIds, type ToolResult } from '@/lib/tools';

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
import { useGuestRoom } from '@/lib/useGuestRoom';
import { guestMediaTransport } from '@/lib/guestRoomApi';
import { useCanvasLiveRoom } from '@/lib/live/useCanvasLiveRoom';
import { GuestInviteLink } from '@/components/guest/GuestInviteLink';
import {
  createGuestRoom, leaveGuestRoom, fetchGuestRoomCanvas, pushGuestRoomCanvas,
  getActiveGuestRoom, getGuestDisplayName, setGuestDisplayName,
} from '@/lib/guestRoomApi';
import { CanvasRunAbortedError, GuestAiUnavailableError, isCanvasRunAborted, runCreationCanvasAi, type CanvasAiCompletion } from '@/lib/creationCanvasAi';
import { canvasNoticesFrom } from '@/lib/canvasNotices';
import { canvasTranscriptForModel } from '@/lib/canvasTranscript';
import { approvalGuidance, evaluateGate, readProvenance, type ApprovalMode } from '@/lib/canvasApprovalGate';
import { sheetFormulaGuidance } from '@/lib/canvasSheet';
import { deadlineBearingKinds, isSpecObjectKind, makeSpecDeriveBoard, specRefKey } from '@/lib/specObjects';
import { learnersFromCohort } from '@/lib/academic/gradebook';
import { statsOf, curriculumMapProblems, mappingRows } from '@/lib/academic/derivations';
import { applyRubric, applyLatePolicy, hoursLate, parseLatePolicy, rubricFromNode, rubricProblems, type CriterionSelection } from '@/lib/academic/marking';
import { parseRosterCsv, type RosterRow } from '@/lib/academic/roster';
import { parseReferences, entryRowFromRecord } from '@/lib/academic/citations';
import { pullLtiRoster, pushLtiScore } from '@/lib/ltiApi';
import { FORMULA_FUNCTIONS } from '@/lib/canvasFormula';
import type { BrainAction, BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { ProjectEvermindPanel } from '@/components/builder/ProjectEvermindPanel';
import { EvermindValidationProvider } from '@/components/builder/EvermindValidationContext';
import { getProjectEvermindContributions, getProjectEvermindHead, recallProjectEvermind, teachProjectEvermindFromText, type ProjectEvermindContributions, type ProjectEvermindHead } from '@/lib/projectEvermindApi';
import { isAwaitingApprovalExecution } from '@/lib/builderforceApi';
import { hiringApi } from '@/lib/hiringApi';
import { screenCandidates } from '@/lib/canvasResumeScreening';
import { guestLimitRefusal, type GuestLimitRefusal } from '@/lib/guestLimit';
import { GuestSignupCta, type GuestSignupPrompt } from '@/components/GuestSignupCta';
import { ApiRequestError } from '@/lib/apiClient';
import { resolveCanvasImage, type CanvasImageResolveMode } from '@/lib/canvasImageAssets';
import { evaluateModel, fetchProjects, publishSite } from '@/lib/api';
import { computeProjectHealth } from '@/lib/projectHealth';
import { createCloudAgent, updateAgent } from '@/lib/api';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, createDefaultCreationData, creationObjectDefinition, emptyShellProblem, sanitizeCreationObjectPatch, type CreationObjectGroup } from './creationObjectRegistry';
import { CREATION_TEMPLATES, type CreationTemplate } from './creationTemplates';
import { describeMailboxFilter, mailboxApi, resolveMailboxConnection, type MailboxFilter } from '@/lib/mailboxApi';
import { describeSocialFilter, socialApi, totalEngagement, type SocialCampaign, type SocialFeedFilter, type SocialFeedItem, type SocialNetwork } from '@/lib/socialApi';
import { canvasSocialToolRedirect, isSocialNetworkName, socialCampaignNodeData, socialFeedPatch, socialPostNodeData, socialPostProjection } from '@/lib/canvasSocial';
import { canvasMediaSource, isCanvasMediaKind, resolvePublicMediaUrls } from '@/lib/canvasPublicMedia';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { analyzeDependencies, appendCanvasVideoSource, canvasGameToolRedirect, canvasImageToolRedirect, canvasToolRequiresAccount, canvasVideoDuration, canvasVideoSourcesFrom, canvasVideoTimelineFrom, checkDataUse, findingFingerprint, normalizeQaSteps, CANVAS_GAME_ACCOUNT_GATE, CANVAS_GAME_TOOL, CANVAS_IMAGE_ACCOUNT_GATE, CANVAS_IMAGE_TOOL, CANVAS_QA_ACCOUNT_GATE, CANVAS_SOCIAL_ACCOUNT_GATE, CREATION_CONNECTION_KINDS, CREATIVE_CAPABILITIES, DATA_PURPOSES, GAME_PLATFORMS, isGamePlatform, LAWFUL_BASES, QA_FINDING_TYPES, QA_SEVERITIES, QA_STEP_ACTIONS, type CanvasVideoSource, type CreationConnectionKind, type DataPurpose, type DataUsePolicy, type DependencyAnalysis, type LawfulBasis, type QaFindingSeverity, type QaFindingType } from '@builderforce/creation-canvas-contract';
import { getStoredTenantToken } from '@/lib/auth';
import { claimLocalDraft } from '@/lib/pendingWork';
import { downloadBlob, downloadJson, downloadText, toCsv } from '@/lib/download';
import { OfficeExportUnavailableError, exportCsv, exportDocx, exportPdf, exportPptx, exportXlsx } from '@/lib/exportApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import {
  MAX_MATERIALIZED_ROWS, MAX_TABULAR_COLUMNS, TABULAR_AGGREGATE_OPERATORS, TABULAR_FILTER_OPERATORS,
  TABULAR_TIME_GRAINS, TABULAR_WINDOW_OPERATORS,
  profileTabular, queryTabular, tabularFromObject,
  type TabularHighlightRule, type TabularQuery, type TabularSource, type TabularTimeGrain,
} from '@/lib/canvasTabularData';
// ── The data-science stages: analysis, model, evaluation, ship ──────────────────
// Every one of these is a pure module over rows that are already on the board, which
// is why the tools built on them are guest-safe: a visitor evaluating the product can
// profile a distribution, project a trend and sample an eval set without an account.
import { runNotebook } from '@/lib/canvasNotebook';
import { rowBasis } from '@/lib/canvasDatasetVersion';
import { trainingRunFields } from '@/lib/canvasTrainingRun';
import { compareRuns } from '@/lib/canvasRunComparison';
import { sampleRows } from '@/lib/canvasLabelSet';
import { forecastSeries, seriesFromDataset } from '@/lib/canvasForecast';
import { fetchTrainingJob, fetchTrainingLogs, listTrainingJobs } from '@/lib/api';
import {
  DATA_MODEL_CARDINALITIES,
  DATA_MODEL_TYPES,
  SQL_DIALECTS,
  dataModelFromIntrospection,
  dataModelFromTabular,
  dataModelSummary,
  entityKey,
  normalizeDataModel,
  readDataModel,
  validateDataModel,
  type DataModel,
  type SqlDialect,
} from '@/lib/canvasDataModel';
import { dataModelDdl, dataModelMermaid } from '@/lib/canvasDataModelDdl';
import {
  DATA_CLASSIFICATIONS, PII_CATEGORIES,
  classificationSummary, classifyTabular, contractVerdict, evaluateDataContract, inferDataContract,
  normalizeClassifications, normalizeDataContract,
} from '@/lib/canvasDataGovernance';
import {
  DATA_QUALITY_CHECK_KINDS, checksFromContract, dataQualityVerdict, normalizeDataQualityChecks,
  referenceSources, runDataQualityChecks, suggestDataQualityChecks,
} from '@/lib/canvasDataQuality';
import {
  METRIC_DIRECTIONS, METRIC_FORMATS,
  computeMetric, computeMetricSeries, formatMetricValue, normalizeMetricDefinition,
} from '@/lib/canvasMetrics';
import { TABULAR_JOIN_TYPES, joinTabular, suggestJoinKeys, type TabularJoinKey } from '@/lib/canvasTabularJoin';
import { buildLineageGraph, columnImpact, impactOf, lineagePatch, staleDerivatives, upstreamOf } from '@/lib/canvasLineage';
import { dataSourceApi, resolveDataSource, type DataSourceSummary } from '@/lib/dataSourceApi';
import { detectGeoColumns, mapObjectFields, mapPointsFromRows } from '@/lib/canvasGeo';
import { analyzeCompetitorGeography, competitorSitesFrom } from '@/lib/competitorGeo';
import { evaluateCanvasTriggers, isDateComparator, triggerUnboundHint } from '@/lib/canvasTriggers';
import { useCoarsePointer } from '@/lib/useCoarsePointer';
import { canvasInteractionProps, type CanvasGesture } from './canvasPointerMode';
import { canvasStrokes, drawingPatch, DRAWING_TOOLS, eraseStrokes, strokesSvg, type CanvasDrawingTool, type CanvasStroke } from '@/lib/canvasDrawing';
import { DEFAULT_DRAWING_PREFERENCES, readDrawingPreferences, writeDrawingPreferences, type DrawingPreferences } from './drawingPreferences';
import { useChromeSpace } from './useChromeSpace';
import {
  fileToDataUrl, importCanvasFile, type AttachmentBytesStrategy, type ImportTranslator,
} from '@/lib/canvasFileImport';
import { uploadAttachmentSource } from '@/lib/canvasAttachmentUploadApi';
import { importResumeFromAttachment } from '@/lib/resumeImportApi';
import { boardInventory, findInInventory, scopeNote } from '@/lib/canvasContextSnapshot';
import {
  RESUME_TEMPLATES, RESUME_TEMPLATE_IDS, activeResumeRevision, createResumeFamily,
  initializeResumeFromPatch, preserveResumeSourceForPatch, renderResumeMarkdown,
  resumeDocumentFromJson, resumeDocumentFromNode,
  resumeFamilyFromNode, resumeNodePatch, resumeTemplateVariants, type ResumeTemplateId,
} from '@/lib/canvasResume';
import { resumeDocumentFromText, resumeDocumentIsThin } from '@builderforce/creation-canvas-contract';
import { renderedCanvasResume, resumeHtmlFile } from '@/lib/canvasResumeRenderer';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { createCanvasJournal, describeGraphChange } from '@/lib/canvasActionJournal';
import { readStoredJournal, writeStoredJournal } from '@/lib/canvasJournalStore';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { Icon } from '@/components/ui/Icon';
import { appendImageToDrawioCanvas, createDrawioImageCanvas } from '@/lib/drawioImageCanvas';
import { convertGraphSource, diagramConvertSource, diagramConvertTargets } from '@/lib/canvasDiagramConvert';
import { DIAGRAM_TARGETS, diagramNotation } from '@/lib/diagramNotations';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';
import { VoiceOutput } from '@/components/builder/VoiceOutput';
import { useVoiceStudio } from '@/lib/voiceStudio';
import { CopyButton } from '@/components/CopyButton';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildCreationCanvasDiagnosticsReport } from '@/lib/creationCanvasDiagnostics';
import { alignCanvasNodesLeft, arrangeCanvasNodes, canvasArrangementTargets, canvasNodeDimensions, canvasPlacementUnlocked, nextCanvasObjectPosition, type CanvasArrangement } from './creationCanvasLayout';
import { isBrainAutoApprove, setBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useConfirm } from '@/components/ConfirmProvider';
import { SectionTour, type SectionTourStep } from '@/components/onboarding/SectionTour';
import { useSectionTour } from '@/components/onboarding/useSectionTour';
import { canvasTourDesignFromNode, defaultCanvasTourDesign, type CanvasTourDesign } from '@/lib/onboarding/canvasTourDesign';
import { useChatModelOptions } from '@/lib/useLlmModels';
import { ChatInput, type ChatModelSelection } from '@/components/ChatInput';
import { PromptUseCasePicker } from '@/components/PromptUseCasePicker';
import {
  C_SUITE_CANVAS_USE_CASES,
  C_SUITE_USE_CASE_IDS,
  cSuiteCanvasOwner,
  cSuiteCanvasWorkflow,
  executiveUseCaseFromPrompt,
  resolveExecutiveUseCaseId,
} from '@/lib/templates/promptUseCases';
import { applyTemplateEntry } from '@/lib/templates/apply';
import { useTemplateCatalog } from '@/lib/templates/useTemplateCatalog';
import { matchesTemplateQuery } from '@/lib/templates/contract';
import { DOMAINS, getDomainItems, getDomainMetrics, getDomainSummary, getEntityRows, getScopeEntities, isDomain } from '@/lib/kernel/kernelApi';
import { TwilioCanvasSetup } from './TwilioCanvasSetup';
import { NEW_CHAT_MODE, normalizeChatMode, useQueuedTurns, type ChatMode } from '@/lib/brain';
import { runCanonicalCanvasGroupTurn } from '@/lib/creationAgentChat';
import { buildBrowserCreativeArtifact, buildWebsiteAssets, creationDeliverables, creativeBrief, creativeMeshGeometry, creativePreviewImageUrl, evermindMediaArtifact, generateEvermindMedia, generateServerCreativeArtifact, mediaFrameDataUrl, navigableArtifactUrl, withCreationDeliverable, EVERMIND_CREATIVE_KINDS, SERVER_CREATIVE_KINDS, type CreationDeliverable, type CreativeArtifact } from '@/lib/creationDeliverables';
import { canvasDiagram, canvasDocument, canvasFiles, canvasObjectMarkdown, type CanvasFile } from '@/lib/canvasDocuments';
import { EXPORT_EXTENSION, EXPORT_MIME, SERVER_RENDERED_ACTIONS, defaultExportAction, pdfExportStrategy, type CanvasExportAction } from '@/lib/canvasExports';
import {
  PITCH_COMPETITIONS, PITCH_MAX_SCORE, formatPitchDuration, pitchApplicationAnswers,
  pitchApplicationReadiness, pitchBeats, pitchCompetitionFor, pitchCriteria, pitchEligibility, pitchQaCoverage,
  pitchQaItems, pitchReadiness, pitchRuntimeSeconds, pitchSpokenSeconds, pitchTimingTone, type PitchLabelled,
} from '@/lib/pitchCompetition';
import { markdownHtmlDocument, printCanvasObject } from '@/lib/printDocument';
import { canvasObjectSvg } from '@/lib/renderedSvg';
import { CanvasExportActions, canvasExportActionsFor } from './CanvasExportActions';
import { SellInMarketplace } from './SellInMarketplace';
import { CourseSubjectControl, PracticeAuthoring, ReadingLevelControl } from './LearningControls';
import { listEvermindModels } from '@/lib/studioModelsApi';
import { canvasProjectId, canvasProjectNodes, connectedCanvasProjectNode } from '@/lib/canvasProjectRef';
import {
  buildTestPlan, coverageReport, defectFromResult, normalizeExitCriteria, planGateVerdict,
  readTestCases, readTestResults, relowerCase, releaseEvidence, routesFromHtml, summarizeRun,
  testTargetUrl, type BuildPlanInput, type GateEvidence,
} from '@/lib/canvasQa';
import { auditPageHtml } from '@/lib/canvasPageAudit';
import { generateFixture } from '@/lib/canvasTestData';
import * as qaApi from '@/lib/qa/api';
import { canvasBuildBinding, canvasBuildModality, canvasBuildPatch, createCanvasBuild } from '@/lib/canvasBuild';
import { canvasBuildActions, type BoundCanvasBuild } from '@/lib/canvasBuildTools';
import { canvasFounderOpsActions, type CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import { canvasLegalDocumentActions } from '@/lib/canvasLegalDocumentTools';
import { canvasSignatureActions } from '@/lib/canvasSignatureTools';
import { sendInvestorUpdate } from '@/lib/founderOpsApi';
import { notifyWorkspaceFilesChanged } from '@/lib/workspaceFileEvents';
import { canvasWebPageUrl, normalizeWebPageUrl, webPageHost } from '@/lib/canvasWebPage';
import { canvasViewport } from '@/lib/canvasViewport';
import { deleteIdeProject, listIdeProjects } from '@/lib/api';
import { CREATIVE_GENERATOR_KINDS } from '@/lib/creationObjectGroups';
import {
  kindSettingsActions,
  kindSettingsFields,
  kindSettingsManifest,
  kindSettingsSellable,
} from '@/lib/canvasKindSettings';
import { SettingsFieldControl } from './SettingsFieldControl';
import { TimingFields } from './TimingFields';
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
import { useLocalizedModalities, useModalityCopy } from '@/lib/useModalityCopy';
import type { ProjectModality } from '@/lib/modality';
import { buildLlmCourse, buildScormPackage, courseFromNode } from '@/lib/courseLms';
import { executeModelComparison } from '@/lib/modelComparison';
import { normalizeModelComparisonIds } from '@/lib/modelComparisonRequest';
import { authoredWebsiteProblem, patchWebsiteHero, websiteHeroFrom, websiteThemeFrom } from './websiteWysiwyg';
import { builtinAgentSurfaceHref, type BuiltinAgentSurfaceIntent } from '@/lib/team/builtinAgentSurface';

const Canvas3DView = dynamic(
  () => import('@/components/canvas/Canvas3DView')
    .then((module) => module.Canvas3DView as ComponentType<Canvas3DViewProps<CreationFlowNode>>),
  { ssr: false },
);
// Real WebGL (three.js + react-three-fiber + Rapier's WASM physics) — the
// heaviest dependency this canvas pulls in, and the first one. Dynamic +
// `ssr: false` for the same reason Canvas3DView is: no server-side render,
// and it must not sit in the main chunk for people who never open a `world`.
const CanvasWorldView = dynamic(
  () => import('./CanvasWorldView').then((module) => module.CanvasWorldView),
  { ssr: false },
);
const VoiceConfigPanel = dynamic(
  () => import('@/components/builder/VoiceConfigPanel').then((module) => module.VoiceConfigPanel),
  { ssr: false },
);
const AITrainingPanel = dynamic(
  () => import('@/components/AITrainingPanel').then((module) => module.AITrainingPanel),
  { ssr: false },
);
const CanvasGamePanel = dynamic(
  () => import('./CanvasGamePanel').then((module) => module.CanvasGamePanel),
  { ssr: false },
);
const CanvasPublishPanel = dynamic(
  () => import('./CanvasPublishPanel').then((module) => module.CanvasPublishPanel),
  { ssr: false },
);
const CanvasReleasesPanel = dynamic(
  () => import('./CanvasReleasesPanel').then((module) => module.CanvasReleasesPanel),
  { ssr: false },
);

const DND_MIME = 'application/x-builderforce-creation-object';
/**
 * How long an outcome message holds the pill's one status line before the routine
 * save state may take it back. Long enough to read a sentence; short enough that
 * "Saved on this device" is still the resting state a moment later.
 */
const OUTCOME_HOLD_MS = 4_000;
const COURSE_AUTHORING_CONTRACT = '{ version, language, audience, description, estimatedMinutes, passingScore, completedLessonIds: [], modules: [{ id, title, description, lessons: [{ id, title, objective, content, activity, durationMinutes }], assessment: { question, choices, answer, explanation } }] }';
const COURSE_AUTHORING_SCHEMA = {
  type: 'object',
  required: ['version', 'language', 'audience', 'description', 'estimatedMinutes', 'passingScore', 'completedLessonIds', 'modules'],
  properties: {
    version: { type: 'string' }, language: { type: 'string' }, audience: { type: 'string' }, description: { type: 'string' },
    estimatedMinutes: { type: 'number' }, passingScore: { type: 'number' }, completedLessonIds: { type: 'array', items: { type: 'string' } },
    modules: {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['id', 'title', 'description', 'lessons', 'assessment'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
          lessons: {
            type: 'array', minItems: 1, items: {
              type: 'object', required: ['id', 'title', 'objective', 'content', 'activity', 'durationMinutes'],
              properties: { id: { type: 'string' }, title: { type: 'string' }, objective: { type: 'string' }, content: { type: 'string' }, activity: { type: 'string' }, durationMinutes: { type: 'number' } },
            },
          },
          assessment: {
            type: 'object', required: ['question', 'choices', 'answer', 'explanation'],
            properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } }, answer: { type: 'number' }, explanation: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;
const GUIDED_TOUR_AUTHORING_SCHEMA = {
  type: 'object',
  required: ['version', 'minimumVisits', 'offerTitle', 'offerBody', 'startLabel', 'cancelLabel', 'blurBackground', 'escapeHatch', 'steps'],
  properties: {
    version: { type: 'number' }, minimumVisits: { type: 'number' }, offerTitle: { type: 'string' }, offerBody: { type: 'string' },
    startLabel: { type: 'string' }, cancelLabel: { type: 'string' }, blurBackground: { type: 'boolean' }, escapeHatch: { type: 'boolean', const: true },
    steps: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'title', 'body', 'targetObjectId'], properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, targetObjectId: { type: 'string', description: 'Canvas object id to spotlight; use an empty string until a target exists.' } } } },
  },
} as const;
const PALETTE_COLLAPSE_STORAGE_KEY = 'builderforce:create:palette-collapsed-groups';
const PALETTE_OPEN_STORAGE_KEY = 'builderforce:create:palette-open';
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
const ACCOUNT_REQUIRED_OBJECT_ACTIONS =new Set(['publish', 'deliver', 'assign', 'authenticate', 'execute', 'record', 'train', 'start', 'compare', 'build']);

/**
 * ONE shape for every "this needs a free account" tool answer.
 *
 * `error` is deliberate rather than a softer `message`: it is the field the canvas tool
 * loop keeps as `lastToolError`, so a turn that ends without a reply still tells the
 * user the real reason instead of "I couldn't prepare any canvas changes from that
 * request". `requiresAccount` distinguishes a gate from a genuine failure for anything
 * reading the trace. The account prompt is already open by the time the model reads it.
 */
function accountGateResult(tool: string, reason: string): { requiresAccount: true; tool: string; error: string } {
  return { requiresAccount: true, tool, error: reason };
}
const CONNECTED_CANVAS_ACTIONS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  website: ['publish'], video: ['generate'], build: ['open'],
  // `build` compiles the authored steps into a real workflow definition; `run`
  // executes one. Run builds first when needed, so Brain can call either.
  workflow: ['build', 'run'], dataset: ['visualize', 'plot', 'profile'], project: ['expand', 'compare'],
  mockup: ['deliver'], mockupSet: ['expand', 'deliver'], standup: ['start'],
  evermind: ['train', 'evaluate', 'publish'],
  image: ['generate', 'preview', 'export', 'convert-to-diagram'], drawing: ['convert-to-diagram'], diagram: ['convert-to-diagram'], animation: ['generate', 'preview', 'export'], podcast: ['generate', 'preview', 'export'],
  comic: ['generate', 'preview', 'export'], game: ['generate', 'preview', 'export'], cad: ['generate', 'preview', 'export', 'convert-to-diagram'], model3d: ['generate', 'preview', 'export'],
  resume: ['generate', 'preview', 'export'], template: ['browse', 'apply'],
  // The QA objects. `gate` recomputes the plan's verdict from the runs, defects and
  // audits on the board; `export` writes the .spec.ts (a plan writes its whole suite
  // as one file). Nothing else is advertised, because nothing else is connected —
  // running a suite is `canvas_publish_tests`, and a kind that advertised `run` here
  // would produce the honest-but-useless "no delivery adapter" answer forever.
  testPlan: ['gate', 'export'], testCase: ['export'], testRun: ['export'], defect: ['export'],
  // The monthly update, actually sent — over the SAME transports a campaign uses
  // (platform sender, the tenant's connected mailbox, or their SendGrid
  // connection). It stays a GATED action in `canvasApprovalGate`, so a model
  // cannot fire it: what changed is that a human who approves it now gets a send
  // instead of "no delivery adapter is connected".
  investorUpdate: ['send'],
  // The assessment cycle. `distribute` fans an assignment into one `submission` per
  // roster row; `compute` surfaces the gradebook's already-live derivation as a
  // reported figure; `mark` applies the rubric to a submission's authored
  // `placements` and, when the assignment is LTI-bound, pushes the score through
  // AGS; `import` pulls a cohort's roster from a connected LMS through NRPS (a CSV
  // paste goes through the dedicated `canvas_import_roster` tool instead, since this
  // generic action carries no text); `validate` checks a curriculum map's mapping
  // grid for outcomes and columns that do not resolve on the board.
  assignment: ['distribute'], gradebook: ['compute'], submission: ['mark'],
  cohort: ['import'], curriculumMap: ['validate'], bibliography: ['import'],
  // FO-B3: the five consumers routed through the form/signature primitives (0469).
  // `contract.sign` and `dataRoom.share` stay GATED in `canvasApprovalGate` — what
  // changed is that a human who approves either now gets a real signature request
  // instead of "no delivery adapter is connected". `offer.send` is gated the same
  // way; `offer.sign` is not, because it only re-reads the request it created and
  // asserts nothing new. `policy.acknowledge` is open: sending a roster its own
  // reviewer a nudge to sign is reversible and not attested.
  contract: ['sign'], policy: ['acknowledge'], offer: ['send', 'sign'], dataRoom: ['share'],
};
const WEBSITE_SECTION_SCHEMA = {
  type: 'object', required: ['id', 'kind'], additionalProperties: false,
  properties: {
    id: { type: 'string' }, kind: { type: 'string', enum: ['hero', 'features', 'content', 'stats', 'testimonial', 'cta'] },
    eyebrow: { type: 'string' }, heading: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, secondaryCta: { type: 'string' },
    quote: { type: 'string' }, author: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, body: { type: 'string' }, value: { type: 'string' }, label: { type: 'string' } } } },
  },
};
const WEBSITE_PAGES_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 8, items: {
    type: 'object', required: ['id', 'name', 'path', 'sections'], additionalProperties: false,
    properties: { id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' }, sections: { type: 'array', minItems: 2, maxItems: 12, items: WEBSITE_SECTION_SCHEMA } },
  },
};
const WEBSITE_THEME_SCHEMA = {
  type: 'object', required: ['style'], additionalProperties: false,
  properties: { style: { type: 'string', enum: ['editorial', 'bold', 'minimal', 'soft', 'technical'] }, background: { type: 'string' }, foreground: { type: 'string' }, accent: { type: 'string' } },
};
const CREATIVE_OUTPUTS = Object.fromEntries(CREATIVE_CAPABILITIES.map((capability) => [capability.kind, capability.outputs])) as Partial<Record<CreationObjectKind, readonly string[]>>;

/** Serialize one trace arg/result for the diagnostics report. A trace payload can
 *  hold a cyclic React value or a very large tool result, and the report that
 *  explains a failure must never be the thing that throws while producing it. */
function safeTraceJson(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text === undefined ? '(unserializable)' : text.slice(0, 400);
  } catch {
    return '(unserializable)';
  }
}

/**
 * The board a computed field reads, indexed once per snapshot.
 *
 * Every `contextAdapter` call below takes one, because a `gradebook`'s mean and a
 * `submission`'s lateness are computed from the objects NEXT TO them — a snapshot built
 * without the board hands the model a card the user can see numbers on and it cannot,
 * which is the authorable-but-unreadable drift `creationObjectContext` exists to stop,
 * in its mirror image.
 *
 * Built per INVOCATION rather than per render: these are tool calls, not frames, and
 * indexing N objects once inside a call is O(N) where indexing per object would be
 * O(N²) — the fan-out shape the platform rejects.
 */
function specBoardOf(source: readonly CreationFlowNode[]) {
  return makeSpecDeriveBoard(source.map((node) => node.data as unknown as Record<string, unknown>));
}

/** True only when an advertised capability has a real Canvas-side adapter. */
export function canInvokeCreationObjectAction(kind: CreationObjectKind, action: string): boolean {
  return action === 'inspect' || action === 'edit' || CONNECTED_CANVAS_ACTIONS[kind]?.includes(action) === true;
}
const PALETTE_GROUP_ICONS: Record<CreationObjectGroup, string> = {
  Build: '✦', Data: '▦', Knowledge: '▤', Insights: '↗', Work: '✓', Quality: '⛉', Teaching: '◈', Research: '⌕',
  Pitch: '◈', People: '●', Hiring: '◐', Operations: '⬢', Agents: '✧', Models: '◉', Collaborate: '◇', Integrations: '⌘',
};
export type ProposedCanvasChange =
  | { id: string; type: 'object.add'; label: string; node: CreationFlowNode }
  | { id: string; type: 'object.update'; label: string; objectId: string; patch: Partial<CreationNodeData> }
  | { id: string; type: 'object.delete'; label: string; objectId: string }
  | { id: string; type: 'object.layout'; label: string; objectId: string; position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean; locked?: boolean }
  | { id: string; type: 'object.action'; label: string; objectId: string; action: string }
  | { id: string; type: 'connection.add'; label: string; edge: Edge }
  | { id: string; type: 'connection.update'; label: string; connectionId: string; patch: { label?: string; kind?: CreationConnectionKind } }
  | { id: string; type: 'connection.delete'; label: string; connectionId: string };

/**
 * Canvas-local authoring is reversible and is the direct result the user asked
 * Brain to create, so it must not stop behind a second approval step. Keep
 * destructive operations, executable actions, and canonical PRD persistence in
 * review. Those can remove data, trigger work, or write outside the canvas.
 */
export function canvasChangesCanAutoApply(changes: readonly ProposedCanvasChange[]): boolean {
  return changes.length > 0 && changes.every((change) => {
    if (change.type === 'object.add') return change.node.data.canonicalPrdPending !== true;
    return change.type === 'object.update'
      || change.type === 'object.layout'
      || change.type === 'connection.add'
      || change.type === 'connection.update';
  });
}
type MergeItem = { key: string; source: CreationFlowNode; target: CreationFlowNode | null; choice: 'branch' | 'parent' };
type MergeReview = { parentId: string; parentRevision: number; parentNodes: CreationFlowNode[]; parentEdges: Edge[]; items: MergeItem[] };
type FramePreset = { id: string; name: string; data: CreationNodeData };

/** A follow-up about the selected object is an edit unless the user clearly asks
 * for another object. This is also enforced at the tool boundary so a model that
 * ignores the prompt cannot silently duplicate a chart while claiming an update. */
export function duplicateAddUpdateTarget(
  prompt: string,
  kind: CreationObjectKind,
  nodes: CreationFlowNode[],
  selectedIds: string[],
): CreationFlowNode | undefined {
  const selected = nodes.find((node) => selectedIds.includes(node.id) && node.data.kind === kind && node.data.kind !== 'chat');
  if (!selected) return undefined;
  const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('-', '[ -]');
  const explicitlyCreatesObject = new RegExp(`\\b(?:create|add|insert|duplicate|copy)\\s+(?:(?:a|an|another|new|additional|second|one)\\s+)?(?:analytical\\s+)?${escapedKind}\\b`, 'i').test(prompt)
    || /\b(?:another|new|additional|second)\s+(?:object|visual|widget|version)\b/i.test(prompt);
  return explicitlyCreatesObject ? undefined : selected;
}
type CanvasTimelineMessage = Pick<CreationTimelineMessage, 'clientMessageId' | 'messageRole' | 'body' | 'createdAt'> & { id?: number; metadata?: CreationTimelineMessage['metadata'] };
type BrowserSpeechRecognition = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void };
type AccountGate = { title: string; description: string; action: string };
/** The panels that share the canvas's left dock. One is open, or none is. */
type CanvasDockPanel = 'files' | 'miro' | 'social' | 'ads' | 'outline';

export function shouldAcquireCanvasObjectLock(
  persistence: 'local' | 'server',
  selectedId: string | null,
  canEdit: boolean,
  persistedObjectIds: ReadonlySet<string>,
): boolean {
  return persistence === 'server' && !!selectedId && canEdit && persistedObjectIds.has(selectedId);
}

export async function persistCanonicalProjectPrd(
  node: CreationFlowNode,
  createSpec: typeof specsApi.create = specsApi.create,
): Promise<CreationFlowNode> {
  const projectId = Number(node.data.sourceProjectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('The reviewed PRD has no canonical project');
  const markdown = String(node.data.markdown || node.data.content || '').trim();
  if (!markdown) throw new Error('The reviewed PRD has no authored content');
  const requestedStatus = String(node.data.status || 'draft');
  const status = (['draft', 'ready', 'in_progress', 'complete'].includes(requestedStatus) ? requestedStatus : 'draft') as 'draft' | 'ready' | 'in_progress' | 'complete';
  const saved = await createSpec({ projectId, goal: node.data.title, prd: markdown, status, kind: 'feature' });
  const { canonicalPrdPending: _pending, ...data } = node.data;
  return { ...node, data: { ...data, resourceId: `spec:${saved.id}`, status: saved.status } };
}

function newNode(kind: CreationObjectKind, position: { x: number; y: number }): CreationFlowNode {
  return { id: crypto.randomUUID(), type: 'creation', position, data: createDefaultCreationData(kind) };
}

/**
 * The evidence a test plan's gate is judged on, gathered from the board.
 *
 * ONE collector, two readers: the `gate` action (which writes the verdict onto the
 * plan) and the JSON export (which hands the same verdict to the release-audit CLI).
 * Two collectors would be two definitions of "an open defect", and the CLI would
 * eventually certify something the board was calling red.
 *
 * Runs and audits must be CONNECTED to the plan — evidence for one release is not
 * evidence for another. Defects are the whole board's, because a defect found
 * anywhere still blocks the thing it was found in.
 */
function releaseGateEvidence(
  plan: CreationFlowNode,
  nodes: readonly CreationFlowNode[],
  edges: readonly Edge[],
): GateEvidence {
  const connected = new Set(edges.filter((edge) => edge.source === plan.id).map((edge) => edge.target));
  return {
    runs: nodes
      .filter((node) => node.data.kind === 'testRun' && connected.has(node.id))
      .map((node) => ({ ...summarizeRun(readTestResults(node.data.results)), finishedAt: String(node.data.finishedAt ?? '') }))
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
    defects: nodes
      .filter((node) => node.data.kind === 'defect')
      .map((node) => ({
        severity: QA_SEVERITIES.includes(node.data.severity as QaFindingSeverity) ? node.data.severity as QaFindingSeverity : 'medium',
        status: String(node.data.status ?? 'open'),
      })),
    audits: nodes
      .filter((node) => node.data.kind === 'diagnostics' && connected.has(node.id) && Array.isArray(node.data.auditFindings))
      .map((node) => ({ passed: node.data.auditPassed === true })),
    signOffs: (Array.isArray(plan.data.signOffs) ? plan.data.signOffs : []).flatMap((entry) => {
      const record = entry as { owner?: unknown; approvedAt?: unknown };
      return typeof record?.owner === 'string' && typeof record.approvedAt === 'string'
        ? [{ owner: record.owner, approvedAt: record.approvedAt }]
        : [];
    }),
  };
}

/**
 * The Playwright source a QA object exports as.
 *
 * A `testCase` is its own spec. A `testPlan` is every case connected to it, joined
 * into ONE file with a single import — because a suite is taken away as a file, not
 * as one download per card, and because N files each re-importing `@playwright/test`
 * is not what a person would have written.
 *
 * Re-lowered from `steps` rather than trusting the stored `spec` when the two could
 * disagree: `relowerCase` is the single generator, so an edited step list cannot
 * export yesterday's assertions.
 */
function canvasSpecSource(
  target: CreationFlowNode,
  nodes: readonly CreationFlowNode[],
  edges: readonly Edge[],
): string | null {
  const specOf = (node: CreationFlowNode): string | null => {
    const [restored] = readTestCases([{
      title: node.data.title,
      steps: node.data.steps,
      route: node.data.route,
      spec: node.data.spec,
      priority: node.data.priority,
    }]);
    if (!restored) return null;
    // A stored spec that came back from the QA library (persona-aware, possibly
    // model-written) wins; otherwise the deterministic lowering of the steps.
    return restored.steps.length ? relowerCase(restored).spec : restored.spec;
  };

  if (target.data.kind === 'testCase') return specOf(target);
  if (target.data.kind !== 'testPlan') return null;

  const memberIds = new Set(edges.filter((edge) => edge.source === target.id).map((edge) => edge.target));
  const cases = nodes.filter((node) => node.data.kind === 'testCase' && memberIds.has(node.id));
  const specs = cases.map(specOf).filter((spec): spec is string => !!spec);
  if (!specs.length) return null;
  const bodies = specs.map((spec) => spec.split('\n').filter((line) => !line.startsWith('import ')).join('\n').trim());
  return [`import { test, expect } from '@playwright/test';`, '', ...bodies].join('\n') + '\n';
}

/**
 * Restyle every mark on a drawing at once.
 *
 * Geometry is deliberately untouched: the strokes are already relative to their
 * own card, so re-normalizing them here would move the card by a pixel every
 * time somebody dragged the colour slider. `stroke` / `strokeWidth` are kept in
 * step on the object because they are what a pre-strokes client reads.
 */
function restyleDrawing(data: CreationNodeData, style: { stroke?: string; strokeWidth?: number }): Partial<CreationNodeData> {
  const strokes = canvasStrokes(data).map((stroke) => ({ ...stroke, ...style }));
  return { strokes, ...style } as Partial<CreationNodeData>;
}

/** One glyph per tool, so the tray is scannable without reading it. The label
 *  stays beside it — an icon-only pen tray is a memory test. */
const DRAWING_TOOL_GLYPH: Readonly<Record<CanvasDrawingTool, string>> = {
  pen: '✎', highlighter: '▬', line: '╱', rect: '▭', ellipse: '◯', text: 'T', eraser: '⌫',
};
/** `<input type="color">` cannot show a CSS variable, and the default stroke IS
 *  one (so a sketch reads correctly in both themes). The swatch falls back to the
 *  hex of that variable until the user picks a colour of their own. */
const DRAWING_FALLBACK_HEX = '#4d9eff';

/**
 * The object a point lands on, topmost first.
 *
 * What makes a stroke an annotation rather than a stray sketch: the mark belongs
 * to whatever is under the pen when it goes down. Later nodes render above
 * earlier ones, so the list is walked backwards — the card a person can see is
 * the card they think they are drawing on.
 */
function topmostNodeAt(nodes: readonly CreationFlowNode[], point: { x: number; y: number }): CreationFlowNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (node.hidden) continue;
    const { width, height } = canvasNodeDimensions(node);
    if (point.x >= node.position.x && point.x <= node.position.x + width && point.y >= node.position.y && point.y <= node.position.y + height) return node;
  }
  return null;
}

/** Social-campaign fields the SERVER owns — see `syncSocialCampaign`. Editing one on
 *  the tile has to write through, or the board shows one message and publishes another. */
const SERVER_OWNED_CAMPAIGN_FIELDS = ['body', 'linkUrl', 'mediaUrls', 'variants', 'scheduledAt'] as const;

export function associateBrainWithArtifacts(current: Edge[], brainId: string, artifactIds: Iterable<string>, label = 'Brain context'): Edge[] {
  if (!brainId) return current;
  const next = [...current];
  for (const artifactId of artifactIds) {
    if (!artifactId || artifactId === brainId || next.some((edge) => edge.source === brainId && edge.target === artifactId)) continue;
    next.push({ id: crypto.randomUUID(), source: brainId, target: artifactId, type: 'smoothstep', label, data: { connectionKind: 'reference' } });
  }
  return next;
}

export function scoreAgentTestResponse(response: string, expected: string): { passed: boolean | null; matched: string[]; missing: string[] } {
  const criteria = expected.split(/[\n,;]+/).map((item) => item.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 20);
  if (!criteria.length) return { passed: null, matched: [], missing: [] };
  const haystack = response.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const matches = (criterion: string) => {
    const words = criterion.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];
    return words.length > 0 && words.filter((word) => haystack.includes(word)).length >= Math.ceil(words.length * 0.6);
  };
  const matched = criteria.filter(matches);
  const missing = criteria.filter((criterion) => !matches(criterion));
  return { passed: missing.length === 0, matched, missing };
}

function safeDownloadName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'creation';
}


/**
 * The rows an object holds, in the positional shape BOTH the CSV writer and the
 * .xlsx writer index by.
 *
 * One derivation — `tabularFromObject`, the same one the sheet card renders from
 * — so an exported file can never disagree with what is on screen. This used to
 * re-read `data.rows`/`data.columns` by hand, which is why a dataset carrying
 * `sampleRows` rendered on the card and then exported as "no rows".
 */
function artifactSheet(data: CreationNodeData): { columns: string[]; rows: Array<Array<string | number | null>> } | null {
  const source = tabularFromObject(data as Record<string, unknown>);
  if (!source.columns.length) return null;
  const rows = source.rows.map((row) => source.columns.map((column) => {
    const value = row[column];
    if (value == null) return null;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
  }));
  return { columns: source.columns, rows };
}

/** Horizontal gap between objects created by one multi-file drop, so a folder
 * dropped at once lands as a readable row rather than a single stack. */
const IMPORT_COLUMN_GAP = 360;
/** Vertical gap for the EXTRA objects one file yields — a workbook's second and
 * third sheets stack under the card that stood in for the file. */
const IMPORT_ROW_GAP = 300;

/**
 * Let the browser paint before the next parse takes the main thread back.
 *
 * `officeFormats`' readers are synchronous CPU inside an async signature, so
 * committing a node to React state and immediately starting the next read means
 * the commit never reaches the screen. One frame, then a macrotask, is the pair
 * that reliably gets a paint out of both engines.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
/** Files read from a single drop. Past this the board stops being legible and
 * the parse cost stops being worth it, so the rest are reported, not silently
 * discarded. */
const MAX_DROPPED_FILES = 12;

/** Whether a drag carries files from outside the browser, as opposed to an
 * object being dragged off the palette. */
function dragCarriesFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

const SEED = {
  workflow: '00000000-0000-4000-8000-000000000001', website: '00000000-0000-4000-8000-000000000002',
  dashboard: '00000000-0000-4000-8000-000000000003', chat: '00000000-0000-4000-8000-000000000004',
  sarah: '00000000-0000-4000-8000-000000000005', jordan: '00000000-0000-4000-8000-000000000006',
  agent: '00000000-0000-4000-8000-000000000007', workflowWebsite: '00000000-0000-4000-8000-000000000008',
  websiteDashboard: '00000000-0000-4000-8000-000000000009',
};

const INITIAL_NODES: CreationFlowNode[] = [
  { id: SEED.workflow, type: 'creation', position: { x: 80, y: 55 }, data: { kind: 'workflow', title: 'Fall campaign workflow', status: 'Ready' } },
  { id: SEED.website, type: 'creation', position: { x: 610, y: 45 }, data: { kind: 'website', title: 'Campaign landing page', status: 'Draft' } },
  { id: SEED.dashboard, type: 'creation', position: { x: 1140, y: 55 }, data: { kind: 'dashboard', title: 'Campaign forecast' } },
  // The Brain Object is 390px wide once the conversation is placed INSIDE it, so
  // the row beside it starts clear of that — a seeded board that reads well docked
  // and then overlaps itself the moment Brain goes inline is the first impression.
  { id: SEED.chat, type: 'creation', position: { x: 80, y: 380 }, data: { kind: 'chat', title: 'Brain' } },
  { id: SEED.sarah, type: 'creation', position: { x: 520, y: 455 }, data: { kind: 'staff', title: 'Sarah', role: 'Marketing', focus: 'Defining audience segments and writing email copy.', accent: 'var(--canvas-obj-evermind)' } },
  { id: SEED.jordan, type: 'creation', position: { x: 800, y: 455 }, data: { kind: 'staff', title: 'Jordan', role: 'Design', focus: 'Refining hero section and mobile layout.', accent: 'var(--canvas-obj-staff)' } },
  { id: SEED.agent, type: 'creation', position: { x: 1080, y: 455 }, data: { kind: 'agent', title: 'Campaign Strategist', status: 'Draft', model: 'gpt-4o', subtitle: 'Defines strategy, messaging, and audience for high-impact campaigns.' } },
];

const INITIAL_EDGES: Edge[] = [
  { id: SEED.workflowWebsite, source: SEED.workflow, target: SEED.website, label: 'publishes', type: 'smoothstep', data: { connectionKind: 'control' } },
  { id: SEED.websiteDashboard, source: SEED.website, target: SEED.dashboard, label: 'measures', type: 'smoothstep', data: { connectionKind: 'data' } },
];

function flowFromSession(detail: CreationSessionDetail): { nodes: CreationFlowNode[]; edges: Edge[] } {
  return {
    nodes: detail.objects.map((object) => ({
      id: object.id, type: 'creation',
      position: { x: Number(object.canvasData?.x ?? 0), y: Number(object.canvasData?.y ?? 0) },
      draggable: object.content?.placementLocked !== true,
      hidden: object.content?.placementHidden === true,
      ...((Number(object.canvasData?.w) > 0 || Number(object.canvasData?.h) > 0) ? { style: { width: Number(object.canvasData?.w) || undefined, height: Number(object.canvasData?.h) || undefined } } : {}),
      data: {
        kind: object.kind as CreationObjectKind,
        title: object.kind,
        ...(object.resourceType && object.resourceId ? { resourceId: `${object.resourceType}:${object.resourceId}` } : {}),
        ...(object.content ?? {}),
      } as CreationNodeData,
    })),
    edges: detail.connections.map((edge) => ({
      id: edge.id, source: edge.sourceObjectId, target: edge.targetObjectId,
      type: typeof edge.metadata?.rendererType === 'string' ? edge.metadata.rendererType : 'smoothstep', label: edge.label ?? undefined, animated: !!edge.metadata?.animated,
      data: { connectionKind: edge.kind || 'reference' },
    })),
  };
}

function mergeCollaboratorGraph(local: { nodes: CreationFlowNode[]; edges: Edge[] }, remote: { nodes: CreationFlowNode[]; edges: Edge[] }) {
  const nodes = new Map(remote.nodes.map((node) => [node.id, node]));
  local.nodes.forEach((node) => nodes.set(node.id, node));
  const edges = new Map(remote.edges.map((edge) => [edge.id, edge]));
  local.edges.forEach((edge) => edges.set(edge.id, edge));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function flowFromSnapshotGraph(graph: { objects: Array<{ id: string; kind: string; resourceType?: string | null; resourceId?: string | null; canvasData: Record<string, unknown>; content: Record<string, unknown> }>; connections: Array<{ id: string; sourceObjectId: string; targetObjectId: string; kind?: string; label?: string | null; metadata?: Record<string, unknown> }> }) {
  const nodes: CreationFlowNode[] = graph.objects.map((object) => ({
    id: object.id, type: 'creation', position: { x: Number(object.canvasData?.x ?? 0), y: Number(object.canvasData?.y ?? 0) }, draggable: object.content?.placementLocked !== true, hidden: object.content?.placementHidden === true,
    ...((Number(object.canvasData?.w) > 0 || Number(object.canvasData?.h) > 0) ? { style: { width: Number(object.canvasData?.w) || undefined, height: Number(object.canvasData?.h) || undefined } } : {}),
    data: { kind: object.kind as CreationObjectKind, title: object.kind, ...(object.resourceType && object.resourceId ? { resourceId: `${object.resourceType}:${object.resourceId}` } : {}), ...(object.content ?? {}) } as CreationNodeData,
  }));
  const edges: Edge[] = graph.connections.map((edge) => ({ id: edge.id, source: edge.sourceObjectId, target: edge.targetObjectId, type: typeof edge.metadata?.rendererType === 'string' ? edge.metadata.rendererType : 'smoothstep', label: edge.label ?? undefined, animated: !!edge.metadata?.animated, data: { connectionKind: edge.kind || 'reference' } }));
  return { nodes, edges };
}

/** Canonical project state rendered over an attached Evermind node. Kept outside the
 * persisted canvas graph so a 20-second live refresh never creates canvas revisions. */
export function projectEvermindNodePatch(head: ProjectEvermindHead, activity: ProjectEvermindContributions): Partial<CreationNodeData> {
  const measuredLoss = activity.training.find((point) => point.loss > 0)?.loss;
  return {
    title: head.name || 'Project Evermind',
    status: head.seeded ? `${head.mode === 'connected' ? 'Learning' : 'Frozen'} · v${head.version}` : 'Ready to seed',
    evermindVersion: head.version,
    evermindSeeded: head.seeded,
    contributions: activity.contributions,
    pendingContributions: activity.pending,
    recentLearnings: activity.recent,
    trainingLoss: measuredLoss,
    learningMode: activity.mode,
    lastLearnedAt: activity.lastLearnedAt,
    quarantinedAt: activity.quarantinedAt ?? head.quarantinedAt,
    quarantineReason: activity.quarantineReason ?? head.quarantineReason,
    evalPoint: activity.eval,
    inferenceEnabled: activity.inferenceEnabled,
    teacherModel: activity.teacherModel || undefined,
    evermindLoading: false,
  };
}

function CanvasInner({ sessionId, persistence, initialFocusId, initialShareOpen = false, initialBuildOpen = false, initialBuildChatId, initialBuildTicket, initialPrompt, initialPresent = false, initialModelComparisonIds = [], stageActive = true }: { sessionId: string; persistence: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialBuildOpen?: boolean; initialBuildChatId?: number | null; initialBuildTicket?: { kind: string; ref: string } | null; initialPrompt?: string | null; initialPresent?: boolean; initialModelComparisonIds?: readonly string[]; stageActive?: boolean }) {
  const t = useTranslations('creationCanvas');
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
  const tAds = useTranslations('canvas.ads');
  const tImport = useTranslations('creationCanvas.import');
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
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(persistence === 'local' ? INITIAL_NODES : []);
  const [evermindLiveByNodeId, setEvermindLiveByNodeId] = useState<Record<string, Partial<CreationNodeData>>>({});
  /** A file is being dragged over the board from outside the browser. */
  const [fileDragging, setFileDragging] = useState(false);
  const fileDragDepth = useRef(0);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persistence === 'local' ? INITIAL_EDGES : []);
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
  const [title, setTitle] = useState('Untitled session');
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  /**
   * WHICH SURFACE this canvas is being read through — the board, the 3D space, or the
   * conversation. Every surface but the board replaces the flat view rather than
   * floating over it: two live views of the same objects would compete for the same
   * pointer, and the point of a surface is to read the work one way without distraction.
   *
   * ONE state, because it is one question. 3D used to keep its own boolean beside this
   * (`useCanvasThreeD`, which the four other spatial canvases still use), and a second
   * answer to "what am I looking at?" is a second control that can disagree with the
   * first. The rail and the phone stack both drive THIS, and `data-view` publishes it to
   * the stylesheet — see `lib/canvasSurfaces.ts`.
   *
   * A model comparison opens straight into the space: the whole point of running two
   * models side by side is to read the results in depth.
   */
  const comparisonModelIds = useMemo(() => normalizeModelComparisonIds(initialModelComparisonIds), [initialModelComparisonIds]);
  const [surface, setSurfaceState] = useState<CanvasSurfaceId>(comparisonModelIds.length >= 2 ? 'scene3d' : 'graph');
  /**
   * The object an object-scoped surface is about. Null for every board surface, and the
   * reason a surface can be `page` at all: a page is a page OF something.
   */
  const [surfaceTarget, setSurfaceTarget] = useState<string | null>(null);
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
  const setSurface = useCallback((next: CanvasSurfaceId, targetId: string | null = null) => {
    setSurfaceState(next);
    setSurfaceTarget(canvasSurfaceDefinition(next).scope === 'object' ? targetId : null);
    // The registry decides what is worth remembering — a PLACE the user chose, never a
    // projection of the board they were already on, and never a surface that cannot be
    // restored without the object it was about.
    writeCanvasSurface(next);
  }, []);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [accountGate, setAccountGate] = useState<AccountGate | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateKind, setTemplateKind] = useState<CreationObjectKind | 'all'>('all');
  // The category filter is now over template SOURCES rather than the packs'
  // own two-value `category` field, because the browser renders every source.
  const [templateCategory, setTemplateCategory] = useState<'all' | 'pack' | 'workspace' | 'prompt'>('all');
  // The one catalogue, shared with the prompt picker. Installable templates are
  // fetched only while the browser is open — a guest canvas never opens it.
  const templateEntries = useTemplateCatalog({ includeWorkspace: templateOpen });
  const [paletteSearch, setPaletteSearch] = useState('');
  const [collapsedPaletteGroups, setCollapsedPaletteGroups] = useState<Set<CreationObjectGroup>>(new Set());
  const [palettePreferencesReady, setPalettePreferencesReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PALETTE_COLLAPSE_STORAGE_KEY) || '[]') as unknown;
      const allowed = new Set(CREATION_PALETTE_GROUPS.map((group) => group.group));
      setCollapsedPaletteGroups(new Set(Array.isArray(saved) ? saved.filter((group): group is CreationObjectGroup => typeof group === 'string' && allowed.has(group as CreationObjectGroup)) : []));
    } catch { setCollapsedPaletteGroups(new Set()); }
    try {
      const savedOpen = localStorage.getItem(PALETTE_OPEN_STORAGE_KEY);
      setPaletteOpen(savedOpen === '1' || (savedOpen == null && window.innerWidth > 760));
    } catch { setPaletteOpen(window.innerWidth > 760); }
    setPalettePreferencesReady(true);
  }, []);
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

  /** Beside the badge, clamped so a card at the right edge does not open a panel off it. */
  const anchorFrom = (rect: { top: number; right: number }, width: number) => ({
    x: Math.min(Math.max(12, rect.right + 12), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(12, rect.top - 8), Math.max(12, window.innerHeight - 220)),
  });

  const boxOf = (rect: DOMRect) => ({ top: rect.top, right: rect.right });

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
  const [workflowFocus, setWorkflowFocus] = useState<{ nodeId: string; definitionId: string | null } | null>(null);
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
  const [creatingBuild, setCreatingBuild] = useState(false);
  const [framePresets, setFramePresets] = useState<FramePreset[]>([]);
  const [serverTemplates, setServerTemplates] = useState<ServerCreationTemplate[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CreationSessionSummary['role']>('editor');
  const [prompt, setPrompt] = useState('');
  const [promptHeight, setPromptHeight] = useState(34);
  const promptResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const clampPromptHeight = useCallback((height: number) => Math.min(240, Math.max(34, height)), []);
  const handlePromptResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    promptResizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: promptHeight };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [promptHeight]);
  const handlePromptResizeMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const resize = promptResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setPromptHeight(clampPromptHeight(resize.startHeight + resize.startY - event.clientY));
  }, [clampPromptHeight]);
  const handlePromptResizeEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (promptResizeRef.current?.pointerId !== event.pointerId) return;
    promptResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  const handlePromptResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === 'ArrowUp') setPromptHeight((height) => clampPromptHeight(height + step));
    else if (event.key === 'ArrowDown') setPromptHeight((height) => clampPromptHeight(height - step));
    else if (event.key === 'Home') setPromptHeight(34);
    else if (event.key === 'End') setPromptHeight(240);
    else return;
    event.preventDefault();
  }, [clampPromptHeight]);
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
  const [notice, setNoticeText] = useState('Session saved');
  /** When the last OUTCOME was announced — see {@link noteSaveState}. */
  const lastOutcomeAt = useRef(0);
  /**
   * Say what just happened.
   *
   * The pill has one status line and two kinds of message compete for it: an
   * OUTCOME ("Evaluation added to canvas", "Sketch added", an error) and the
   * routine SAVE STATE ("Saving…", "Saved on this device"). Autosave is debounced
   * 300ms behind the edit that triggered it, so every outcome used to be wiped by
   * a save confirmation about a third of a second after it appeared — too fast to
   * read, and the one message the person was waiting for.
   */
  const setNotice = useCallback((text: string) => {
    lastOutcomeAt.current = Date.now();
    setNoticeText(text);
  }, []);
  /**
   * Report the save state, unless it would talk over a fresher outcome. A save
   * that stays quiet is not a save that did not happen — the outcome message
   * already told the person their change landed, and the next edit's save says so
   * again once the outcome has had its moment.
   */
  const noteSaveState = useCallback((text: string) => {
    if (Date.now() - lastOutcomeAt.current < OUTCOME_HOLD_MS) return;
    setNoticeText(text);
  }, []);

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
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const guestName = useRef('');
  useEffect(() => {
    if (persistence !== 'local') return;
    setRoomCode(getActiveGuestRoom());
    guestName.current = getGuestDisplayName();
  }, [persistence]);
  const room = useGuestRoom(persistence === 'local' ? roomCode : null, { name: guestName.current });
  const inRoom = persistence === 'local' && !!roomCode;
  /** Read inside callbacks that must not re-create when the room changes. */
  const roomCodeRef = useRef<string | null>(null);
  roomCodeRef.current = inRoom ? roomCode : null;
  /** The snapshot most recently exchanged with the room — suppresses echo. */
  const lastRoomSnapshot = useRef<string>('');
  /**
   * False until this device has read the room's board (or learned it has none).
   *
   * An invitee mounts on the DEFAULT starter board and the save debounce fires
   * ~300ms later — before the first pull can land. Without this gate that empty
   * starter board would be pushed over the host's real one, and joining a shared
   * canvas would wipe it. Pushes are held until the pull settles.
   */
  const roomHydrated = useRef(false);
  const announceCanvas = room.announceCanvas;

  /**
   * The ONE write for an account-less canvas: this device, and — when the session
   * is shared — the room everybody else is reading. Called by every local save
   * path, so a shared board can never be updated by one of them and missed by
   * another.
   */
  const persistSnapshot = useCallback((snapshot: LocalCreationSnapshot) => {
    writeLocalCreationSession(sessionId, snapshot);
    const code = roomCodeRef.current;
    if (!code || !roomHydrated.current) return;
    const serialized = JSON.stringify(snapshot);
    // Don't push back what we just pulled — that is how two peers get into a
    // permanent round-trip over a board neither of them is touching.
    if (serialized === lastRoomSnapshot.current) return;
    lastRoomSnapshot.current = serialized;
    void pushGuestRoomCanvas(code, serialized).then((stored) => {
      if (stored) announceCanvas();
      // A board too big for the room's slot must say so out loud: everyone here
      // would otherwise keep editing while late joiners load a stale board.
      else setNotice(t('sharedBoardTooLarge'));
    });
  }, [sessionId, announceCanvas, t]);
  const [loadingSession, setLoadingSession] = useState(persistence === 'server');
  const [realtimeState, setRealtimeState] = useState<'local' | 'connecting' | 'online' | 'reconnecting' | 'offline'>(persistence === 'local' ? 'local' : 'connecting');
  const [members, setMembers] = useState<CreationSessionDetail['members']>([]);
  /**
   * Where everyone's pointer is RIGHT NOW, off the peer relay — as opposed to
   * `members`, which is where they were when the 8s presence poll last ran. The
   * two are merged for rendering (`liveMembers`), never kept as rival rosters.
   */
  const [livePresence, setLivePresence] = useState<LivePresenceMap>({});
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
    if (step === 1) setPaletteOpen(true);
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreationSnapshotSummary[]>([]);
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
  // Read from the token store rather than from `useAuth`, for two reasons: it is the
  // exact value `apiRequest` authorizes with (so it cannot disagree with the call it is
  // predicting), and the canvas mounts in surfaces that have no AuthProvider above them
  // — the VS Code webview, the embed, and the component tests.
  const [hasAccount, setHasAccount] = useState(false);
  const [claimingDraft, setClaimingDraft] = useState(false);
  useEffect(() => { setHasAccount(!!getStoredTenantToken()); }, []);
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
   * Returns true when the caller may proceed.
   */
  const connectedAccountGate = useCallback((source: string) => {
    if (getStoredTenantToken()) return true;
    requireAccount('connected_account', t('connectedGateTitle', { source }), t('connectedGateBody', { source }));
    return false;
  }, [requireAccount, t]);
  useEffect(() => {
    if (!palettePreferencesReady) return;
    try {
      localStorage.setItem(PALETTE_COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedPaletteGroups]));
      localStorage.setItem(PALETTE_OPEN_STORAGE_KEY, paletteOpen ? '1' : '0');
    } catch { /* storage can be unavailable in hardened contexts */ }
  }, [collapsedPaletteGroups, paletteOpen, palettePreferencesReady]);
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
  const pendingSave = useRef<{ serialized: string; key: string } | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  /** The live socket, when it is open — the channel pointer frames go out on. */
  const liveSocketRef = useRef<WebSocket | null>(null);
  /** Last outbound presence frame's timestamp + payload, for the send throttle. */
  const presenceSentRef = useRef<{ atMs: number; pending: CanvasPresenceState | null; timer: number | null }>({ atMs: 0, pending: null, timer: null });
  /**
   * Put this client's ephemeral state on the relay.
   *
   * Throttled to {@link PRESENCE_SEND_INTERVAL_MS}, and the throttle COALESCES
   * rather than drops: a move inside the window is remembered and flushed at the
   * end of it. Dropping instead would leave the pointer stopped at wherever the
   * last frame happened to land whenever someone moved fast and then stopped —
   * which is exactly when a cursor is being watched.
   *
   * Silent when the socket is not open; the presence poll is the fallback and
   * resumes carrying the cursor on its own (see the reconcile effect).
   */
  const sendPresence = useCallback((state: CanvasPresenceState) => {
    const socket = liveSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const throttle = presenceSentRef.current;
    const flush = (payload: CanvasPresenceState) => {
      throttle.atMs = Date.now();
      throttle.pending = null;
      try { socket.send(JSON.stringify({ type: CANVAS_PRESENCE_FRAME, ...payload })); } catch { /* the socket is closing; the poll takes over */ }
    };
    const waited = Date.now() - throttle.atMs;
    if (waited >= PRESENCE_SEND_INTERVAL_MS && throttle.timer == null) { flush(state); return; }
    throttle.pending = { ...throttle.pending, ...state };
    if (throttle.timer != null) return;
    throttle.timer = window.setTimeout(() => {
      throttle.timer = null;
      const pending = throttle.pending;
      if (pending) flush(pending);
    }, Math.max(0, PRESENCE_SEND_INTERVAL_MS - waited));
  }, []);
  const pendingViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const flowWrapRef = useRef<HTMLDivElement | null>(null);
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
  // `--canvas-top-chrome-space`. It is measured off the top-right card because that is the
  // TALLEST of the three cards sharing that line (the session pill, the surface chips and
  // this one all sit at `top:14px`), so clearing it clears all three.
  //
  // TWO things read it, and both were broken without it. Every panel that opens in the
  // top-right corner is anchored to the same `top:14px; right:14px` as the card, which
  // floats at z-index 20 over panels at 9 — so the details panel's expand and close buttons
  // sat underneath Share / Publish / Save and could not be clicked: the panel could be
  // opened and not shut. And every FULL-BLEED surface draws from the shell's top edge, so
  // the conversation surface drew its own header underneath the pill — the session's name
  // painted over by the same session's name, with its participants marooned beside the
  // surface tabs. Measured rather than declared for the reason the bottom bands are: the
  // card grows by a wrapped Save button, by whatever the surface contributes to `handoff`,
  // and shrinks when the bar is collapsed.
  const topChromeSpaceRef = useChromeSpace(shellRef, '--canvas-top-chrome-space', { edge: 'top', gap: TOP_CHROME_CLEARANCE });
  const paletteSearchRef = useRef<HTMLInputElement | null>(null);
  const proposalBuffer = useRef<ProposedCanvasChange[]>([]);
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
  /**
   * The surface the visitor last chose to work on, restored after hydration rather than
   * in the initial state — `localStorage` does not exist on the server, and a first
   * render that disagreed with the markup would flash the wrong surface. A canvas opened
   * FOR a model comparison keeps the space it was opened into; the stored preference is
   * about where someone works, not about what a link asked for.
   */
  useEffect(() => {
    if (comparisonModelIds.length >= 2) return;
    setSurfaceState(readCanvasSurface());
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

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    // The palette starts open on wide screens. Focusing its search field makes
    // every Add affordance useful even when opening it is otherwise a no-op.
    window.requestAnimationFrame(() => paletteSearchRef.current?.focus());
  }, []);

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
      .catch((error) => setNotice(error instanceof Error ? error.message : t('noticeInvitationsFailed')));
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
        const { nodes: loadedNodes, edges: loadedEdges } = flowFromSession(detail);
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
        noteSaveState(t('noticeSessionSaved'));
      }).catch((error) => {
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'failed', durationMs: performance.now() - openedAt }).catch(() => undefined);
        setNotice(error instanceof Error ? error.message : t('noticeLoadSessionFailed'));
      }).finally(() => setLoadingSession(false));
    } catch { hydrated.current = true; }
  }, [persistence, sessionId, setEdges, setNodes]);

  /**
   * Adopt the room's board. Used for the first load in a shared session and for
   * every peer edit after it.
   *
   * Setting `lastSavedGraph`/`lastRoomSnapshot` BEFORE the state lands is the
   * whole trick: both save debounces compare against them and bail, so applying a
   * peer's board cannot be mistaken for a local edit and pushed straight back —
   * which is how a two-person session turns into an infinite sync loop.
   */
  const applyRoomSnapshot = useCallback((serialized: string) => {
    let snapshot: LocalCreationSnapshot;
    try {
      snapshot = JSON.parse(serialized) as LocalCreationSnapshot;
    } catch {
      return; // a corrupt board is not worth wiping a good local one for
    }
    if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return;
    lastRoomSnapshot.current = serialized;
    lastSavedGraph.current = JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges });
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
  }, [sessionId, setEdges, setNodes]);

  // Pull the shared board: once on entering a room (this is how a LATE joiner
  // sees anything at all) and again whenever a peer announces a new one.
  useEffect(() => {
    if (persistence !== 'local' || !roomCode) { roomHydrated.current = false; return; }
    let cancelled = false;
    void fetchGuestRoomCanvas(roomCode).then((serialized) => {
      if (cancelled) return;
      // A room with no board yet (the host is mid-create) means THIS device's
      // board becomes the shared one — so open the gate either way.
      if (serialized) { applyRoomSnapshot(serialized); hydrated.current = true; }
      roomHydrated.current = true;
    });
    return () => { cancelled = true; };
  }, [persistence, roomCode, room.canvasVersion, applyRoomSnapshot]);

  /**
   * Turn this private board into a shared session. The board comes WITH it —
   * "invite people to this canvas" that starts them on an empty one would be a
   * different (and worse) feature.
   */
  const startSharedSession = useCallback(async () => {
    setRoomBusy(true);
    const name = guestName.current.trim() || t('sharedDefaultHostName');
    setGuestDisplayName(name);
    guestName.current = name;
    const state = await createGuestRoom(name, title, 'canvas');
    if (typeof state === 'string') {
      setNotice(state === 'unavailable' ? t('sharedUnavailable') : t('sharedEnded'));
      setRoomBusy(false);
      return;
    }
    const snapshot = localCreationSnapshot(sessionId, { title, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), nodes, edges, viewport: viewportRef.current });
    const serialized = JSON.stringify(snapshot);
    lastRoomSnapshot.current = serialized;
    // The host's board IS the room's board — no pull to wait for.
    roomHydrated.current = true;
    const stored = await pushGuestRoomCanvas(state.code, serialized);
    setRoomCode(state.code);
    setRoomBusy(false);
    setNotice(stored ? t('sharedStarted') : t('sharedBoardTooLarge'));
  }, [edges, nodes, sessionId, t, timeline, title, viewportRef]);

  /** Stop sharing on THIS device. The board stays here; the room runs on for anyone else. */
  const leaveSharedSession = useCallback(async () => {
    const code = roomCodeRef.current;
    setRoomCode(null);
    lastRoomSnapshot.current = '';
    if (code) await leaveGuestRoom(code);
    setNotice(t('sharedLeft'));
  }, [t]);

  const evermindBindingKey = useMemo(() => JSON.stringify(nodes.flatMap((node) => {
    const match = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string'
      ? /^evermind:(\d+)$/.exec(node.data.resourceId)
      : null;
    return match ? [{ nodeId: node.id, projectId: Number(match[1]) }] : [];
  }).sort((a, b) => a.nodeId.localeCompare(b.nodeId))), [nodes]);

  useEffect(() => {
    if (persistence !== 'server' || evermindBindingKey === '[]') {
      setEvermindLiveByNodeId({});
      return;
    }
    let stopped = false;
    const bindings = JSON.parse(evermindBindingKey) as Array<{ nodeId: string; projectId: number }>;
    const sync = async () => {
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
      if (stopped) return;
      const activeNodeIds = new Set(bindings.map((binding) => binding.nodeId));
      setEvermindLiveByNodeId((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([nodeId]) => activeNodeIds.has(nodeId)));
        for (const entry of settled) {
          if (entry) next[entry[0]] = entry[1];
        }
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 20_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [evermindBindingKey, persistence]);

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

  useEffect(() => {
    if (!hydrated.current || !canEdit) return;
    const handle = window.setTimeout(() => {
      const serialized = JSON.stringify({ nodes, edges });
      if (serialized === lastSavedGraph.current) return;
      if (persistence === 'local') {
        const snapshot = localCreationSnapshot(sessionId, { title, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), nodes, edges, viewport: viewportRef.current });
        persistSnapshot(snapshot);
        lastSavedGraph.current = serialized;
        noteSaveState(t('noticeSavedOnDevice'));
        return;
      }
      noteSaveState(t('noticeSavingChanges'));
      saveInFlight.current = true;
      const graph = creationGraphFromSnapshot({ nodes, edges });
      if (!pendingSave.current || pendingSave.current.serialized !== serialized) pendingSave.current = { serialized, key: crypto.randomUUID() };
      const saveAttempt = pendingSave.current;
      void creationSessionsApi.applyCommands(sessionId, revision.current, saveAttempt.key, [{ type: 'graph.replace', ...graph, viewport: viewportRef.current }]).then((saved) => {
        revision.current = saved.revision;
        lastSavedGraph.current = serialized;
        setPersistedObjectIds(new Set(graph.objects.map((object) => object.id)));
        if (pendingSave.current?.key === saveAttempt.key) pendingSave.current = null;
        noteSaveState(t('noticeSessionSaved'));
      }).catch(async (error) => {
        if (error instanceof Error && error.message === 'Session changed') {
          try {
            const detail = await creationSessionsApi.get(sessionId);
            const remote = flowFromSession(detail);
            const merged = mergeCollaboratorGraph({ nodes, edges }, remote);
            revision.current = detail.session.canvasRevision ?? detail.session.revision ?? revision.current;
            lastSavedGraph.current = JSON.stringify(remote);
            setNodes(merged.nodes);
            setEdges(merged.edges);
            setPersistedObjectIds(new Set(remote.nodes.map((node) => node.id)));
            pendingSave.current = null;
            setNotice(t('noticeConcurrentMerged'));
            return;
          } catch { /* Fall through to the original conflict message. */ }
        }
        setNotice(error instanceof Error ? error.message : t('noticeSaveFailed'));
      })
        .finally(() => { saveInFlight.current = false; });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canEdit, edges, nodes, persistence, sessionId, storageKey, title]);

  useEffect(() => {
    if (persistence !== 'local' || !hydrated.current) return;
    const handle = window.setTimeout(() => {
      const prior = readLocalCreationSession(sessionId); if (!prior) return;
      const snapshot: LocalCreationSnapshot = { ...prior, title, nodes, edges, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), viewport: viewportRef.current, updatedAt: new Date().toISOString() };
      persistSnapshot(snapshot);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [edges, nodes, persistence, sessionId, storageKey, timeline, title]);

  useEffect(() => {
    if (persistence !== 'server') return;
    let stopped = false;
    const reconcile = async () => {
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
        if (stopped) return;
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
        if (presence.revision <= revision.current || saveInFlight.current || currentGraph.current !== lastSavedGraph.current) return;
        const detail = await creationSessionsApi.get(sessionId);
        if (stopped) return;
        const remoteRevision = detail.session.canvasRevision ?? detail.session.revision ?? 1;
        if (remoteRevision <= revision.current) return;
        const remote = flowFromSession(detail);
        setNodes(remote.nodes);
        setEdges(remote.edges);
        setPersistedObjectIds(new Set(remote.nodes.map((node) => node.id)));
        setTitle(detail.session.title);
        setAllMembers(detail.members);
        revision.current = remoteRevision;
        lastSavedGraph.current = JSON.stringify(remote);
        currentGraph.current = lastSavedGraph.current;
        setNotice(t('noticeUpdatedByCollaborator'));
      } catch { /* Presence and polling are best-effort; local edits continue. */ }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 8_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [currentUserId, followingUserId, isComposingPrompt, persistence, selectedIds, sessionId, setEdges, setNodes]);

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
      if (stopped || saveInFlight.current || currentGraph.current !== lastSavedGraph.current) return;
      try {
        const caughtUp = await creationSessionsApi.events(sessionId, revision.current);
        const remoteRevision = Math.max(Number(hint || 0), Number(caughtUp.revision || 0));
        if (remoteRevision <= revision.current) return;
        const detail = await creationSessionsApi.get(sessionId);
        if (stopped) return;
        const remote = flowFromSession(detail);
        setNodes(remote.nodes);
        setEdges(remote.edges);
        setPersistedObjectIds(new Set(remote.nodes.map((node) => node.id)));
        setTitle(detail.session.title);
        setAllMembers(detail.members);
        revision.current = detail.session.canvasRevision ?? detail.session.revision ?? remoteRevision;
        lastSavedGraph.current = JSON.stringify(remote);
        currentGraph.current = lastSavedGraph.current;
        setNotice(t('noticeUpdatedLive'));
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
          // A peer's pointer, at pointer speed. Relayed frames are attributed by the
          // SERVER (`userId`), never by the sender — see `SessionRoomDO`.
          if (isPresenceFrame(frame)) setLivePresence((current) => applyPresenceFrame(current, frame, Date.now()));
          // A cursor must not outlive its socket. `presence`/`leave` names the socket,
          // so the peer id is resolved back to the user through the last frame it sent.
          if (frame.type === 'presence' && frame.action === 'leave') {
            const gone = String(frame.peer?.id ?? '');
            setLivePresence((current) => {
              const owner = Object.entries(current).find(([, entry]) => entry.socketId === gone);
              return owner ? dropPresence(current, owner[0]) : current;
            });
          }
        } catch { /* Ignore malformed relay frames. */ }
      };
      socket.onclose = () => {
        if (liveSocketRef.current === socket) liveSocketRef.current = null;
        socket = null;
        // Nobody's pointer is live while this client is deaf; the poll takes over.
        setLivePresence({});
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
      const throttle = presenceSentRef.current;
      if (throttle.timer != null) { window.clearTimeout(throttle.timer); throttle.timer = null; }
      throttle.pending = null;
      socket?.close();
    };
  }, [persistence, sessionId, setEdges, setNodes]);

  /**
   * Composing a prompt is presence too — the cursor label says so. It changes at
   * human speed, so it is sent on the state change rather than throttled per frame.
   */
  useEffect(() => {
    if (persistence !== 'server') return;
    sendPresence({ typing: isComposingPrompt });
  }, [isComposingPrompt, persistence, sendPresence]);

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
   * Retire pointers nobody retracted. A socket that dies without a close frame
   * (a closed lid, a dropped network) leaves a cursor standing exactly where its
   * owner stopped; this is what takes it down.
   */
  useEffect(() => {
    if (persistence !== 'server') return;
    const timer = window.setInterval(
      () => setLivePresence((current) => expirePresence(current, Date.now())),
      LIVE_PRESENCE_TTL_MS / 2,
    );
    return () => window.clearInterval(timer);
  }, [persistence]);

  /**
   * One roster to draw. Identity (name, role) comes from the poll; position comes
   * from the relay. Merging rather than keeping two lists is why a name and a
   * pointer can never disagree — see `lib/canvas/livePresence`.
   */
  const liveMembers = useMemo(
    () => mergeLivePresence(members, livePresence, currentUserId) as CreationSessionDetail['members'],
    [currentUserId, livePresence, members],
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
    if (canvasSurfaceDefinition(surface).scope === 'object' && !surfaceNode) setSurface('graph');
  }, [surface, surfaceNode, setSurface]);
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
    if (persistence !== 'local' || !inRoom || !roomCode) { publishAnchor(null); return undefined; }
    publishAnchor({
      roomKey: roomCode,
      label: t('sharedCallLabel'),
      tenantId: null,
      participant: { name: guestName.current, ref: 'self' },
      transport: guestMediaTransport,
    });
    return () => publishAnchor(null);
  }, [inRoom, persistence, publishAnchor, roomCode, t]);

  const publishPresence = liveSession?.publishPresence;
  useEffect(() => {
    if (!publishPresence) return;
    publishPresence(members.map((member) => ({ userId: member.userId, displayName: member.displayName })), currentUserId);
  }, [currentUserId, members, publishPresence]);

  /**
   * Which canonical projects this board references — read by the stage to decide
   * whether to show "viewing a canvas outside the current project" after a scope
   * change, per `canvasScopePolicy`. Published rather than recomputed there so
   * the project reference is read out of the board by the one module that already
   * knows how (`canvasProjectRef`).
   */
  const activeCanvas = useOptionalActiveCanvas();
  const publishProjectIds = activeCanvas?.publishProjectIds;
  const boardProjectIds = useMemo(
    () => [...new Set(canvasProjectNodes(nodes).flatMap((node) => { const id = canvasProjectId(node.data); return id == null ? [] : [id]; }))],
    [nodes],
  );
  useEffect(() => {
    publishProjectIds?.(sessionId, boardProjectIds);
  }, [boardProjectIds, publishProjectIds, sessionId]);
  const scopedEdges = useMemo(() => edges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target)), [edges, scopedNodeIds]);
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
    try {
      const { campaign } = await socialApi.updateCampaign(campaignId, {
        ...(typeof patch.body === 'string' ? { body: patch.body } : {}),
        ...(typeof patch.linkUrl === 'string' ? { linkUrl: patch.linkUrl } : {}),
        ...(Array.isArray(patch.mediaUrls) ? { mediaUrls: patch.mediaUrls.map(String) } : {}),
        ...(patch.variants && typeof patch.variants === 'object'
          ? { variants: patch.variants as Partial<Record<SocialNetwork, string>> }
          : {}),
        ...(patch.scheduledAt !== undefined
          ? { scheduledAt: patch.scheduledAt ? String(patch.scheduledAt) : null }
          : {}),
      });
      setNodes((current) => current.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, ...socialCampaignNodeData(campaign) } as CreationNodeData }
        : node));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tSocial('campaignUpdateFailed'));
    }
  }, [setNodes, tSocial]);

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

  const updateNodeData = useCallback((nodeId: string, patch: Partial<CreationNodeData>) => {
    if (!cardsEditable) return;
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node));
    noteSaveState(t('noticeSavingChanges'));
    const target = nodesRef.current.find((node) => node.id === nodeId);
    const campaignId = Number(target?.data.campaignId);
    if (target?.data.kind === 'socialCampaign'
      && Number.isInteger(campaignId)
      && SERVER_OWNED_CAMPAIGN_FIELDS.some((field) => field in patch)) {
      void syncSocialCampaign(campaignId, nodeId, patch);
    }
  }, [cardsEditable, setNodes, syncSocialCampaign]);

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
        if (!stopped) { setLockBlocked(true); setNotice(error instanceof Error ? error.message : t('noticeObjectLocked')); }
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
      if (rows.length > datasetRowLimit) throw new Error(t('datasetRowLimit', { limit: datasetRowLimit.toLocaleString() }));
      const { title: _title, ...fields } = imported!.data;
      // Adopt the imported file's name, but only over the palette's placeholder.
      // A card the user has already named is theirs and survives the import;
      // one that still says "Imported dataset.csv" after importing revenue.csv is
      // simply wrong, and every artifact derived from it — "… visualization",
      // the map, the chart — inherits that wrong name.
      const placeholder = createDefaultCreationData('dataset').title;
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
          ...(node.data.title === placeholder ? { title: file.name } : {}),
        } }
        : node)));
      setNotice(governance.piiColumns
        ? t('datasetImportedWithPii', { name: file.name, rows: rows.length.toLocaleString(), columns: columns.length, pii: governance.piiColumns })
        : t('datasetImported', { name: file.name, rows: rows.length.toLocaleString(), columns: columns.length }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('datasetImportFailed'));
    }
  }, [datasetRowLimit, importLabel, selectedId, setNodes, t]);

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

  const selectionIds = useCallback(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);
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
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
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
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pasted]); setEdges((current) => [...current, ...pastedEdges]);
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
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, draggable: !shouldLock, data: { ...node.data, placementLocked: shouldLock } } : node));
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
        event.preventDefault(); setNodes((current) => current.filter((node) => !ids.has(node.id))); setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))); setSelectedId(null); setSelectedIds([]);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return; }
      if (event.key === 'Escape') { setSelectedId(null); setSelectedIds([]); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && ids.size && canEdit) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1; const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        setNodes((current) => current.map((node) => ids.has(node.id) && canvasPlacementUnlocked(node) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node));
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [canEdit, copySelection, duplicateSelection, pasteSelection, redo, selectionIds, setEdges, setNodes, undo]);

  const visualizeDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    const source = tabularFromObject(selectedNode.data as Record<string, unknown>);
    if (!source.columns.length || !source.rows.length) { setNotice(t('datasetImportBeforeVisualizing')); return; }
    // Group by the most informative low-cardinality column and total the first
    // numeric measure, rather than charting the first six rows verbatim.
    const profile = profileTabular(source);
    const groupable = (column: { distinct: number }) => {
      const distinct = column.distinct;
      if (distinct < 2) return false;
      return distinct < 25;
    };
    const category = profile.find((column) => column.type !== 'number' && groupable(column))
      ?? profile.find(groupable)
      ?? profile[0]!;
    const measure = profile.find((column) => column.type === 'number' && column.name !== category.name);
    const result = queryTabular(source, {
      groupBy: category.name,
      aggregate: measure ? [{ op: 'sum', column: measure.name, label: measure.name }] : [{ op: 'count', label: 'count' }],
      sort: { column: measure ? measure.name : 'count', direction: 'desc' },
      limit: 8,
    });
    const valueKey = measure ? measure.name : 'count';
    const dashboard = newNode('dashboard', { x: selectedNode.position.x + 440, y: selectedNode.position.y });
    dashboard.data = {
      ...dashboard.data,
      title: t('datasetVisualizationTitle', { name: selectedNode.data.title }),
      status: t('statusLive'),
      chartTitle: measure ? t('chartTitleMeasureBy', { measure: measure.name, category: category.name }) : t('chartTitleCountBy', { category: category.name }),
      xAxisLabel: category.name,
      yAxisLabel: measure ? measure.name : t('chartCountAxis'),
      chartLabels: (result.groups ?? []).map((group) => group.key),
      chartValues: (result.groups ?? []).map((group) => Number(group[valueKey] ?? group.count)),
      kpis: [
        { label: t('kpiTotalRows'), value: result.totalRows.toLocaleString() },
        { label: t('kpiGroups', { category: category.name }), value: String(result.groups?.length ?? 0) },
      ],
      sourceDatasetId: selectedNode.id,
      subtitle: measure ? t('chartTitleMeasureBy', { measure: measure.name, category: category.name }) : t('chartTitleCountBy', { category: category.name }),
    };
    setNodes((current) => [...current, dashboard]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: dashboard.id, type: 'smoothstep', label: t('edgeVisualizes'), animated: true, data: { connectionKind: 'data' } }]);
    setSelectedId(dashboard.id);
    openNodeInspector(dashboard.id);
    setNotice(t('datasetVisualizationAdded'));
  }, [openNodeInspector, selectedNode, setEdges, setNodes, t]);

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
    const source = tabularFromObject(selectedNode.data as Record<string, unknown>);
    if (!source.columns.length || !source.rows.length) { setNotice(t('datasetImportBeforePlotting')); return; }
    const geoColumns = detectGeoColumns(source);
    const points = mapPointsFromRows(source, geoColumns, MAX_MATERIALIZED_ROWS);
    if (!points.length) {
      // Name the columns actually looked at: "cannot plot" is not actionable, and the
      // usual cause is a coordinate column this dataset spells differently.
      setNotice(geoColumns.latitude && geoColumns.longitude
        ? t('datasetPlotNoCoordinates', { latitude: geoColumns.latitude, longitude: geoColumns.longitude })
        : t('datasetPlotNoGeoColumns', { columns: source.columns.join(', ') }));
      return;
    }
    const map = newNode('map', { x: selectedNode.position.x + 440, y: selectedNode.position.y });
    map.style = { width: 420, height: 380 };
    map.data = {
      ...map.data,
      ...mapObjectFields({
        title: t('datasetMapTitle', { name: selectedNode.data.title }),
        status: t('datasetPlottedCount', { count: points.length }),
        summary: t('datasetPlotSummary', { plotted: points.length, total: source.rows.length, name: selectedNode.data.title }),
        points,
        columns: geoColumns,
        sourceDatasetId: selectedNode.id,
      }),
    };
    setNodes((current) => [...current, map]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: map.id, type: 'smoothstep', label: t('edgePlots'), animated: true, data: { connectionKind: 'data' } }]);
    setSelectedId(map.id);
    openNodeInspector(map.id);
    setNotice(t('datasetMapAdded'));
  }, [openNodeInspector, selectedNode, setEdges, setNodes, t]);

  const profileDataset = useCallback((nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const source = tabularFromObject(target.data as Record<string, unknown>);
    if (!source.columns.length || !source.rows.length) { setNotice(t('datasetImportBeforeProfiling')); return; }
    const profile = profileTabular(source);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, profile, rowCount: source.rows.length, columns: source.columns, summary: t('datasetProfileSummary', { rows: source.rows.length.toLocaleString(), columns: source.columns.length, complete: profile.filter((column) => !column.empty).length }) } }
      : node));
    setNotice(t('datasetProfiled', { columns: profile.length }));
  }, [nodes, setNodes, t]);

  // What a primary drag on empty board does, and how forgiving the board is about a
  // pointer that wanders. `panAndSelectConflict` is the invariant `canvasInteractionProps`
  // guarantees, not a React Flow prop, so it is dropped before the rest is spread.
  const coarsePointer = useCoarsePointer();
  const { panAndSelectConflict: _panAndSelectConflict, ...interactionProps } = useMemo(
    () => canvasInteractionProps({ gesture: canvasGesture, pointer: coarsePointer ? 'coarse' : 'fine', drawing: drawingMode }),
    [canvasGesture, coarsePointer, drawingMode],
  );

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep', data: { connectionKind }, label: connectionKind, markerEnd: { type: MarkerType.ArrowClosed } }, current));
    trackActivity('creation_connection_added', { sessionId, metadata: { clientSurface: canvasSurface(), connectionKind } });
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (persistence === 'server' && source && target && source.data.kind !== 'chat' && target.data.kind !== 'chat') {
      const correlationId = crypto.randomUUID();
      const metadata = { sourceKind: source.data.kind, targetKind: target.data.kind, connectionKind };
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'started', artifactId: source.id, metadata }).catch(() => undefined);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'reused', artifactId: source.id, metricKey: 'outputs_reused', metricValue: 1, unit: 'count', metadata }).catch(() => undefined);
    }
  }, [connectionKind, nodes, persistence, sessionId, setEdges]);

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
    const followers = moves.flatMap((move) => {
      const source = nodes.find((node) => node.id === move.id);
      if (!source) return [];
      const dx = move.position.x - source.position.x;
      const dy = move.position.y - source.position.y;
      if (!dx && !dy) return [];
      return nodes
        .filter((node) => node.data.kind === 'drawing' && node.data.annotatesId === move.id)
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
    if (persistence === 'server') { cursorRef.current = point; sendPresence({ cursor: point }); }
    if (drawingMode && drawingPoints.current.length) drawingPoints.current.push(point);
  }, [drawingMode, persistence, sendPresence]);
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
      // round trip (see creationGraphFromSnapshot) — a parent id would be
      // silently dropped on save and the mark would come back detached.
      ...(target ? { annotatesId: target.id, status: '' } : {}),
    };
    if (target) node.zIndex = 6;
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
    setNotice(target ? t('noticeAnnotationAdded', { title: target.data.title }) : t('noticeSketchAdded'));
  }, [drawing, drawingMode, nodes, setNodes, t]);
  const onViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    viewportRef.current = viewport;
    // A follower is watching this pan happen, not reading about it eight seconds later.
    if (persistence === 'server') sendPresence({ viewport });
    if (persistence !== 'local' || !hydrated.current) return;
    const snapshot = localCreationSnapshot(sessionId, { title, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), nodes, edges, viewport });
    persistSnapshot(snapshot);
  }, [edges, nodes, persistence, sendPresence, sessionId, storageKey, timeline, title]);

  /** Place a new object at the middle of the viewport. `data` lets a caller that
   *  already HAS the object's content (an editor capture) seed it in one step
   *  rather than adding an empty object and patching it afterwards. */
  const addAtCenter = useCallback((kind: CreationObjectKind, data?: Partial<CreationNodeData>) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const node = newNode(kind, position);
    if (kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
    if (kind === 'chat') node.data = { ...node.data, messages: timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt })) };
    if (data) node.data = { ...node.data, ...data };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id); setSelectedIds([node.id]);
    // A deliberate "add a Project/Task/Website" from the palette is a request to
    // configure it, not a glance at an existing card — so the panel opens WIDE here,
    // where a click on an existing card opens the short one.
    if (node.data.kind !== 'chat') openNodeInspector(node.id);
    setNotice(t('objectAdded', { title: node.data.title }));
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [kind] } });
  }, [canEdit, localizedTourDefaults, openNodeInspector, sessionId, setNodes, t, timeline]);

  /**
   * What choosing an object in the picker DOES.
   *
   * With a source node it is an INSERT: the object is created to the right of that node
   * and wired to it in one action, which is the difference between "add a step" and "add
   * an object" — and the reason the board could previously only be built by prompting.
   * Without one it is the bar's plain add, which is `addAtCenter` unchanged.
   */
  const pickObject = useCallback((kind: CreationObjectKind, fromNodeId?: string) => {
    setObjectPicker(null);
    if (!fromNodeId) { addAtCenter(kind); return; }
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const source = nodes.find((node) => node.id === fromNodeId);
    if (!source) { addAtCenter(kind); return; }
    // Beside it, not on top of it — far enough right that the two cards and the edge
    // between them are all legible without an immediate re-layout.
    const node = newNode(kind, { x: source.position.x + (canvasNodeDimensions(source).width || 300) + 90, y: source.position.y });
    setNodes((current) => [...current, node]);
    setEdges((current) => addEdge({ id: crypto.randomUUID(), source: fromNodeId, target: node.id, type: connectionKind }, current));
    setSelectedId(node.id); setSelectedIds([node.id]);
    if (node.data.kind !== 'chat') openNodeInspector(node.id);
    setNotice(t('objectAdded', { title: node.data.title }));
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [kind] } });
  }, [addAtCenter, canEdit, connectionKind, nodes, openNodeInspector, sessionId, setEdges, setNodes, t]);

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
    const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
    const node = newNode('socialFeed', nextCanvasObjectPosition(
      [...nodes, ...stagedNodes],
      { ...(opts.x != null ? { x: opts.x } : {}), ...(opts.y != null ? { y: opts.y } : {}) },
      typeof window !== 'undefined' && window.innerWidth <= 760,
      'socialFeed',
    ));
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
  }, [nodes, tSocial]);

  /** The panel's "put it on the board" — a committed add, not a proposal. */
  const addSocialFeedToBoard = useCallback(async (filter: SocialFeedFilter) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const built = await buildSocialFeedNode(filter);
    if (!built.ok) { setNotice(built.error); return; }
    setNodes((current) => [...current, built.node]);
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
    setNodes((current) => [...current, ...placed]);
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
        current, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'socialCampaign',
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
    if (!point) { addAtCenter('agent', data); }
    else {
      const node = newNode('agent', point);
      node.data = { ...node.data, ...data };
      setNodes((current) => [...current, node]);
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
    setNodes((current) => [...current, ...stubs]);
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
        importDone({ ok: false, detail: `unreadable — ${error instanceof Error ? error.message : 'import failed'}` });
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

  const applyTemplate = useCallback((template: CreationTemplate) => {
    if (!canEdit) return;
    const center = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 260 };
    const created = template.objects.map((item) => { const node = newNode(item.kind, { x: center.x + item.x - 520, y: center.y + item.y - 180 }); node.data = { ...node.data, ...(item.data ?? {}), ...(item.title ? { title: item.title } : {}) }; return node; });
    const createdEdges = (template.connections ?? []).map((edge) => ({ id: crypto.randomUUID(), source: created[edge.source].id, target: created[edge.target].id, type: 'smoothstep', label: edge.label }));
    setNodes((current) => [...current, ...created]); setEdges((current) => [...current, ...createdEdges]); setTemplateOpen(false); setNotice(t('noticeTemplateAddedMarketplace', { name: templateText(template, 'name') }));
    trackActivity('creation_object_pack_added', { sessionId, metadata: { clientSurface: canvasSurface(), templateId: template.id, objectKinds: template.objects.map((item) => item.kind) } });
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: created.map(({ id }) => ({ id })), padding: .2, duration: 400 }), 0);
  }, [canEdit, sessionId, setEdges, setNodes, t, templateText]);

  const addFramePreset = useCallback((preset: FramePreset) => {
    if (!canEdit) return;
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 260 };
    const node = newNode('frame', position); node.data = { ...preset.data, title: preset.name };
    setNodes((current) => [...current, node]); setSelectedId(node.id); setTemplateOpen(false); setNotice(t('noticeFramePresetAdded', { name: preset.name }));
  }, [canEdit, setNodes]);

  const saveFramePreset = useCallback(() => {
    if (selectedNode?.data.kind !== 'frame') return;
    const preset: FramePreset = { id: crypto.randomUUID(), name: selectedNode.data.title, data: { ...selectedNode.data } };
    if (persistence === 'server') {
      const graph = creationGraphFromSnapshot({ nodes: [{ ...selectedNode, id: crypto.randomUUID(), position: { x: 80, y: 80 } }], edges: [] });
      void creationSessionsApi.templates.create({ name: preset.name, description: 'Reusable Canvas frame', category: 'Frame', visibility: 'private', graph }).then(() => {
        setNotice(t('noticeFrameSavedAccount'));
        return creationSessionsApi.templates.list();
      }).then((result) => setServerTemplates(result.templates)).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeSaveTemplateFailed')));
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
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeTemplateFailed')));
  }, [canEdit, persistence, sessionId, setEdges, setNodes]);

  const createBranch = useCallback(() => {
    if (persistence !== 'server') { requireAccount('branch', 'Create an account to branch this canvas', 'Branches need durable version history so you can compare and merge safely without losing your local work.'); return; }
    setNotice(t('noticeCreatingBranch'));
    void creationSessionsApi.branch(sessionId, `${title} — branch`).then(async ({ session }) => {
      canvasNavigate(`/create/${session.id}`);
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeCreateBranchFailed')));
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
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeCompareBranchFailed')));
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
    const graph = creationGraphFromSnapshot({ nodes: merged, edges: [...retainedEdges, ...branchEdges] });
    setNotice(t('noticeApplyingMerge'));
    void creationSessionsApi.saveGraph(mergeReview.parentId, { ...graph, expectedRevision: mergeReview.parentRevision }).then(() => { canvasNavigate(`/create/${mergeReview.parentId}`); }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeMergeFailed')));
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
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, subtitle: item.subtitle ?? undefined, ...(item.kind === 'task' ? taskDetails.get(String(item.resourceId)) : undefined), resourceId: `${item.resourceType}:${item.resourceId}`, workflowExecutable: item.workflowExecutable, resourceSubtype: item.resourceSubtype },
          })),
          ...expanded.generated.map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 390 + index * 370, y: project.position.y - 430 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, sourceProjectId: projectId, expansionKey: item.key },
          })),
        ];
        const knownResources = new Set(nodes.map((node) => node.data.resourceId).filter(Boolean));
        const knownNative = new Set(nodes.map((node) => String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        const additions = related.filter((node) => node.data.resourceId ? !knownResources.has(node.data.resourceId) : !knownNative.has(String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        setNodes((current) => [...current, ...additions]);
        setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: project.id, target: node.id, type: 'smoothstep', label: node.data.kind }))]);
        setNotice(additions.length ? `${additions.length} related project items added` : t('noticeLensAlreadyExpanded'));
        trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: canvasSurface(), projectId } });
      }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeExpandProjectFailed')));
      return;
    }
    const related: CreationFlowNode[] = [
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y - 150 }, data: { kind: 'dashboard', title: `${project.data.title} health` } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y + 100 }, data: { kind: 'roadmap', title: `${project.data.title} roadmap`, status: 'Live' } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y - 120 }, data: { kind: 'workflow', title: 'Delivery workflow', status: 'Ready' } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y + 150 }, data: { kind: 'task', title: 'Next delivery task', status: 'Ready', role: 'Campaign Strategist' } },
    ];
    const additions = related.filter((candidate) => !nodes.some((node) => node.data.kind === candidate.data.kind && node.data.title === candidate.data.title));
    setNodes((current) => [...current, ...additions]);
    setEdges((current) => [...current, ...additions.map((candidate) => ({ id: crypto.randomUUID(), source: project.id, target: candidate.id, type: 'smoothstep' }))]);
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
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeCompareProjectsFailed')));
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
      setNotice(error instanceof Error ? error.message : t('noticeLoadQualityFailed'));
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
      setNodes((current) => [...current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status } } : node), task]);
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
        const message = error instanceof Error ? error.message : 'Could not create delivery task';
        const failed: CreationDeliverable = { ...deliverable, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivery failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'failed', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt }).catch(() => undefined);
        setNotice(message);
      });
      return;
    }
    addTaskNode(`draft-task:${crypto.randomUUID()}`, 'Draft');
    setNotice(t('noticeNeedProjectForDelivery'));
  }, [nodes, persistence, requireAccount, selectedNode, sessionId, setEdges, setNodes]);

  const expandMockupSet = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'mockupSet') return;
    const labels = Array.isArray(selectedNode.data.items) && selectedNode.data.items.length
      ? selectedNode.data.items.map(String).slice(0, 10)
      : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'];
    const additions = labels.map((label, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: selectedNode.position.x + 440 + (index % 2) * 330, y: selectedNode.position.y - 180 + Math.floor(index / 2) * 220 }, data: { kind: 'mockup', title: label, status: 'Ready for review', subtitle: `High-fidelity concept ${index + 1} of ${labels.length}.` } }));
    setNodes((current) => [...current, ...additions]);
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
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeLoadEvermindFailed')));
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
    const specs: Array<{ kind: CreationObjectKind; title: string; status: string; x: number; y: number; step: number; instruction: string; detail?: Partial<CreationNodeData> }> = [
      { kind: 'dataset', title: `${selectedNode.data.title} training corpus`, status: 'Start here', x: -430, y: -20, step: 1, instruction: 'Select this card, then import a CSV or TSV in Details.' },
      { kind: 'workflow', title: 'Tokenize examples', status: 'Waiting for data', x: -430, y: 250, step: 2, instruction: 'Review the corpus, then run tokenization.', detail: { steps: [{ title: 'Inspect corpus', status: 'Waiting' }, { title: 'Build vocabulary', status: 'Waiting' }, { title: 'Verify tokens', status: 'Waiting' }] } },
      { kind: 'workflow', title: 'Distil & tune', status: 'Waiting for tokens', x: -20, y: 250, step: 3, instruction: 'Choose self-learning or a teacher, then adapt the model.', detail: { steps: [{ title: 'Choose teacher', status: 'Waiting' }, { title: 'Create exemplars', status: 'Waiting' }, { title: 'Adapt weights', status: 'Waiting' }, { title: 'Save version', status: 'Waiting' }] } },
      { kind: 'evaluation', title: 'Quality gate', status: 'Waiting for version', x: 800, y: 15, step: 4, instruction: 'Test learned answers before enabling replies.', detail: { verdict: 'Awaiting trained version', gaps: ['Run readiness prompts', 'Compare held-out loss', 'Approve the version'], recommendations: ['Complete distillation and tuning first.', 'Check regression against prior learnings.', 'Publish only after the model is coherent.'] } },
      { kind: 'dashboard', title: 'Learning telemetry', status: 'Waiting for run', x: 800, y: 300, step: 5, instruction: 'Observe loss, weight movement, and learned examples.', detail: { kpis: [{ label: 'Loss', value: '—', trend: 'After first run' }, { label: 'Weights moved', value: '—', trend: 'After first run' }, { label: 'Examples learned', value: '0', trend: 'No run yet' }], chartLabels: ['No training runs yet'], chartValues: [0] } },
    ];
    const created = specs.map((spec) => {
      const node = newNode(spec.kind, { x: selectedNode.position.x + spec.x, y: selectedNode.position.y + spec.y });
      node.data = { ...node.data, ...spec.detail, title: spec.title, status: spec.status, modelPipelineFor: selectedNode.id, pipelineStep: spec.step, pipelineStart: spec.step === 1, pipelineInstruction: spec.instruction };
      return node;
    });
    const [dataset, tokenizer, tuning, evaluation, telemetry] = created;
    const sequence = [
      { source: dataset!.id, target: tokenizer!.id, label: '1 · examples' },
      { source: tokenizer!.id, target: tuning!.id, label: '2 · tokens' },
      { source: tuning!.id, target: selectedNode.id, label: '3 · learned version' },
      { source: selectedNode.id, target: evaluation!.id, label: '4 · test' },
      { source: evaluation!.id, target: telemetry!.id, label: '5 · observe' },
    ];
    setNodes((current) => [...current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, pipelineExpanded: true } } : node), ...created]);
    setEdges((current) => [...current, ...sequence.map((edge) => ({ ...edge, id: crypto.randomUUID(), type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed } }))]);
    setSelectedId(dataset!.id); setSelectedIds([dataset!.id]); openNodeInspector(dataset!.id);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...created].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
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
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeEvermindEvalFailed')));
  }, [nodes, selectedNode, setEdges, setNodes]);

  const startStandup = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'standup') return;
    if (persistence === 'local') { requireAccount('start', 'Create an account to start a collaborative stand-up', 'A live stand-up needs durable participants, shared activity, follow-up tasks, and tenant permissions.'); return; }
    const people = nodes.filter((node) => node.data.kind === 'staff' || node.data.kind === 'agent').slice(0, 25);
    if (!people.length) { setNotice(t('noticeNeedPeopleOnCanvas')); return; }
    const participants = people.map((node) => ({
      kind: node.data.kind === 'agent' ? 'agent' : 'human',
      ref: node.data.resourceId?.split(':').slice(1).join(':') || node.id,
      name: node.data.title,
      focus: node.data.focus || node.data.subtitle || 'No current focus recorded',
    }));
    const applyStandup = (resourceId?: string) => {
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: resourceId ? 'Live' : 'Draft', participants, resourceId: resourceId || node.data.resourceId, summary: `${participants.length} participants gathered. Brain will ask each person for progress, blockers, and next actions, then create follow-up work on this canvas.` } } : node));
      setEdges((current) => [...current, ...people.filter((person) => !current.some((edge) => edge.source === person.id && edge.target === selectedNode.id)).map((person) => ({ id: crypto.randomUUID(), source: person.id, target: selectedNode.id, label: 'joins', type: 'smoothstep' }))]);
    };
    const project = canvasProjectNodes(nodes)[0];
    const projectId = project ? canvasProjectId(project.data) : null;
    if (persistence === 'server' && projectId) {
      setNotice(t('noticeStartingStandup'));
      void ceremonySessionsApi.start(projectId, 'standup', participants.map(({ kind, ref, name }) => ({ kind, ref, name }))).then((result) => {
        const ceremonyId = result.session?.id;
        applyStandup(ceremonyId ? `ceremony:${ceremonyId}` : undefined);
        setNotice(ceremonyId ? 'Live stand-up started' : t('noticeStandupFramePrepared'));
      }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeStartStandupFailed')));
      return;
    }
    applyStandup();
    setNotice(t('noticeNeedProjectForStandup'));
  }, [nodes, persistence, requireAccount, selectedNode, setEdges, setNodes]);

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
    const kind = event.dataTransfer.getData(DND_MIME) as CreationObjectKind;
    // A link dragged from a browser tab or another app carries no object kind —
    // it lands as a live Web page panel, which is what a dropped URL means.
    if (!kind && point) {
      const dropped = normalizeWebPageUrl(event.dataTransfer.getData('text/uri-list').split('\n')[0] || event.dataTransfer.getData('text/plain'));
      if (dropped) {
        const page = newNode('browser', point);
        page.data = { ...page.data, title: webPageHost(dropped), url: dropped, status: '' };
        setNodes((current) => [...current, page]);
        setSelectedId(page.id); setSelectedIds([page.id]); openNodeInspector(page.id);
        return;
      }
    }
    if (!kind || !point) return;
    const node = newNode(kind, point);
    if (kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id); setSelectedIds([node.id]); openNodeInspector(node.id);
  }, [addFilesToCanvas, canEdit, localizedTourDefaults, openNodeInspector, setNodes, t]);

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
   * Resolve "the dataset this action runs against", once.
   *
   * Five data tools ask the same question — classify, contract, quality, metric,
   * and the model inferrer — and each was a candidate to re-derive the candidate
   * list, the ambiguity error and the empty-rows error slightly differently. It
   * reads STAGED objects too, so a dataset proposed earlier in the same turn can
   * be classified in the next tool call rather than being reported as absent.
   */
  const resolveTabularTarget = useCallback((objectId?: string) => {
    const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
    const candidates = [...nodes, ...staged].filter((node) =>
      ['dataset', 'table', 'spreadsheet', 'datasource'].includes(node.data.kind)
      && Array.isArray(node.data.rows) && node.data.rows.length > 0);
    const node = objectId ? candidates.find((candidate) => candidate.id === objectId) : candidates.length === 1 ? candidates[0] : undefined;
    if (!node) {
      return {
        error: candidates.length
          ? `Specify which dataset. Tabular objects on this canvas: ${candidates.map((candidate) => `${candidate.id} (${candidate.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas. Attach a CSV, TSV, or JSON file, or read one from a connected data source with canvas_query_data_source.',
      } as const;
    }
    const source = tabularFromObject(node.data as Record<string, unknown>);
    if (!source.columns.length) return { error: `${node.data.title} has no columns yet.` } as const;
    return { node, source } as const;
  }, [nodes]);

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
    const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
    return [...nodes, ...staged].flatMap((node) => {
      if (node.data.kind !== 'build') return [];
      const binding = canvasBuildBinding(node.data);
      return binding ? [{ objectId: node.id, title: String(node.data.title ?? 'Build'), binding }] : [];
    });
  }, [nodes]);

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
    const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
    const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
    const node = newNode('build', nextCanvasObjectPosition([...nodes, ...staged], {}, narrowViewport, 'build'));
    const ide = await createCanvasBuild({ title: input.title, modality: input.modality });
    const patch = canvasBuildPatch(ide);
    node.data = { ...node.data, ...patch, title: input.title };
    setNodes((current) => [...current, node]);
    const binding = canvasBuildBinding(node.data);
    if (!binding) throw new Error('The workspace was created but could not be bound to the board.');
    return { objectId: node.id, title: input.title, binding };
  }, [nodes, setNodes]);

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
    hasTenant: persistence === 'server',
    canEdit,
    objects: () => {
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      return [...nodesRef.current, ...staged].map((node) => ({
        id: node.id, kind: node.data.kind, title: node.data.title,
        data: node.data as unknown as Record<string, unknown>,
      }));
    },
    addObject: (kind, fields, at) => {
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode(kind as CreationObjectKind, nextCanvasObjectPosition([...nodesRef.current, ...staged], at ?? {}, narrowViewport, kind as CreationObjectKind));
      node.data = { ...node.data, ...sanitizeCreationObjectPatch(kind as CreationObjectKind, fields) } as CreationNodeData;
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: String(fields.title ?? node.data.title), node });
      return { objectId: node.id };
    },
    updateObject: (objectId, patch, label) => {
      const kind = nodesRef.current.find((node) => node.id === objectId)?.data.kind;
      proposalBuffer.current.push({
        id: crypto.randomUUID(), type: 'object.update', label, objectId,
        patch: sanitizeCreationObjectPatch((kind ?? 'account') as CreationObjectKind, patch),
      });
    },
  }), [canEdit, persistence]);

  const canvasFounderOpsActionList = useMemo<BrainAction[]>(() => canvasFounderOpsActions(canvasOpsContext), [canvasOpsContext]);
  /** The secure legal-document vocabulary — share, revoke, request signature, sync.
   *  See `canvasLegalDocumentTools.ts` for why these are dedicated tools rather than
   *  routed through `canvas_invoke_object_action`. */
  const canvasLegalDocumentActionList = useMemo<BrainAction[]>(() => canvasLegalDocumentActions(canvasOpsContext), [canvasOpsContext]);
  /** The generic e-signature request for authored (non-file) objects — closes the
   *  `contract.sign` gap; see `canvasSignatureTools.ts`. */
  const canvasSignatureActionList = useMemo<BrainAction[]>(() => canvasSignatureActions(canvasOpsContext), [canvasOpsContext]);

  const canvasActions = useMemo<BrainAction[]>(() => ([{
    name: 'canvas_prepare_executive_use_case',
    description: 'Prepare one of the 48 migrated executive use cases for execution on this Canvas. Call this first when the prompt contains a legacy dotted use-case id. It returns the exact operation, completion condition, permitted existing Canvas outputs, and live evidence from the already-owning Builderforce domains. It never creates schema or mutates canonical domain data.',
    parameters: {
      type: 'object', required: ['useCaseId'], additionalProperties: false,
      properties: {
        useCaseId: { type: 'string', enum: C_SUITE_CANVAS_USE_CASES.map((item) => item.id) },
        days: { type: 'number', minimum: 1, maximum: 365 },
        limit: { type: 'number', minimum: 1, maximum: 100 },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as { useCaseId?: unknown; days?: unknown; limit?: unknown };
      // Resolved tolerantly, and against the contract THIS TURN is running when
      // the args carry nothing usable — see `resolveExecutiveUseCaseId` for why
      // that is safe for this tool and not in general. A run died here on a
      // model typing `useCas1eId`, with the right value under the wrong key.
      const resolvedId = resolveExecutiveUseCaseId(raw, inFlightUseCaseId.current);
      const useCase = C_SUITE_CANVAS_USE_CASES.find((candidate) => candidate.id === resolvedId);
      const workflow = useCase ? cSuiteCanvasWorkflow(useCase) : null;
      const owner = useCase ? cSuiteCanvasOwner(useCase) : null;
      if (!useCase || !workflow || !owner) {
        // The error names the way out. The dead-end version ("Unknown executive
        // Canvas use case.") told the model nothing it could act on, so it
        // stopped rather than retrying — the turn's real cause of death.
        return {
          error: 'Unknown executive Canvas use case.',
          hint: 'Call this again with `useCaseId` set to one of the listed ids, spelled exactly.',
          validUseCaseIds: [...C_SUITE_USE_CASE_IDS],
        };
      }
      const contract = {
        id: useCase.id,
        label: useCase.label,
        stages: owner.stages,
        operation: workflow.operation,
        evidence: workflow.evidence,
        domains: owner.domains,
        entityTerms: workflow.entityTerms,
        allowedOutputs: workflow.outputs,
        completion: workflow.completion,
        confirmTarget: workflow.confirmTarget === true,
        noNewTables: true,
      };
      if (workflow.evidence === 'web') return {
        contract,
        evidenceStatus: 'research_required',
        next: 'Use builtin_web_search and builtin_web_fetch, preserve source URLs in a dataset, then author only the allowed Canvas outputs.',
      };
      if (workflow.evidence === 'canvas') return {
        contract,
        evidenceStatus: 'canvas_snapshot_available',
        next: workflow.confirmTarget
          ? 'Read the selected target in full with canvas_read_object before changing it; preserve every field outside the requested change.'
          : 'Use the current Canvas snapshot and canvas_read_object/canvas_read_snapshot when more detail is needed.',
      };
      if (persistence !== 'server') return {
        contract,
        evidenceStatus: 'saved_session_required',
        error: 'This use case requires live tenant-scoped Builderforce domain data. Save or claim the Creation Canvas before executing it.',
      };
      const days = Math.max(1, Math.min(365, Math.floor(Number(args.days) || 30)));
      const limit = Math.max(1, Math.min(100, Math.floor(Number(args.limit) || 50)));
      const normalizedTerms = workflow.entityTerms.map((term) => term.toLocaleLowerCase().replaceAll('-', '_'));
      const domains = await Promise.all(owner.domains.map(async (domain) => {
        const [summary, entities, items, metrics] = await Promise.all([
          getDomainSummary(domain), getScopeEntities(domain), getDomainItems(domain, { limit }), getDomainMetrics(domain, days),
        ]);
        const matches = entities.filter((entity) => {
          const name = entity.name.toLocaleLowerCase();
          return entity.readable && normalizedTerms.some((term) => name.includes(term) || term.includes(name));
        }).sort((left, right) => right.count - left.count).slice(0, 4);
        const entityEvidence = await Promise.all(matches.map(async (entity) => {
          try {
            const page = await getEntityRows(domain, entity.name, { limit: Math.min(limit, 50) });
            return { entity, rows: page.rows, total: page.total };
          } catch (error) {
            return { entity, rows: [], total: entity.count, error: error instanceof Error ? error.message : 'Entity rows unavailable' };
          }
        }));
        return { domain, summary, matchedEntities: entityEvidence, items, metrics };
      }));
      return {
        contract,
        evidenceStatus: domains.some((domain) => domain.summary.itemCount > 0 || domain.metrics.length > 0 || domain.matchedEntities.some((entity) => entity.total > 0)) ? 'available' : 'empty',
        domains,
        instruction: 'Create or update an allowed Canvas output only from these rows, metrics and registered objects. State missing evidence inside the artifact; never fill it with example values.',
      };
    },
  }, {
    name: 'canvas_read_domain',
    description: 'Read real, tenant-scoped Builderforce domain data for an executive Canvas request. Use this before authoring a C-suite dashboard, report, chart, table, KPI, forecast, register, company view, or risk rollup. Returns the domain summary, registered entity catalog with row counts, recent objects, metric series, and—when entity is supplied—the selected entity rows. Never invent a value when this result has no supporting row or metric.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        domain: { type: 'string', enum: [...DOMAINS], description: 'Builderforce owner domain. Marketing maps to growth; agile maps to delivery; CRM maps to revenue; operations maps to people; product/company maps to investor or delivery according to the requested record.' },
        entity: { type: 'string', description: 'Optional entity name returned by the domain catalog, for example expenses, validation_dashboards, or people_employees.' },
        days: { type: 'number', minimum: 1, maximum: 365, description: 'Metric lookback window. Defaults to 30.' },
        limit: { type: 'number', minimum: 1, maximum: 200, description: 'Maximum recent objects or entity rows. Defaults to 50.' },
      },
      required: ['domain'],
    },
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Executive domain data requires a saved, authenticated Creation Canvas session.' };
      const args = raw as { domain?: unknown; entity?: unknown; days?: unknown; limit?: unknown };
      const domain = typeof args.domain === 'string' && isDomain(args.domain) ? args.domain : null;
      if (!domain) return { error: `Choose a supported domain: ${DOMAINS.join(', ')}` };
      const days = Math.max(1, Math.min(365, Math.floor(Number(args.days) || 30)));
      const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 50)));
      const [summary, entities, items, metrics] = await Promise.all([
        getDomainSummary(domain), getScopeEntities(domain), getDomainItems(domain, { limit }), getDomainMetrics(domain, days),
      ]);
      const entity = typeof args.entity === 'string' ? args.entity.trim() : '';
      if (!entity) return { domain, summary, entities, items, metrics };
      const descriptor = entities.find((candidate) => candidate.name === entity);
      if (!descriptor) return { error: `Entity '${entity}' is not owned by ${domain}.`, domain, summary, entities, items, metrics };
      if (!descriptor.readable) return { error: `Entity '${entity}' is intentionally not available through the generic tenant reader.`, domain, summary, entity: descriptor, items, metrics };
      const page = await getEntityRows(domain, entity, { limit });
      return { domain, summary, entity: descriptor, rows: page.rows, total: page.total, items, metrics };
    },
  }, {
    // ── The founder objects ──────────────────────────────────────────────────
    //
    // "Use my existing business details" only means something if the details are
    // reachable. This writes the investor seat's `companies` row onto a `company`
    // object so the rest of the analysis is authored against the real business
    // rather than against whatever the user retyped into the prompt.
    //
    // It is a WRITE-TO-BOARD layered on the read `canvas_read_domain` already
    // performs — the relationship `canvas_add_diagnostic` has to `GET /api/tools`
    // — not a second way to read a tenant's company.
    name: 'canvas_sync_company_profile',
    description: 'Put the signed-in tenant\'s own business details on the canvas as a `company` object. Call this FIRST whenever the user says "my business", "our company", "my existing business details", or asks for analysis grounded in who they are. Creates the object when absent and refreshes it when present. If the tenant has no company record the result says so — author a `company` object with canvas_add_object from what the user tells you instead of inventing one.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Existing company object to refresh. Omit to create one.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') {
        return { error: 'Reading your saved business details needs a signed-in Creation Canvas session. Ask the user for the company name, sector, stage and markets served, then author a `company` object with canvas_add_object — do not invent them.' };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; x?: number; y?: number };
      const page = await getEntityRows('investor', 'companies', { limit: 25 });
      // The tenant's OWN business is the portfolio-flagged row if one is marked, else the
      // only row. Several unflagged rows is genuinely ambiguous — a CRM's worth of
      // companies is the normal state of that table — so it asks rather than guessing,
      // because picking a customer's company as "your business" poisons every downstream
      // object in the analysis.
      const rows = page.rows as Array<Record<string, unknown>>;
      if (!rows.length) {
        return { companyFound: false, reason: 'no-company-record', instruction: 'This tenant has no company record. Ask the user for their business details and author a `company` object with canvas_add_object. Never invent them.' };
      }
      const owned = rows.filter((row) => row.isPortfolio !== true);
      const candidates = owned.length ? owned : rows;
      const row = candidates.length === 1 ? candidates[0] : null;
      if (!row) {
        return {
          companyFound: false, reason: 'ambiguous',
          companies: candidates.slice(0, 20).map((candidate) => ({ id: candidate.id, name: candidate.name })),
          instruction: 'Several companies are on this tenant. Ask the user which one is their own business before authoring anything against it.',
        };
      }
      const fields: Record<string, unknown> = {
        title: String(row.name ?? 'Company'),
        status: String(row.stage ?? 'Active'),
        ...(row.name ? { legalName: String(row.name) } : {}),
        ...(row.sector ? { sector: String(row.sector) } : {}),
        ...(row.stage ? { stage: String(row.stage) } : {}),
        ...(row.website ? { website: String(row.website) } : {}),
        ...(row.headcount != null ? { headcount: String(row.headcount) } : {}),
        ...(row.arr != null ? { arr: `${row.arr}${row.currency ? ` ${row.currency}` : ''}` } : {}),
        ...(row.country ? { geography: [String(row.country)] } : {}),
        summary: `Synced from the investor seat's company record on ${new Date().toISOString().slice(0, 10)}.`,
      };
      const patch = sanitizeCreationObjectPatch('company', fields);
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const existing = args.objectId
        ? [...nodes, ...stagedNodes].find((node) => node.id === args.objectId)
        : [...nodes, ...stagedNodes].find((node) => node.data.kind === 'company');
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: t('founderCompanySynced', { title: String(fields.title) }), objectId: existing.id, patch });
        return { ok: true, proposed: true, companyFound: true, object: { id: existing.id, kind: 'company', title: fields.title, updated: true } };
      }
      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode('company', nextCanvasObjectPosition([...nodes, ...stagedNodes], args, isNarrow, 'company'));
      node.data = { ...node.data, ...patch } as CreationNodeData;
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('founderCompanySynced', { title: String(fields.title) }), node });
      return { ok: true, proposed: true, companyFound: true, object: { id: node.id, kind: 'company', title: fields.title } };
    },
  }, {
    // Turns the competitor objects on the board into a real geographic analysis: a
    // `map` object built through the SAME `mapObjectFields` every other plot uses,
    // plus the density and coverage-gap tables that are the actual deliverable.
    name: 'canvas_map_competitors',
    description: 'Plot every `competitor` object on this canvas onto a map and analyse the geography: competitor density by metro, and the metros in the market with NO competitor presence. Call this after researching competitors and writing their `locations` (each with lat/lng from builtin_geo_geocode). Returns the coverage gaps — the white space — which is the part of a geographic market analysis a founder is actually buying. Competitors whose locations have no coordinates are named in the result so you can say which rival is missing geography rather than quietly plotting fewer.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        market: { type: 'string', description: 'The market being analysed, e.g. "Florida". Drives which reference metros coverage gaps are measured against.' },
        title: { type: 'string', description: 'Title for the map object.' },
        coverageRadiusMiles: { type: 'number', minimum: 1, maximum: 500, description: 'How close a competitor site must be to count as covering a metro. Defaults to 40.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
      required: ['market'],
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { market?: string; title?: string; coverageRadiusMiles?: number; x?: number; y?: number };
      const market = typeof args.market === 'string' ? args.market.trim() : '';
      if (!market) return { error: 'Pass the market being analysed, e.g. "Florida".' };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const competitorNodes = [...nodes, ...stagedNodes].filter((node) => node.data.kind === 'competitor');
      if (!competitorNodes.length) {
        return { error: 'No competitor objects are on this canvas yet. Research the market with builtin_web_search, resolve each site with builtin_geo_geocode, then create one `competitor` object per rival with canvas_add_object before mapping.' };
      }
      const analysis = analyzeCompetitorGeography({
        sites: competitorNodes.flatMap((node) => competitorSitesFrom(node.data.title, node.data.locations)),
        allCompetitors: competitorNodes.map((node) => node.data.title),
        market,
        ...(typeof args.coverageRadiusMiles === 'number' ? { coverageRadiusMiles: args.coverageRadiusMiles } : {}),
      });
      if (!analysis.points.length) {
        return {
          error: `None of the ${competitorNodes.length} competitor object(s) on this canvas has a location with usable lat/lng. Resolve each competitor's city with builtin_geo_geocode and write the coordinates back with canvas_update_object into locations: [{name, city, region, lat, lng}], then call this again.`,
          unmappedCompetitors: analysis.unmappedCompetitors,
        };
      }
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : `${market} competitor landscape`;
      const gapSummary = analysis.marketKnown
        ? analysis.gaps.length
          ? `${analysis.gaps.length} metro(s) with no competitor within the coverage radius: ${analysis.gaps.slice(0, 5).map((gap) => gap.metro).join(', ')}.`
          : 'Every reference metro in this market has a competitor inside the coverage radius.'
        : `No reference metros are known for "${market}", so competitor density is clustered by stated city and no coverage gaps are computed.`;
      const fields = mapObjectFields({
        title,
        status: t('founderCompetitorMapStatus', { count: analysis.points.length }),
        summary: `${analysis.mappedCompetitors.length} competitor(s) plotted across ${analysis.clusters.length} area(s). ${gapSummary}`,
        points: analysis.points,
        columns: { latitude: 'lat', longitude: 'lng', label: 'competitor', value: null },
        sourceDatasetId: '',
        ...(analysis.region ? { region: analysis.region } : {}),
        regionName: market,
      });
      const patch = sanitizeCreationObjectPatch('map', fields);
      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode('map', nextCanvasObjectPosition([...nodes, ...stagedNodes], args, isNarrow, 'map'));
      node.data = { ...node.data, ...patch } as CreationNodeData;
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('founderCompetitorMapProposal', { title }), node });
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'map', title },
        market,
        marketKnown: analysis.marketKnown,
        clusters: analysis.clusters,
        coverageGaps: analysis.gaps,
        mappedCompetitors: analysis.mappedCompetitors,
        unmappedCompetitors: analysis.unmappedCompetitors,
        instruction: 'Report the coverage gaps as the finding. Where a gap exists, say which competitor is nearest and how far, so the user can judge whether it is genuinely uncontested or merely underserved. Never describe an unmapped competitor as absent from a region — it has no coordinates, which is not the same thing.',
      };
    },
  }, {
    // The LIVE half. See the `liveMetric` note in the contract.
    name: 'canvas_refresh_live_metric',
    description: 'Re-read the domain metric a `liveMetric` object is bound to, and write the current value, trend and series onto it. Use this instead of authoring a number by hand whenever the board already carries a bound metric — a runway, burn, pipeline or lead figure typed into a card is wrong the next morning and cannot be asked again. Available metric keys come from the domain manifest; bind with the `binding` field, e.g. "finance.runway_months".',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The liveMetric object to refresh. Omit when exactly one is on the board.' },
        binding: { type: 'string', description: 'Override or set the binding, e.g. "finance.runway_months", "revenue.pipeline", "growth.leads".' },
        days: { type: 'number', minimum: 1, maximum: 365, description: 'Lookback window for the series. Defaults to 30.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Live metrics read tenant domain data, which needs a signed-in, saved Creation Canvas session.' };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; binding?: string; days?: number };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const candidates = [...nodes, ...stagedNodes].filter((node) => node.data.kind === 'liveMetric');
      const target = args.objectId ? candidates.find((node) => node.id === args.objectId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which live metric to refresh. On this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No liveMetric object is on this canvas. Create one with canvas_add_object and set its `binding` to a domain metric key.' };
      }
      const binding = (typeof args.binding === 'string' && args.binding.trim() ? args.binding : String(target.data.binding ?? '')).trim();
      const [domainPart] = binding.split('.');
      if (!binding || !domainPart || !isDomain(domainPart)) {
        return { error: `"${binding || '(unset)'}" is not a bound domain metric. Use "<domain>.<metric>" where domain is one of: ${DOMAINS.join(', ')}. Read the available metric keys for a domain with canvas_read_domain.` };
      }
      const days = Math.max(1, Math.min(365, Math.floor(Number(args.days) || 30)));
      const series = await getDomainMetrics(domainPart, days);
      const match = series.find((entry) => entry.metric === binding);
      if (!match) {
        return {
          error: `The ${domainPart} domain does not report "${binding}" over the last ${days} days. Metrics it does report: ${series.map((entry) => entry.metric).join(', ') || '(none yet)'}.`,
          availableMetrics: series.map((entry) => entry.metric),
        };
      }
      const points = match.points.slice(-90);
      const latest = points.at(-1) ?? null;
      if (!latest) {
        return { error: `"${binding}" has no observations in the last ${days} days, so there is no value to write. Say so rather than reporting a zero.` };
      }
      const first = points[0];
      const delta = points.length > 1 ? latest.value - first.value : null;
      const fields: Record<string, unknown> = {
        status: t('founderMetricLive'),
        value: latest.value.toLocaleString(),
        binding,
        ...(match.unit ? { unit: match.unit } : {}),
        ...(delta != null ? { trend: `${delta >= 0 ? '+' : ''}${delta.toLocaleString()} vs ${days}d ago` } : {}),
        series: points.map((point) => ({ at: point.at, value: point.value })),
        fetchedAt: new Date().toISOString(),
      };
      const patch = sanitizeCreationObjectPatch('liveMetric', fields);
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: t('founderMetricRefreshed', { title: target.data.title }), objectId: target.id, patch });
      return {
        ok: true, proposed: true,
        object: { id: target.id, kind: 'liveMetric', title: target.data.title },
        binding, value: latest.value, unit: match.unit, observedAt: latest.at, pointCount: points.length,
        instruction: 'This value was read from the tenant\'s own domain data just now. Report it with its as-of instant. If a trigger on this board watches this metric, call canvas_evaluate_triggers so a breach is reported in the same turn.',
      };
    },
  }, {
    // ── The recruiter's funnel ─────────────────────────────────────────────────
    // Ranks the resume objects ALREADY on this board against a posting on this board,
    // in the browser. No network call and no account: the deterministic analyzer the
    // resume builder already uses, composed N:1 — which is the half a recruiter needs
    // and the 1:1 version could not express.
    name: 'canvas_screen_resumes',
    description: 'Rank every `resume` object on this canvas against a `jobPosting` on this canvas, and write the ranking onto a `shortlist` object. Use this whenever the user asks who to interview, who the strongest candidates are, or to screen a pile of CVs — never rank them by reading the resumes yourself, because the result must be reproducible and defensible. Scores four declared signals (keyword coverage, whether matched terms appear in a dated role, demonstrated years against the stated level, and how recently the skills were used) and returns the evidence and the gaps for every candidate. It reads no demographic or personal attribute and adds nothing a resume does not state.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        postingObjectId: { type: 'string', description: 'The jobPosting to rank against. Omit when exactly one is on the board.' },
        shortlistObjectId: { type: 'string', description: 'An existing shortlist to write into. Omit to create one.' },
        resumeObjectIds: { type: 'array', items: { type: 'string' }, description: 'Restrict the screen to these resume objects. Omit to screen every resume on the board.' },
        level: { type: 'string', description: 'Override the seniority read from the posting, e.g. "senior", "staff", "graduate".' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { postingObjectId?: string; shortlistObjectId?: string; resumeObjectIds?: string[]; level?: string };
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...staged];

      const postings = all.filter((node) => node.data.kind === 'jobPosting');
      const posting = args.postingObjectId ? postings.find((node) => node.id === args.postingObjectId) : postings.length === 1 ? postings[0] : undefined;
      if (!posting) {
        return { error: postings.length
          ? `Specify which posting to rank against. On this canvas: ${postings.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No jobPosting object is on this canvas. Create one with canvas_add_object first — a ranking with no posting behind it is an opinion.' };
      }

      const wanted = new Set(args.resumeObjectIds ?? []);
      const resumes = all.filter((node) => node.data.kind === 'resume' && (wanted.size === 0 || wanted.has(node.id)));
      if (!resumes.length) {
        return { error: 'No resume objects are on this canvas to screen. Add them first — this ranks what is on the board, and never invents a candidate.' };
      }

      // The posting's own fields ARE the job description. Reading them rather than asking
      // the model to restate them is what keeps the ranking reproducible: the same board
      // screened twice must produce the same order.
      const jobDescription = [
        posting.data.title, posting.data.summary, posting.data.level, posting.data.location,
        ...(Array.isArray(posting.data.mustHaves) ? posting.data.mustHaves : []),
        ...(Array.isArray(posting.data.niceToHaves) ? posting.data.niceToHaves : []),
        ...(Array.isArray(posting.data.responsibilities)
          ? (posting.data.responsibilities as Array<Record<string, unknown>>).map((item) => `${item?.title ?? ''} ${item?.detail ?? ''}`)
          : []),
      ].filter(Boolean).join('\n');
      if (jobDescription.trim().length < 40) {
        return { error: 'That posting has no requirements to screen against. Author its mustHaves, niceToHaves and responsibilities first — screening against an empty posting ranks nobody honestly.' };
      }

      // Read through the SAME accessor the template engine uses. Reading
      // `data.resumeDocument` directly found nothing on an imported résumé — that field
      // is consumed when the family is built and never persisted — so a board full of
      // real CVs screened as "no parsed resume document".
      const candidates = resumes.flatMap((node) => {
        const document = resumeDocumentFromNode(node.data);
        return document ? [{ ref: node.id, name: String(node.data.title || node.id), document }] : [];
      });
      if (!candidates.length) {
        return { error: 'None of those resume objects carries a parsed resume document yet, so there is nothing to score.' };
      }

      const level = typeof args.level === 'string' && args.level.trim() ? args.level : String(posting.data.level ?? '');
      const report = screenCandidates(candidates, { jobDescription, ...(level ? { level } : {}) });

      const fields = {
        status: t('hiringShortlistRanked', { count: report.ranked.length }),
        postingRef: posting.id,
        method: report.method,
        ranked: report.ranked.map((entry) => ({
          rank: entry.rank,
          candidate: entry.candidate,
          score: entry.score,
          evidence: entry.evidence.join(', '),
          gaps: entry.gaps.join(', '),
        })),
        knockouts: report.knockouts,
        reviewedCount: report.reviewedCount,
      };
      const patch = sanitizeCreationObjectPatch('shortlist', fields);

      const shortlists = all.filter((node) => node.data.kind === 'shortlist');
      const target = args.shortlistObjectId ? shortlists.find((node) => node.id === args.shortlistObjectId) : undefined;
      if (target) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: t('hiringShortlistUpdated', { title: target.data.title }), objectId: target.id, patch });
      } else {
        const node = newNode('shortlist', { x: 320, y: 320 });
        node.data = { ...node.data, ...patch, title: t('hiringShortlistFor', { title: String(posting.data.title || '') }) };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('hiringShortlistCreated'), node });
      }

      return {
        ok: true, proposed: true,
        reviewedCount: report.reviewedCount,
        ranked: report.ranked.map((entry) => ({ rank: entry.rank, candidate: entry.candidate, score: entry.score, signals: entry.signals })),
        instruction: 'Report the top of this ranking and the reason each one is there, using the evidence and gaps on the shortlist. This is a READING ORDER, not a decision: never say a candidate was rejected, and never restate a score without the gap that goes with it.',
      };
    },
  }, {
    /**
     * THE TEMPLATE ENGINE, EXPOSED.
     *
     * "Make ten versions of my résumé in different styles" had no route to this engine,
     * so the only path left was ten `canvas_add_object` calls, each retyping the whole
     * document. Measured 2026-08-15: the turn spent four minutes, produced nothing, and
     * hung. One call now renders every requested style from the one document — no model
     * round-trip per version, and no chance of a variant inventing a job.
     */
    name: 'canvas_render_resume_variants',
    description: `Render one résumé in several visual styles at once, using the built-in template engine. USE THIS — never canvas_add_object — whenever the user asks for their résumé in different styles, templates, designs, layouts or formats, or for "N versions" of it. It re-renders the EXISTING document, so every version states the same history; authoring them by hand would be slower and would let the versions drift apart. Reads the résumé from a resume object, or from a dataset holding an imported JSON Resume. Available templates: ${RESUME_TEMPLATES.map((template) => `${template.id} (${template.industry})`).join(', ')}.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The resume or dataset object holding the résumé. Omit when exactly one is on the board.' },
        templateIds: { type: 'array', items: { type: 'string', enum: [...RESUME_TEMPLATE_IDS] }, description: 'Templates to render, in order. Omit to render the requested count across the full catalog.' },
        count: { type: 'number', description: 'How many styles to render when templateIds is omitted. Capped at the number of templates that exist.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; templateIds?: unknown; count?: number };
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...staged];
      const sources = all.filter((node) => resumeDocumentFromNode(node.data) !== null);
      const source = args.objectId ? all.find((node) => node.id === args.objectId) : sources.length === 1 ? sources[0] : undefined;
      if (!source) {
        return { error: sources.length
          ? `Specify which object holds the résumé. On this canvas: ${sources.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No structured résumé is on this canvas — this restyles a real document and never invents one. If a CV is here as a document, an imported PDF or a Word file, call canvas_import_resume on it FIRST and then restyle the object that produces.' };
      }
      const document = resumeDocumentFromNode(source.data);
      if (!document) return { error: `Object ${source.id} does not hold a readable résumé document, so there is nothing to restyle.` };

      const requested = Array.isArray(args.templateIds)
        ? args.templateIds.filter((id): id is ResumeTemplateId => RESUME_TEMPLATE_IDS.includes(id as ResumeTemplateId))
        : [];
      const count = Math.max(1, Math.min(Number(args.count) || requested.length || RESUME_TEMPLATES.length, RESUME_TEMPLATES.length));
      // Deduplicated and then topped up from the catalog, so "ten versions" is ten
      // DIFFERENT designs rather than the same template repeated to reach a number.
      const templateIds = [...new Set([...requested, ...RESUME_TEMPLATES.map((template) => template.id)])].slice(0, Math.max(count, requested.length));

      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const variants = resumeTemplateVariants(document, templateIds, { title: String(source.data.title || '') });
      const created: Array<{ id: string; templateId: string; title: string }> = [];
      for (const variant of variants) {
        const placed = [...all, ...proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : [])];
        const node = newNode('resume', nextCanvasObjectPosition(placed, {}, narrowViewport, 'resume'));
        node.data = {
          ...node.data,
          ...resumeNodePatch(variant.family),
          title: activeResumeRevision(variant.family).title,
          subtitle: variant.industry,
          status: t('resumeEditor.statusOriginal'),
        };
        node.style = { width: 560, height: 620 };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Render résumé · ${variant.industry}`, node });
        created.push({ id: node.id, templateId: variant.templateId, title: String(node.data.title) });
      }
      return {
        ok: true, proposed: true,
        renderedFrom: source.id,
        variants: created,
        instruction: 'These are already on the board, fully rendered. Name the styles you produced in one short line and stop — do NOT create them again with canvas_add_object, and do not retype any résumé content.',
      };
    },
  }, {
    /**
     * THE MISSING FIRST STEP.
     *
     * A person drops their CV on the board and asks to turn it into a résumé. Every
     * tool that follows — restyling, screening, tailoring, the ATS check — needs a
     * `resume` object, and there was NO tool that made one from a document already on
     * the canvas. So the model did the only thing left: it asked the person to paste
     * the text of the file it was looking at (measured 2026-08-16). This reads the
     * document the importer already extracted and structures it with the same
     * deterministic reader the upload route uses — no model, no upload, no tokens.
     *
     * A SCAN has no extracted text for that deterministic reader to find — it
     * lands as a `file` attachment instead of a `document`. Its bytes survive
     * that landing (see `attachmentBytesStrategy`), so when there is no
     * readable document this falls back to escalating the attachment's
     * retained bytes through the same OCR route the résumé editor's own file
     * picker already uses. That costs a model call and needs a tenant to bill
     * it to, so it only runs on a signed-in, server-persisted session.
     */
    name: 'canvas_import_resume',
    description: 'Turn a résumé that is already on this canvas — as a document, imported PDF, Word file, text, or a scanned/photographed attachment — into a real `resume` object. USE THIS — never canvas_add_object, and never ask the user to paste their résumé — whenever someone asks to convert, import, parse, structure or "make a resume from" a file on the board. A document with real text is structured deterministically; a scan with no text layer is OCR’d server-side (signed-in sessions only). The resulting object is what canvas_render_resume_variants and canvas_screen_resumes need.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The document, file or note holding the résumé. Omit when the canvas holds exactly one document.' },
        title: { type: 'string', description: 'Title for the résumé object. Defaults to the name on the document, or the source file name.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; title?: string };
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...staged];
      // A résumé that is ALREADY structured is not a source: re-importing it would
      // replace a parsed document with a re-parse of its own rendering.
      const candidates = all.filter((node) => canvasDocument(node.data) && resumeDocumentFromNode(node.data) === null);
      // A scan carries no `canvasDocument` — its markdown was never extracted — but
      // if its bytes were retained at drop time, it is still a résumé source.
      const scanCandidates = all.filter((node) => node.data.kind === 'file'
        && (typeof node.data.sourceFileKey === 'string' || typeof node.data.sourceDataUrl === 'string'));
      const source = args.objectId
        ? all.find((node) => node.id === args.objectId)
        : candidates.length === 1 ? candidates[0]
          : candidates.length === 0 && scanCandidates.length === 1 ? scanCandidates[0]
            : undefined;
      if (!source) {
        const named = [...candidates, ...scanCandidates];
        return { error: named.length
          ? `Specify which object holds the résumé. On this canvas: ${named.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'Nothing on this canvas carries readable résumé text. If a file landed as an attachment saying its text could not be extracted, it is a scan with no text layer — say so and ask for a PDF or Word file with real text, or for the text itself. Do NOT ask the user to paste a document whose text this canvas already holds.' };
      }

      let markdown = canvasDocument(source.data)?.markdown?.trim() ?? '';
      let document = markdown ? resumeDocumentFromText(markdown) : null;
      let ocr: { provider: string; model: string } | null = null;

      if (!document) {
        const sourceFileKey = typeof source.data.sourceFileKey === 'string' ? source.data.sourceFileKey : undefined;
        const sourceDataUrl = typeof source.data.sourceDataUrl === 'string' ? source.data.sourceDataUrl : undefined;
        if (!sourceFileKey && !sourceDataUrl) {
          return { error: `Object ${source.id} carries no readable text, so there is nothing to structure. If it is a scanned PDF, say that plainly rather than guessing at its contents.` };
        }
        if (persistence !== 'server') {
          return { error: `Object ${source.id} is a scan with no text layer. Reading it takes a model call billed to a workspace, which needs a signed-in, saved Creation Canvas session — ask the person to sign in, then try again.` };
        }
        const attachmentName = typeof source.data.fileName === 'string' ? source.data.fileName : String(source.data.title || 'attachment');
        try {
          const result = await importResumeFromAttachment({ fileName: attachmentName, sourceFileKey, sourceDataUrl });
          document = resumeDocumentFromJson(result.document);
          ocr = { provider: result.provider, model: result.model };
        } catch (error) {
          return { error: `Reading the scan failed: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (!document) return { error: `Object ${source.id} could not be read into a résumé — the scan may be unclear, or not a résumé.` };
        markdown = renderResumeMarkdown(document);
      }

      const embedded = typeof document.basics?.name === 'string' ? document.basics.name.trim() : '';
      const fileName = typeof source.data.fileName === 'string' ? source.data.fileName.replace(/\.[^.]+$/, '') : '';
      const title = String(args.title ?? '').trim() || embedded || fileName || String(source.data.title || t('resumeEditor.untitledVersion'));
      const family = createResumeFamily({ title, markdown, document });

      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode('resume', nextCanvasObjectPosition(all, { x: source.position.x + 460, y: source.position.y }, narrowViewport, 'resume'));
      node.data = { ...node.data, ...resumeNodePatch(family), title, status: t('resumeEditor.statusOriginal') };
      node.style = { width: 560, height: 620 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('resumeImportedFrom', { title: String(source.data.title || '') }), node });

      // A structure this thin means the source had no recognisable sections. It is
      // still the person's résumé and still lands on the board — but the turn must
      // say so, because the alternative is a confident empty document.
      const thin = resumeDocumentIsThin(document);
      return {
        ok: true, proposed: true,
        objectId: node.id,
        importedFrom: source.id,
        name: embedded,
        workEntries: Array.isArray(document.work) ? document.work.length : 0,
        educationEntries: Array.isArray(document.education) ? document.education.length : 0,
        skills: Array.isArray(document.skills) ? document.skills.length : 0,
        thin,
        ...(ocr ? { readVia: 'ocr' as const, provider: ocr.provider, model: ocr.model } : {}),
        instruction: thin
          ? 'The résumé is on the board, but few sections were recognised. Say which ones came through and offer to fill the rest from what the person tells you — do NOT invent employers, dates or skills, and do not retype the document.'
          : 'The résumé is on the board, fully structured. Report what came through in one short line and offer the next step — restyling with canvas_render_resume_variants, or screening against a posting. Do NOT retype any of its content.',
      };
    },
  }, {
    // Mirrors `canvas_import_resume`: a deterministic reader for a file a registrar
    // or a spreadsheet actually produces, so the roster field's own hint
    // ("canvas_import_roster reads a CSV") is real rather than aspirational.
    name: 'canvas_import_roster',
    description: 'Import a cohort roster from CSV text into a `cohort` object\'s `roster` field. Use this whenever someone pastes or uploads a class list, student list or roster export and asks to load it — never retype rows by hand. Accepts headers ref/id/student id, name, email, group/section and status (enrolled|withdrawn|auditing) in any order, or a headerless ref,name,email,group,status file. Parsed rows are ADDED to any roster already on the object; a learner already present (matched on ref) is left alone rather than duplicated.',
    parameters: {
      type: 'object', required: ['objectId', 'source'], additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The `cohort` object to import into.' },
        source: { type: 'string', description: 'The full CSV text.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; source?: string };
      const target = nodes.find((node) => node.id === args.objectId && node.data.kind === 'cohort');
      if (!target) return { error: 'objectId must name a `cohort` object on this canvas' };
      const parsed = parseRosterCsv(String(args.source ?? ''));
      if (!parsed.length) {
        return { error: 'No roster rows were recognised in that text. Expected a header row naming ref/id, name, email, group and status in any order, or headerless ref,name,email,group,status rows.' };
      }
      const existing: RosterRow[] = Array.isArray(target.data.roster) ? target.data.roster as RosterRow[] : [];
      const seen = new Set(existing.map((row) => specRefKey(row?.ref)));
      const merged = [...existing, ...parsed.filter((row) => !seen.has(specRefKey(row.ref)))];
      proposalBuffer.current.push({
        id: crypto.randomUUID(), type: 'object.update', label: `Import ${parsed.length} learners into ${target.data.title}`,
        objectId: target.id, patch: { roster: merged, enrolledCount: merged.length },
      });
      return { ok: true, proposed: true, objectId: target.id, imported: parsed.length, total: merged.length };
    },
  }, {
    // Mirrors `canvas_import_resume` for the other document format the academic set
    // documents but never wired: a `.bib`/`.ris` export, which every reference
    // manager already produces and nobody should have to retype.
    name: 'canvas_import_references',
    description: 'Import references from BibTeX (.bib) or RIS (.ris) text into a `bibliography` object\'s `entries` field. Use this whenever someone pastes or uploads a Zotero, Mendeley, EndNote, Scopus or PubMed export and asks to load their references — never retype them by hand and never write a pre-formatted citation string. The format is detected automatically. Parsed entries are ADDED to any already on the object.',
    parameters: {
      type: 'object', required: ['objectId', 'source'], additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The `bibliography` object to import into.' },
        source: { type: 'string', description: 'The full .bib or .ris text.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; source?: string };
      const target = nodes.find((node) => node.id === args.objectId && node.data.kind === 'bibliography');
      if (!target) return { error: 'objectId must name a `bibliography` object on this canvas' };
      const records = parseReferences(String(args.source ?? ''));
      if (!records.length) return { error: 'No .bib or .ris entries were recognised in that text.' };
      const existing = Array.isArray(target.data.entries) ? target.data.entries : [];
      proposalBuffer.current.push({
        id: crypto.randomUUID(), type: 'object.update', label: `Import ${records.length} references into ${target.data.title}`,
        objectId: target.id, patch: { entries: [...existing, ...records.map(entryRowFromRecord)] },
      });
      return { ok: true, proposed: true, objectId: target.id, imported: records.length };
    },
  }, {
    // The measurement half of every other hiring object. One `funnel` kind, bound to a
    // domain by VALUE — see SHARED_OBJECT_KINDS for why this is not `hiringFunnel`.
    name: 'canvas_measure_funnel',
    description: 'Read real stage conversion, time-in-stage and source-of-hire from the tenant own pipeline data, and write it onto a `funnel` object. Use this whenever the user asks where candidates are being lost, how long hiring takes, which source actually converts, or to measure any funnel — never author these numbers by hand. Returns the bottleneck stage with the number behind it.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The funnel object to write into. Omit to create one.' },
        funnelDomain: { type: 'string', enum: ['hiring'], description: 'Which funnel to measure. Only `hiring` reports live counts today; the kind is domain-neutral so the others bind without a new object.' },
        pipelineRef: { type: 'string', description: 'Restrict to one pipeline. Omit to measure every pipeline in the tenant.' },
        days: { type: 'number', minimum: 1, maximum: 365, description: 'Lookback window. Defaults to 90.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'A funnel reads tenant pipeline data, which needs a signed-in, saved Creation Canvas session.' };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; funnelDomain?: string; pipelineRef?: string; days?: number };
      const report = await hiringApi.funnel({
        ...(args.pipelineRef ? { pipelineRef: args.pipelineRef } : {}),
        ...(args.days ? { days: Math.max(1, Math.min(365, Math.floor(args.days))) } : {}),
      });
      if (!report.stages.length) {
        return { error: 'No pipeline movement in that window, so there is no funnel to draw. Say that rather than writing a card of zeroes.' };
      }
      const fields = {
        status: t('hiringFunnelMeasured'),
        funnelDomain: 'hiring',
        stages: report.stages,
        sourceBreakdown: report.sourceBreakdown,
        totalEntered: report.totalEntered,
        totalConverted: report.totalConverted,
        overallConversion: report.overallConversion,
        medianCycleDays: report.medianCycleDays,
        dateRange: report.dateRange,
        ...(report.bottleneck ? { bottleneck: report.bottleneck } : {}),
        fetchedAt: report.fetchedAt,
      };
      const patch = sanitizeCreationObjectPatch('funnel', fields);
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const existing = [...nodes, ...staged].filter((node) => node.data.kind === 'funnel');
      const target = args.objectId ? existing.find((node) => node.id === args.objectId) : existing.length === 1 ? existing[0] : undefined;
      if (target) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: t('hiringFunnelUpdated', { title: target.data.title }), objectId: target.id, patch });
      } else {
        const node = newNode('funnel', { x: 320, y: 520 });
        node.data = { ...node.data, ...patch, title: t('hiringFunnelTitle') };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('hiringFunnelCreated'), node });
      }
      return {
        ok: true, proposed: true,
        bottleneck: report.bottleneck, overallConversion: report.overallConversion,
        medianCycleDays: report.medianCycleDays, dateRange: report.dateRange,
        instruction: 'Lead with the bottleneck stage and the number of people lost there, not with the totals. These counts were read from the tenant own pipeline just now — report them with the window they cover.',
      };
    },
  }, {
    // The candidate-facing half of a solver that already existed and had exactly one
    // internal consumer. This is what removes the largest time sink in the role.
    name: 'canvas_offer_interview_slots',
    description: 'Propose interview times that clear every interviewer calendar and mint a link the CANDIDATE can use to book one themselves, writing it onto an `interviewLoop` object. Use this whenever the user asks to schedule, arrange or set up an interview — never propose times by reading calendars yourself, and never write a bookingUrl by hand, because an authored URL does not resolve. The interview must already exist in the hiring domain and its stage must name its interviewers.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        interviewId: { type: 'number', description: 'The hiring-domain interview to schedule. Find candidates for it with canvas_read_domain on the hiring domain, entity "interviews".' },
        objectId: { type: 'string', description: 'The interviewLoop object to write the link onto. Omit when exactly one is on the board.' },
        durationMinutes: { type: 'number', minimum: 5, maximum: 480, description: 'Slot length. Defaults to 45.' },
        candidateTimezone: { type: 'string', description: 'IANA zone of the CANDIDATE, e.g. "Europe/Berlin". Ask for it rather than assuming your own — an offer of 9am in one zone is 3am in another.' },
        count: { type: 'number', minimum: 1, maximum: 20, description: 'How many slots to offer. Defaults to 8.' },
      },
      required: ['interviewId'],
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Offering interview times reads real calendars, which needs a signed-in, saved Creation Canvas session.' };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { interviewId?: number; objectId?: string; durationMinutes?: number; candidateTimezone?: string; count?: number };
      const interviewId = Math.floor(Number(args.interviewId));
      if (!Number.isInteger(interviewId) || interviewId <= 0) return { error: 'Name the interview to schedule by its id.' };

      const result = await hiringApi.offerSlots(interviewId, {
        ...(args.durationMinutes ? { durationMinutes: Math.max(5, Math.min(480, Math.floor(args.durationMinutes))) } : {}),
        ...(args.candidateTimezone ? { candidateTimezone: args.candidateTimezone } : {}),
        ...(args.count ? { count: Math.max(1, Math.min(20, Math.floor(args.count))) } : {}),
      });
      if ('error' in result) return { error: result.error };

      const bookingUrl = `${window.location.origin}/book/${result.token}`;
      const fields = {
        status: t('hiringLoopOffered', { count: result.slots.length }),
        bookingUrl,
        bookingExpiresAt: result.expiresAt,
        ...(args.candidateTimezone ? { candidateTimezone: args.candidateTimezone } : {}),
      };
      const patch = sanitizeCreationObjectPatch('interviewLoop', fields);
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const loops = [...nodes, ...staged].filter((node) => node.data.kind === 'interviewLoop');
      const target = args.objectId ? loops.find((node) => node.id === args.objectId) : loops.length === 1 ? loops[0] : undefined;
      if (target) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: t('hiringLoopUpdated', { title: target.data.title }), objectId: target.id, patch });
      } else {
        const node = newNode('interviewLoop', { x: 620, y: 320 });
        node.data = { ...node.data, ...patch, title: t('hiringLoopTitle') };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('hiringLoopCreated'), node });
      }
      return {
        ok: true, proposed: true,
        slotCount: result.slots.length, expiresAt: result.expiresAt, bookingUrl,
        instruction: 'Give the user the booking link to send, and say how many slots it offers and when it expires. The link is shown ONCE — it cannot be recovered from the board later, so if they lose it, offer slots again.',
      };
    },
  }, {
    // What makes the board speak first.
    name: 'canvas_evaluate_triggers',
    description: `Evaluate every \`trigger\` object on this canvas and mark each armed, breached or unbound. A trigger watches EITHER a \`liveMetric\`'s number (below/above/equals/changes-by) OR a deadline on any object that carries one — kinds: ${deadlineBearingKinds().join(', ')} — with due-within (warn me N days before, and stay breached once past) or overdue-by (chase it once N days late). Call this after refreshing a metric, and whenever the user asks what needs their attention or what is coming up. A trigger whose metric has no value, or whose watched object carries no deadline, is reported unbound rather than healthy — silence about an unevaluated threshold is the failure this prevents.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'Evaluate one trigger. Omit to evaluate all of them.' } },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const board = [...nodes, ...stagedNodes];
      if (!board.some((node) => node.data.kind === 'trigger' && (!args.objectId || node.id === args.objectId))) {
        return { error: args.objectId ? 'That object is not a trigger on this canvas.' : 'No trigger objects are on this canvas.' };
      }
      const now = Date.now();
      const evaluatedAt = new Date(now).toISOString();
      // ONE traversal, shared with the nightly sweep — see `contract/triggers.ts` for why
      // a second copy of this comparison would be worse than no sweep at all.
      const resolved = evaluateCanvasTriggers(board, now, { onlyTriggerId: args.objectId });
      const results = resolved.map((entry) => {
        const patch = sanitizeCreationObjectPatch('trigger', {
          state: entry.evaluation.state,
          lastEvaluatedAt: evaluatedAt,
          status: t(`founderTriggerState_${entry.evaluation.state}`),
        });
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: t('founderTriggerEvaluated', { title: entry.triggerTitle }), objectId: entry.triggerId, patch });
        return {
          id: entry.triggerId, title: entry.triggerTitle,
          watches: entry.watchedTitle, watchedKind: entry.watchedKind,
          deadlineField: entry.deadlineField,
          state: entry.evaluation.state, reason: entry.evaluation.reason, observed: entry.evaluation.observed,
          threshold: entry.threshold, comparator: entry.comparator,
          // For a deadline this is days remaining, negative once past — say so, so the
          // model reports "9 days overdue" rather than an unlabelled -9.
          observedMeans: isDateComparator(entry.comparator) ? 'days-remaining' : 'metric-value',
          hint: triggerUnboundHint(entry),
          thenDo: entry.thenDo,
        };
      });
      const breached = results.filter((result) => result.state === 'breached');
      const unbound = results.filter((result) => result.state === 'unbound');
      return {
        ok: true, proposed: true, evaluatedAt, results,
        breachedCount: breached.length, unboundCount: unbound.length,
        instruction: breached.length
          ? 'Lead your reply with the breached triggers and the action each one names in `thenDo`. For a deadline trigger, `observed` is DAYS REMAINING and is negative once the date has passed — say "renews in 12 days" or "9 days overdue", never the bare number. Do not bury a breach under the ones that are fine.'
          : unbound.length
            ? 'Say which triggers could NOT be evaluated and why — each carries a `hint` naming exactly what is missing. An unbound trigger is not a healthy one, and reporting "all clear" over it is the failure this tool exists to prevent.'
            : 'Confirm that every trigger was evaluated and none breached, naming what was checked.',
      };
    },
  }, {
    name: 'canvas_read_snapshot',
    // This tool PROMISED "every object" and delivered the scoped subset, which is
    // how the one escape hatch from a partial view became a second confirmation
    // of it: the model checked, was told the board held one object, and reported
    // a file missing that was sitting right there. Asking to read everything is
    // an explicit request to leave the scope, so it now does.
    description: 'Read every object and relationship on the creation canvas — the WHOLE board, regardless of what the user has selected. Use this whenever you are about to say something is not on the canvas.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => ({
      scope: resolvedScopeMode,
      scopeNote: scopeNote('canvas', nodes.length, nodes.length),
      objects: ((board) => nodes.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data, board), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true, inScope: scopedNodeIds.has(node.id) }; }))(specBoardOf(nodes)),
      connections: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
    }),
  }, {
    // The lookup the scope note points at. Named rather than positional because
    // the reported failure was a NAME miss (`.htm` vs `.html`), and a model that
    // has to guess an object id to check whether an object exists will not check.
    name: 'canvas_read_object',
    description: 'Read one object on this canvas in full by id, title, or file name — including objects outside the current selection. Use this before telling the user that a file or object is not on the canvas: matching tolerates a wrong extension and a partial name.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Exact object id from boardInventory.' },
        name: { type: 'string', description: 'Title or file name the user referred to, e.g. "Sales-Discovery-Guide.htm".' },
      },
    },
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; name?: string };
      const inventory = boardInventory(nodes, scopedNodeIds);
      const match = args.objectId
        ? inventory.find((entry) => entry.id === args.objectId) ?? null
        : findInInventory(inventory, args.name ?? '');
      if (!match) {
        // An honest miss carries the inventory, so the next sentence the model
        // writes is grounded in what IS there rather than in what it expected.
        return { found: false, boardInventory: inventory, message: 'No object on this board matches that id or name. The full inventory is included — do not ask the user to upload something listed in it.' };
      }
      const node = nodes.find((candidate) => candidate.id === match.id);
      if (!node) return { found: false, boardInventory: inventory };
      const definition = creationObjectDefinition(node.data.kind);
      return {
        found: true,
        object: { id: node.id, ...definition.contextAdapter(node.data, specBoardOf(nodes)), mutableFields: definition.mutableFields, actions: definition.actions },
        connections: edges
          .filter((edge) => edge.source === node.id || edge.target === node.id)
          .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
      };
    },
  }, {
    name: 'canvas_read_project_prds',
    description: 'Read the complete canonical PRDs and version history for every ticket in a project. Always use this before synthesizing, consolidating, or explaining project requirements; canvas selection does not limit this project-wide read.',
    parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'number', description: 'Canonical project id. Omit when exactly one project is present on the canvas.' } } },
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Canonical project PRDs require a saved session' };
      const requested = Number((raw as { projectId?: unknown })?.projectId);
      const available = canvasProjectNodes(nodes).map((node) => canvasProjectId(node.data)!);
      const projectId = Number.isInteger(requested) && requested > 0 ? requested : available.length === 1 ? available[0]! : NaN;
      if (!Number.isInteger(projectId) || projectId <= 0) return { error: available.length ? 'Specify which canvas project to read' : 'Add a canonical project to the canvas first' };
      return creationSessionsApi.projectPrdContext(sessionId, projectId);
    },
  }, {
    // The canvas snapshot caps every string field, so a twenty-page document
    // dropped on the board reaches Brain as its first two thousand characters.
    // This is the document counterpart of canvas_query_dataset: the full body,
    // by page, so "summarise this" reads the file rather than its opening.
    name: 'canvas_read_document',
    description: 'Read the full written body of any object on this canvas that carries one — a Document, PRD, Knowledge page, Report, Note, or an imported Word or PDF file — one page at a time. The canvas snapshot truncates long bodies, so ALWAYS use this before summarizing, reviewing, rewriting, quoting, or answering questions about a document; never answer from the truncated snapshot text.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Object id of the document. Omit when the canvas holds exactly one document-like object.' },
        page: { type: 'number', description: 'One-based page to read. Omit for the first page.' },
        pages: { type: 'number', description: 'How many consecutive pages to return, up to 6. Defaults to 3.' },
      },
    },
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; page?: number; pages?: number };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const candidates = [...nodes, ...stagedNodes].filter((node) => canvasDocument(node.data));
      const target = args.objectId ? candidates.find((node) => node.id === args.objectId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which document to read. Documents on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No document with a written body is on this canvas.' };
      }
      const document = canvasDocument(target.data)!;
      const span = Math.max(1, Math.min(Math.round(Number(args.pages) || 3), 6));
      const first = Math.max(1, Math.min(Math.round(Number(args.page) || 1), document.pages.length));
      const returned = document.pages.slice(first - 1, first - 1 + span);
      return {
        objectId: target.id,
        title: target.data.title,
        ...(typeof target.data.fileName === 'string' ? { fileName: target.data.fileName } : {}),
        ...(typeof target.data.sourceFormat === 'string' ? { sourceFormat: target.data.sourceFormat } : {}),
        totalPages: document.pages.length,
        wordCount: document.wordCount,
        outline: document.headings,
        firstPage: first,
        pages: returned.map((body, index) => ({ page: first + index, body })),
        hasMore: first - 1 + returned.length < document.pages.length,
        readFromSource: true,
      };
    },
  }, {
    name: 'canvas_create_project_prd',
    description: 'Propose a complete canonical PRD assigned to a project and represented on the canvas. Use this—not canvas_add_object—for a project PRD, consolidated PRD, or requirements synthesis.',
    parameters: {
      type: 'object', required: ['title', 'markdown'], additionalProperties: false,
      properties: {
        projectId: { type: 'number', description: 'Canonical project id. Omit when exactly one project is present on the canvas.' },
        title: { type: 'string' }, markdown: { type: 'string', description: 'Complete authored PRD in Markdown.' },
        status: { type: 'string', enum: ['draft', 'ready', 'in_progress', 'complete'] },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      if (persistence !== 'server') return { error: 'Create an account and save the session before creating a canonical project PRD' };
      const args = raw as { projectId?: unknown; title?: unknown; markdown?: unknown; status?: unknown };
      const requested = Number(args.projectId);
      const projectNodes = canvasProjectNodes(nodes);
      const project = Number.isInteger(requested) && requested > 0
        ? projectNodes.find((node) => node.data.resourceId === `project:${requested}`)
        : projectNodes.length === 1 ? projectNodes[0] : undefined;
      if (!project) return { error: projectNodes.length ? 'Specify which canvas project owns this PRD' : 'Add a canonical project to the canvas first' };
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) : '';
      const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      if (!title || !markdown) return { error: 'A project PRD requires a title and complete Markdown content' };
      const projectId = canvasProjectId(project.data)!;
      const node = newNode('prd', { x: project.position.x + 390, y: project.position.y });
      node.data = {
        ...node.data, title, markdown, content: markdown,
        status: ['draft', 'ready', 'in_progress', 'complete'].includes(String(args.status)) ? String(args.status) : 'draft',
        sourceProjectId: projectId, canonicalPrdPending: true,
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Create project PRD “${title}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Assign ${title} to ${project.data.title}`, edge: { id: crypto.randomUUID(), source: node.id, target: project.id, type: 'smoothstep', label: 'requirements for', data: { connectionKind: 'reference' } } });
      return { ok: true, proposed: true, projectId, object: { id: node.id, kind: 'prd', title }, persistence: 'canonical-after-review' };
    },
  }, {
    name: 'canvas_query_dataset',
    description: 'Compute real values from a Dataset, Table, or Spreadsheet object on this canvas, and optionally build the resulting Table, Chart, Dashboard, or KPI. This runs over every imported row, not the sample in the snapshot. Use it for any counting, totalling, ranking, comparison, success/failure split, or visualization of uploaded data. Never estimate, sample, or invent numbers when this tool can compute them.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        datasetId: { type: 'string', description: 'Object id of the dataset. Omit when the canvas holds exactly one tabular object.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Columns to return. Omit for every column.' },
        filter: {
          type: 'array', description: 'Row conditions applied before grouping.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: { description: 'Comparison value, or an array for in/notIn.' } } },
        },
        filterMatch: { type: 'string', enum: ['all', 'any'], description: 'Whether every filter must match, or any one of them. Defaults to all.' },
        derive: {
          type: 'array',
          description: 'Computed columns evaluated before filtering and grouping. Use this to classify rows, for example a Status column that is "Success" when a count column equals 1 and "Failure" otherwise.',
          items: { type: 'object', required: ['name', 'when', 'then'], additionalProperties: false, properties: {
            name: { type: 'string' },
            when: { type: 'array', items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } } },
            match: { type: 'string', enum: ['all', 'any'] },
            then: { type: 'string' }, otherwise: { type: 'string' },
          } },
        },
        timeGrain: {
          type: 'object', required: ['column', 'grain'], additionalProperties: false,
          description: 'Bucket a date column to a calendar grain BEFORE grouping. This is how "by month" / "by week" questions are answered — never bucket dates by hand.',
          properties: { column: { type: 'string' }, grain: { type: 'string', enum: [...TABULAR_TIME_GRAINS] }, as: { type: 'string', description: 'Output column name. Defaults to <column>_<grain>.' } },
        },
        groupBy: {
          description: 'Column(s) to group by — a string, or an array of up to 4 for a composite breakdown such as ["month","region"]. Returns one row per combination with real counts.',
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 4 }],
        },
        aggregate: { type: 'array', items: { type: 'object', required: ['op'], additionalProperties: false, properties: { op: { type: 'string', enum: [...TABULAR_AGGREGATE_OPERATORS] }, column: { type: 'string' }, label: { type: 'string' } } } },
        having: {
          type: 'array', description: 'Conditions applied to the GROUPED rows after aggregation, e.g. keep only groups whose count exceeds 10. Filter the rows with `filter`; filter the groups with this.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } },
        },
        window: {
          type: 'array',
          description: 'Row-relative calculations over the sorted result: running totals, rank within a segment, share of the whole, and period-over-period movement. Use these instead of computing a trend by hand.',
          items: { type: 'object', required: ['op'], additionalProperties: false, properties: {
            op: { type: 'string', enum: [...TABULAR_WINDOW_OPERATORS] },
            column: { type: 'string', description: 'Numeric column the calculation reads. Defaults to the first aggregate.' },
            partitionBy: { description: 'Restart per distinct value of these columns.', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            as: { type: 'string' },
            periods: { type: 'number', description: 'Look-back length for movingAverage, lag, delta and percentChange. Defaults to 3 for movingAverage and 1 otherwise.' },
          } },
        },
        sort: { type: 'object', additionalProperties: false, properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'number' },
        materializeAs: { type: 'string', enum: ['none', 'table', 'chart', 'dashboard', 'kpi', 'map'], description: 'Build a canvas object populated with the real query result. Use "table" for a row-level breakdown, "chart" or "dashboard" for a grouped visualization, and "map" to plot rows geographically — "map" requires latitude and longitude columns, which geo.geocode can add to a dataset of place names.' },
        title: { type: 'string', description: 'Title for the materialized object.' },
        mapValueColumn: { type: 'string', description: 'For materializeAs "map": the numeric column that sizes each marker.' },
        mapRegionName: { type: 'string', description: 'For materializeAs "map": the enclosing region shown on the card, e.g. "Michigan".' },
        mapRegion: { type: 'array', items: { type: 'number' }, description: 'For materializeAs "map": [south, north, west, east] to fit the viewport to, exactly as geo.geocode returns in boundingBox. Omit to fit the plotted points.' },
        mapOutline: { description: 'For materializeAs "map": a boundary to draw behind the points — pass geo.geocode\'s outline value for the enclosing region straight through.' },
        mapAttribution: { type: 'string', description: 'For materializeAs "map": the geocoder attribution string to print under the map.' },
        highlight: {
          type: 'array', description: 'Row colouring for a materialized table. The first matching rule wins.',
          items: { type: 'object', required: ['column', 'tone'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {}, tone: { type: 'string', enum: ['success', 'warning', 'danger', 'info'] } } },
        },
      },
    },
    mutates: (raw: unknown) => (raw as { materializeAs?: unknown })?.materializeAs != null && (raw as { materializeAs?: unknown }).materializeAs !== 'none',
    run: (raw: unknown) => {
      const args = raw as TabularQuery & {
        datasetId?: string; materializeAs?: string; title?: string; highlight?: TabularHighlightRule[];
        mapValueColumn?: string; mapRegionName?: string; mapRegion?: unknown; mapOutline?: unknown; mapAttribution?: string;
      };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const candidates = [...nodes, ...stagedNodes].filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to query. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas. Ask the user to attach a CSV, TSV, or JSON file, or import one from the Dataset inspector.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      if (!source.rows.length) return { error: `${target.data.title} has no imported rows yet` };
      const result = queryTabular(source, args);
      if (result.unknownColumns.length) {
        return { error: `Unknown column(s): ${result.unknownColumns.join(', ')}. Available columns: ${source.columns.join(', ')}` };
      }
      const materializeAs = ['table', 'chart', 'dashboard', 'kpi', 'map'].includes(String(args.materializeAs)) ? String(args.materializeAs) as 'table' | 'chart' | 'dashboard' | 'kpi' | 'map' : null;
      // Resolve geography BEFORE anything is proposed, so a plot with no coordinates
      // fails with the columns it actually looked at rather than staging an empty map.
      const geoColumns = materializeAs === 'map' ? detectGeoColumns({ columns: result.columns, rows: result.rows }, args.mapValueColumn) : null;
      const mapPoints = geoColumns ? mapPointsFromRows({ columns: result.columns, rows: result.rows }, geoColumns, MAX_MATERIALIZED_ROWS) : [];
      if (materializeAs === 'map' && !mapPoints.length) {
        return {
          error: geoColumns?.latitude && geoColumns.longitude
            ? `No row in this result has a usable coordinate pair in ${geoColumns.latitude}/${geoColumns.longitude}.`
            : `This result has no latitude/longitude columns, so it cannot be plotted. Available columns: ${result.columns.join(', ')}. Resolve the place names with geo.geocode, write the returned lat/lng back onto the dataset rows with canvas_update_object, then plot it.`,
        };
      }
      const payload = {
        datasetId: target.id, datasetTitle: target.data.title,
        columns: result.columns, rows: result.rows.slice(0, 20),
        totalRows: result.totalRows, matchedRows: result.matchedRows, returnedRows: result.returnedRows, truncated: result.truncated,
        ...(result.groups ? { groups: result.groups } : {}),
        ...(result.aggregates ? { aggregates: result.aggregates } : {}),
        computedFromEveryRow: true,
      };
      if (!materializeAs) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      const kind: CreationObjectKind = materializeAs;
      const existing = [...nodes, ...stagedNodes].find((node) => node.data.kind === kind && node.data.sourceDatasetId === target.id);
      const title = typeof args.title === 'string' && args.title.trim()
        ? args.title.trim().slice(0, 160)
        : `${target.data.title} ${materializeAs === 'kpi' ? 'metric' : materializeAs}`;
      const highlightRules = Array.isArray(args.highlight)
        ? args.highlight.filter((rule) => rule?.column && rule.tone).slice(0, 20)
        : [];
      // `groupBy` is one column OR several (a composite "by month by region" breakdown).
      // Normalized once here because three places below read it, and each of them was
      // written against the single-column shape: `column !== args.groupBy` is never true
      // for an array, so the value column resolved to the FIRST grouping key and every
      // composite breakdown charted its own labels as its values.
      const groupByColumns = (Array.isArray(args.groupBy) ? args.groupBy : args.groupBy ? [args.groupBy] : []).filter((column): column is string => typeof column === 'string');
      const groupByLabel = groupByColumns.join(' · ');
      const valueKey = result.columns.find((column) => !groupByColumns.includes(column)) ?? 'count';
      // The TRANSFORM travels with the artifact. Recording only WHICH dataset a
      // chart came from — and not HOW — is why a chart could never be recomputed
      // when its source moved, why nothing knew it had gone stale, and why "what
      // breaks if I drop this column" had no answer. See lib/canvasLineage.
      const provenance = lineagePatch([target.id], {
        engine: 'tabular',
        query: args as TabularQuery,
        rowsIn: result.totalRows,
        rowsOut: result.returnedRows,
      }, { columns: result.columns });
      const fields: Record<string, unknown> = materializeAs === 'table'
        ? {
          title, columns: result.columns, rows: result.rows.slice(0, MAX_MATERIALIZED_ROWS), rowCount: result.matchedRows,
          sampleRows: result.rows.slice(0, 8), ...(highlightRules.length ? { highlightRules } : {}),
          status: `${result.matchedRows.toLocaleString()} of ${result.totalRows.toLocaleString()} rows`,
          summary: `${result.matchedRows.toLocaleString()} matching rows of ${result.totalRows.toLocaleString()} in ${target.data.title}.`,
          sourceDatasetId: target.id,
        }
        : materializeAs === 'kpi'
          ? {
            title, value: String(Object.values(result.aggregates ?? { count: result.matchedRows })[0] ?? result.matchedRows),
            status: 'Live', summary: `Computed from ${result.totalRows.toLocaleString()} rows in ${target.data.title}.`, sourceDatasetId: target.id,
          }
          : materializeAs === 'map'
            // Same builder the Dataset inspector's "Plot on a map" uses — see
            // `mapObjectFields`. Only the copy differs (model-facing here, localized
            // there); the field assembly, region/outline sanitization and the
            // MultiPolygon flattening are shared so the two paths cannot drift.
            ? mapObjectFields({
              title,
              status: `${mapPoints.length.toLocaleString()} plotted`,
              summary: `${mapPoints.length.toLocaleString()} of ${result.matchedRows.toLocaleString()} matching rows in ${target.data.title} have coordinates and are plotted.`,
              points: mapPoints,
              columns: geoColumns ?? { latitude: null, longitude: null, label: null, value: null },
              sourceDatasetId: target.id,
              region: args.mapRegion,
              regionName: args.mapRegionName,
              outline: args.mapOutline,
              attribution: args.mapAttribution,
            })
            : {
            title, status: 'Live',
            chartTitle: title,
            ...(groupByLabel ? { xAxisLabel: groupByLabel } : {}),
            yAxisLabel: valueKey,
            // A composite breakdown has no single label column, so the label is every
            // grouping key joined — which is also what `result.groups[].key` already
            // holds when the query grouped, hence the preference order.
            chartLabels: (result.groups ?? result.rows).map((row, index) => {
              const record = row as Record<string, unknown>;
              if (record.key != null) return String(record.key);
              const composite = groupByColumns.map((column) => record[column]).filter((value) => value != null).join(' · ');
              return composite || `Row ${index + 1}`;
            }),
            chartValues: (result.groups ?? result.rows).map((row) => Number((row as Record<string, unknown>)[valueKey] ?? (row as { count?: number }).count ?? 0)),
            // A null aggregate means "not computable over these rows" — a median
            // of an empty column. Dropping the chip is right; printing "null"
            // beside three real numbers reads as a value that was measured.
            kpis: Object.entries(result.aggregates ?? {})
              .flatMap(([label, value]) => value == null ? [] : [{ label, value: value.toLocaleString() }])
              .slice(0, 4),
            summary: `Computed from ${result.totalRows.toLocaleString()} rows in ${target.data.title}.`,
            sourceDatasetId: target.id,
          };
      // Spread AFTER the branch so every materialized kind carries it — the map
      // builder is shared with the inspector and must not have to know about it.
      const patch = sanitizeCreationObjectPatch(kind, { ...fields, ...provenance });
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update ${kind} “${title}”`, objectId: existing.id, patch });
        return { ...payload, proposed: true, materialized: { id: existing.id, kind, title, updated: true } };
      }
      const node = newNode(kind, nextCanvasObjectPosition([...nodes, ...stagedNodes], { x: target.position.x + 460, y: target.position.y }, typeof window !== 'undefined' && window.innerWidth <= 760, kind));
      node.data = { ...node.data, ...patch };
      if (kind === 'table') node.style = { width: 720, height: 460 };
      if (kind === 'map') node.style = { width: 420, height: 380 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add ${kind} “${title}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Connect ${target.data.title} to ${title}`, edge: { id: crypto.randomUUID(), source: target.id, target: node.id, type: 'smoothstep', animated: true, label: 'computed from', data: { connectionKind: 'data' } } });
      return { ...payload, proposed: true, materialized: { id: node.id, kind, title, created: true } };
    },
  }, {
    /**
     * "Create me an ERD" — the headline of IDEA → REAL for data.
     *
     * A dedicated tool rather than `canvas_add_object` with hand-authored fields,
     * for the same reason `canvas_add_inbox` is: what comes back must be REAL. The
     * model authors entities and relationships; this validates them, resolves every
     * many-to-many into a junction table, and generates executable DDL — so the
     * answer to "create me an ERD" is a diagram AND the statements that build it,
     * not a picture someone still has to translate by hand.
     */
    name: 'canvas_create_data_model',
    description: 'Author a REAL entity-relationship model on the canvas: entities, attributes, keys, and relationships. Use this for any request to design, draw, model or diagram a database, schema, data model or ERD — never canvas_add_object with kind "diagram", which produces a picture that cannot be validated or executed. The result is validated (missing keys, dangling foreign keys, repeating groups, unresolved many-to-many) and lowered to executable DDL in the chosen dialect. Set sourceDatasetId instead of authoring entities to infer the model from a dataset already on the board.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Name of the model, e.g. "Order management schema".' },
        dialect: { type: 'string', enum: [...SQL_DIALECTS], description: 'SQL dialect the DDL is generated for. Defaults to postgres.' },
        objectId: { type: 'string', description: 'Amend the ERD object with this id instead of creating one. Read it with canvas_read_object first and send the WHOLE model — entities omitted here are removed.' },
        sourceDatasetId: { type: 'string', description: 'Infer a single entity from this dataset/table object instead of authoring entities. Column types, nullability, keys and PII tags come from the real rows.' },
        notes: { type: 'string', description: 'Design notes: assumptions, out-of-scope areas, open questions.' },
        entities: {
          type: 'array',
          description: 'The tables. Give every entity a primary key — an entity without one is reported as an error.',
          items: {
            type: 'object', required: ['name', 'attributes'], additionalProperties: false,
            properties: {
              name: { type: 'string', description: 'snake_case table name, e.g. "order_line".' },
              description: { type: 'string' },
              primaryKey: { type: 'array', items: { type: 'string' }, description: 'Composite key. For a single-column key set primaryKey:true on the attribute instead.' },
              attributes: {
                type: 'array',
                items: {
                  type: 'object', required: ['name', 'type'], additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: [...DATA_MODEL_TYPES] },
                    nullable: { type: 'boolean', description: 'Omit for NOT NULL. Modelling defaults to required.' },
                    primaryKey: { type: 'boolean' },
                    unique: { type: 'boolean' },
                    description: { type: 'string' },
                    unit: { type: 'string', description: 'Physical unit — "USD", "ms", "kg".' },
                    enumValues: { type: 'array', items: { type: 'string' } },
                    defaultValue: { type: 'string' },
                    classification: { type: 'string', enum: [...DATA_CLASSIFICATIONS] },
                    pii: { type: 'string', enum: [...PII_CATEGORIES], description: 'Tag personal data here — it is carried into the DDL as a column comment and shown on the diagram.' },
                    references: {
                      type: 'object', required: ['entity', 'attribute'], additionalProperties: false,
                      description: 'Foreign key target. Declaring it here creates the relationship; you need not also list it in relationships.',
                      properties: { entity: { type: 'string' }, attribute: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        relationships: {
          type: 'array',
          description: 'Relationships not already expressed as attribute foreign keys. A many-to-many is resolved into a junction table automatically before DDL is generated.',
          items: {
            type: 'object', required: ['from', 'to', 'cardinality'], additionalProperties: false,
            properties: {
              name: { type: 'string' },
              from: { type: 'object', required: ['entity'], additionalProperties: false, properties: { entity: { type: 'string' }, attributes: { type: 'array', items: { type: 'string' } } } },
              to: { type: 'object', required: ['entity'], additionalProperties: false, properties: { entity: { type: 'string' }, attributes: { type: 'array', items: { type: 'string' } } } },
              cardinality: { type: 'string', enum: [...DATA_MODEL_CARDINALITIES] },
              optional: { type: 'boolean' },
              description: { type: 'string' },
            },
          },
        },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as {
        title?: string; dialect?: string; objectId?: string; sourceDatasetId?: string; notes?: string;
        entities?: unknown; relationships?: unknown; x?: number; y?: number;
      };
      const dialect = (SQL_DIALECTS as readonly string[]).includes(String(args.dialect)) ? args.dialect as SqlDialect : 'postgres';
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];

      // Two ways in. Inferring from real rows is not a lesser path: types,
      // nullability and the natural key come from what is ACTUALLY there, which
      // is more truthful than the same model authored from the column names.
      let model: DataModel;
      let inferredFrom: { id: string; title: string } | null = null;
      if (args.sourceDatasetId) {
        const dataset = all.find((node) => node.id === args.sourceDatasetId);
        if (!dataset) return { error: `No object with id "${args.sourceDatasetId}" is on this canvas.` };
        const source = tabularFromObject(dataset.data as Record<string, unknown>);
        if (!source.columns.length) return { error: `${dataset.data.title} has no columns to model.` };
        const classifications = normalizeClassifications(dataset.data.classifications).length
          ? normalizeClassifications(dataset.data.classifications)
          : classifyTabular(source, profileTabular(source));
        model = dataModelFromTabular(String(args.title || dataset.data.title), profileTabular(source), source.rows.length, classifications);
        inferredFrom = { id: dataset.id, title: String(dataset.data.title) };
      } else {
        model = normalizeDataModel({ entities: args.entities, relationships: args.relationships, dialect, origin: 'authored', notes: args.notes });
      }
      if (!model.entities.length) {
        return { error: 'A data model needs at least one entity with at least one attribute. Author `entities`, or set `sourceDatasetId` to infer one from a dataset on the board.' };
      }
      model = { ...model, dialect };

      const issues = validateDataModel(model);
      const summary = dataModelSummary(model, issues);
      const ddl = dataModelDdl(model, dialect);
      const title = String(args.title || 'Data model').trim().slice(0, 160) || 'Data model';
      const fields = {
        title, dataModel: model, dialect, ddl, mermaid: dataModelMermaid(model), issues,
        ...(args.notes ? { notes: String(args.notes).slice(0, 2_000) } : {}),
        ...(inferredFrom ? { sourceObjectId: inferredFrom.id, ...lineagePatch([inferredFrom.id], { engine: 'import' }) } : {}),
        status: summary.errors ? `${summary.errors} to resolve` : `${summary.entities} entities · ${summary.relationships} relationships`,
        summary: `${summary.entities} entities, ${summary.attributes} attributes, ${summary.relationships} relationships. ${summary.keyed} of ${summary.entities} keyed.`,
      };
      const patch = sanitizeCreationObjectPatch('erd', fields);

      const existing = args.objectId ? all.find((node) => node.id === args.objectId && node.data.kind === 'erd') : undefined;
      if (args.objectId && !existing) return { error: `No ERD object with id "${args.objectId}" is on this canvas.` };

      const payload = {
        ok: true, proposed: true, dialect,
        model: { entities: model.entities.map((entity) => ({ name: entity.name, attributes: entity.attributes.length, key: entityKey(entity) })), relationships: summary.relationships },
        issues, ddl,
        ...(inferredFrom ? { inferredFrom } : {}),
      };
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update data model “${title}”`, objectId: existing.id, patch });
        return { ...payload, object: { id: existing.id, kind: 'erd', title, updated: true } };
      }
      const anchor = inferredFrom ? all.find((node) => node.id === inferredFrom.id) : undefined;
      const node = newNode('erd', nextCanvasObjectPosition(all, anchor ? { x: anchor.position.x + 460, y: anchor.position.y } : args, typeof window !== 'undefined' && window.innerWidth <= 760, 'erd'));
      node.data = { ...node.data, ...patch };
      node.style = { width: 760, height: 560 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Create data model “${title}”`, node });
      if (anchor) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Model ${anchor.data.title}`, edge: { id: crypto.randomUUID(), source: anchor.id, target: node.id, type: 'smoothstep', animated: true, label: 'modelled as', data: { connectionKind: 'data' } } });
      }
      return { ...payload, object: { id: node.id, kind: 'erd', title, created: true } };
    },
  }, {
    /** The model IS the source; DDL and Mermaid are renderings of it. Putting the
     *  DDL on the board as a `code` object is what makes it copyable and runnable
     *  rather than something buried in a tool result. */
    name: 'canvas_export_data_model',
    description: 'Generate executable DDL or a Mermaid erDiagram from a data model already on the canvas, and optionally put the DDL on the board as a Code object. Use this when asked for the SQL, the CREATE TABLE statements, the migration, or a portable diagram of a model that already exists.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The ERD object. Omit when the canvas holds exactly one.' },
        format: { type: 'string', enum: ['ddl', 'mermaid'], description: 'Defaults to ddl.' },
        dialect: { type: 'string', enum: [...SQL_DIALECTS], description: 'Overrides the model\'s own dialect for this export.' },
        materialize: { type: 'boolean', description: 'Put the result on the board as a Code object connected to the model.' },
      },
    },
    mutates: (raw: unknown) => (raw as { materialize?: unknown })?.materialize === true,
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; format?: string; dialect?: string; materialize?: boolean };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const models = all.filter((node) => node.data.kind === 'erd');
      const target = args.objectId ? models.find((node) => node.id === args.objectId) : models.length === 1 ? models[0] : undefined;
      if (!target) {
        return { error: models.length ? `Say which model: ${models.map((node) => `${node.id} (${node.data.title})`).join(', ')}` : 'There is no data model on this canvas yet. Create one with canvas_create_data_model.' };
      }
      const model = readDataModel(target.data as Record<string, unknown>);
      if (!model.entities.length) return { error: `${target.data.title} has no entities yet.` };
      const dialect = (SQL_DIALECTS as readonly string[]).includes(String(args.dialect)) ? args.dialect as SqlDialect : (model.dialect ?? 'postgres');
      const format = args.format === 'mermaid' ? 'mermaid' : 'ddl';
      const output = format === 'mermaid' ? dataModelMermaid(model) : dataModelDdl(model, dialect);
      const issues = validateDataModel(model);
      const payload = { ok: true, format, dialect, output, issues: issues.filter((issue) => issue.severity === 'error') };
      if (!args.materialize) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      const title = `${target.data.title} ${format === 'mermaid' ? 'diagram source' : `DDL (${dialect})`}`;
      const node = newNode('code', nextCanvasObjectPosition(all, { x: target.position.x + 800, y: target.position.y }, typeof window !== 'undefined' && window.innerWidth <= 760, 'code'));
      node.data = { ...node.data, ...sanitizeCreationObjectPatch('code', {
        title, code: output, language: format === 'mermaid' ? 'mermaid' : 'sql',
        status: format === 'mermaid' ? 'Diagram source' : `${model.entities.length} tables`,
        ...lineagePatch([target.id], { engine: 'tabular' }),
      }) };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Export ${title}`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Generated from ${target.data.title}`, edge: { id: crypto.randomUUID(), source: target.id, target: node.id, type: 'smoothstep', animated: true, label: 'generates', data: { connectionKind: 'data' } } });
      return { ...payload, proposed: true, object: { id: node.id, kind: 'code', title } };
    },
  }, {
    /**
     * The `data` edge, finally given meaning.
     *
     * Two datasets sharing a key could sit side by side with a line drawn between
     * them and still not be relatable, because the query engine took exactly one
     * source. A join is what makes a board of datasets a data model rather than a
     * pile of spreadsheets — and the fan-out and unmatched counts are returned
     * because a join that silently multiplied its rows is how a confidently wrong
     * total gets charted.
     */
    name: 'canvas_join_datasets',
    description: 'Relate TWO tabular objects on the canvas on a shared key, producing a Table with the combined columns. Use this whenever a question spans two datasets ("which customers from the CRM export have open tickets"). Omit `on` to have the join keys detected from matching column names and overlapping values. Reports unmatched rows and row fan-out, which are what decide whether the join is trustworthy.',
    parameters: {
      type: 'object', required: ['leftId', 'rightId'], additionalProperties: false,
      properties: {
        leftId: { type: 'string', description: 'Object id of the left (driving) dataset.' },
        rightId: { type: 'string', description: 'Object id of the right (looked-up) dataset.' },
        type: { type: 'string', enum: [...TABULAR_JOIN_TYPES], description: 'inner keeps only matched rows; left keeps every left row. Defaults to inner.' },
        on: {
          type: 'array', description: 'Join keys. Omit to detect them.',
          items: { type: 'object', required: ['left', 'right'], additionalProperties: false, properties: { left: { type: 'string' }, right: { type: 'string' } } },
        },
        select: { type: 'array', items: { type: 'string' }, description: 'Columns to keep. Omit for every column of both sides.' },
        rightAlias: { type: 'string', description: 'Prefix for right-hand columns whose names collide. Defaults to "right".' },
        title: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { leftId?: string; rightId?: string; type?: string; on?: TabularJoinKey[]; select?: string[]; rightAlias?: string; title?: string; limit?: number };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const left = all.find((node) => node.id === args.leftId);
      const right = all.find((node) => node.id === args.rightId);
      if (!left || !right) return { error: 'Both leftId and rightId must be objects on this canvas.' };
      if (left.id === right.id) return { error: 'A dataset cannot be joined to itself here.' };
      const leftSource = tabularFromObject(left.data as Record<string, unknown>);
      const rightSource = tabularFromObject(right.data as Record<string, unknown>);
      if (!leftSource.rows.length || !rightSource.rows.length) return { error: 'Both objects need imported rows before they can be joined.' };

      const keys = args.on?.length ? args.on : suggestJoinKeys(leftSource, rightSource);
      if (!keys.length) {
        return { error: `No shared key was found between ${left.data.title} (${leftSource.columns.join(', ')}) and ${right.data.title} (${rightSource.columns.join(', ')}). Name the columns explicitly with \`on\`.` };
      }
      const spec = { on: keys, ...(args.type ? { type: args.type as typeof TABULAR_JOIN_TYPES[number] } : {}), ...(args.rightAlias ? { rightAlias: args.rightAlias } : {}), ...(args.select ? { select: args.select } : {}), ...(args.limit ? { limit: args.limit } : {}) };
      const result = joinTabular(leftSource, rightSource, spec);
      if (result.unknownColumns.length) {
        return { error: `Unknown join column(s): ${result.unknownColumns.join(', ')}. Left has ${leftSource.columns.join(', ')}; right has ${rightSource.columns.join(', ')}.` };
      }
      if (!result.rows.length) {
        return { error: `No rows matched on ${keys.map((key) => `${key.left} = ${key.right}`).join(' and ')}. ${leftSource.rows.length} left rows and ${rightSource.rows.length} right rows were compared. Check the key, or use type "left" to keep unmatched rows.` };
      }

      const title = (args.title || `${left.data.title} × ${right.data.title}`).trim().slice(0, 160);
      const node = newNode('table', nextCanvasObjectPosition(all, { x: Math.max(left.position.x, right.position.x) + 460, y: left.position.y }, typeof window !== 'undefined' && window.innerWidth <= 760, 'table'));
      node.data = { ...node.data, ...sanitizeCreationObjectPatch('table', {
        title, columns: result.columns, rows: result.rows.slice(0, MAX_MATERIALIZED_ROWS), rowCount: result.rowCount,
        sampleRows: result.rows.slice(0, 8),
        status: `${result.rowCount.toLocaleString()} joined rows`,
        summary: `${result.type} join on ${keys.map((key) => `${key.left} = ${key.right}`).join(', ')}. ${result.matchedLeft.toLocaleString()} of ${leftSource.rows.length.toLocaleString()} left rows matched; ${result.unmatchedLeft.toLocaleString()} did not.`,
        ...lineagePatch([left.id, right.id], { engine: 'join', join: spec, rowsIn: leftSource.rows.length + rightSource.rows.length, rowsOut: result.rowCount }, { columns: result.columns }),
      }) };
      node.style = { width: 720, height: 460 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Join “${title}”`, node });
      for (const parent of [left, right]) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Join input ${parent.data.title}`, edge: { id: crypto.randomUUID(), source: parent.id, target: node.id, type: 'smoothstep', animated: true, label: 'joined', data: { connectionKind: 'data' } } });
      }
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'table', title },
        joinedOn: keys, type: result.type, keysDetected: !args.on?.length,
        rows: result.rowCount, columns: result.columns,
        matchedLeft: result.matchedLeft, unmatchedLeft: result.unmatchedLeft, unmatchedRight: result.unmatchedRight,
        // Surfaced deliberately: a one-to-many join inflates row counts, and any
        // SUM taken over the result afterwards will be wrong by that factor.
        fanOut: result.fanOut, renamedColumns: result.collisions, truncated: result.truncated,
        sample: result.rows.slice(0, 10),
      };
    },
  }, {
    name: 'canvas_classify_dataset',
    description: 'Scan a dataset on the canvas for personal and sensitive data, tagging each column with a PII category and a sensitivity classification. Use this before sharing a board, before building anything from an uploaded customer file, or whenever asked what personal data a dataset holds. Detection reads names AND values; columns tagged as credentials, financial, government id or health are masked wherever they render and export.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The dataset/table object. Omit when the canvas holds exactly one with rows.' },
        overrides: {
          type: 'array', description: 'Confirm or correct the detection for specific columns. Use this to record a human decision rather than re-running detection.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: {
            column: { type: 'string' },
            pii: { type: 'string', enum: [...PII_CATEGORIES] },
            classification: { type: 'string', enum: [...DATA_CLASSIFICATIONS] },
            masked: { type: 'boolean' },
          } },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; overrides?: Array<{ column: string; pii?: string; classification?: string; masked?: boolean }> };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const detected = classifyTabular(source, profileTabular(source));
      const overrides = normalizeClassifications(args.overrides ?? []);
      const byColumn = new Map(detected.map((item) => [item.column, item]));
      for (const override of overrides) {
        const base = byColumn.get(override.column);
        if (base) byColumn.set(override.column, { ...base, ...override, confidence: 'high', reason: 'value-match' });
      }
      const classifications = [...byColumn.values()];
      const summary = classificationSummary(classifications);
      const patch = sanitizeCreationObjectPatch(dataset.data.kind, {
        classifications,
        status: summary.piiColumns ? `${summary.piiColumns} personal columns` : 'No personal data found',
        summary: summary.piiColumns
          ? `${summary.piiColumns} of ${summary.total} columns hold personal data (${summary.categories.join(', ')}); ${summary.maskedColumns} are masked on render and export.`
          : `No personal data detected across ${summary.total} columns.`,
      });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Classify ${dataset.data.title}`, objectId: dataset.id, patch });
      return {
        ok: true, proposed: true, objectId: dataset.id,
        classifications: classifications.filter((item) => item.pii !== 'none'),
        summary,
        // Stated so the model does not then quote a masked value as if it were real.
        maskedColumns: classifications.filter((item) => item.masked).map((item) => item.column),
      };
    },
  }, {
    name: 'canvas_set_data_contract',
    description: 'Declare what a dataset is ALLOWED to be — required columns, types, uniqueness, units, allowed values, ranges, a primary key, row-count bounds and a freshness SLA — and evaluate the current rows against it. Use this to lock a dataset\'s shape so a later re-import that drifts is caught instead of quietly changing every chart built on it. Omit `contract` to infer one from what the data currently is.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The dataset/table object. Omit when the canvas holds exactly one with rows.' },
        materialize: { type: 'boolean', description: 'Also put the contract on the board as its own object. Defaults to true.' },
        contract: {
          type: 'object', required: ['columns'], additionalProperties: false,
          properties: {
            columns: {
              type: 'array',
              items: { type: 'object', required: ['name', 'type'], additionalProperties: false, properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['number', 'boolean', 'date', 'text', 'empty'] },
                required: { type: 'boolean' }, unique: { type: 'boolean' },
                description: { type: 'string' },
                unit: { type: 'string', description: 'Physical unit. Two charts cannot be compared without it.' },
                allowedValues: { type: 'array', items: { type: 'string' } },
                min: { type: 'number' }, max: { type: 'number' },
                classification: { type: 'string', enum: [...DATA_CLASSIFICATIONS] },
                pii: { type: 'string', enum: [...PII_CATEGORIES] },
              } },
            },
            primaryKey: { type: 'array', items: { type: 'string' } },
            rowCountMin: { type: 'number' }, rowCountMax: { type: 'number' },
            freshnessHours: { type: 'number', description: 'Maximum age before the data is stale.' },
          },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; contract?: unknown; materialize?: boolean };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const classifications = normalizeClassifications(dataset.data.classifications);
      const contract = normalizeDataContract(args.contract)
        ?? inferDataContract(source, profileTabular(source), classifications.length ? classifications : classifyTabular(source, profileTabular(source)));
      const fetchedAt = typeof dataset.data.fetchedAt === 'string' ? dataset.data.fetchedAt : null;
      const violations = evaluateDataContract(source, contract, { fetchedAt });
      const verdict = contractVerdict(violations);
      const declaredAt = new Date().toISOString();
      const stored = { ...contract, declaredAt };

      proposalBuffer.current.push({
        id: crypto.randomUUID(), type: 'object.update', label: `Declare contract for ${dataset.data.title}`, objectId: dataset.id,
        patch: sanitizeCreationObjectPatch(dataset.data.kind, { dataContract: stored, violations }),
      });

      const payload = {
        ok: true, proposed: true, objectId: dataset.id,
        inferred: !args.contract, verdict, violations,
        contract: { columns: contract.columns.length, primaryKey: contract.primaryKey ?? [], freshnessHours: contract.freshnessHours ?? null },
      };
      if (args.materialize === false) return payload;

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const title = `${dataset.data.title} contract`;
      const existing = all.find((node) => node.data.kind === 'dataContract' && node.data.sourceDatasetId === dataset.id);
      const fields = sanitizeCreationObjectPatch('dataContract', {
        title, dataContract: stored, violations, verdict, sourceDatasetId: dataset.id,
        status: verdict === 'pass' ? 'Honoured' : verdict === 'fail' ? `${violations.filter((violation) => violation.severity === 'error').length} breaches` : `${violations.length} warnings`,
        summary: `${contract.columns.length} declared columns over ${source.rows.length.toLocaleString()} rows.`,
        ...(fetchedAt ? { fetchedAt } : {}),
      });
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update contract “${title}”`, objectId: existing.id, patch: fields });
        return { ...payload, object: { id: existing.id, kind: 'dataContract', title, updated: true } };
      }
      const node = newNode('dataContract', nextCanvasObjectPosition(all, { x: dataset.position.x + 460, y: dataset.position.y + 300 }, typeof window !== 'undefined' && window.innerWidth <= 760, 'dataContract'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add contract “${title}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Governs ${dataset.data.title}`, edge: { id: crypto.randomUUID(), source: node.id, target: dataset.id, type: 'smoothstep', label: 'governs', data: { connectionKind: 'reference' } } });
      return { ...payload, object: { id: node.id, kind: 'dataContract', title, created: true } };
    },
  }, {
    /** A contract IS a set of checks — `checksFromContract` derives them rather than
     *  asking anyone to restate "customer_id must be unique" in a second place. */
    name: 'canvas_run_data_quality',
    description: 'Build and run data quality checks against a dataset on the canvas — not-null, uniqueness, row-count bounds, numeric ranges, allowed values, regex, freshness, and referential integrity across two objects. Use this to assert that data is fit to use before building on it, or to explain WHY a dataset looks wrong. If the dataset already has a declared contract, its rules are included automatically.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The dataset/table object. Omit when the canvas holds exactly one with rows.' },
        materialize: { type: 'boolean', description: 'Put the suite and its results on the board. Defaults to true.' },
        checks: {
          type: 'array',
          description: 'Checks to run IN ADDITION to any derived from the dataset\'s contract. Omit entirely to run the contract\'s checks plus a conservative suggested suite.',
          items: { type: 'object', required: ['kind'], additionalProperties: false, properties: {
            kind: { type: 'string', enum: [...DATA_QUALITY_CHECK_KINDS] },
            column: { type: 'string' },
            min: { type: 'number' }, max: { type: 'number' },
            values: { type: 'array', items: { type: 'string' } },
            pattern: { type: 'string' },
            hours: { type: 'number', description: 'Freshness SLA in hours.' },
            referenceObjectId: { type: 'string', description: 'For referentialIntegrity: the canvas object holding the parent rows.' },
            referenceColumn: { type: 'string', description: 'For referentialIntegrity: the parent column values must exist in.' },
            tolerance: { type: 'number', description: 'Share of rows (0–1) allowed to fail before the check does.' },
            severity: { type: 'string', enum: ['error', 'warning'] },
          } },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; checks?: unknown; materialize?: boolean };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const contract = normalizeDataContract(dataset.data.dataContract);
      const authored = normalizeDataQualityChecks(args.checks);
      const derived = contract ? checksFromContract(contract) : [];
      // Deduplicated by id so a rule declared in a contract and repeated by the
      // model is one check, not two identical rows in the report.
      const byId = new Map([...derived, ...(authored.length ? authored : derived.length ? [] : suggestDataQualityChecks(source))].map((check) => [check.id, check]));
      const checks = [...byId.values()];
      if (!checks.length) return { error: `${dataset.data.title} has nothing to check yet. Declare a contract with canvas_set_data_contract, or pass checks explicitly.` };

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const references = referenceSources(
        all.filter((node) => ['dataset', 'table', 'spreadsheet', 'datasource'].includes(node.data.kind)).map((node) => ({ id: node.id, data: node.data as Record<string, unknown> })),
        (data) => tabularFromObject(data),
      );
      const results = runDataQualityChecks(source, checks, {
        fetchedAt: typeof dataset.data.fetchedAt === 'string' ? dataset.data.fetchedAt : null,
        references,
      });
      const verdict = dataQualityVerdict(results);
      const lastRunAt = new Date().toISOString();

      const payload = { ok: true, proposed: true, objectId: dataset.id, verdict, results };
      if (args.materialize === false) return payload;

      const title = `${dataset.data.title} quality`;
      const existing = all.find((node) => node.data.kind === 'dataQuality' && node.data.sourceDatasetId === dataset.id);
      const fields = sanitizeCreationObjectPatch('dataQuality', {
        title, checks, results, verdict: verdict.status, score: verdict.score, sourceDatasetId: dataset.id, lastRunAt,
        status: verdict.status === 'pass' ? `${verdict.passed} passing` : `${verdict.failed} failing`,
        summary: `${verdict.passed} passed, ${verdict.warned} warned, ${verdict.failed} failed, ${verdict.skipped} skipped over ${source.rows.length.toLocaleString()} rows.`,
      });
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Re-run quality on ${dataset.data.title}`, objectId: existing.id, patch: fields });
        return { ...payload, object: { id: existing.id, kind: 'dataQuality', title, updated: true } };
      }
      const node = newNode('dataQuality', nextCanvasObjectPosition(all, { x: dataset.position.x + 920, y: dataset.position.y + 300 }, typeof window !== 'undefined' && window.innerWidth <= 760, 'dataQuality'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add quality checks “${title}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Checks ${dataset.data.title}`, edge: { id: crypto.randomUUID(), source: node.id, target: dataset.id, type: 'smoothstep', label: 'checks', data: { connectionKind: 'reference' } } });
      return { ...payload, object: { id: node.id, kind: 'dataQuality', title, created: true } };
    },
  }, {
    /** The semantic layer. Two tiles labelled "MRR" that disagree is the defect;
     *  ONE definition that both evaluate is the fix. */
    name: 'canvas_define_metric',
    description: 'Define a metric ONCE — its source, formula, filters, breakdown, unit, format and target — so every KPI, chart and report that quotes it computes the same number. Use this whenever a number will be referred to by name ("MRR", "win rate", "average handling time") rather than asked for once. Optionally materialize the current value as a KPI or the breakdown as a chart, both bound to this definition.',
    parameters: {
      type: 'object', required: ['name', 'aggregate'], additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'The metric\'s name, as people say it: "Monthly recurring revenue".' },
        description: { type: 'string', description: 'What it counts and, importantly, what it excludes.' },
        sourceObjectId: { type: 'string', description: 'The dataset/table it is computed from. Omit when the canvas holds exactly one with rows.' },
        aggregate: {
          type: 'object', required: ['op'], additionalProperties: false,
          properties: { op: { type: 'string', enum: [...TABULAR_AGGREGATE_OPERATORS] }, column: { type: 'string' }, label: { type: 'string' } },
        },
        filter: {
          type: 'array', description: 'Rows the metric counts. THIS is the part that makes two definitions of the same word disagree, so state it.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } },
        },
        dimension: { type: 'string', description: 'Breakdown column for the series form.' },
        timeGrain: { type: 'object', required: ['column', 'grain'], additionalProperties: false, properties: { column: { type: 'string' }, grain: { type: 'string', enum: [...TABULAR_TIME_GRAINS] } } },
        unit: { type: 'string', description: 'Currency code for format "currency" (e.g. USD), otherwise a free unit.' },
        format: { type: 'string', enum: [...METRIC_FORMATS] },
        decimals: { type: 'number' },
        target: { type: 'number' },
        direction: { type: 'string', enum: [...METRIC_DIRECTIONS], description: 'Which way is good. "down" for churn or cost — it inverts how attainment is read.' },
        materializeAs: { type: 'string', enum: ['none', 'kpi', 'chart'], description: 'Also put the current value on the board, bound to this definition.' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as Record<string, unknown> & { sourceObjectId?: string; materializeAs?: string };
      const target = resolveTabularTarget(args.sourceObjectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;

      const definition = normalizeMetricDefinition({ ...args, sourceObjectId: dataset.id });
      if (!definition) return { error: 'A metric needs a name and an aggregate.' };
      const unknown = [definition.aggregate.column, definition.dimension, definition.timeGrain?.column, ...(definition.filter ?? []).map((filter) => filter.column)]
        .filter((column): column is string => !!column)
        .filter((column) => !source.columns.includes(column));
      if (unknown.length) {
        return { error: `Unknown column(s): ${[...new Set(unknown)].join(', ')}. ${dataset.data.title} has: ${source.columns.join(', ')}` };
      }

      const value = computeMetric(source, definition);
      const series = computeMetricSeries(source, definition);
      const producedAt = new Date().toISOString();
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];

      const metricFields = sanitizeCreationObjectPatch('metric', {
        title: definition.name, definition, sourceObjectId: dataset.id,
        value: value.value, ...(series ? { series: series.labels.map((label, index) => ({ at: label, value: series.values[index] ?? 0 })) } : {}),
        status: formatMetricValue(value.value, definition),
        summary: `${definition.aggregate.op}${definition.aggregate.column ? ` of ${definition.aggregate.column}` : ''} over ${value.matchedRows.toLocaleString()} of ${value.totalRows.toLocaleString()} rows in ${dataset.data.title}.`,
        ...lineagePatch([dataset.id], { engine: 'metric', query: { aggregate: [definition.aggregate], ...(definition.filter ? { filter: definition.filter } : {}) }, rowsIn: value.totalRows, rowsOut: 1 }, { producedAt }),
      });
      const existing = all.find((node) => node.data.kind === 'metric' && normalizeMetricDefinition(node.data.definition)?.id === definition.id);
      let metricId: string;
      if (existing) {
        metricId = existing.id;
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update metric “${definition.name}”`, objectId: existing.id, patch: metricFields });
      } else {
        const node = newNode('metric', nextCanvasObjectPosition(all, { x: dataset.position.x + 460, y: dataset.position.y - 260 }, typeof window !== 'undefined' && window.innerWidth <= 760, 'metric'));
        node.data = { ...node.data, ...metricFields };
        metricId = node.id;
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Define metric “${definition.name}”`, node });
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Computed from ${dataset.data.title}`, edge: { id: crypto.randomUUID(), source: dataset.id, target: node.id, type: 'smoothstep', animated: true, label: 'defines', data: { connectionKind: 'data' } } });
      }

      const payload = {
        ok: true, proposed: true,
        metric: { id: definition.id, objectId: metricId, name: definition.name },
        value: value.value, formatted: formatMetricValue(value.value, definition),
        matchedRows: value.matchedRows, totalRows: value.totalRows,
        ...(value.attainment != null ? { target: value.target, attainment: value.attainment, status: value.status } : {}),
        ...(series ? { series } : {}),
        computedFromEveryRow: true,
      };
      const materializeAs = args.materializeAs === 'kpi' || args.materializeAs === 'chart' ? args.materializeAs : null;
      if (!materializeAs) return payload;
      if (materializeAs === 'chart' && !series) {
        return { ...payload, error: 'A chart needs a breakdown. Set `dimension` or `timeGrain` on the metric first.' };
      }

      // The artifact stores `metricId`, not a literal — which is what makes the
      // definition load-bearing rather than decorative.
      const artifact = newNode(materializeAs, nextCanvasObjectPosition([...all, ...proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : [])], { x: dataset.position.x + 920, y: dataset.position.y - 260 }, typeof window !== 'undefined' && window.innerWidth <= 760, materializeAs));
      artifact.data = { ...artifact.data, ...sanitizeCreationObjectPatch(materializeAs, materializeAs === 'kpi'
        ? {
          title: definition.name, value: formatMetricValue(value.value, definition),
          ...(definition.target != null ? { target: formatMetricValue(definition.target, definition) } : {}),
          ...(definition.unit ? { unit: definition.unit } : {}),
          metricId: definition.id, sourceDatasetId: dataset.id, status: 'Live',
          summary: `Defined by “${definition.name}” · computed from ${value.totalRows.toLocaleString()} rows.`,
          ...lineagePatch([dataset.id], { engine: 'metric' }, { producedAt }),
        }
        : {
          title: definition.name, chartTitle: definition.name, status: 'Live',
          xAxisLabel: series!.dimension, yAxisLabel: definition.aggregate.column ?? definition.aggregate.op,
          chartLabels: series!.labels, chartValues: series!.values,
          metricId: definition.id, sourceDatasetId: dataset.id,
          summary: `Defined by “${definition.name}” · computed from ${value.totalRows.toLocaleString()} rows.`,
          ...lineagePatch([dataset.id], { engine: 'metric' }, { producedAt }),
        }) };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add ${materializeAs} “${definition.name}”`, node: artifact });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Quotes ${definition.name}`, edge: { id: crypto.randomUUID(), source: metricId, target: artifact.id, type: 'smoothstep', animated: true, label: 'quotes', data: { connectionKind: 'data' } } });
      return { ...payload, materialized: { id: artifact.id, kind: materializeAs, title: definition.name } };
    },
  }, {
    name: 'canvas_trace_lineage',
    description: 'Map where the numbers on this canvas came from: which artifact was computed from which source, by what transform, and which artifacts are now STALE because their source was re-read after they were built. Pass `column` with `objectId` to answer "what breaks if I change this column". Use this before renaming or dropping a column, or when a chart and its dataset disagree.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Focus on one object: its upstream sources and everything computed from it.' },
        column: { type: 'string', description: 'With objectId: report only the artifacts that read this column.' },
        materialize: { type: 'boolean', description: 'Put the lineage map on the board as its own object.' },
      },
    },
    mutates: (raw: unknown) => (raw as { materialize?: unknown })?.materialize === true,
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; column?: string; materialize?: boolean };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const objects = all.map((node) => ({ id: node.id, kind: node.data.kind, title: String(node.data.title), data: node.data as Record<string, unknown> }));
      const graph = buildLineageGraph(objects);
      const stale = staleDerivatives(objects);

      if (args.objectId && args.column) {
        const impacts = columnImpact(objects, args.objectId, args.column);
        return {
          ok: true, objectId: args.objectId, column: args.column,
          impacted: impacts,
          // An empty result is a real, useful answer here — it means the column can
          // be changed without breaking anything on this board.
          safeToChange: impacts.length === 0,
        };
      }

      const focused = args.objectId
        ? { downstream: impactOf(graph, args.objectId), upstream: upstreamOf(graph, args.objectId) }
        : null;
      const payload = {
        ok: true,
        objects: graph.nodes,
        links: graph.edges,
        stale,
        ...(focused ? { focus: { objectId: args.objectId, ...focused } } : {}),
      };
      if (!args.materialize) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      if (!graph.nodes.length) return { ...payload, error: 'Nothing on this canvas records where it came from yet. Build a chart or table from a dataset first.' };

      const title = 'Data lineage';
      const existing = all.find((node) => node.data.kind === 'lineage');
      const fields = sanitizeCreationObjectPatch('lineage', {
        title, lineageNodes: graph.nodes, lineageEdges: graph.edges, staleDerivatives: stale,
        ...(args.objectId ? { focusObjectId: args.objectId } : {}),
        status: stale.length ? `${stale.length} stale` : `${graph.nodes.length} tracked`,
        summary: `${graph.nodes.length} objects linked by ${graph.edges.length} transforms. ${stale.length} artifact${stale.length === 1 ? '' : 's'} predate their source.`,
      });
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: 'Refresh lineage', objectId: existing.id, patch: fields });
        return { ...payload, proposed: true, object: { id: existing.id, kind: 'lineage', title, updated: true } };
      }
      const node = newNode('lineage', nextCanvasObjectPosition(all, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'lineage'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: 'Trace lineage', node });
      return { ...payload, proposed: true, object: { id: node.id, kind: 'lineage', title, created: true } };
    },
  }, {
    /**
     * The CELL. Real execution, in a worker, over rows already on this board.
     *
     * Its outputs land as first-class `table`/`chart` objects rather than as a
     * scrollback buffer, which is what makes an analysis something the next turn can
     * reason over instead of prose someone has to re-read.
     */
    name: 'canvas_run_notebook',
    description: 'Execute analysis code against a dataset on this canvas and put the results on the board. Each cell is JavaScript whose LAST EXPRESSION is its result. Inside a cell you have `df` (the bound rows: df.rows, df.columns, df.nums(column), df.where(fn), df.groupBy(column)), `stats` (median, percentile, stddev, variance, correlation, summarize, histogram, linearFit, zScores, mode) and `infer` (proportionInterval, meanInterval, twoProportionTest). Return {columns, rows} to build a table, {labels, values} to build a chart, or any value to print it. Use this for anything canvas_query_dataset cannot express — a distribution, a correlation matrix, a hypothesis test, a custom cohort.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['cells'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset, table or spreadsheet object to bind as `df`. Omit when the canvas has exactly one.' },
        cells: {
          type: 'array', description: 'Cells to run, in order.',
          items: { type: 'object', required: ['source'], additionalProperties: false, properties: { source: { type: 'string', description: 'JavaScript. The last expression is the result.' } } },
        },
        title: { type: 'string', description: 'Title for the notebook object.' },
        materialize: { type: 'boolean', description: 'Also promote each table/chart output to its own canvas object. Default true.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      const args = raw as { datasetId?: string; cells?: Array<{ source?: string }>; title?: string; materialize?: boolean };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const cells = (args.cells ?? []).flatMap((cell, index) => {
        const source = typeof cell?.source === 'string' ? cell.source.trim() : '';
        return source ? [{ id: `c${index + 1}`, source }] : [];
      });
      if (!cells.length) return { error: 'Pass at least one cell with a non-empty `source`.' };

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const candidates = all.filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to bind as \`df\`. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas. Attach a CSV or import one first — a notebook with no data can only compute constants.' };
      }

      // The data-use gate reads the dataset's declared policy. Analysis of rows
      // already in front of the user is the permissive case, so this refuses only a
      // dataset whose owner explicitly excluded it.
      const refusal = checkDataUse((target.data as { dataUse?: DataUsePolicy }).dataUse, 'analysis', Date.now());
      if (refusal) return { error: refusal.message };

      const source = tabularFromObject(target.data as Record<string, unknown>);
      const outputs = await runNotebook(cells, source, 'js');

      const title = args.title?.trim() || `Analysis of ${String(target.data.title)}`;
      const failures = outputs.filter((output) => output.kind === 'error');
      const fields = sanitizeCreationObjectPatch('notebook', {
        title,
        language: 'js',
        sourceObjectId: target.id,
        cells,
        outputs: outputs.map((output) => ({ cellId: output.cellId, kind: output.kind, preview: output.preview, runtimeMs: output.runtimeMs })),
        lastRunAt: new Date().toISOString(),
        status: failures.length ? `${failures.length} of ${cells.length} failed` : `${cells.length} cell${cells.length === 1 ? '' : 's'} ran`,
        summary: failures.length
          ? `${failures.length} of ${cells.length} cells failed: ${failures.map((output) => output.error).join(' · ').slice(0, 300)}`
          : `Ran ${cells.length} cell${cells.length === 1 ? '' : 's'} over ${source.rows.length.toLocaleString()} rows of ${String(target.data.title)}.`,
      });
      const node = newNode('notebook', nextCanvasObjectPosition(all, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'notebook'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: 'Run notebook', node });

      // A table or chart output becomes a real object, carrying the same provenance
      // every other derived artifact carries — so a notebook result is as traceable as
      // a query result and can go stale the same way.
      const promoted: Array<{ id: string; kind: string; cellId: string }> = [];
      if (args.materialize !== false) {
        const basis = rowBasis(source, Number((target.data as { rowCount?: number }).rowCount) || null);
        for (const output of outputs) {
          const kind = output.table ? 'chart' : output.chart ? 'chart' : null;
          if (!kind) continue;
          const derived = output.table
            ? { chartType: 'bar', chartLabels: output.table.rows.map((row) => String(row[output.table!.columns[0]] ?? '')), chartValues: output.table.rows.map((row) => Number(row[output.table!.columns[1]] ?? 0)) }
            : { chartType: 'bar', chartLabels: output.chart!.labels, chartValues: output.chart!.values };
          const childFields = sanitizeCreationObjectPatch('chart', {
            title: `${title} · ${output.cellId}`,
            ...derived,
            sourceDatasetId: target.id,
            basis,
            producedAt: new Date().toISOString(),
            summary: `Computed by notebook cell ${output.cellId}.`,
          });
          const child = newNode('chart', nextCanvasObjectPosition([...all, node], {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'chart'));
          child.data = { ...child.data, ...childFields };
          proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Chart from ${output.cellId}`, node: child });
          promoted.push({ id: child.id, kind: 'chart', cellId: output.cellId });
        }
      }

      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'notebook', title, created: true },
        outputs: outputs.map((output) => ({ cellId: output.cellId, kind: output.kind, preview: output.preview, error: output.error, runtimeMs: output.runtimeMs })),
        promoted,
        rowsBound: source.rows.length,
      };
    },
  }, {
    /**
     * The half of the fine-tune loop the board never had.
     *
     * A `build` object of modality `finetune` already LAUNCHES a run; this is what
     * brings the loss curve and the four-axis scorecard back, so the result can be
     * connected to the dataset that produced it and the decision that used it.
     */
    name: 'canvas_read_training_run',
    description: 'Read fine-tuning runs from this workspace and put one on the canvas with its hyperparameters, loss curve and evaluation scorecard. Call with no jobId to LIST the runs for a project; call with a jobId to place that run on the board. The runs come from Builder workspaces of type "finetune" — this is how a training result gets onto the canvas beside the dataset it learned from.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'IDE project whose runs to list. Omit to use the project this canvas is bound to.' },
        jobId: { type: 'string', description: 'Place this run on the canvas. Omit to list.' },
        datasetObjectId: { type: 'string', description: 'Canvas id of the dataset object this run trained on, so the board records the link.' },
      },
    },
    mutates: (raw: unknown) => typeof (raw as { jobId?: unknown })?.jobId === 'string',
    run: async (raw: unknown) => {
      const args = raw as { projectId?: string; jobId?: string; datasetObjectId?: string };
      // The canvas has no single "bound project"; a project OBJECT on the board is what
      // binds one, which is the same resolution `canvasProjectId` already performs for
      // the Builder and Evermind paths.
      const boardProject = [...nodes, ...proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : [])]
        .flatMap((node) => { const id = canvasProjectId(node.data); return id == null ? [] : [id]; })[0];
      const projectId = args.projectId ?? (boardProject != null ? String(boardProject) : undefined);
      if (!args.jobId) {
        if (!projectId) return { error: 'No project is bound to this canvas, so there are no training runs to list. Open this canvas from a project, or pass projectId.' };
        const jobs = await listTrainingJobs(projectId).catch(() => null);
        if (!jobs) return { error: 'Could not read the training runs for this project.' };
        if (!jobs.length) return { runs: [], error: 'This project has no training runs yet. Add a Builder object, choose the "finetune" type, and start a run.' };
        return { runs: jobs.map((job) => ({ jobId: job.id, baseModel: job.base_model, status: job.status, epochs: job.epochs, evalScore: job.eval_score ?? null, createdAt: job.created_at })) };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const job = await fetchTrainingJob(args.jobId).catch(() => null);
      if (!job) return { error: `No training run with id ${args.jobId} is readable from this workspace.` };
      // Logs are the loss CURVE; a run without them still places, with the single
      // current-loss point, rather than rendering an empty chart that reads as broken.
      const logs = await fetchTrainingLogs(args.jobId).catch(() => []);
      const lowered = trainingRunFields(job, logs);

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const title = `${job.base_model} · run ${job.id.slice(0, 8)}`;
      const fields = sanitizeCreationObjectPatch('trainingRun', {
        title, ...lowered,
        ...(args.datasetObjectId ? { datasetObjectId: args.datasetObjectId } : {}),
      });
      const existing = all.find((node) => node.data.kind === 'trainingRun' && node.data.jobId === job.id);
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: 'Refresh training run', objectId: existing.id, patch: fields });
        return { ok: true, proposed: true, object: { id: existing.id, kind: 'trainingRun', title, updated: true }, run: lowered };
      }
      const node = newNode('trainingRun', nextCanvasObjectPosition(all, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'trainingRun'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: 'Add training run', node });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'trainingRun', title, created: true }, run: lowered };
    },
  }, {
    name: 'canvas_compare_runs',
    description: 'Rank the training runs on this canvas against a baseline on one metric, and put the comparison on the board. Shows each run\'s score, its delta from the baseline, and ONLY the hyperparameters that differ — which is the actual explanation of why one run beat another. Use this before promoting a model: a table of scores with no baseline is a list, not a comparison.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        rankBy: { type: 'string', description: 'Axis to rank on: evalScore, codeCorrectness, reasoningQuality or hallucinationRate. Defaults to evalScore. hallucinationRate is ranked ascending because lower is better.' },
        baselineObjectId: { type: 'string', description: 'Canvas id of the trainingRun everything is measured against. Defaults to the first run on the board.' },
        title: { type: 'string' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      const args = raw as { rankBy?: string; baselineObjectId?: string; title?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const runs = all.filter((node) => node.data.kind === 'trainingRun');
      if (runs.length < 2) {
        return { error: `A comparison needs at least two training runs on the canvas; there ${runs.length === 1 ? 'is 1' : 'are none'}. Add them with canvas_read_training_run first.` };
      }
      const comparison = compareRuns(
        runs.map((node) => ({
          objectId: node.id,
          label: String(node.data.title),
          scorecard: (node.data as { scorecard?: Array<{ axis: string; score: number }> }).scorecard ?? [],
          hyperparameters: (node.data as { hyperparameters?: Array<{ name: string; value: string | number }> }).hyperparameters ?? [],
        })),
        args.rankBy || 'evalScore',
        args.baselineObjectId,
      );
      const title = args.title?.trim() || `Run comparison · ${comparison.rankBy}`;
      const scored = comparison.rows.filter((row) => row.score != null).length;
      const fields = sanitizeCreationObjectPatch('runComparison', {
        title,
        rankBy: comparison.rankBy,
        baselineRunId: comparison.baselineObjectId,
        runs: comparison.rows,
        verdict: comparison.verdict,
        status: `${scored} of ${comparison.rows.length} scored`,
        summary: `${comparison.rows.length} runs ranked on ${comparison.rankBy}. ${scored < comparison.rows.length ? `${comparison.rows.length - scored} have not been evaluated.` : 'All runs evaluated.'}`,
      });
      const node = newNode('runComparison', nextCanvasObjectPosition(all, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'runComparison'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: 'Compare runs', node });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'runComparison', title, created: true }, comparison };
    },
  }, {
    name: 'canvas_sample_for_labels',
    description: 'Build a label set: take a reproducible, evenly-spread sample of a dataset and put it on the board with the question reviewers must answer. This is where an evaluation set legitimately comes from — the alternative is a model writing its own test cases and grading itself, which measures nothing. The sample is a stride, not the first N rows, because the head of an export is usually its oldest data.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset to sample. Omit when the canvas has exactly one.' },
        question: { type: 'string', description: 'The ONE question every reviewer answers about every sample. If it needs an "and", it is two label sets.' },
        options: { type: 'array', items: { type: 'string' }, description: 'The allowed answers. A closed set, so agreement is computable.' },
        guidelines: { type: 'string', description: 'How to decide the hard cases, with a worked example of each option.' },
        size: { type: 'number', description: 'How many rows to sample. Defaults to 50.' },
        textColumn: { type: 'string', description: 'Column a reviewer reads. Omit to show the whole row.' },
        title: { type: 'string' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      const args = raw as { datasetId?: string; question?: string; options?: string[]; guidelines?: string; size?: number; textColumn?: string; title?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const question = args.question?.trim();
      if (!question) return { error: 'A label set needs the question reviewers answer.' };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const candidates = all.filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to sample. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      const samples = sampleRows(source, Number(args.size) || 50, args.textColumn);
      if (!samples.length) return { error: `${String(target.data.title)} has no rows to sample.` };

      const title = args.title?.trim() || `Labels · ${String(target.data.title)}`;
      const fields = sanitizeCreationObjectPatch('labelSet', {
        title,
        sourceDatasetId: target.id,
        question,
        options: Array.isArray(args.options) ? args.options.map(String) : [],
        ...(args.guidelines?.trim() ? { guidelines: args.guidelines.trim() } : {}),
        samples,
        labels: [],
        status: `0 of ${samples.length} labelled`,
        summary: `${samples.length} rows sampled from ${source.rows.length.toLocaleString()} for review. Nothing is labelled yet, so this set cannot score anything.`,
      });
      const node = newNode('labelSet', nextCanvasObjectPosition(all, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'labelSet'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: 'Sample for labels', node });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'labelSet', title, created: true }, sampled: samples.length, of: source.rows.length };
    },
  }, {
    name: 'canvas_forecast_series',
    description: 'Project a series on this canvas forward and flag its outliers. Point it at a dataset with a date column and a value column, and it buckets by period, fits a least-squares trend, projects the next periods and flags points that are unusual GIVEN the trend (not merely far from the average). Returns the slope with its R², because a trend without a fit quality is the most misleading number a dashboard can show. Empty periods are filled with zero rather than skipped, so the trend is not steepened by a compressed axis.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['dateColumn', 'valueColumn'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset holding the series. Omit when the canvas has exactly one.' },
        dateColumn: { type: 'string', description: 'Date column to bucket by.' },
        valueColumn: { type: 'string', description: 'Numeric column to total per period.' },
        grain: { type: 'string', enum: [...TABULAR_TIME_GRAINS], description: 'Period size. Defaults to month.' },
        horizon: { type: 'number', description: 'How many periods to project. Defaults to 6.' },
        materialize: { type: 'boolean', description: 'Put a chart of history plus projection on the board. Default true.' },
        title: { type: 'string' },
      },
    },
    mutates: (raw: unknown) => (raw as { materialize?: unknown })?.materialize !== false,
    run: (raw: unknown) => {
      const args = raw as { datasetId?: string; dateColumn?: string; valueColumn?: string; grain?: TabularTimeGrain; horizon?: number; materialize?: boolean; title?: string };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const candidates = all.filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset holds the series. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      for (const column of [args.dateColumn, args.valueColumn]) {
        if (column && !source.columns.includes(column)) {
          return { error: `Unknown column "${column}". Available columns: ${source.columns.join(', ')}` };
        }
      }
      const history = seriesFromDataset(source, String(args.dateColumn), String(args.valueColumn), args.grain ?? 'month');
      if (history.length < 2) {
        return { error: `"${args.dateColumn}" produced ${history.length} period${history.length === 1 ? '' : 's'}, which cannot define a trend. Check that it holds real dates — a bare number column is not read as a date.` };
      }
      const result = forecastSeries(history, Number(args.horizon) || 6);
      if (args.materialize === false) return { ok: true, ...result };

      if (!canEdit) return { ok: true, ...result, error: 'The current session role cannot edit this canvas' };
      const title = args.title?.trim() || `${String(args.valueColumn)} forecast`;
      const fields = sanitizeCreationObjectPatch('chart', {
        title,
        chartType: 'line',
        chartLabels: [...result.history.map((point) => point.label), ...result.forecast.map((point) => point.label)],
        chartValues: [...result.history.map((point) => point.value), ...result.forecast.map((point) => point.value)],
        sourceDatasetId: target.id,
        basis: rowBasis(source, Number((target.data as { rowCount?: number }).rowCount) || null),
        producedAt: new Date().toISOString(),
        sampleSize: result.history.length,
        status: `R² ${result.r2}`,
        // The fit quality leads the summary on purpose: a projection quoted without it
        // is the number people repeat, and a slope through noise looks identical to a
        // slope through a trend.
        summary: `Projected ${result.forecast.length} periods at ${result.slope >= 0 ? '+' : ''}${result.slope} per period, R² ${result.r2}${result.r2 < 0.5 ? ' — a weak fit, so treat the projection as a direction rather than a number' : ''}. ${result.anomalies.length} anomal${result.anomalies.length === 1 ? 'y' : 'ies'} against the trend.`,
      });
      const node = newNode('chart', nextCanvasObjectPosition(all, {}, typeof window !== 'undefined' && window.innerWidth <= 760, 'chart'));
      node.data = { ...node.data, ...fields };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: 'Forecast series', node });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'chart', title, created: true }, ...result };
    },
  }, {
    name: 'canvas_set_data_use',
    description: 'Declare what a dataset may be USED for: its permitted purposes, its lawful basis, and how long the rows may be kept. This is a restriction, not a description — canvas_classify_dataset says what the rows ARE, and this says what may be done with them. Once purposes are declared, a use outside them is refused: a dataset whose purposes exclude "training" cannot become a fine-tune corpus, and rows past their retention window cannot be used at all. Set this whenever a dataset holds personal data.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['datasetId'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset to govern.' },
        purposes: { type: 'array', items: { type: 'string', enum: [...DATA_PURPOSES] }, description: 'What these rows may be used for. Omit to leave the dataset unrestricted.' },
        lawfulBasis: { type: 'string', enum: [...LAWFUL_BASES], description: 'GDPR Article 6 basis. Required before the rows may be used for training or sharing.' },
        retentionDays: { type: 'number', description: 'Days the rows may be kept from collectedAt. Omit or 0 for no declared limit.' },
        collectedAt: { type: 'string', description: 'ISO date the rows were collected — the clock retention is measured from.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      const args = raw as { datasetId?: string; purposes?: string[]; lawfulBasis?: string; retentionDays?: number; collectedAt?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const target = [...nodes, ...stagedNodes].find((node) => node.id === args.datasetId);
      if (!target) return { error: `No object with id ${args.datasetId} is on this canvas.` };

      const dataUse: DataUsePolicy = {
        ...(args.purposes?.length ? { purposes: args.purposes.filter((purpose): purpose is DataPurpose => (DATA_PURPOSES as readonly string[]).includes(purpose)) } : {}),
        ...(args.lawfulBasis && (LAWFUL_BASES as readonly string[]).includes(args.lawfulBasis) ? { lawfulBasis: args.lawfulBasis as LawfulBasis } : {}),
        ...(Number(args.retentionDays) > 0 ? { retentionDays: Math.trunc(Number(args.retentionDays)) } : {}),
        ...(args.collectedAt ? { collectedAt: args.collectedAt } : {}),
      };
      const patch = sanitizeCreationObjectPatch(target.data.kind, {
        dataUse,
        summary: `Use restricted to: ${dataUse.purposes?.join(', ') || 'any purpose'}${dataUse.lawfulBasis ? ` · basis: ${dataUse.lawfulBasis}` : ''}${dataUse.retentionDays ? ` · retained ${dataUse.retentionDays} days` : ''}.`,
      });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: 'Declare data use', objectId: target.id, patch });
      return { ok: true, proposed: true, objectId: target.id, dataUse };
    },
  }, {
    name: 'canvas_list_data_sources',
    description: 'List the live databases and warehouses this workspace has connected — Postgres/Neon, ClickHouse, BigQuery and others — and what each can do here. Call this before canvas_add_data_source or canvas_query_data_source when the user has not named one.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    run: async () => {
      const { sources } = await dataSourceApi.list().catch(() => ({ sources: [] as DataSourceSummary[] }));
      if (!sources.length) {
        return { sources: [], error: 'No data source is connected to this workspace. Connect one in Integrations, or attach a CSV to work with a file instead.' };
      }
      return { sources };
    },
  }, {
    /**
     * REAL → model: reverse-engineer a live database.
     *
     * The other direction of "create me an ERD". Everything on a canvas used to
     * arrive by file upload; this reads the actual schema — tables, columns,
     * nullability, primary keys and foreign keys — so a model of production is
     * the truth rather than someone's recollection of it.
     */
    name: 'canvas_add_data_source',
    description: 'Put a connected database or warehouse on the canvas as a LIVE source, reading its real schema. Use this when asked to look at, explore, document, diagram or model an actual database. Set buildModel to also produce a validated ERD of the real schema — this is how "draw the ERD for our production database" is answered truthfully rather than from guesswork.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        sourceId: { type: 'string', description: 'Connection id from canvas_list_data_sources. Omit when exactly one is connected.' },
        name: { type: 'string', description: 'Connection name, as an alternative to sourceId.' },
        dataset: { type: 'string', description: 'BigQuery only: the dataset whose schema to read. Required there, ignored elsewhere.' },
        buildModel: { type: 'boolean', description: 'Also create a validated ERD object from the real schema.' },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { sourceId?: string; name?: string; dataset?: string; buildModel?: boolean; title?: string; x?: number; y?: number };
      const { sources } = await dataSourceApi.list().catch(() => ({ sources: [] as DataSourceSummary[] }));
      const resolved = resolveDataSource(sources, { id: args.sourceId ?? null, name: args.name ?? null });
      if (!resolved.ok) return { error: `${resolved.error} Connect one in Integrations.` };
      const source = resolved.source;
      if (!source.canIntrospect) {
        return { error: `${source.providerLabel} cannot have its schema read from here${source.note ? ` — ${source.note}` : '.'}` };
      }

      let schema: Awaited<ReturnType<typeof dataSourceApi.schema>>;
      try {
        schema = await dataSourceApi.schema(source.id, args.dataset);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That data source could not be read.' };
      }
      if (!schema.tables.length) return { error: `${source.name} reported no tables${args.dataset ? ` in dataset "${args.dataset}"` : ''}.` };

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const fetchedAt = new Date().toISOString();
      const title = (args.title || source.name).trim().slice(0, 160);
      const node = newNode('datasource', nextCanvasObjectPosition(all, args, typeof window !== 'undefined' && window.innerWidth <= 760, 'datasource'));
      node.data = { ...node.data, ...sanitizeCreationObjectPatch('datasource', {
        title, tables: schema.tables, relationships: schema.relationships, scanned: schema.scanned,
        status: `${schema.tables.length} tables`,
        summary: `${schema.tables.length} tables and ${schema.relationships.length} foreign keys in ${schema.scanned.join(', ') || source.providerLabel}.`,
        fetchedAt,
      }), connectionId: source.id, provider: source.provider, providerLabel: source.providerLabel };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add data source “${title}”`, node });

      const payload = {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'datasource', title },
        provider: source.providerLabel,
        tables: schema.tables.map((table) => ({ name: table.name, columns: table.columns.length })),
        relationships: schema.relationships.length,
        scanned: schema.scanned,
      };
      if (!args.buildModel) return payload;

      const model = dataModelFromIntrospection(schema.tables, schema.relationships);
      const issues = validateDataModel(model);
      const summary = dataModelSummary(model, issues);
      const modelTitle = `${title} schema`;
      const modelNode = newNode('erd', nextCanvasObjectPosition([...all, node], { x: node.position.x + 460, y: node.position.y }, typeof window !== 'undefined' && window.innerWidth <= 760, 'erd'));
      modelNode.data = { ...modelNode.data, ...sanitizeCreationObjectPatch('erd', {
        title: modelTitle, dataModel: model, dialect: 'postgres', ddl: dataModelDdl(model, 'postgres'), mermaid: dataModelMermaid(model), issues,
        status: `${summary.entities} entities`,
        summary: `Reverse-engineered from ${source.providerLabel}: ${summary.entities} entities, ${summary.relationships} relationships.`,
        ...lineagePatch([node.id], { engine: 'import' }, { producedAt: fetchedAt }),
      }) };
      modelNode.style = { width: 760, height: 560 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Model “${modelTitle}”`, node: modelNode });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Schema of ${title}`, edge: { id: crypto.randomUUID(), source: node.id, target: modelNode.id, type: 'smoothstep', animated: true, label: 'schema of', data: { connectionKind: 'data' } } });
      return { ...payload, model: { id: modelNode.id, kind: 'erd', title: modelTitle, entities: summary.entities, issues } };
    },
  }, {
    name: 'canvas_query_data_source',
    description: 'Run ONE read-only SQL query against a connected database and put the real result on the canvas as a Table, Chart, KPI or Dataset. Use this for any question about live data rather than an uploaded file. Only SELECT (and WITH … SELECT) is accepted — a canvas data source cannot write. Materializing as "dataset" is the right choice when further analysis will follow, because every later canvas_query_dataset call then runs over the returned rows without another round trip.',
    parameters: {
      type: 'object', required: ['sql'], additionalProperties: false,
      properties: {
        sourceId: { type: 'string', description: 'Connection id from canvas_list_data_sources. Omit when exactly one is connected.' },
        name: { type: 'string', description: 'Connection name, as an alternative to sourceId.' },
        sql: { type: 'string', description: 'A single SELECT statement. A LIMIT is added when you omit one.' },
        limit: { type: 'number', description: 'Row ceiling, up to 500.' },
        materializeAs: { type: 'string', enum: ['none', 'dataset', 'table', 'chart', 'kpi'], description: 'Defaults to table.' },
        title: { type: 'string' },
      },
    },
    mutates: (raw: unknown) => (raw as { materializeAs?: unknown })?.materializeAs !== 'none',
    run: async (raw: unknown) => {
      const args = raw as { sourceId?: string; name?: string; sql?: string; limit?: number; materializeAs?: string; title?: string };
      const { sources } = await dataSourceApi.list().catch(() => ({ sources: [] as DataSourceSummary[] }));
      const resolved = resolveDataSource(sources, { id: args.sourceId ?? null, name: args.name ?? null });
      if (!resolved.ok) return { error: `${resolved.error} Connect one in Integrations.` };
      if (!resolved.source.canQuery) return { error: `${resolved.source.providerLabel} does not accept SQL from a canvas.` };

      let result: Awaited<ReturnType<typeof dataSourceApi.query>>;
      try {
        result = await dataSourceApi.query(resolved.source.id, String(args.sql ?? ''), args.limit);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That query could not be run.' };
      }
      const payload = {
        ok: true, source: result.source, sql: result.sql,
        columns: result.columns, rows: result.rows.slice(0, 20),
        rowCount: result.rowCount, truncated: result.truncated,
        readFromLiveSource: true,
      };
      const materializeAs = ['dataset', 'table', 'chart', 'kpi'].includes(String(args.materializeAs ?? 'table'))
        ? String(args.materializeAs ?? 'table') as 'dataset' | 'table' | 'chart' | 'kpi'
        : null;
      if (!materializeAs) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      if (!result.rows.length) return { ...payload, error: 'That query returned no rows, so nothing was added to the canvas.' };

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...stagedNodes];
      const fetchedAt = new Date().toISOString();
      const title = (args.title || `${result.source.name} query`).trim().slice(0, 160);
      const bound = all.find((node) => node.data.kind === 'datasource' && node.data.connectionId === result.source.id);
      const provenance = lineagePatch(bound ? [bound.id] : [], { engine: 'sql', sql: result.sql, rowsOut: result.rowCount }, { columns: result.columns, producedAt: fetchedAt });
      const numeric = result.columns.find((column) => result.rows.some((row) => typeof row[column] === 'number'));

      const fields: Record<string, unknown> = materializeAs === 'chart'
        ? {
          title, chartTitle: title, status: 'Live',
          xAxisLabel: result.columns[0] ?? '', yAxisLabel: numeric ?? '',
          chartLabels: result.rows.map((row) => String(row[result.columns[0] ?? ''] ?? '')),
          chartValues: result.rows.map((row) => Number(row[numeric ?? ''] ?? 0)),
          summary: `${result.rowCount.toLocaleString()} rows from ${result.source.name}.`,
        }
        : materializeAs === 'kpi'
          ? {
            title, value: String(Object.values(result.rows[0] ?? {})[0] ?? ''), status: 'Live',
            summary: `Read from ${result.source.name}.`,
          }
          : {
            title, columns: result.columns, rows: result.rows, rowCount: result.rowCount,
            sampleRows: result.rows.slice(0, 8),
            status: `${result.rowCount.toLocaleString()} rows`,
            summary: `${result.rowCount.toLocaleString()} rows from ${result.source.name}.`,
            ...(materializeAs === 'dataset' ? { profile: profileTabular({ columns: result.columns, rows: result.rows }) } : {}),
          };

      const node = newNode(materializeAs, nextCanvasObjectPosition(all, bound ? { x: bound.position.x + 460, y: bound.position.y + 300 } : {}, typeof window !== 'undefined' && window.innerWidth <= 760, materializeAs));
      node.data = { ...node.data, ...sanitizeCreationObjectPatch(materializeAs, { ...fields, ...provenance, fetchedAt }) };
      if (materializeAs === 'table' || materializeAs === 'dataset') node.style = { width: 720, height: 460 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add ${materializeAs} “${title}”`, node });
      if (bound) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Queried ${bound.data.title}`, edge: { id: crypto.randomUUID(), source: bound.id, target: node.id, type: 'smoothstep', animated: true, label: 'query', data: { connectionKind: 'data' } } });
      }
      return { ...payload, proposed: true, materialized: { id: node.id, kind: materializeAs, title } };
    },
  }, {
    /**
     * The whole point of "show me my inbox on the canvas".
     *
     * A dedicated action rather than `canvas_add_object` with hand-authored
     * fields, because a model cannot invent someone's real mail: this READS the
     * connected mailbox and puts what is actually there on the board. It also
     * stores the `filter` alongside the messages, which is what makes the tile a
     * live, reproducible view rather than a one-off screenshot — `canvas_refresh_inbox`
     * re-runs exactly the same query later.
     */
    name: 'canvas_add_inbox',
    description: 'Put a LIVE INBOX from a connected Microsoft 365 or Gmail mailbox onto the canvas, optionally filtered. Use this whenever the user asks to see, show, display, review or triage their email or inbox — it reads their real mailbox rather than inventing messages. Filters combine: query (free text), from, subject, unreadOnly, hasAttachments, after/before (ISO dates). The filter is saved with the tile, so it can be refreshed later and still mean the same thing. Name the mailbox with accountEmail when the workspace has more than one connected.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        accountEmail: { type: 'string', description: 'Which connected mailbox. Omit when exactly one is connected.' },
        title: { type: 'string', description: 'Tile title, e.g. "Unread from Acme". Defaults to a description of the filter.' },
        query: { type: 'string', description: 'Free-text search across subject, body and participants.' },
        from: { type: 'string', description: 'Match the sender address.' },
        subject: { type: 'string', description: 'Match the subject line.' },
        unreadOnly: { type: 'boolean' },
        hasAttachments: { type: 'boolean' },
        after: { type: 'string', description: 'ISO instant — only mail received at or after this.' },
        before: { type: 'string', description: 'ISO instant — only mail received before this.' },
        limit: { type: 'number', description: 'Up to 100. Defaults to 25.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as {
        accountEmail?: string; title?: string; query?: string; from?: string; subject?: string;
        unreadOnly?: boolean; hasAttachments?: boolean; after?: string; before?: string;
        limit?: number; x?: number; y?: number;
      };
      const { connections } = await mailboxApi.listConnections().catch(() => ({ connections: [] }));
      const resolved = resolveMailboxConnection(connections, { accountEmail: args.accountEmail ?? null });
      if (!resolved.ok) {
        // Actionable rather than a bare failure: the user has to leave the
        // canvas to fix this, so say where to go.
        return { error: `${resolved.error} Connect one in Growth → Mailboxes.` };
      }

      const filter = {
        q: args.query, from: args.from, subject: args.subject,
        unread: args.unreadOnly, hasAttachments: args.hasAttachments,
        after: args.after, before: args.before, limit: args.limit,
      };
      let read: Awaited<ReturnType<typeof mailboxApi.listMessages>>;
      try {
        read = await mailboxApi.listMessages(resolved.connection.id, filter);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That mailbox could not be read.' };
      }

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode('inbox', nextCanvasObjectPosition([...nodes, ...stagedNodes], args, narrowViewport, 'inbox'));
      const unreadCount = read.triage.filter((m) => m.unread).length;
      node.data = {
        ...node.data,
        title: args.title?.trim().slice(0, 160) || read.accountEmail,
        subtitle: describeMailboxFilter(filter),
        status: `${read.triage.length} message${read.triage.length === 1 ? '' : 's'}`,
        connectionId: resolved.connection.id,
        accountEmail: read.accountEmail,
        provider: read.provider,
        filter,
        // The TRIAGE projection, not the full messages: a canvas node's data is
        // persisted with the session AND fed to Brain's snapshot, and 25 full
        // emails would bloat both.
        messages: read.triage,
        unreadCount,
        fetchedAt: new Date().toISOString(),
      };
      node.style = { width: 460, height: 520 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add inbox “${node.data.title}”`, node });
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'inbox', title: node.data.title },
        accountEmail: read.accountEmail,
        total: read.triage.length,
        unread: unreadCount,
        messages: read.triage,
      };
    },
  }, {
    name: 'canvas_refresh_inbox',
    description: 'Re-read a mailbox already on the canvas, using the filter that tile was created with, and return what is there now. Use this when asked to refresh, re-check or "look again at" an inbox on the board — it updates the tile in place rather than adding a second one.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'The inbox object. Omit when the canvas holds exactly one.' } },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const objectId = (raw as { objectId?: string }).objectId;
      const inboxes = nodes.filter((node) => node.data.kind === 'inbox');
      const target = objectId ? inboxes.find((node) => node.id === objectId) : inboxes.length === 1 ? inboxes[0] : undefined;
      if (!target) {
        return { error: inboxes.length ? 'Say which inbox to refresh.' : 'There is no inbox on this canvas yet.' };
      }
      const connectionId = Number(target.data.connectionId);
      if (!Number.isInteger(connectionId)) return { error: 'That inbox is not bound to a connected mailbox.' };

      let read: Awaited<ReturnType<typeof mailboxApi.listMessages>>;
      try {
        read = await mailboxApi.listMessages(connectionId, (target.data.filter as MailboxFilter) ?? {});
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That mailbox could not be read.' };
      }
      const unreadCount = read.triage.filter((m) => m.unread).length;
      const patch = {
        messages: read.triage,
        unreadCount,
        fetchedAt: new Date().toISOString(),
        status: `${read.triage.length} message${read.triage.length === 1 ? '' : 's'}`,
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Refresh inbox ${target.id}`, objectId: target.id, patch });
      return { ok: true, proposed: true, objectId: target.id, total: read.triage.length, unread: unreadCount, messages: read.triage };
    },
  }, {
    /** Lifting one message out of a live view is what makes it durable: an
     *  `email` object stops changing, so it can be annotated and connected to a
     *  task and will still be there after the inbox has moved on. */
    name: 'canvas_pin_email',
    description: 'Pin ONE message from an inbox on the canvas as its own object, and read it in full while doing so. Use this when a specific email needs to be discussed, annotated, or connected to a task — unlike the live inbox tile, a pinned email does not change when the mailbox does.',
    parameters: {
      type: 'object', required: ['messageId'], additionalProperties: false,
      properties: {
        messageId: { type: 'string', description: 'The message id, as listed by the inbox tile.' },
        objectId: { type: 'string', description: 'Which inbox it came from. Omit when the canvas holds exactly one.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { messageId?: string; objectId?: string };
      const inboxes = nodes.filter((node) => node.data.kind === 'inbox');
      const source = args.objectId ? inboxes.find((node) => node.id === args.objectId) : inboxes.length === 1 ? inboxes[0] : undefined;
      if (!source) return { error: inboxes.length ? 'Say which inbox the message is in.' : 'There is no inbox on this canvas yet.' };
      const connectionId = Number(source.data.connectionId);
      if (!Number.isInteger(connectionId) || !args.messageId) return { error: 'That inbox is not bound to a connected mailbox.' };

      let message: Awaited<ReturnType<typeof mailboxApi.getMessage>>;
      try {
        message = await mailboxApi.getMessage(connectionId, args.messageId);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That message could not be read.' };
      }

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const node = newNode('email', nextCanvasObjectPosition(
        [...nodes, ...stagedNodes],
        { x: source.position.x + 500, y: source.position.y },
        typeof window !== 'undefined' && window.innerWidth <= 760,
        'email',
      ));
      node.data = {
        ...node.data,
        title: message.subject,
        subtitle: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
        status: new Date(message.receivedAtISO).toLocaleString(),
        messageId: message.id,
        connectionId,
        accountEmail: source.data.accountEmail,
        from: message.from, fromName: message.fromName, to: message.to,
        subject: message.subject, receivedAt: message.receivedAtISO,
        bodyText: message.bodyText, unread: message.unread,
        hasAttachments: message.hasAttachments, webUrl: message.webUrl,
      };
      node.style = { width: 460, height: 420 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Pin email “${message.subject}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Connect ${source.data.title} to ${message.subject}`, edge: { id: crypto.randomUUID(), source: source.id, target: node.id, type: 'smoothstep', animated: false, label: 'pinned from', data: { connectionKind: 'reference' } } });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'email', title: message.subject }, message };
    },
  }, {
    /**
     * "Connect all my social accounts" — the FIRST thing anyone asks for, and until
     * now the one thing the social vocabulary could not answer.
     *
     * Every other social tool assumes accounts already exist. Asked to connect them,
     * the model had nothing to call and improvised (2026-08-15, see the note in
     * `@builderforce/creation-canvas-contract`): it told the user to go and connect
     * their accounts to "a social media management platform" — while sitting inside
     * one, one rail icon away from the panel that does it.
     *
     * It does NOT take credentials. A token typed into a chat message is a token
     * written into the conversation, the timeline, the diagnostics report and the
     * model's context; the connect form is where a secret belongs, and this opens it.
     * What the tool returns is the thing the model actually lacked — which networks
     * exist, which are already connected, and exactly what each still needs — so the
     * reply is a specific instruction rather than a suggestion to look around.
     */
    name: 'canvas_connect_social_account',
    description: 'Open the social panel on this canvas so the user can CONNECT their X, LinkedIn, Facebook Pages, Instagram or TikTok account, and return which networks are available, which are already connected, and what each one still needs before it can publish. Call this whenever the user asks to connect, link, add, hook up or authorise their social accounts, and whenever another social tool reports that no account is connected. This does not ask you for credentials and you must never request a password, token or API key in chat — the panel collects them securely. Relay the returned per-network requirements verbatim.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { network: { type: 'string', description: 'Highlight one network: x, linkedin, facebook, instagram or tiktok. Omit to show them all.' } },
    },
    mutates: false,
    run: async (raw: unknown) => {
      const gated = socialAccountGate('canvas_connect_social_account');
      if (gated) return gated;
      const wanted = (raw as { network?: string }).network;
      let networks: Awaited<ReturnType<typeof socialApi.networks>>;
      let accounts: Awaited<ReturnType<typeof socialApi.accounts>>;
      try {
        [networks, accounts] = await Promise.all([socialApi.networks(), socialApi.accounts()]);
      } catch (error) {
        return { error: error instanceof Error ? error.message : tSocial('loadFailed') };
      }
      // Opening the panel IS the action — the tool has done its work by the time the
      // model reads this, which is why it reports `opened` rather than proposing a
      // change the user would have to approve before anything appeared.
      setDockPanel('social');
      const listed = networks.networks.filter((option) => !isSocialNetworkName(wanted) || option.network === wanted);
      return {
        ok: true,
        opened: true,
        instruction: 'The social panel is open on this canvas, on its Accounts tab. Tell the user to pick their network there and complete the connect form — never ask them for a credential in chat.',
        networks: listed.map((option) => ({
          network: option.network,
          label: option.label,
          connected: option.connectedCount,
          publishMode: option.publishMode,
          // The non-secret ids three networks cannot post without. Naming them up
          // front is what stops a connection that looks fine from failing at publish.
          alsoNeeds: option.accountFields.map((field) => `${field.label} — ${field.help}`),
        })),
        connected: accounts.accounts.map((account) => ({
          network: account.network,
          name: account.name,
          ready: account.ready,
          missing: account.missingFields.map((field) => field.label),
        })),
      };
    },
  }, {
    /**
     * "Show me our social feed" — the whole point of a connected account on the board.
     *
     * A dedicated action rather than `canvas_add_object` with authored fields, for the
     * same reason `canvas_add_inbox` is: a model cannot invent what a company actually
     * posted or how it performed. This READS the connected accounts and puts what is
     * really there on the board, and it stores the FILTER alongside the posts, which is
     * what makes the tile a live, reproducible view rather than a screenshot.
     */
    name: 'canvas_add_social_feed',
    description: 'Put a LIVE SOCIAL FEED from the workspace\'s connected accounts (X, LinkedIn, Facebook, Instagram, TikTok) onto the canvas, merged newest-first with real engagement numbers. Use this whenever the user asks to see, show, review or analyse their social media, posts, or channel performance — it reads their real accounts rather than inventing posts. Narrow with networks (e.g. ["x","linkedin"]) or query (free text). The filter is saved with the tile so it can be refreshed later and still mean the same thing.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        networks: { type: 'array', items: { type: 'string' }, description: 'Restrict to these networks: x, linkedin, facebook, instagram, tiktok.' },
        title: { type: 'string', description: 'Tile title, e.g. "Launch week posts". Defaults to a description of the filter.' },
        query: { type: 'string', description: 'Free-text filter across post text and author.' },
        limit: { type: 'number', description: 'Up to 50. Defaults to 25.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_add_social_feed');
      if (gated) return gated;
      const args = raw as { networks?: string[]; title?: string; query?: string; limit?: number; x?: number; y?: number };
      const filter: SocialFeedFilter = {
        ...(Array.isArray(args.networks) && args.networks.length ? { networks: args.networks.filter(isSocialNetworkName) } : {}),
        ...(args.query ? { q: args.query } : {}),
        ...(args.limit ? { limit: args.limit } : {}),
      };
      const built = await buildSocialFeedNode(filter, {
        ...(args.title ? { title: args.title } : {}),
        ...(args.x != null ? { x: args.x } : {}),
        ...(args.y != null ? { y: args.y } : {}),
      });
      if (!built.ok) return { error: built.error };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add social feed “${built.node.data.title}”`, node: built.node });
      return {
        ok: true, proposed: true,
        object: { id: built.node.id, kind: 'socialFeed', title: built.node.data.title },
        accounts: built.read.accounts.map((account) => `${account.networkLabel} · ${account.name}`),
        total: built.read.items.length,
        engagement: totalEngagement(built.read.items),
        posts: built.read.items.map(socialPostProjection),
        ...(built.read.errors.length ? { accountErrors: built.read.errors } : {}),
      };
    },
  }, {
    name: 'canvas_refresh_social_feed',
    description: 'Re-read the social accounts behind a feed already on the canvas, using the filter that tile was created with, and return what is there now. Use this when asked to refresh, re-check or "look again at" a social feed on the board — it updates the tile in place rather than adding a second one.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'The social feed object. Omit when the canvas holds exactly one.' } },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_refresh_social_feed');
      if (gated) return gated;
      const objectId = (raw as { objectId?: string }).objectId;
      const feeds = nodes.filter((node) => node.data.kind === 'socialFeed');
      const target = objectId ? feeds.find((node) => node.id === objectId) : feeds.length === 1 ? feeds[0] : undefined;
      if (!target) return { error: feeds.length ? 'Say which social feed to refresh.' : 'There is no social feed on this canvas yet.' };

      let read: Awaited<ReturnType<typeof socialApi.feed>>;
      try {
        read = await socialApi.feed((target.data.filter as SocialFeedFilter) ?? {});
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Those accounts could not be read.' };
      }
      const patch = socialFeedPatch(read);
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Refresh social feed ${target.id}`, objectId: target.id, patch });
      return {
        ok: true, proposed: true, objectId: target.id,
        total: read.items.length, engagement: totalEngagement(read.items),
        posts: read.items.map(socialPostProjection),
        ...(read.errors.length ? { accountErrors: read.errors } : {}),
      };
    },
  }, {
    /** Lifting one post out of a live view is what makes it durable: a `socialPost`
     *  object stops changing, so it can be annotated, connected to a task, and
     *  compared against whatever was published after it. */
    name: 'canvas_pin_social_post',
    description: 'Pin ONE post from a social feed on the canvas as its own object, with its text, media and engagement at the time it was read. Use this when a specific post needs to be discussed, annotated, or connected to work — unlike the live feed tile, a pinned post does not change when the account does.',
    parameters: {
      type: 'object', required: ['postId'], additionalProperties: false,
      properties: {
        postId: { type: 'string', description: 'The post id, as listed by the feed tile.' },
        objectId: { type: 'string', description: 'Which feed it came from. Omit when the canvas holds exactly one.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { postId?: string; objectId?: string };
      const feeds = nodes.filter((node) => node.data.kind === 'socialFeed');
      const source = args.objectId ? feeds.find((node) => node.id === args.objectId) : feeds.length === 1 ? feeds[0] : undefined;
      if (!source) return { error: feeds.length ? 'Say which social feed the post is in.' : 'There is no social feed on this canvas yet.' };

      const posts = (Array.isArray(source.data.posts) ? source.data.posts : []) as SocialFeedItem[];
      const post = posts.find((item) => String(item.id) === String(args.postId));
      if (!post) return { error: 'That post is not in this feed — refresh it, or pin one of the posts it lists.' };

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const node = newNode('socialPost', nextCanvasObjectPosition(
        [...nodes, ...stagedNodes],
        { x: source.position.x + 500, y: source.position.y },
        typeof window !== 'undefined' && window.innerWidth <= 760,
        'socialPost',
      ));
      node.data = { ...node.data, ...socialPostNodeData(post) };
      node.style = { width: 420, height: 420 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Pin ${post.network} post`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Connect ${source.data.title} to the pinned post`, edge: { id: crypto.randomUUID(), source: source.id, target: node.id, type: 'smoothstep', animated: false, label: 'pinned from', data: { connectionKind: 'reference' } } });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'socialPost', title: node.data.title }, post: socialPostProjection(post) };
    },
  }, {
    /**
     * Drafting is separate from publishing, deliberately.
     *
     * A campaign object on the board is reviewable — its copy, its targets and its
     * blockers are visible — and `canvas_publish_social_campaign` is the single,
     * explicit act that makes it public. Collapsing the two would mean a model could
     * post to a company's channels as a side effect of being asked to "write" a post.
     */
    name: 'canvas_create_social_campaign',
    description: 'Draft a SOCIAL CAMPAIGN on the canvas — one announcement to be published to every connected account. This does NOT publish it; the tile shows the copy, each target account and any blockers, and canvas_publish_social_campaign is what makes it public. Use `variants` for per-network copy ({"x":"280 characters","linkedin":"a paragraph"}); an absent network falls back to `body`. Instagram cannot publish text alone: attach the picture with `mediaObjectIds` (canvas objects — the image this board already made) or `mediaUrls` (public https), or that account is skipped. Pass `scheduledAt` (ISO) to publish it later automatically.',
    parameters: {
      type: 'object', required: ['name', 'body'], additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Campaign name, for the board and the report.' },
        body: { type: 'string', description: 'The shared copy every network gets unless a variant overrides it.' },
        variants: { type: 'object', description: 'Per-network copy keyed by network id.' },
        linkUrl: { type: 'string', description: 'Destination URL appended to networks with no link field.' },
        mediaUrls: { type: 'array', items: { type: 'string' }, description: 'Public https image URLs the networks fetch themselves.' },
        mediaObjectIds: { type: 'array', items: { type: 'string' }, description: 'Canvas objects whose picture should be attached — an image, mockup, chart or drawing already on this board. Prefer this over mediaUrls for anything the canvas made: the picture is published to a public URL for you, which is what Instagram needs.' },
        networks: { type: 'array', items: { type: 'string' }, description: 'Restrict targets to these networks. Omit to target every ready account.' },
        scheduledAt: { type: 'string', description: 'ISO instant to publish at. Omit to leave it a draft.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_create_social_campaign');
      if (gated) return gated;
      const args = raw as {
        name?: string; body?: string; variants?: Record<string, string>; linkUrl?: string;
        mediaUrls?: string[]; mediaObjectIds?: string[]; networks?: string[]; scheduledAt?: string; x?: number; y?: number;
      };
      let accounts: Awaited<ReturnType<typeof socialApi.accounts>>;
      try {
        accounts = await socialApi.accounts();
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'The connected accounts could not be read.' };
      }
      const wanted = (args.networks ?? []).filter(isSocialNetworkName);
      const targets = accounts.accounts
        .filter((account) => account.ready && (wanted.length === 0 || wanted.includes(account.network)))
        .map((account) => account.id);
      if (targets.length === 0) {
        // ACTIONABLE, AND IT OPENS THE THING IT NAMES. Telling a model in chat to "use
        // the social panel on this canvas" left the user hunting a rail icon for a
        // panel Brain could not reach — so this opens it, and names the tool that
        // would have opened it, rather than describing a destination.
        setDockPanel('social');
        return {
          error: accounts.accounts.length === 0
            ? 'No social account is connected to this workspace yet, so there is nothing to publish to. The social panel is now open on this canvas — connect X, LinkedIn, Facebook, Instagram or TikTok there, or call canvas_connect_social_account to list what each one needs. Say that in one sentence, and author the campaign copy on the board now so it is ready the moment an account is connected.'
            : `Connected accounts exist but none is ready to publish: ${accounts.accounts.map((account) => `${account.networkLabel} · ${account.name} needs ${account.missingFields.map((field) => field.label).join(', ') || 'setup'}`).join('; ')}. The social panel is now open — those fields are filled in on the connection itself. Relay exactly which field is missing on which account; do not describe this as the product being unable to post.`,
          accounts: accounts.accounts.map((account) => ({
            network: account.network, name: account.name, ready: account.ready,
            missing: account.missingFields.map((field) => field.label),
          })),
        };
      }

      // THE PICTURE THE BOARD ALREADY MADE, MADE FETCHABLE.
      //
      // Instagram does not receive media, it FETCHES it — with no session — so a
      // campaign carrying the `data:` URI a generated image lives in was a target
      // silently `skipped` with a blocker nobody could clear from the canvas. Both
      // named objects and hand-passed urls go through the SAME resolver the social
      // panel uses, so a campaign a model drafts and one a person composes attach
      // the identical URL.
      const mediaSources = [
        ...(args.mediaObjectIds ?? []).map((id) => {
          const node = nodes.find((candidate) => candidate.id === id)
            ?? proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []).find((candidate) => candidate.id === id);
          return node ? canvasMediaSource(node.data) : null;
        }),
        ...(Array.isArray(args.mediaUrls) ? args.mediaUrls.map(String) : []),
      ].filter((value): value is string => !!value);
      const missingObjects = (args.mediaObjectIds ?? []).filter((id) => {
        const node = nodes.find((candidate) => candidate.id === id);
        return !node || !canvasMediaSource(node.data);
      });
      const media = await resolvePublicMediaUrls(mediaSources, { name: String(args.name ?? 'Campaign image') });

      let created: Awaited<ReturnType<typeof socialApi.createCampaign>>;
      try {
        created = await socialApi.createCampaign({
          name: String(args.name ?? '').trim(),
          body: String(args.body ?? '').trim(),
          connectionIds: targets,
          ...(args.variants ? { variants: args.variants as Partial<Record<SocialNetwork, string>> } : {}),
          ...(args.linkUrl ? { linkUrl: args.linkUrl } : {}),
          ...(media.urls.length ? { mediaUrls: media.urls } : {}),
          ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
          // ONLY A SAVED SESSION. `social_campaigns.session_id` is a uuid FK to
          // `creation_sessions`, and an unsaved board's id is the literal string
          // `local-<uuid>` — so sending it unconditionally made every campaign drafted
          // from an unsaved board fail at the database with an error the user reads as
          // "posting is broken". The link is what rolls delivery up into this board's
          // outcome ledger; a board that has no row cannot be in it, and drafting the
          // campaign matters more than the rollup.
          ...(persistence === 'server' && sessionId ? { sessionId } : {}),
        });
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That campaign could not be drafted.' };
      }

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const node = newNode('socialCampaign', nextCanvasObjectPosition(
        [...nodes, ...stagedNodes], args, typeof window !== 'undefined' && window.innerWidth <= 760, 'socialCampaign',
      ));
      node.data = { ...node.data, ...socialCampaignNodeData(created.campaign) };
      node.style = { width: 440, height: 460 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add social campaign “${created.campaign.name}”`, node });
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'socialCampaign', title: created.campaign.name },
        campaignId: created.campaign.id,
        targets: created.campaign.targets,
        accounts: created.campaign.posts.map((post) => `${post.network} · ${post.accountName}`),
        blockers: created.campaign.blockers,
        scheduled: created.campaign.scheduledAtISO,
        ...(media.urls.length ? { mediaUrls: media.urls } : {}),
        // Reported rather than thrown: one unusable picture must not lose the
        // campaign, and the model has to be able to say WHICH one and why —
        // "Instagram was skipped" with no reason is the answer this replaces.
        ...(media.problems.length ? { mediaProblems: media.problems } : {}),
        ...(missingObjects.length ? { mediaObjectsWithoutPictures: missingObjects } : {}),
      };
    },
  }, {
    name: 'canvas_publish_social_campaign',
    description: 'PUBLISH a social campaign that is on the canvas to every account it targets. THIS IS PUBLIC AND CANNOT BE UNDONE — confirm with the user before calling it, and never call it to "test" a campaign. Each account is published at most once, so a retry is safe; networks that need media and have none are skipped rather than failed. The tile updates in place with each account\'s outcome and permalink.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'The social campaign object. Omit when the canvas holds exactly one.' } },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_publish_social_campaign');
      if (gated) return gated;
      const objectId = (raw as { objectId?: string }).objectId;
      const campaigns = nodes.filter((node) => node.data.kind === 'socialCampaign');
      const target = objectId ? campaigns.find((node) => node.id === objectId) : campaigns.length === 1 ? campaigns[0] : undefined;
      if (!target) return { error: campaigns.length ? 'Say which social campaign to publish.' : 'There is no social campaign on this canvas yet.' };
      const campaignId = Number(target.data.campaignId);
      if (!Number.isInteger(campaignId)) return { error: 'That campaign tile is not bound to a saved campaign.' };

      let batch: Awaited<ReturnType<typeof socialApi.publishCampaign>>;
      try {
        batch = await socialApi.publishCampaign(campaignId);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'That campaign could not be published.' };
      }
      if (batch.campaign) {
        proposalBuffer.current.push({
          id: crypto.randomUUID(), type: 'object.update',
          label: `Publish social campaign ${target.id}`, objectId: target.id,
          patch: socialCampaignNodeData(batch.campaign),
        });
      }
      return {
        ok: true, proposed: true, objectId: target.id,
        published: batch.published, failed: batch.failed, skipped: batch.skipped,
        remaining: batch.remaining, status: batch.status, results: batch.results,
      };
    },
  }, {
    /**
     * The diagnostics catalog, on the board (PRD 21 §11.4.5).
     *
     * `/tools/<id>` is the REFERENCE page for a diagnostic — where you read what
     * it measures. This pair is where you USE it: the capability reaches the
     * canvas as a tool Brain can call, not as a canvas mounted on a marketing
     * URL, which is what it used to be.
     *
     * Listed separately from `canvas_add_diagnostic` for the reason
     * `creative.capabilities` is separate from `creative.compose`: a model that
     * has to guess an id before it can see the catalog guesses, and a wrong
     * `toolId` is a 404 the user reads as "the diagnostic does not exist".
     */
    name: 'canvas_list_diagnostics',
    description: 'List the free diagnostics and calculators this platform can run (id, name, what it measures, whether it is a calculator/assessment/quiz, and whether it also has a data-driven mode). Call this BEFORE canvas_add_diagnostic whenever the exact diagnostic id is not already known — for "what can you assess?", "estimate my AI spend", "how mature is our delivery?", "check our DORA metrics", "governance readiness".',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    mutates: false,
    run: async () => {
      try {
        const catalog = await toolsApi.list();
        return { diagnostics: catalog.map((entry) => ({
          id: entry.id, name: entry.name, about: entry.tagline,
          category: entry.category, kind: entry.kind, hasDataDriven: entry.hasDataDriven === true,
          referencePage: `/tools/${entry.id}`,
        })) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'The diagnostics catalog could not be read.' };
      }
    },
  }, {
    name: 'canvas_add_diagnostic',
    description: 'Put a diagnostic or calculator on the canvas as a live object the user can answer in place. Pass `answers` (question id → number, as listed by this tool when called without them) to ALSO compute the result and land the object already scored. Use this for "add the AI cost estimator", "run the maturity assessment on the board", "score our delivery". Get the id from canvas_list_diagnostics first.',
    parameters: {
      type: 'object', required: ['toolId'], additionalProperties: false,
      properties: {
        toolId: { type: 'string', description: 'Catalog id, e.g. from canvas_list_diagnostics.' },
        answers: { type: 'object', description: 'Question/input id → numeric answer. Omit to place an unanswered object for the user to fill in.', additionalProperties: { type: 'number' } },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { toolId?: string; answers?: Record<string, unknown>; x?: number; y?: number };
      const toolId = typeof args.toolId === 'string' ? args.toolId.trim() : '';
      if (!toolId) return { error: 'Say which diagnostic. Call canvas_list_diagnostics for the ids.' };

      let definition: Awaited<ReturnType<typeof toolsApi.get>>;
      try {
        definition = await toolsApi.get(toolId);
      } catch {
        const catalog = await toolsApi.list().catch(() => []);
        return { error: catalog.length
          ? `No diagnostic '${toolId}'. Available: ${catalog.map((entry) => entry.id).join(', ')}.`
          : `No diagnostic '${toolId}'.` };
      }

      // Only the questions this diagnostic actually has: a model that invents an
      // extra key would otherwise get a result scored against a shape the tool
      // does not define, which is a number that looks computed and is not.
      const accepted = new Set(questionIds(definition));
      const answers: Record<string, number> = {};
      for (const [key, value] of Object.entries(args.answers ?? {})) {
        if (accepted.has(key) && Number.isFinite(Number(value))) answers[key] = Number(value);
      }
      const input = Object.keys(answers).length ? { ...defaultInput(definition), ...answers } : {};
      const complete = Object.keys(answers).length > 0 && answersComplete(definition, input);

      let result: ToolResult | null = null;
      if (complete) {
        try {
          result = await toolsApi.compute(toolId, input);
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'That diagnostic could not be scored.' };
        }
      }

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode('diagnostics', nextCanvasObjectPosition([...nodes, ...stagedNodes], args, narrowViewport, 'diagnostics'));
      node.data = {
        ...node.data,
        title: definition.name,
        subtitle: definition.about,
        toolId,
        toolIcon: definition.icon,
        toolInput: input,
        ...(result ? {
          toolResult: result, result,
          status: result.scoreLabel || result.headline,
          qualityScore: result.score, qualityLabel: result.scoreLabel, qualityHeadline: result.headline,
          summary: result.summary,
          recommendations: result.recommendations,
          results: result.metrics.map((metric) => ({ title: metric.label, result: metric.value, detail: metric.hint })),
          gapCount: result.recommendations.length,
        } : { status: 'Ready to run' }),
      };
      node.style = { width: 760 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add diagnostic “${definition.name}”`, node });
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'diagnostics', title: definition.name },
        toolId, kind: definition.kind, referencePage: `/tools/${toolId}`,
        // Unanswered, the model needs the question ids to be able to offer to
        // fill them in; answered, it needs the score to be able to talk about it.
        ...(result ? { result } : { questions: [...accepted], awaitingAnswers: true }),
      };
    },
  }, {
    name: 'canvas_add_image',
    description: 'Find or create an actual image and put the finished image on the Canvas. ALWAYS use this instead of canvas_add_object for an image request. Use mode="generate" for create/draw/generate/make requests, mode="find" for find/search/stock/photo requests, and mode="auto" only when the user did not express a preference.',
    parameters: {
      type: 'object', required: ['query', 'mode'], additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'The complete visual search query or generation prompt.' },
        mode: { type: 'string', enum: ['find', 'generate', 'auto'] },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      // ADVERTISED ON EVERY BOARD, EXECUTED WITH ANY ACCOUNT. Stripping this tool from
      // an anonymous canvas removed the only route to pixels, and a model cannot report
      // a tool it was never given — it improvises. See the guest-gated set in
      // `@builderforce/creation-canvas-contract`. Gated on CREDENTIALS, not on whether
      // the board is saved: search and generation are stateless posts that carry the
      // tenant token, so a signed-in user on an unsaved board gets real pixels. Read the
      // token here rather than closing over `hasAccount`, so a sign-in mid-session is
      // reflected on the very next call instead of on the next memo rebuild.
      if (!getStoredTenantToken()) {
        requireAccount('image', t('gateImageTitle'), t('gateImageBody'));
        return accountGateResult(CANVAS_IMAGE_TOOL, CANVAS_IMAGE_ACCOUNT_GATE);
      }
      const args = raw as { query?: string; mode?: CanvasImageResolveMode; title?: string; x?: number; y?: number };
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 2_000) : '';
      const mode = args.mode === 'find' || args.mode === 'generate' || args.mode === 'auto' ? args.mode : null;
      if (!query || !mode) return { error: 'Pass an image query and mode (find, generate, or auto)' };
      try {
        const asset = await resolveCanvasImage(query, mode);
        const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
        const node = newNode('image', nextCanvasObjectPosition([...nodes, ...stagedNodes], args, typeof window !== 'undefined' && window.innerWidth <= 760, 'image'));
        const imageTitle = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : query.slice(0, 80);
        const mimeType = asset.url.startsWith('data:image/png') || /\.png(?:$|[?#])/i.test(asset.url) ? 'image/png'
          : /\.webp(?:$|[?#])/i.test(asset.url) ? 'image/webp' : 'image/jpeg';
        const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
        const delivered: CreationDeliverable = {
          id: crypto.randomUUID(), action: asset.source === 'stock' ? 'find' : 'generate', artifactKind: 'image',
          status: 'delivered', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
          url: asset.url, mimeType, fileName: `${safeDownloadName(imageTitle)}.${extension}`, provider: asset.provider,
          validation: { status: 'passed', detail: asset.source === 'stock' ? t('imageFoundValidation', { provider: asset.licence ?? asset.provider }) : t('imageGeneratedValidation') },
          metadata: { source: asset.source, ...(asset.model ? { model: asset.model } : {}) },
        };
        node.data = {
          ...node.data,
          title: imageTitle,
          subtitle: asset.source === 'stock' ? `${asset.licence ?? asset.provider}${asset.author ? ` · ${asset.author}` : ''}` : query,
          status: asset.source === 'stock' ? t('imageFoundStatus') : t('creativeGeneratedStatus'),
          prompt: query,
          outputUrl: asset.url,
          thumbnailUrl: asset.thumbnailUrl,
          outputFormat: 'Image',
          outputFileName: delivered.fileName,
          outputMimeType: mimeType,
          provider: asset.provider,
          ...(asset.model ? { model: asset.model } : {}),
          ...(asset.width ? { imageWidth: asset.width } : {}),
          ...(asset.height ? { imageHeight: asset.height } : {}),
          imageSource: asset.source,
          imageLicence: asset.licence,
          imageAuthor: asset.author,
          imageAuthorUrl: asset.authorUrl,
          deliverables: withCreationDeliverable(node.data, delivered),
        };
        node.style = { width: 520, height: 430 };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t(asset.source === 'stock' ? 'imageFoundProposal' : 'imageGeneratedProposal', { title: node.data.title }), node });
        return { ok: true, proposed: true, object: { id: node.id, kind: 'image', title: node.data.title }, source: asset.source, provider: asset.provider, imageUrl: asset.url };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'The image could not be resolved' };
      }
    },
  }, {
    name: CANVAS_GAME_TOOL,
    description: 'Write a PLAYABLE game and put it on the Canvas, finished. ALWAYS use this instead of canvas_add_object for any request to make, build, create or design a game — including "a Roblox game", "a game for my phone", "an Android game" or "an iPhone game". It authors the game AND attaches the playable artifact in one call, so the user can press play immediately. A game design document is NOT a game: never write the concept into a `game` object as prose and never present a design as if it were playable. Use platform "roblox" when the user names Roblox, Studio, or an experience; otherwise use platform "web" — one self-contained document that plays on the canvas, installs on an Android or iPhone home screen, and wraps into a real app, so a phone or app-store request is still platform "web".',
    parameters: {
      type: 'object', required: ['brief', 'platform'], additionalProperties: false,
      properties: {
        brief: { type: 'string', description: 'What the game IS: the goal, the rules, how it is controlled, how you win or lose. Concrete and specific — this is the only description the generator gets.' },
        platform: { type: 'string', enum: [...GAME_PLATFORMS] },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { brief?: string; platform?: string; title?: string; x?: number; y?: number };
      const brief = typeof args.brief === 'string' ? args.brief.trim().slice(0, 4_000) : '';
      const platform = isGamePlatform(args.platform) ? args.platform : null;
      if (!brief || !platform) return { error: `Pass a brief and a platform (${GAME_PLATFORMS.join(' or ')})` };

      // Gated on CREDENTIALS and only for Roblox, read at call time so a sign-in
      // mid-session counts on the very next turn — the same rule as the image
      // tool. A WEB game is authored in this browser and needs no account, so
      // gating the whole tool would be a false limitation.
      if (platform === 'roblox' && !getStoredTenantToken()) {
        requireAccount('game', t('game.gateTitle'), t('game.gateBody'));
        return accountGateResult(CANVAS_GAME_TOOL, CANVAS_GAME_ACCOUNT_GATE);
      }

      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const node = newNode('game', nextCanvasObjectPosition([...nodes, ...stagedNodes], args, typeof window !== 'undefined' && window.innerWidth <= 760, 'game'));
      const gameTitle = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : brief.slice(0, 60);
      const seed: CreationNodeData = { ...node.data, kind: 'game', title: gameTitle, prompt: brief, gamePlatform: platform };

      // The whole point of this tool: GENERATE, then attach. A game object that
      // reaches the board without an artifact is the bug this replaces.
      let artifact: CreativeArtifact;
      try {
        artifact = getStoredTenantToken()
          ? await generateServerCreativeArtifact(seed)
          : { ...buildBrowserCreativeArtifact(seed), provider: 'builderforce-browser' };
      } catch (error) {
        // Roblox has no browser baseline — a place cannot be authored without a
        // model — so its failure is reported rather than quietly downgraded into
        // an HTML game the user did not ask for.
        if (platform === 'roblox') {
          return { error: error instanceof Error ? error.message : 'The Roblox place could not be generated' };
        }
        artifact = { ...buildBrowserCreativeArtifact(seed), provider: 'builderforce-browser' };
      }

      const delivered: CreationDeliverable = {
        id: crypto.randomUUID(), action: 'generate', artifactKind: artifact.artifactKind,
        status: 'delivered', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        url: artifact.url, mimeType: artifact.mimeType, fileName: artifact.fileName, provider: artifact.provider,
        validation: { status: 'passed', detail: artifact.validationDetail },
        metadata: { outputFormat: artifact.outputFormat, platform, ...(artifact.model ? { model: artifact.model } : {}) },
      };
      node.data = {
        ...seed,
        status: t('creativeGeneratedStatus'),
        ...(artifact.summary ? { subtitle: artifact.summary } : { subtitle: brief.slice(0, 160) }),
        outputUrl: artifact.url,
        outputFormat: artifact.outputFormat,
        outputFileName: artifact.fileName,
        outputMimeType: artifact.mimeType,
        provider: artifact.provider,
        thumbnailUrl: artifact.previewImageUrl ?? '',
        deliverables: withCreationDeliverable(node.data, delivered),
      };
      node.style = { width: 520, height: 470 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: t('game.proposal', { title: gameTitle }), node });
      return {
        ok: true, proposed: true, playable: true,
        object: { id: node.id, kind: 'game', title: gameTitle }, platform,
        provider: artifact.provider, outputFormat: artifact.outputFormat,
        instruction: platform === 'roblox'
          ? 'The place is on the board and downloadable as a .rbxlx — say it opens in Roblox Studio and plays there. Do NOT restate the design as prose.'
          : 'The game is on the board and plays immediately — say so in one line. Do NOT restate the design as prose.',
      };
    },
  }, {
    name: 'canvas_add_object',
    description: `Create a fully authored visual object. For an actual image, NEVER use this tool; use canvas_add_image so pixels are found or generated and attached immediately. Put type-specific content in fields; supported fields depend on kind and are listed in the current canvas snapshot. Never send placeholder or schema-probe fields. For kind="course", author the curriculum in the FIRST call as fields.course = ${COURSE_AUTHORING_CONTRACT}. Never author rows or chart values by hand from an imported dataset — use canvas_query_dataset so the artifact holds real computed values. For kind="spreadsheet", a derived column is a FORMULA and never a column of typed numbers: ${sheetFormulaGuidance(FORMULA_FUNCTIONS)} ${approvalGuidance()}`,
    parameters: {
      type: 'object', required: ['kind'], additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: CREATION_OBJECT_REGISTRY.map((definition) => definition.kind) },
        title: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' },
        fields: { type: 'object', description: 'Type-specific authored content. Unknown or sensitive fields are rejected. Website and prototype objects require complete WYSIWYG pages and an authored theme; never create a titled shell. For courses, course must match the declared nested schema. For guidedTour objects, author the complete reusable onboarding contract in tour.', properties: { course: COURSE_AUTHORING_SCHEMA, tour: GUIDED_TOUR_AUTHORING_SCHEMA, pages: WEBSITE_PAGES_SCHEMA, websiteTheme: WEBSITE_THEME_SCHEMA }, additionalProperties: true },
        x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { kind?: CreationObjectKind; title?: string; subtitle?: string; status?: string; fields?: unknown; x?: number; y?: number; width?: number; height?: number };
      const allowed = new Set(CREATION_OBJECT_REGISTRY.map((definition) => definition.kind));
      if (!args.kind || !allowed.has(args.kind)) return { error: 'Unsupported canvas object kind' };
      const updateTarget = duplicateAddUpdateTarget(prompt, args.kind, nodes, effectiveSelectedIds);
      if (updateTarget) return { error: `This is a correction to selected ${args.kind} ${updateTarget.id}. Call canvas_update_object for that object instead of creating a duplicate.` };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode(args.kind, nextCanvasObjectPosition([...nodes, ...stagedNodes], args, narrowViewport, args.kind));
      if (args.kind === 'guidedTour') node.data = { ...node.data, ...localizedTourDefaults() };
      let authored = sanitizeCreationObjectPatch(args.kind, { ...((args.fields && typeof args.fields === 'object') ? args.fields : {}), title: args.title, subtitle: args.subtitle, status: args.status });
      if (args.kind === 'resume') authored = initializeResumeFromPatch(typeof authored.title === 'string' ? authored.title : node.data.title, authored);
      // A REQUEST FOR PIXELS ROUTED HERE IS A MISROUTE, NOT A MALFORMED CALL.
      //
      // "draw me a coniferous landscape at <address>" arrives as kind "drawing" with no
      // points, or kind "image" with no pixels — both because those are the kinds whose
      // NAMES match the request. The old refusal described the drawing schema and
      // offered a chart instead; the model relayed it as "a technical limitation with
      // the drawing tool" and told the user the product cannot draw (2026-08-12, ui
      // 2026.7.213). Name the tool that would actually work. On an anonymous board it
      // is advertised and self-gating, so this redirect is correct on both surfaces.
      const wantsPixels = args.kind === 'image' && !authored.outputUrl;
      const emptyDrawing = args.kind === 'drawing' && (!Array.isArray(authored.points) || authored.points.length < 2);
      if (wantsPixels || emptyDrawing) return { error: canvasImageToolRedirect(args.kind) };
      // THE SAME MISROUTE, ONE KIND OVER, AND THE MOST EXPENSIVE ONE. A `game`
      // authored here is a brief with no artifact: generating the playable thing
      // is a separate step the model does not know to take. It reached the board
      // holding a four-thousand-word design document in `content` — which
      // satisfied the empty-shell gate (that gate NAMES `content` first, so it
      // actively teaches this mistake) and played nothing. Name the tool that
      // actually produces a game. See `canvasGameToolRedirect`.
      if (args.kind === 'game' && !authored.outputUrl) return { error: canvasGameToolRedirect() };
      // THE SAME MISROUTE, ONE DOMAIN OVER. A social feed, a pinned post and a campaign
      // are READ from connected accounts and from the server's publish ledger, so this
      // tool can only ever produce a convincing fake of one. Name the tool that reads
      // the real thing — see `canvasSocialToolRedirect` for the refusal this replaces,
      // which asked a model to hand-author a campaign id and a published count.
      const socialRedirect = canvasSocialToolRedirect(args.kind);
      if (socialRedirect) return { error: socialRedirect };
      // A Course seeds the worked "Build an LLM" sample so a human dragging one
      // out of the palette gets something real to read. That default is a TRAP
      // for a generated object: a course titled "Recruiting and Hiring" with no
      // authored `course` inherits the LLM curriculum verbatim, which reads as
      // the product having built the wrong subject rather than as a missing
      // argument. Refuse it and say what to send instead.
      if (args.kind === 'course' && !(authored.course as { modules?: unknown } | undefined)?.modules) {
        return { error: `A generated course must include the authored curriculum in fields.course as ${COURSE_AUTHORING_CONTRACT}. Without it the object would show the sample "Build an LLM" curriculum under your title.` };
      }
      if (args.kind === 'website' || args.kind === 'prototype') {
        const problem = authoredWebsiteProblem(authored);
        if (problem) return { error: `${problem} Do not create an empty website shell or rely on renderer defaults.` };
      }
      // The general form of the three rules above: an artifact whose only authored
      // field is its title is not a deliverable. Registry-driven, so every kind is
      // covered rather than the three that happened to get a bespoke branch.
      const shellProblem = emptyShellProblem(args.kind, authored as Record<string, unknown>);
      if (shellProblem) return { error: shellProblem };
      node.data = { ...node.data, ...authored, title: typeof authored.title === 'string' && authored.title.trim() ? authored.title.slice(0, 160) : node.data.title };
      const width = Number(args.width); const height = Number(args.height);
      if (Number.isFinite(width) || Number.isFinite(height)) node.style = { width: Number.isFinite(width) ? Math.max(240, Math.min(width, 2_400)) : undefined, height: Number.isFinite(height) ? Math.max(130, Math.min(height, 1_800)) : undefined };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add ${node.data.kind} “${node.data.title}”`, node });
      return { ok: true, proposed: true, object: { id: node.id, kind: node.data.kind, title: node.data.title }, mutableFields: creationObjectDefinition(args.kind).mutableFields };
    },
  }, {
    name: 'canvas_update_object',
    description: 'Author or revise any supported field of an existing canvas object. Read the snapshot first to learn its kind and mutableFields. For a resume, send the complete JSON Resume object in fields.resumeDocument when possible; the Canvas creates a derived revision and protects the uploaded original automatically.',
    parameters: { type: 'object', required: ['objectId', 'fields'], additionalProperties: false, properties: { objectId: { type: 'string' }, fields: { type: 'object', additionalProperties: true } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; fields?: unknown };
      const target = nodes.find((node) => node.id === args.objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === args.objectId)?.node;
      if (!args.objectId || !target) return { error: 'Object not found' };
      let patch = sanitizeCreationObjectPatch(target.data.kind, args.fields);
      if (!Object.keys(patch).length) return { error: `No supported fields supplied. Mutable fields: ${creationObjectDefinition(target.data.kind).mutableFields.join(', ')}` };
      if (target.data.kind === 'resume') {
        const protectedPatch = preserveResumeSourceForPatch(target.data, patch);
        patch = { ...protectedPatch, ...(protectedPatch.resumeFamily ? { status: t('resumeEditor.statusDerived') } : {}) };
      }
      if (target.data.kind === 'website' || target.data.kind === 'prototype') {
        const problem = authoredWebsiteProblem({ ...target.data, ...patch });
        if (problem) return { error: `${problem} Update this object with its complete WYSIWYG page structure.` };
      }
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update ${args.objectId}`, objectId: args.objectId, patch });
      return { ok: true, proposed: true, objectId: args.objectId, updatedFields: Object.keys(patch) };
    },
  }, {
    name: 'canvas_delete_object',
    description: 'Remove an object and all of its connections from the canvas.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const objectId = (raw as { objectId?: string }).objectId;
      const target = nodes.find((node) => node.id === objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === objectId)?.node;
      if (!objectId || !target) return { error: 'Object not found' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.delete', label: `Delete ${target.data.title}`, objectId });
      return { ok: true, proposed: true, objectId };
    },
  }, {
    name: 'canvas_arrange_objects',
    description: 'Automatically position multiple canvas objects in a non-overlapping grid, row, or column using their actual rendered sizes. Use this for requests to organize, align, evenly space, tidy, or remove overlaps. When objectIds is omitted, this intentionally arranges the whole visible canvas regardless of the prompt selection scope.',
    parameters: { type: 'object', additionalProperties: false, properties: { objectIds: { type: 'array', items: { type: 'string' }, description: 'Specific objects to arrange. Omit to arrange every visible unlocked object on the canvas, even when the composer is scoped to a single selection.' }, arrangement: { type: 'string', enum: ['grid', 'row', 'column'] }, gap: { type: 'number', description: 'Space between object bounds in canvas pixels.' }, columns: { type: 'number', description: 'Optional grid column count.' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectIds?: unknown; arrangement?: CanvasArrangement; gap?: number; columns?: number };
      const requestedIds = Array.isArray(args.objectIds) ? new Set(args.objectIds.filter((id): id is string => typeof id === 'string')) : null;
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const targets = canvasArrangementTargets([...nodes, ...stagedNodes], requestedIds);
      if (targets.length < 2) return { error: 'At least two unlocked objects are required to arrange the canvas' };
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const arrangement = args.arrangement ?? (narrowViewport ? 'column' : undefined);
      const positions = arrangeCanvasNodes(targets, arrangement, Number(args.gap ?? 48), Number(args.columns));
      let proposed = 0;
      for (const target of targets) {
        const position = positions.get(target.id);
        if (!position || (position.x === target.position.x && position.y === target.position.y)) continue;
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.layout', label: `Arrange ${target.data.title}`, objectId: target.id, position });
        proposed += 1;
      }
      return { ok: true, proposed: true, arrangedObjects: targets.length, proposedChanges: proposed, arrangement: arrangement || 'grid', gap: Math.max(16, Math.min(Number(args.gap ?? 48), 320)) };
    },
  }, {
    name: 'canvas_set_object_layout',
    description: 'Move, resize, hide, show, lock, or unlock an existing canvas object.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; x?: number; y?: number; width?: number; height?: number; hidden?: boolean; locked?: boolean };
      const current = nodes.find((node) => node.id === args.objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === args.objectId)?.node;
      if (!args.objectId || !current) return { error: 'Object not found' };
      const hasPosition = Number.isFinite(args.x) || Number.isFinite(args.y);
      const position = hasPosition ? { x: Number.isFinite(args.x) ? Number(args.x) : current.position.x, y: Number.isFinite(args.y) ? Number(args.y) : current.position.y } : undefined;
      const change: Extract<ProposedCanvasChange, { type: 'object.layout' }> = { id: crypto.randomUUID(), type: 'object.layout', label: `Arrange ${current.data.title}`, objectId: args.objectId, ...(position ? { position } : {}), ...(Number.isFinite(args.width) ? { width: Math.max(240, Math.min(Number(args.width), 2_400)) } : {}), ...(Number.isFinite(args.height) ? { height: Math.max(130, Math.min(Number(args.height), 1_800)) } : {}), ...(typeof args.hidden === 'boolean' ? { hidden: args.hidden } : {}), ...(typeof args.locked === 'boolean' ? { locked: args.locked } : {}) };
      if (!change.position && change.width == null && change.height == null && change.hidden == null && change.locked == null) return { error: 'No layout change supplied' };
      proposalBuffer.current.push(change);
      return { ok: true, proposed: true, objectId: args.objectId };
    },
  }, {
    name: 'canvas_convert_diagram',
    // The enum is built from the notation registry, so the model is told exactly
    // the destinations that exist. A hand-written list here is how a prompt ends
    // up naming a format the canvas cannot write.
    description: `Convert a Diagram, vector Image, CAD drawing, uploaded Image or freehand Drawing into a diagram in another notation. Destinations: ${DIAGRAM_TARGETS.map((notation) => `${notation.id} (${notation.name})`).join(', ')}. A picture with no shapes in it can only become drawio, where it is embedded; to add another picture to the same draw.io file, pass that existing Diagram as diagramObjectId.`,
    parameters: { type: 'object', required: ['sourceObjectId'], additionalProperties: false, properties: {
      sourceObjectId: { type: 'string', description: 'Diagram, Image, CAD or Drawing object to convert.' },
      format: { type: 'string', enum: DIAGRAM_TARGETS.map((notation) => notation.id), description: 'Destination notation. Omit for the first one this source supports.' },
      diagramObjectId: { type: 'string', description: 'Existing draw.io Diagram to append a picture to. Omit to create a new file; when exactly one draw.io Diagram exists it is reused.' },
    } },
    mutates: true,
    run: async (raw: unknown) => {
      const args = raw as { sourceObjectId?: string; format?: string; diagramObjectId?: string };
      if (!args.sourceObjectId) return { error: 'sourceObjectId is required' };
      const result = await convertObjectToDiagram(args.sourceObjectId, args.format, args.diagramObjectId);
      return result.ok ? { ok: true, diagramObjectId: result.diagramId, savedWithSession: persistence === 'server' } : { error: result.error };
    },
  }, {
    name: 'canvas_invoke_object_action',
    description: 'Invoke a native capability declared by a canvas object. Inspect and edit return guidance immediately; operational actions are proposed for user review before execution.',
    parameters: { type: 'object', required: ['objectId', 'action'], additionalProperties: false, properties: { objectId: { type: 'string' }, action: { type: 'string' } } },
    mutates: (raw: unknown) => !['inspect', 'edit'].includes(String((raw as { action?: unknown })?.action || '')),
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; action?: string };
      const target = nodes.find((node) => node.id === args.objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === args.objectId)?.node;
      if (!args.objectId || !target) return { error: 'Object not found' };
      const definition = creationObjectDefinition(target.data.kind);
      if (!args.action || !definition.actions.includes(args.action)) return { error: `Unsupported action. Available actions: ${definition.actions.join(', ')}` };
      if (args.action === 'inspect') return { object: { id: target.id, ...definition.contextAdapter(target.data, specBoardOf(nodes)) }, actions: definition.actions, mutableFields: definition.mutableFields };
      if (args.action === 'edit') return { objectId: target.id, kind: target.data.kind, mutableFields: definition.mutableFields, instruction: 'Call canvas_update_object with the desired fields.' };
      if (!canInvokeCreationObjectAction(target.data.kind, args.action)) {
        return { error: `${args.action} is declared for ${definition.label}, but no real Canvas delivery adapter is connected yet. Do not claim that it ran.` };
      }
      if (persistence === 'local' && ACCOUNT_REQUIRED_OBJECT_ACTIONS.has(args.action)) {
        requireAccount(args.action, `Create an account to ${args.action}`, `Your ${target.data.title} remains saved on this device. Create a free account to ${args.action} it with durable tenant resources, permissions, and history.`);
        return {
          ...accountGateResult('canvas_invoke_object_action', `"${args.action}" needs a free Builderforce account: it creates or changes a durable tenant resource, which an anonymous canvas has none of. The account prompt is now open and the canvas is unchanged. Say that in one sentence and keep building what this canvas can hold; never claim the action ran.`),
          action: args.action, objectId: target.id,
        };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      // ── The approval gate ────────────────────────────────────────────────────
      //
      // Two reviews found the same hole from opposite sides: outbound acts (send,
      // publish, share) were direct-fire with no reviewer, and attested acts (approve a
      // budget, authorise a bill, issue an invoice) had no record of who stood behind
      // the figure. Both are "an act that needs authority before it takes effect", so
      // both go through ONE gate rather than two — see `canvasApprovalGate.ts`.
      //
      // Evaluated HERE, at the single seam every model-invoked action passes through,
      // rather than per kind: a gate a caller can forget to consult is not a gate.
      const gate = evaluateGate({
        kind: target.data.kind,
        action: args.action,
        ...(typeof target.data.approvalMode === 'string' ? { mode: target.data.approvalMode as ApprovalMode } : {}),
        // The model is acting, so it is the actor. It is deliberately NOT allowed to
        // satisfy its own `required` gate — an approval an agent granted to an agent is
        // not review, it is a second copy of the same judgement.
        actor: { kind: 'brain', ref: 'brain', name: 'Brain' },
        provenance: readProvenance(target.data as Record<string, unknown>),
      });
      if (!gate.allowed) return { error: gate.message, objectId: target.id, action: args.action, awaitingApproval: true };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.action', label: `${args.action} ${target.data.title}`, objectId: target.id, action: args.action });
      return { ok: true, proposed: true, objectId: target.id, action: args.action, approval: gate.reason };
    },
  }, {
    name: 'canvas_connect_objects',
    description: 'Draw a labeled relationship between two existing canvas objects.',
    parameters: { type: 'object', required: ['sourceId', 'targetId'], additionalProperties: false, properties: { sourceId: { type: 'string' }, targetId: { type: 'string' }, kind: { type: 'string', enum: [...CREATION_CONNECTION_KINDS] }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { sourceId?: string; targetId?: string; kind?: CreationConnectionKind; label?: string };
      const exists = (id: string) => nodes.some((node) => node.id === id) || proposalBuffer.current.some((change) => change.type === 'object.add' && change.node.id === id);
      if (!args.sourceId || !args.targetId || !exists(args.sourceId) || !exists(args.targetId)) return { error: 'Source or target object not found' };
      const edge = { id: crypto.randomUUID(), source: args.sourceId, target: args.targetId, label: args.label?.slice(0, 120), type: 'smoothstep', animated: true, data: { connectionKind: args.kind || 'reference' } } satisfies Edge;
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Connect objects${args.label ? `: ${args.label}` : ''}`, edge });
      return { ok: true, proposed: true, connectionId: edge.id };
    },
  }, {
    name: 'canvas_update_connection',
    description: 'Change the label or semantic kind of an existing connection.',
    parameters: { type: 'object', required: ['connectionId'], additionalProperties: false, properties: { connectionId: { type: 'string' }, kind: { type: 'string', enum: [...CREATION_CONNECTION_KINDS] }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { connectionId?: string; kind?: CreationConnectionKind; label?: string };
      const exists = edges.some((edge) => edge.id === args.connectionId) || proposalBuffer.current.some((change) => change.type === 'connection.add' && change.edge.id === args.connectionId);
      if (!args.connectionId || !exists) return { error: 'Connection not found' };
      const patch = { ...(typeof args.label === 'string' ? { label: args.label.slice(0, 120) } : {}), ...(args.kind && CREATION_CONNECTION_KINDS.includes(args.kind) ? { kind: args.kind } : {}) };
      if (!Object.keys(patch).length) return { error: 'No connection change supplied' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.update', label: `Update connection ${args.connectionId}`, connectionId: args.connectionId, patch });
      return { ok: true, proposed: true, connectionId: args.connectionId };
    },
  }, {
    name: 'canvas_delete_connection',
    description: 'Remove an existing relationship between canvas objects.',
    parameters: { type: 'object', required: ['connectionId'], additionalProperties: false, properties: { connectionId: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const connectionId = (raw as { connectionId?: string }).connectionId;
      const exists = edges.some((edge) => edge.id === connectionId) || proposalBuffer.current.some((change) => change.type === 'connection.add' && change.edge.id === connectionId);
      if (!connectionId || !exists) return { error: 'Connection not found' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.delete', label: `Delete connection ${connectionId}`, connectionId });
      return { ok: true, proposed: true, connectionId };
    },
    // ADVERTISE ONLY WHAT THIS SESSION CAN EXECUTE. An anonymous canvas has no tenant,
    // so every tool that reads or writes a tenant resource (a connected mailbox,
    // canonical PRDs, tenant domain data, server-side image generation) is removed
    // here — the gateway strips them from the request anyway
    // (`api/application/guest/guestCanvasTools`). Advertising them regardless is what
    // made "connect my email" fail silently: the model planned around
    // `canvas_add_inbox`, the gateway deleted it before dispatch, and the turn ended
    // with prose and zero tool calls. Both sides read ONE contract.
  }, {
    /**
     * "I'm trying to create automation tests, can you create them for my website."
     *
     * The whole answer, in one call and with no account: a plan bound to the target,
     * one runnable case per route, the generated Playwright source on each, and the
     * membership edges that make them a suite. Route discovery is deterministic —
     * pass the page HTML from a web fetch and the same links produce the same plan.
     */
    name: 'canvas_create_test_plan',
    description: 'Create automation tests for a website. Builds a test plan bound to a target URL plus one runnable Playwright test case per route, each with real spec source the user can download and run. Use this for any request to write, generate or set up tests, e2e tests, automated QA or regression checks for a site. Pass `html` from a fetched page to discover the routes automatically, or pass `routes` when the user named them. Pass `scenarios` for journeys the user described in words ("a visitor requests a quote") — those become cases with their own steps.',
    parameters: {
      type: 'object', required: ['targetUrl'], additionalProperties: false,
      properties: {
        targetUrl: { type: 'string', description: 'The site under test — "acme.com" or "https://acme.com/app".' },
        name: { type: 'string', description: 'What the plan is called. Defaults to the target.' },
        routes: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to cover, e.g. ["/", "/pricing"]. "/" is always included.' },
        html: { type: 'string', description: 'HTML of the fetched target page. Same-site page links become routes; assets, /api and auth pages are excluded.' },
        scenarios: {
          type: 'array',
          description: 'Named journeys with their own steps. A scenario with no steps becomes a smoke case for its route.',
          items: {
            type: 'object', required: ['title'], additionalProperties: false,
            properties: {
              title: { type: 'string' },
              intent: { type: 'string', description: 'What this case proves.' },
              route: { type: 'string' },
              priority: { type: 'string', enum: ['critical', 'high', 'normal'] },
              steps: {
                type: 'array',
                items: {
                  type: 'object', required: ['action'], additionalProperties: false,
                  properties: {
                    action: { type: 'string', enum: [...QA_STEP_ACTIONS] },
                    route: { type: 'string', description: 'For goto: the path to navigate to.' },
                    selector: { type: 'string', description: 'Resilient first: "testid=submit", "role=button[name=Save]", "label=Email", "text=Thanks", or a CSS selector.' },
                    value: { type: 'string', description: 'For fill: a synthetic value. For press: the key.' },
                    assertion: { type: 'string', description: 'For expect: what is being proven, in one phrase.' },
                  },
                },
              },
            },
          },
        },
        exitCriteria: {
          type: 'object', additionalProperties: false,
          description: 'The release gate this plan is read as. Omit unless the user asked for one.',
          properties: {
            minPassRate: { type: 'number', description: 'Percentage of cases that must pass, 0-100.' },
            maxOpenDefects: { type: 'number' },
            maxSevereDefects: { type: 'number' },
            requireAccessibility: { type: 'boolean' },
            signOffs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { targetUrl?: string; name?: string; routes?: string[]; html?: string; scenarios?: BuildPlanInput['scenarios']; exitCriteria?: unknown };
      const target = typeof args.targetUrl === 'string' ? testTargetUrl(args.targetUrl) : null;
      if (!target) return { error: 'Pass the site under test as a URL or host, e.g. "acme.com".' };
      const discovered = typeof args.html === 'string' && args.html ? routesFromHtml(args.html, target) : [];
      const built = buildTestPlan({
        name: typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 120) : target,
        targetUrl: target,
        routes: [...(args.routes ?? []), ...discovered],
        ...(args.scenarios ? { scenarios: args.scenarios } : {}),
        exitCriteria: normalizeExitCriteria(args.exitCriteria),
      });
      if (!built.cases.length) return { error: 'Nothing to test — pass routes, page html, or at least one scenario.' };

      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const staged = () => proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const planNode = newNode('testPlan', nextCanvasObjectPosition([...nodes, ...staged()], {}, isNarrow, 'testPlan'));
      planNode.data = {
        ...planNode.data,
        ...sanitizeCreationObjectPatch('testPlan', {
          title: built.plan.title, targetUrl: built.plan.targetUrl, routes: built.plan.routes,
          exitCriteria: built.plan.exitCriteria, summary: built.plan.summary, planSlug: built.plan.slug,
          status: built.plan.status,
        }),
        caseCount: built.cases.length,
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add test plan “${built.plan.title}”`, node: planNode });

      for (const [index, testCase] of built.cases.entries()) {
        const caseNode = newNode('testCase', nextCanvasObjectPosition(
          [...nodes, ...staged()],
          { x: planNode.position.x + 520, y: planNode.position.y + index * 260 },
          isNarrow, 'testCase',
        ));
        caseNode.data = {
          ...caseNode.data,
          ...sanitizeCreationObjectPatch('testCase', {
            title: testCase.title, steps: testCase.steps, spec: testCase.spec, priority: testCase.priority,
            caseId: testCase.id, targetUrl: built.plan.targetUrl, status: 'Not run',
            ...(testCase.route ? { route: testCase.route } : {}),
            ...(testCase.intent ? { intent: testCase.intent } : {}),
          }),
        };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add test case “${testCase.title}”`, node: caseNode });
        proposalBuffer.current.push({
          id: crypto.randomUUID(), type: 'connection.add', label: `Case of ${built.plan.title}`,
          edge: { id: crypto.randomUUID(), source: planNode.id, target: caseNode.id, type: 'smoothstep', label: 'covers', data: { connectionKind: 'membership' } },
        });
      }

      return {
        ok: true, proposed: true,
        object: { id: planNode.id, kind: 'testPlan', title: built.plan.title, created: true },
        targetUrl: built.plan.targetUrl,
        routes: built.plan.routes,
        cases: built.cases.map((testCase) => ({ id: testCase.id, title: testCase.title, steps: testCase.steps.length, priority: testCase.priority })),
        // The model must tell the user what it actually made, and what it did not:
        // these run against the site, they are not connected to CI by this call.
        note: 'Each case carries runnable Playwright source. The user can download the .spec.ts files from the case cards. Connecting them to a CI pipeline is a separate step.',
      };
    },
  }, {
    /**
     * Coverage. Computed over `verifies` edges ONLY — see the connection kind's note
     * in the contract for why a `reference` edge must not count.
     */
    name: 'canvas_test_coverage',
    description: 'Report what on this canvas is proven by a test and what is not. Reads the "verifies" connections between test cases/plans and the work they cover, and names the requirements, tasks and builds with no test at all, plus any test case that verifies nothing. Use this to answer "what is untested", "what breaks if this fails", or before a release. Connect a case to what it proves with canvas_connect_objects using kind "verifies".',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    run: () => {
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...staged];
      const stagedEdges = proposalBuffer.current.flatMap((change) => change.type === 'connection.add' ? [change.edge] : []);
      const report = coverageReport(
        all.map((node) => ({ id: node.id, kind: node.data.kind, title: node.data.title })),
        [...edges, ...stagedEdges].map((edge) => ({
          source: edge.source, target: edge.target,
          connectionKind: typeof (edge.data as { connectionKind?: unknown } | undefined)?.connectionKind === 'string'
            ? String((edge.data as { connectionKind?: unknown }).connectionKind) : undefined,
        })),
      );
      return { ok: true, ...report };
    },
  }, {
    /**
     * The defect object, with the journal attached.
     *
     * `journal` is the canvas action record — what the person was actually DOING —
     * and attaching it here is the reason it is persisted at all: a bug report whose
     * repro is "it did this three steps ago" is unactionable, and by the time anyone
     * files one the steps are gone.
     */
    name: 'canvas_record_defect',
    description: 'File a defect on the canvas: what was expected, what happened, how to see it again, and how bad it is. Use this whenever the user reports something broken, or a test case fails. Pass caseObjectId to inherit that case\'s steps as the repro. The recent canvas action journal is attached automatically so the report carries what was actually being done.',
    parameters: {
      type: 'object', required: ['title', 'expected', 'actual'], additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'The defect in one line, as a symptom rather than a guess at the cause.' },
        expected: { type: 'string' },
        actual: { type: 'string' },
        severity: { type: 'string', enum: [...QA_SEVERITIES] },
        defectType: { type: 'string', enum: [...QA_FINDING_TYPES] },
        route: { type: 'string' },
        targetUrl: { type: 'string' },
        caseObjectId: { type: 'string', description: 'A testCase object on this canvas whose steps reproduce it.' },
        reproSteps: {
          type: 'array', description: 'Repro steps, when no case covers it.',
          items: {
            type: 'object', required: ['action'], additionalProperties: false,
            properties: {
              action: { type: 'string', enum: [...QA_STEP_ACTIONS] },
              route: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' }, assertion: { type: 'string' },
            },
          },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as {
        title?: string; expected?: string; actual?: string; severity?: QaFindingSeverity;
        defectType?: QaFindingType; route?: string; targetUrl?: string; caseObjectId?: string; reproSteps?: unknown;
      };
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) : '';
      const expected = typeof args.expected === 'string' ? args.expected.trim().slice(0, 2_000) : '';
      const actual = typeof args.actual === 'string' ? args.actual.trim().slice(0, 2_000) : '';
      if (!title || !expected || !actual) return { error: 'A defect needs a title, what was expected, and what actually happened.' };

      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...staged];
      const source = args.caseObjectId ? all.find((node) => node.id === args.caseObjectId && node.data.kind === 'testCase') : undefined;
      const steps = normalizeQaSteps(args.reproSteps ?? source?.data.steps ?? []);
      const severity = QA_SEVERITIES.includes(args.severity as QaFindingSeverity) ? args.severity as QaFindingSeverity : 'medium';
      const defectType = QA_FINDING_TYPES.includes(args.defectType as QaFindingType) ? args.defectType as QaFindingType : 'assertion';
      const route = typeof args.route === 'string' ? args.route.slice(0, 200) : String(source?.data.route ?? '');
      const targetUrl = typeof args.targetUrl === 'string' ? args.targetUrl.slice(0, 400) : String(source?.data.targetUrl ?? '');

      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode('defect', nextCanvasObjectPosition(
        all,
        source ? { x: source.position.x + 520, y: source.position.y + 120 } : {},
        isNarrow, 'defect',
      ));
      node.data = {
        ...node.data,
        ...sanitizeCreationObjectPatch('defect', {
          title, expected, actual, severity, defectType, reproSteps: steps,
          ...(route ? { route } : {}), ...(targetUrl ? { targetUrl } : {}),
          ...(source ? { caseId: String(source.data.caseId ?? source.id) } : {}),
          fingerprint: findingFingerprint({ type: defectType, route: route || null, selector: null, message: actual }),
          journal: recentJournalEvidence(),
          status: 'open',
        }),
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `File defect “${title}”`, node });
      if (source) {
        proposalBuffer.current.push({
          id: crypto.randomUUID(), type: 'connection.add', label: `Found by ${source.data.title}`,
          edge: { id: crypto.randomUUID(), source: source.id, target: node.id, type: 'smoothstep', label: 'found', data: { connectionKind: 'reference' } },
        });
      }
      return { ok: true, proposed: true, object: { id: node.id, kind: 'defect', title, created: true }, severity, reproSteps: steps.length };
    },
  }, {
    /**
     * The accessibility / performance verdict, on the board beside the thing being
     * built. Static by construction — see `lib/canvasPageAudit` for what that can and
     * cannot decide, which the summary states rather than implies.
     */
    name: 'canvas_audit_page',
    description: 'Audit a web page for accessibility (WCAG 2.2) and performance from its HTML, and put the scored verdict on the canvas. Fetch the page first, then pass its html here. Checks language, title, image alt text, link and button names, form labels, heading order, zoom blocking, frame titles, focus order, landmarks, render-blocking scripts, image dimensions and page weight. It reads source, so it cannot judge colour contrast or anything that only exists after scripts run — the result says so.',
    parameters: {
      type: 'object', required: ['html', 'url'], additionalProperties: false,
      properties: {
        html: { type: 'string', description: 'The fetched page HTML.' },
        url: { type: 'string', description: 'The page that HTML came from.' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { html?: string; url?: string };
      const html = typeof args.html === 'string' ? args.html : '';
      const url = typeof args.url === 'string' ? args.url.trim().slice(0, 400) : '';
      if (html.trim().length < 40) return { error: 'Pass the fetched page HTML — fetch the page first, then audit it.' };
      const audit = auditPageHtml(html, url);

      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const node = newNode('diagnostics', nextCanvasObjectPosition([...nodes, ...staged], {}, isNarrow, 'diagnostics'));
      const failed = audit.findings.filter((item) => item.count > 0);
      node.data = {
        ...node.data,
        ...sanitizeCreationObjectPatch('diagnostics', {
          title: `Accessibility & performance — ${url || 'page'}`,
          auditFindings: audit.findings, auditScore: audit.score, auditPassed: audit.passed, auditTarget: url,
          status: audit.passed ? `${audit.score}/100` : `${failed.length} issue(s)`,
          summary: `${failed.length} of ${audit.findings.length} checks failed (${audit.counts.accessibility} accessibility, ${audit.counts.performance} performance). Static source audit: contrast and script-rendered state are not covered.`,
        }),
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Audit ${url || 'page'}`, node });
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'diagnostics', title: String(node.data.title), created: true },
        score: audit.score, passed: audit.passed, counts: audit.counts,
        failed: failed.map((item) => ({ rule: item.rule, category: item.category, severity: item.severity, count: item.count, wcag: item.wcag })),
      };
    },
  }, {
    /**
     * Test data. The generator's own fill value is the literal `qa-probe`, which
     * exercises no validation rule any product has — this produces the rows that do.
     */
    name: 'canvas_generate_test_data',
    description: 'Generate test data from a declared data contract: a valid control group, the exact boundary values (min, max, first/last allowed, longest string), and the rows that must be REJECTED (empty required fields, out-of-range numbers, wrong types, disallowed values, duplicate keys) plus the string shapes naive validation breaks on. Each row is labelled with the edge it exercises. Use this before testing a form, an import or an API. Pass objectId to read the contract already declared on a dataset.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'A dataset/table object carrying a declared contract. Omit when the canvas holds exactly one.' },
        validRows: { type: 'number', description: 'Size of the valid control group. Default 5.' },
        includeHostileStrings: { type: 'boolean', description: 'Add quotes, markup, unicode, over-length and traversal strings to every free-text column. Default true.' },
        includeBoundary: { type: 'boolean' },
        includeInvalid: { type: 'boolean' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; validRows?: number; includeHostileStrings?: boolean; includeBoundary?: boolean; includeInvalid?: boolean };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset } = target;
      const contract = normalizeDataContract(dataset.data.dataContract);
      if (!contract?.columns.length) {
        return { error: `${dataset.data.title} has no declared contract to generate against. Declare one with canvas_set_data_contract first — the contract is what says which values are valid, so it is also what says which are not.` };
      }
      const fixture = generateFixture(contract, {
        validRows: Number(args.validRows) || 5,
        includeHostileStrings: args.includeHostileStrings !== false,
        ...(args.includeBoundary === false ? { includeBoundary: false } : {}),
        ...(args.includeInvalid === false ? { includeInvalid: false } : {}),
      });

      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const node = newNode('dataset', nextCanvasObjectPosition(
        [...nodes, ...staged],
        { x: dataset.position.x + 460, y: dataset.position.y + 320 },
        isNarrow, 'dataset',
      ));
      node.data = {
        ...node.data,
        ...sanitizeCreationObjectPatch('dataset', {
          title: `${dataset.data.title} fixtures`,
          columns: fixture.columns, rows: fixture.rows, rowCount: fixture.rows.length,
          fixtureCases: fixture.cases.map((item) => ({ kind: item.kind, rule: item.rule, ...(item.column ? { column: item.column } : {}) })),
          status: `${fixture.rows.length} rows`,
          summary: `${fixture.counts.valid} valid, ${fixture.counts.boundary} boundary, ${fixture.counts.invalid} must-reject rows generated from the declared contract.`,
        }),
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Generate fixtures for ${dataset.data.title}`, node });
      proposalBuffer.current.push({
        id: crypto.randomUUID(), type: 'connection.add', label: `Fixtures for ${dataset.data.title}`,
        edge: { id: crypto.randomUUID(), source: dataset.id, target: node.id, type: 'smoothstep', label: 'fixtures', data: { connectionKind: 'data' } },
      });
      return { ok: true, proposed: true, object: { id: node.id, kind: 'dataset', title: String(node.data.title), created: true }, counts: fixture.counts };
    },
  }, {
    /**
     * The tenant half: publish the board's cases into the QA library, and read the
     * runs back.
     *
     * GUEST-GATED rather than absent. A guest asking to "hook these up to CI" must be
     * told the real reason — an account — instead of being handed a model that was
     * never given the tool and therefore improvises a limitation the product does not
     * have. See the guest-gated set in the contract.
     */
    name: 'canvas_publish_tests',
    description: 'Publish this canvas\'s test cases to the workspace QA library so they can run on a schedule and in CI, and read the latest run results back onto the board. Each case becomes a stored flow with a persona-aware generated spec; any failures come back as defect objects. Use this after canvas_create_test_plan when the user wants the tests to actually run rather than only exist.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        planObjectId: { type: 'string', description: 'The testPlan to publish. Omit when the canvas holds exactly one.' },
        projectId: { type: 'number', description: 'Canonical project to file the tests under. Omit to use the project on this canvas.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      if (!getStoredTenantToken()) {
        requireAccount('qa', t('gateQaTitle'), t('gateQaBody'));
        return accountGateResult('canvas_publish_tests', CANVAS_QA_ACCOUNT_GATE);
      }
      const args = raw as { planObjectId?: string; projectId?: number };
      const staged = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const all = [...nodes, ...staged];
      const plans = all.filter((node) => node.data.kind === 'testPlan');
      const plan = args.planObjectId ? plans.find((node) => node.id === args.planObjectId) : plans.length === 1 ? plans[0] : undefined;
      if (!plan) return { error: plans.length ? 'Name the testPlan to publish with planObjectId.' : 'There is no test plan on this canvas yet — create one first.' };

      const stagedEdges = proposalBuffer.current.flatMap((change) => change.type === 'connection.add' ? [change.edge] : []);
      const memberIds = new Set([...edges, ...stagedEdges].filter((edge) => edge.source === plan.id).map((edge) => edge.target));
      const cases = all.filter((node) => node.data.kind === 'testCase' && (memberIds.has(node.id) || memberIds.size === 0));
      if (!cases.length) return { error: 'That plan has no test cases connected to it.' };

      const projectNode = all.find((node) => node.data.kind === 'project' && canvasProjectId(node.data) != null);
      const projectId = Number.isInteger(args.projectId) ? Number(args.projectId) : projectNode ? canvasProjectId(projectNode.data) ?? undefined : undefined;
      const targetUrl = String(plan.data.targetUrl ?? '');

      const published: Array<{ objectId: string; testId: string; title: string; model: string }> = [];
      const failures: Array<{ title: string; reason: string }> = [];
      for (const testCase of cases.slice(0, 25)) {
        const steps = normalizeQaSteps(testCase.data.steps);
        if (!steps.length) { failures.push({ title: String(testCase.data.title), reason: 'no steps' }); continue; }
        try {
          const { flow } = await qaApi.createFlow({
            name: String(testCase.data.title).slice(0, 160),
            steps,
            ...(typeof testCase.data.route === 'string' && testCase.data.route ? { startRoute: testCase.data.route } : {}),
            ...(typeof testCase.data.intent === 'string' && testCase.data.intent ? { description: testCase.data.intent } : {}),
            ...(projectId != null ? { projectId } : {}),
          });
          const generated = await qaApi.generateTest(flow.id);
          published.push({ objectId: testCase.id, testId: generated.test.id, title: String(testCase.data.title), model: generated.usedModel });
          proposalBuffer.current.push({
            id: crypto.randomUUID(), type: 'object.update', label: `Publish ${testCase.data.title}`, objectId: testCase.id,
            patch: sanitizeCreationObjectPatch('testCase', {
              caseId: generated.test.id, status: 'Published',
              ...(generated.test.spec ? { spec: generated.test.spec } : {}),
            }),
          });
        } catch (error) {
          failures.push({ title: String(testCase.data.title), reason: error instanceof Error ? error.message : 'publish failed' });
        }
      }
      if (!published.length) return { error: `No case could be published: ${failures.map((failure) => `${failure.title} (${failure.reason})`).join('; ')}` };

      // Pull the other direction: whatever CI has already reported for these tests.
      const byTestId = new Map(published.map((entry) => [entry.testId, entry]));
      const runs = await qaApi.fetchRuns(projectId ?? null).then(({ runs: rows }) => rows.filter((run) => run.testId && byTestId.has(run.testId))).catch(() => []);
      const results = runs.slice(0, 50).map((run) => ({
        caseId: run.testId ?? '',
        title: run.testName ?? byTestId.get(run.testId ?? '')?.title ?? '',
        status: run.status === 'passed' ? 'passed' as const : run.status === 'skipped' ? 'skipped' as const : run.status === 'error' ? 'error' as const : 'failed' as const,
        ...(run.durationMs != null ? { durationMs: run.durationMs } : {}),
        ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
      }));

      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 760;
      const runNode = newNode('testRun', nextCanvasObjectPosition(
        [...all, ...proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : [])],
        { x: plan.position.x, y: plan.position.y + 340 },
        isNarrow, 'testRun',
      ));
      const summary = summarizeRun(results);
      runNode.data = {
        ...runNode.data,
        ...sanitizeCreationObjectPatch('testRun', {
          title: `${plan.data.title} — library`,
          results, targetUrl, planObjectId: plan.id,
          status: results.length ? `${summary.passRate}% passing` : `${published.length} published`,
          summary: results.length
            ? `${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored across ${results.length} reported run(s).`
            : `${published.length} case(s) published to the QA library. No CI run has reported against them yet.`,
        }),
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add test run for ${plan.data.title}`, node: runNode });
      proposalBuffer.current.push({
        id: crypto.randomUUID(), type: 'connection.add', label: `Run of ${plan.data.title}`,
        edge: { id: crypto.randomUUID(), source: plan.id, target: runNode.id, type: 'smoothstep', label: 'run', data: { connectionKind: 'delivery' } },
      });

      // Every failure becomes a defect, fingerprinted the same way an Agentic Tester
      // finding is — so the same break reported twice is one defect.
      for (const [index, result] of results.filter((item) => item.status === 'failed' || item.status === 'error').slice(0, 10).entries()) {
        const defectNode = newNode('defect', nextCanvasObjectPosition(
          [...all, ...proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : [])],
          { x: runNode.position.x + 520, y: runNode.position.y + index * 240 },
          isNarrow, 'defect',
        ));
        defectNode.data = {
          ...defectNode.data,
          ...sanitizeCreationObjectPatch('defect', {
            ...defectFromResult(result, { targetUrl, caseTitle: result.title }),
            journal: recentJournalEvidence(),
          }),
        };
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `File defect “${result.title}”`, node: defectNode });
        proposalBuffer.current.push({
          id: crypto.randomUUID(), type: 'connection.add', label: `Found by ${plan.data.title}`,
          edge: { id: crypto.randomUUID(), source: runNode.id, target: defectNode.id, type: 'smoothstep', label: 'found', data: { connectionKind: 'reference' } },
        });
      }

      return {
        ok: true, proposed: true,
        object: { id: runNode.id, kind: 'testRun', title: String(runNode.data.title), created: true },
        published: published.map((entry) => ({ title: entry.title, testId: entry.testId, generator: entry.model })),
        ...(failures.length ? { failures } : {}),
        reportedRuns: results.length,
        ...(projectId == null ? { note: 'Published without a project. Add a project object to the canvas to file these under it, which is what gives them a run target and a persona.' } : {}),
      };
    },
  }, ...canvasBuildActionList, ...canvasFounderOpsActionList, ...canvasLegalDocumentActionList, ...canvasSignatureActionList].filter((action) => persistence === 'server' || !canvasToolRequiresAccount(action.name))),
  [canEdit, canvasBuildActionList, canvasFounderOpsActionList, canvasLegalDocumentActionList, canvasSignatureActionList, convertObjectToDiagram, edges, effectiveSelectedIds, localizedTourDefaults, nodes, persistence, prompt, requireAccount, resolveTabularTarget, resolvedScopeMode, scopedEdges, scopedNodeIds, scopedNodes, sessionId, socialAccountGate, tSocial]);

  const addAgentKnowledge = useCallback((agentId: string, content: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    const authored = content.trim();
    if (!agent || !authored || !canEdit) return;
    const knowledge = newNode('knowledge', { x: agent.position.x - 390, y: agent.position.y + 40 });
    knowledge.data = { ...knowledge.data, title: `${agent.data.title} knowledge`, status: 'Ready', markdown: authored, content: authored, sources: [{ label: 'Authored in Agent inspector', resource: `session:${agent.id}` }] };
    setNodes((current) => [...current, knowledge]);
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
      proposalBuffer.current = [];
      turnUnanswered.current = null;
      setBrainTrace([]);
      setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, trace: [] } } : node));
      setProposedChanges([]);
      const request = requestText;
      const snapshot = JSON.stringify({
        sessionId, scope: resolvedScopeMode, selectedObjectIds: effectiveSelectedIds,
        // A scoped turn used to send ONLY the scoped objects, with nothing saying
        // the view was partial — so the model answered "that file is not anywhere
        // on the canvas" about a file that was on the canvas, and asked the user
        // to upload it again. The inventory is identity-only (cheap) and always
        // complete, so an absence claim is never available to be made.
        scopeNote: scopeNote(resolvedScopeMode, nodes.length, scopedNodes.length),
        boardInventory: boardInventory(nodes, scopedNodeIds),
        objects: ((board) => scopedNodes.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data, board), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true }; }))(specBoardOf(nodes)),
        connections: scopedEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
      });
      clearComposer();
      const connectedAgentNodes = nodes.filter((node) => node.data.kind === 'agent' && (
        effectiveSelectedIds.includes(node.id)
        || edges.some((edge) => (edge.source === brainId && edge.target === node.id) || (edge.target === brainId && edge.source === node.id))
      )).slice(0, 3);
      setActiveAgentIds(new Set(connectedAgentNodes.map((agent) => agent.id)));
      const confirmCanvasAction = ({ name, args }: { name: string; args: unknown }) => {
        let preview = '';
        try { const serialized = JSON.stringify(args ?? {}); preview = serialized === '{}' ? '' : serialized.length > 320 ? `${serialized.slice(0, 320)}…` : serialized; } catch { preview = ''; }
        return confirm({ title: 'Approve agent action', message: `A session agent wants to run ${name.replaceAll('_', ' ')}.${preview ? `\n\n${preview}` : ''}`, confirmLabel: 'Approve', cancelLabel: 'Cancel', destructive: false });
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
        const canonicalAgents = connectedAgentNodes.flatMap((agent) => {
          const ref = agent.data.resourceId?.match(/^agent:(.+)$/)?.[1];
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
              setActiveAgentIds((current) => {
                const next = new Set(current);
                const canvasAgent = connectedAgentNodes.find((candidate) => candidate.data.resourceId === `agent:${agent.ref}`);
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
        } else if (connectedAgentNodes.length) {
          // Guest drafts cannot call the tenant workforce runtime. Keep ideation
          // useful, but do not present these local personas as canonical agents.
          for (const agent of connectedAgentNodes) {
            const name = agent.data.title || 'Draft specialist';
            const ref = agent.id;
            try {
              const contribution = await runCreationCanvasAi({
                prompt: 'Contribute a specialist perspective to the latest request.', canvasSnapshot: snapshot,
                guestTurnId: requestMessageId,
                guestTurnInput: request,
                persistence, canvasActions, notices: canvasNotices, routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
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
          prompt: connectedAgentNodes.length
            ? `Synthesize the invited agents' perspectives and complete the user's requested outcome. Resolve disagreements, make the final Canvas changes, and state what was actually created.`
            : request,
          canvasSnapshot: snapshot, persistence, canvasActions, notices: canvasNotices,
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
          ...(persistence === 'server' && memoryEnabled && evermindProjectId != null ? { evermind: {
            recall: (query: string) => recallProjectEvermind(evermindProjectId, query).catch(() => null),
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
            setBrainTrace((current) => [...current, event]);
          },
          conversation: groupConversation,
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
        const changes = [...proposalBuffer.current];
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
        turnDone({ ok: executiveContractSatisfied, detail: `${proposalBuffer.current.length} proposed change(s)${executiveUseCase ? ` · ${executiveUseCase.id} ${executiveContractSatisfied ? 'complete' : 'incomplete'}` : ''}` });
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
        const course: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 420, y: 180 }, data: { kind: 'course', title: 'Build an LLM', status: 'Ready to learn', subtitle: 'From requirements and data to training, evaluation, and deployment.', course: buildLlmCourse() } };
        const lab: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1020, y: 230 }, data: { ...createDefaultCreationData('code'), title: 'LLM capstone lab', status: 'Practice workspace', language: 'python', code: '# Build your tokenizer, model, and training loop here\n' } };
        setNodes((current) => [...current, course, lab]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: course.id, target: lab.id, type: 'smoothstep', label: 'practice', animated: true, data: { connectionKind: 'reference' } }], brain?.id || '', [course.id], 'Created with Brain'));
        setSelectedId(course.id); openNodeInspector(course.id); setThinking(false); clearComposer(); setNotice(t('noticeLlmCourseAdded')); return;
      }
      if (request.includes('roadmap')) {
        const project = nodes.find((node) => node.data.kind === 'project');
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const roadmap: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'roadmap', title: request.includes('executive') ? 'Executive team roadmap' : 'Sales presentation roadmap', status: 'AI generated' } };
        const slides: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 315 }, data: { kind: 'slides', title: request.includes('executive') ? 'Executive team presentation' : 'Sales presentation', status: 'AI generated' } };
        setNodes((current) => [...current, roadmap, slides]);
        setEdges((current) => associateBrainWithArtifacts([...current, ...(project ? [{ id: crypto.randomUUID(), source: project.id, target: roadmap.id, type: 'smoothstep' as const }] : []), { id: crypto.randomUUID(), source: roadmap.id, target: slides.id, type: 'smoothstep', label: 'presents', animated: true }], brain?.id || '', [roadmap.id], 'Created with Brain'));
        setSelectedId(roadmap.id); openNodeInspector(roadmap.id); setThinking(false); clearComposer(); setNotice(t('noticeRoadmapAdded')); return;
      }
      if (request.includes('top 10') || request.includes('requested features')) {
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const summary: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 500, y: 260 }, data: { kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' } };
        const mockups: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 300 }, data: { kind: 'mockupSet', title: 'Top 10 feature mockups', status: 'Ready for review', subtitle: 'Ten linked high-fidelity concepts generated from user feedback.', items: ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'], sources: [{ label: 'Customer feedback evidence', resource: '/api/feedback' }] } };
        setNodes((current) => [...current, summary, mockups]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: summary.id, target: mockups.id, type: 'smoothstep', animated: true }], brain?.id || '', [summary.id], 'Created with Brain'));
        setSelectedId(mockups.id); openNodeInspector(mockups.id); setThinking(false); clearComposer(); setNotice(t('noticeFeatureSummaryAdded')); return;
      }
      const evaluationId = crypto.randomUUID();
      setNodes((current) => [...current, { id: evaluationId, type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' } }]);
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
  }, [appendTimeline, canvasActions, confirm, currentUserId, describeTurnError, disableBrainModel, effectiveSelectedIds, edges, evermindProjectId, members, memoryEnabled, modelSelection, nodes, openNodeInspector, persistence, prompt, recordBrainCompletion, resolvedScopeMode, scopedEdges, scopedNodeIds, scopedNodes, sessionId, sessionMode, setEdges, setNodes, t, thinking, timeline, title]);

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
            draggable: !locked,
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
    if (materializedAdditions.length) setSelectedId(materializedAdditions[materializedAdditions.length - 1]!.node.id);
    else if (selectedId && deletedObjectIds.has(selectedId)) { setSelectedId(null); setSelectedIds([]); }
    if (typeof window !== 'undefined' && window.innerWidth <= 760 && materializedAdditions.length) {
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
  }, [acceptedProposalIds, nodes, proposedChanges, selectedId, sessionId, setEdges, setNodes]);

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
    proposalBuffer.current = [];
    setAutoApplyPending(false);
    setNotice(t('noticeChangesRejected'));
  }, []);

  /** Merge a patch into one node's data. Run/compile state is written by the
   *  app, not the user, so this deliberately skips the `cardsEditable` gate that
   *  `updateNodeData` applies to inspector edits. */
  const patchWorkflowNode = useCallback((targetId: string, patch: Partial<CreationNodeData>) => {
    setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, ...patch } } : node));
  }, [setNodes]);

  /** Resolve which workflow node an action applies to: the one named, else the
   *  selection, else the only one on the board. Shared by build and run. */
  const resolveWorkflowNode = useCallback((workflowId?: string) => {
    const requested = typeof workflowId === 'string' ? nodes.find((node) => node.id === workflowId && node.data.kind === 'workflow') : null;
    return requested ?? (selectedNode?.data.kind === 'workflow' ? selectedNode : nodes.find((node) => node.data.kind === 'workflow')) ?? null;
  }, [nodes, selectedNode]);

  /**
   * Turn an authored canvas workflow into a REAL definition and link it.
   *
   * This is the step that used to be missing entirely: `steps` were rendered and
   * never compiled, so a canvas workflow could not run no matter what it said on
   * the card. Resolves the new definition id, or null when the steps are not
   * runnable — in which case the per-step reasons are written onto the node and
   * shown on the card.
   */
  const compileWorkflow = useCallback(async (workflowId?: string): Promise<string | null> => {
    const target = resolveWorkflowNode(workflowId);
    if (!target) { setNotice(t('noticeNeedWorkflow')); return null; }
    // Compiling creates a tenant-owned, runnable resource, so a local draft has
    // to become an account first — the same gate saving a collaborator uses.
    if (persistence !== 'server') {
      requireAccount('workflow', t('buildWorkflowGateTitle'), t('buildWorkflowGate'));
      return null;
    }
    const targetId = target.id;
    setNotice(t('noticeWorkflowBuilding'));
    patchWorkflowNode(targetId, { status: 'Building', workflowIssues: [] });
    try {
      // Bind the definition to the canvas's project when there is one, so the
      // compiled workflow lands in the same scope as the rest of this board's work.
      const projectId = canvasProjectNodes(nodes).map((node) => canvasProjectId(node.data))[0] ?? null;
      const definition = await workflowDefinitions.fromCanvas({
        name: target.data.title || 'Canvas workflow',
        steps: target.data.steps,
        ...(typeof target.data.content === 'string' && target.data.content ? { description: target.data.content } : {}),
        ...(projectId != null ? { projectId } : {}),
      });
      patchWorkflowNode(targetId, {
        resourceId: `workflow:${definition.id}`,
        resourceSubtype: 'definition',
        workflowExecutable: true,
        workflowIssues: [],
        workflowStepCount: definition.compiledCount,
        status: 'Built',
      });
      setNotice(t('noticeWorkflowBuilt', { count: definition.compiledCount }));
      return definition.id;
    } catch (error) {
      // `details.issues` is the per-step explanation the compile endpoint
      // returns; without it the card can only say "failed", which is what made
      // the previous behaviour impossible to act on.
      const details = error instanceof ApiRequestError ? error.details as { issues?: unknown } | undefined : undefined;
      const issues = Array.isArray(details?.issues) ? details.issues : [];
      const message = error instanceof Error ? error.message : t('noticeWorkflowNotRunnable');
      patchWorkflowNode(targetId, { status: 'Needs setup', workflowIssues: issues });
      setNotice(message);
      return null;
    }
  }, [nodes, patchWorkflowNode, persistence, requireAccount, resolveWorkflowNode, t]);

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
        const message = error instanceof Error ? error.message : 'Workflow could not be started';
        const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Run failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        setNotice(message);
      });
    })();
  }, [canRun, compileWorkflow, persistence, resolveWorkflowNode, setNodes, t]);

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
      .catch((error) => setNotice(error instanceof Error ? error.message : t('agentSettingsSaveFailed')));
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

  const publishWebsite = useCallback((websiteId?: string) => {
    const target = nodes.find((node) => node.id === websiteId && node.data.kind === 'website')
      ?? (selectedNode?.data.kind === 'website' ? selectedNode : nodes.find((node) => node.data.kind === 'website'));
    if (!target) { setNotice(t('noticeNeedWebsite')); return; }
    if (persistence !== 'server') { requireAccount('publish', 'Create an account to publish', 'Save this session to publish the Website as a live Builderforce site.'); return; }
    const connectedProject = connectedCanvasProjectNode(nodes, edges, target.id);
    const projectId = connectedProject ? canvasProjectId(connectedProject.data) : null;
    if (projectId == null) { setNotice(t('noticeConnectWebsite')); return; }
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'publish', artifactKind: 'website', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-sites', resourceRef: `project:${projectId}` };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publishing…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice(t('noticePublishingWebsite'));
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'started', artifactId: target.id, projectId: Number(projectId) }).catch(() => undefined);
    const subdomain = typeof target.data.subdomain === 'string' ? target.data.subdomain : undefined;
    void publishSite(projectId, buildWebsiteAssets(target.data), subdomain).then((site) => {
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), url: site.url, pathUrl: site.pathUrl, mimeType: 'text/html', resourceRef: `site:${site.subdomain}`, validation: { status: 'passed', detail: `${site.assetCount} assets published (${site.totalBytes} bytes)` }, metadata: { versionToken: site.versionToken, assetCount: site.assetCount, totalBytes: site.totalBytes } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Published', url: site.url, siteUrl: site.url, pathUrl: site.pathUrl, subdomain: site.subdomain, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      setNotice(t('noticeWebsitePublished', { url: site.url }));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'succeeded', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { url: site.url, versionToken: site.versionToken } }).catch(() => undefined);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Website publish failed';
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'failed', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [edges, nodes, persistence, requireAccount, selectedNode, sessionId, setNodes]);

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
      .catch((error) => setNotice(error instanceof Error ? error.message : t('build.createFailed')))
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
      setNotice(error instanceof Error ? error.message : t('build.deleteWorkspaceFailed'));
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
    const build = newNode('build', nextCanvasObjectPosition(nodes, { x: source.position.x + 520, y: source.position.y }, typeof window !== 'undefined' && window.innerWidth <= 760, 'build'));
    build.data = { ...build.data, title: source.data.title, modality: canvasBuildModality(source.data) };
    setNodes((current) => [...current, build]);
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
      const message = error instanceof Error ? error.message : 'Video generation failed';
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generation failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'failed', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [nodes, persistence, requireAccount, selectedNode, sessionId, setNodes]);

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
          prompt: creativeBrief(target.data),
          maxFrames: kind === 'animation' ? 24 : 1,
        });
        const rendered = evermindMediaArtifact(target.data, media, model.slug);
        if (!rendered) throw new Error(t('creativeNoFrames'));
        return rendered;
      }
      if (persistence === 'server' && SERVER_CREATIVE_KINDS.has(kind)) return generateServerCreativeArtifact(target.data);
      return { ...buildBrowserCreativeArtifact(target.data), provider: 'builderforce-browser' };
    };

    void generate()
      .then((artifact) => ({ artifact, fellBack: false }))
      // A generator that is unavailable must not leave the object empty: the
      // browser baseline is a real file, and saying which one produced it is the
      // difference between a fallback and a silent downgrade.
      .catch(() => ({ artifact: { ...buildBrowserCreativeArtifact(target.data), provider: 'builderforce-browser' } as CreativeArtifact, fellBack: true }))
      .then(({ artifact, fellBack }) => {
        const delivered: CreationDeliverable = {
          ...started, artifactKind: artifact.artifactKind, status: 'delivered', completedAt: new Date().toISOString(),
          url: artifact.url, mimeType: artifact.mimeType, fileName: artifact.fileName, provider: artifact.provider,
          validation: { status: 'passed', detail: artifact.validationDetail },
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
        setNotice(fellBack ? t('creativeGeneratedOffline', { file: artifact.fileName }) : t('creativeGenerated', { file: artifact.fileName }));
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
    const markdown = canvasObjectMarkdown(target.data);
    const base = safeDownloadName(target.data.title);
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
        const sheet = artifactSheet(target.data);
        if (!sheet) throw new Error(t('noTabularRows'));
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
        const sheet = action === 'xlsx' ? artifactSheet(target.data) : null;
        if (action === 'xlsx' && !sheet) throw new Error(t('noTabularRows'));
        try {
          if (action === 'docx') {
            const renderedResume = target.data.kind === 'resume' ? renderedCanvasResume(target.data) : null;
            await exportDocx(markdown, target.data.title, renderedResume ? {
              accent: renderedResume.template.accent,
              font: renderedResume.template.font,
              density: renderedResume.template.density,
              columns: renderedResume.template.columns,
            } : undefined);
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
   * `investorUpdate.send`, with a delivery behind it.
   *
   * The act stays GATED (`canvasApprovalGate.GATED_ACTIONS`), so a model still
   * cannot fire it — what changed is that a human who approves it now gets a send
   * rather than "no delivery adapter is connected".
   *
   * Recipients come from the object's own `recipients` rows and from NOWHERE
   * else. Harvesting addresses out of a `fundingRound`'s investor table would be
   * the convenient version and the wrong one: those rows carry firm names, not
   * consent to be emailed, and the failure mode of guessing is a private update
   * reaching a stranger. An update with no recipients says so and sends nothing.
   */
  const sendUpdateToInvestors = useCallback(async (objectId: string) => {
    const target = nodesRef.current.find((node) => node.id === objectId && node.data.kind === 'investorUpdate');
    if (!target) return;
    if (persistence !== 'server') { setNotice(t('noticeInvestorUpdateNeedsAccount')); return; }

    const recipients = (Array.isArray(target.data.recipients) ? target.data.recipients : [])
      .flatMap((row) => {
        const entry = row as { name?: unknown; email?: unknown };
        const email = typeof entry.email === 'string' ? entry.email.trim() : '';
        return email.includes('@') ? [{ email, name: typeof entry.name === 'string' ? entry.name : null }] : [];
      });
    if (!recipients.length) { setNotice(t('noticeInvestorUpdateNoRecipients')); return; }

    try {
      const result = await sendInvestorUpdate({
        content: {
          title: target.data.title,
          period: target.data.period ?? null,
          highlights: target.data.highlights ?? [],
          lowlights: target.data.lowlights ?? [],
          metrics: target.data.metrics ?? [],
          asks: target.data.asks ?? [],
          summary: target.data.summary ?? null,
        },
        recipients,
        objectId: null,
      });
      // Stamped onto the card, so "did this go out, and to how many" survives the
      // notice being dismissed — the register's complaint about an act that ends
      // at a card applies just as well to an act that ends at a toast.
      setNodes((current) => current.map((node) => node.id === objectId
        ? { ...node, data: { ...node.data, status: `Sent to ${result.sent}`, sentAt: new Date().toISOString() } }
        : node));
      setNotice(result.failed.length
        ? t('noticeInvestorUpdatePartial', { sent: result.sent, failed: result.failed.length })
        : t('noticeInvestorUpdateSent', { sent: result.sent, from: result.fromLabel }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('noticeInvestorUpdateFailed'));
    }
  }, [persistence, setNodes, t]);

  /**
   * `assignment.distribute` — fan the task into one `submission` per roster row.
   *
   * Idempotent by construction: a learner who already has a submission for this
   * assignment (matched on `learnerRef`) is skipped, so distributing twice — a late
   * enrolment, a re-run after the roster grew — only creates what is missing rather
   * than duplicating every submission on the board.
   */
  const distributeAssignment = useCallback((assignmentId: string) => {
    const all = nodesRef.current;
    const assignment = all.find((node) => node.id === assignmentId && node.data.kind === 'assignment');
    if (!assignment) return;
    const board = makeSpecDeriveBoard(all.map((node) => node.data as unknown as Record<string, unknown>));
    const cohort = board.byRef('cohort', assignment.data.cohortRef);
    const roster = cohort ? learnersFromCohort(cohort) : [];
    if (!roster.length) { setNotice(t('noticeSubmissionsNoCohort')); return; }

    const assignmentKey = specRefKey(assignment.data.title);
    const already = new Set(all
      .filter((node) => node.data.kind === 'submission' && specRefKey(node.data.assignmentRef) === assignmentKey)
      .map((node) => specRefKey(node.data.learnerRef)));
    const toCreate = roster.filter((learner) => !already.has(specRefKey(learner.ref)));
    if (!toCreate.length) { setNotice(t('noticeSubmissionsAlreadyDistributed')); return; }

    const created = toCreate.map((learner, index) => {
      const node = newNode('submission', {
        x: assignment.position.x + 440 + (index % 3) * 300,
        y: assignment.position.y + 220 + Math.floor(index / 3) * 190,
      });
      node.data = {
        ...node.data,
        title: `${learner.name} — ${String(assignment.data.title ?? '')}`,
        learnerRef: learner.ref,
        learnerName: learner.name,
        assignmentRef: String(assignment.data.title ?? ''),
      };
      return node;
    });
    setNodes((current) => [...current, ...created]);
    setEdges((current) => [...current, ...created.map((node) => ({
      id: crypto.randomUUID(), source: assignment.id, target: node.id,
      type: 'smoothstep', label: 'submission', data: { connectionKind: 'membership' },
    }))]);
    setNotice(t('noticeSubmissionsDistributed', { count: created.length }));
  }, [setEdges, setNodes, t]);

  /**
   * `cohort.import`'s GENERIC path — invoked with no roster text, so it pulls
   * through NRPS using whatever `ltiIssuer`/`ltiMembershipsUrl` the cohort already
   * carries. A CSV paste goes through the dedicated `canvas_import_roster` tool
   * instead, which has the text to parse; this is what runs when the action is
   * invoked directly with nothing else to go on.
   */
  const importCohortRosterFromLti = useCallback(async (cohortId: string) => {
    const target = nodesRef.current.find((node) => node.id === cohortId && node.data.kind === 'cohort');
    if (!target) return;
    const issuer = String(target.data.ltiIssuer ?? '').trim();
    const membershipsUrl = String(target.data.ltiMembershipsUrl ?? '').trim();
    if (!issuer || !membershipsUrl) { setNotice(t('noticeRosterNoLmsBound')); return; }
    try {
      const result = await pullLtiRoster(issuer, membershipsUrl);
      setNodes((current) => current.map((node) => node.id === cohortId
        ? { ...node, data: { ...node.data, roster: result.roster, enrolledCount: result.roster.length } }
        : node));
      setNotice(t('noticeRosterPulled', { count: result.roster.length }));
    } catch (error) {
      setNotice(t('noticeRosterPullFailed', { reason: error instanceof Error ? error.message : String(error) }));
    }
  }, [setNodes, t]);

  /**
   * `gradebook.compute` — the matrix, mean, median, pass rate and distribution are
   * already `derive`d live from the submissions on the board (see
   * `academic/derivations.ts`); this action's job is to make that explicit and
   * reportable, stamping the figure onto the card the same way `sendUpdateToInvestors`
   * stamps what it sent rather than leaving it to be read off a toast that closes.
   */
  const computeGradebook = useCallback((gradebookId: string) => {
    const all = nodesRef.current;
    const target = all.find((node) => node.id === gradebookId && node.data.kind === 'gradebook');
    if (!target) return;
    const board = makeSpecDeriveBoard(all.map((node) => node.data as unknown as Record<string, unknown>));
    const stats = statsOf(target.data as unknown as Record<string, unknown>, board);
    if (!stats) { setNotice(t('noticeGradebookEmpty')); return; }
    setNodes((current) => current.map((node) => node.id === gradebookId
      ? { ...node, data: { ...node.data, status: `Computed — ${stats.mean ?? 0}% mean, ${stats.markedCount}/${stats.learnerCount} marked`, computedAt: new Date().toISOString() } }
      : node));
    setNotice(t('noticeGradebookComputed', { mean: stats.mean ?? 0, marked: stats.markedCount, total: stats.learnerCount }));
  }, [setNodes, t]);

  /** Why {@link rubricProblems} refused to mark, in one short clause. */
  const rubricBlockReason = (code: string): string => (code === 'noLevels'
    ? 'it declares no achievement levels'
    : code === 'noCriteria'
      ? 'it declares no criteria'
      : 'every criterion weight is zero');

  /**
   * `submission.mark` — apply the rubric to the placements already authored onto
   * `submission.placements`, apply the assignment's late policy, and write the
   * result. Never invents a judgement: the placements are the input, `applyRubric`
   * and `applyLatePolicy` are the same engines the gradebook already trusts, and a
   * submission with no placements yet is refused rather than marked zero.
   */
  const markSubmission = useCallback((submissionId: string) => {
    const all = nodesRef.current;
    const submission = all.find((node) => node.id === submissionId && node.data.kind === 'submission');
    if (!submission) return;
    const board = makeSpecDeriveBoard(all.map((node) => node.data as unknown as Record<string, unknown>));
    const assignment = board.byRef('assignment', submission.data.assignmentRef);
    const rubric = assignment ? board.byRef('rubric', assignment.rubricRef) : null;
    if (!assignment || !rubric) { setNotice(t('noticeSubmissionNoRubric')); return; }

    const parsedRubric = rubricFromNode(rubric);
    const maxMarks = Number(assignment.maxMarks);
    const problems = rubricProblems(parsedRubric, Number.isFinite(maxMarks) ? maxMarks : undefined);
    const blocking = problems.find((problem) => problem.code === 'noLevels' || problem.code === 'noCriteria' || problem.code === 'weightsZero');
    if (blocking) { setNotice(t('noticeSubmissionRubricBroken', { reason: rubricBlockReason(blocking.code) })); return; }

    const placements = Array.isArray(submission.data.placements) ? submission.data.placements : [];
    if (!placements.length) { setNotice(t('noticeSubmissionNoPlacements')); return; }
    const selections: CriterionSelection[] = placements.flatMap((raw): CriterionSelection[] => {
      if (!raw || typeof raw !== 'object') return [];
      const row = raw as Record<string, unknown>;
      const criterion = String(row.criterion ?? '').trim();
      const levelIndex = Number(row.levelIndex);
      if (!criterion || !Number.isInteger(levelIndex)) return [];
      return [{ criterion, levelIndex, comment: typeof row.comment === 'string' ? row.comment : undefined }];
    });
    const result = applyRubric(parsedRubric, selections);
    if (result.unmarked.length) { setNotice(t('noticeSubmissionPlacementsIncomplete', { criteria: result.unmarked.join(', ') })); return; }

    const policy = parseLatePolicy(assignment.latePolicy);
    const hours = hoursLate(submission.data.submittedAt, assignment.dueAt);
    const late = applyLatePolicy(result.total, hours, policy);
    const percent = parsedRubric.totalMarks > 0 ? Math.round((late.mark / parsedRubric.totalMarks) * 1000) / 10 : 0;

    const commentNotes = result.breakdown.map((row) => row.comment).filter(Boolean).join(' ');
    const lateNote = late.daysLate > 0
      ? ` Submitted ${late.daysLate} day${late.daysLate === 1 ? '' : 's'} late; ${late.deducted} marks deducted under the late policy.`
      : '';
    const feedback = `${commentNotes}${lateNote}`.trim();
    const markBreakdown = result.breakdown.map((row) => ({ criterion: row.criterion, level: row.level, marks: row.marks, comment: row.comment }));

    setNodes((current) => current.map((node) => node.id === submissionId
      ? { ...node, data: { ...node.data, mark: late.mark, markBreakdown, feedback, status: `Marked — ${percent}%` } }
      : node));

    const learnerName = String(submission.data.learnerName ?? submission.data.learnerRef ?? '');
    const learnerRef = String(submission.data.learnerRef ?? '').trim();
    const cohort = board.byRef('cohort', assignment.cohortRef);
    const issuer = cohort ? String(cohort.ltiIssuer ?? '').trim() : '';
    const lineItemUrl = String(assignment.ltiLineItemUrl ?? '').trim();

    const baseNotice = late.daysLate > 0
      ? t('noticeSubmissionMarkedLate', { name: learnerName, percent, mark: late.mark, total: parsedRubric.totalMarks, days: late.daysLate, deducted: late.deducted })
      : t('noticeSubmissionMarked', { name: learnerName, percent, mark: late.mark, total: parsedRubric.totalMarks });

    if (issuer && lineItemUrl && learnerRef) {
      pushLtiScore({
        issuer, lineItemUrl, userId: learnerRef, scoreGiven: late.mark, scoreMaximum: parsedRubric.totalMarks,
        released: true, ...(feedback ? { comment: feedback } : {}),
      })
        .then(() => setNotice(`${baseNotice} ${t('noticeSubmissionScorePushed')}`))
        .catch((error) => setNotice(`${baseNotice} ${t('noticeSubmissionScorePushFailed', { reason: error instanceof Error ? error.message : String(error) })}`));
    } else {
      setNotice(baseNotice);
    }
  }, [setNodes, t]);

  /**
   * `curriculumMap.validate` — structural problems the coverage figure alone cannot
   * show: an outcome nobody mapped, a mapping column naming an assessment that is
   * not actually on this board. See `curriculumMapProblems`.
   */
  const validateCurriculumMap = useCallback((curriculumMapId: string) => {
    const all = nodesRef.current;
    const target = all.find((node) => node.id === curriculumMapId && node.data.kind === 'curriculumMap');
    if (!target) return;
    const board = makeSpecDeriveBoard(all.map((node) => node.data as unknown as Record<string, unknown>));
    const data = target.data as unknown as Record<string, unknown>;
    const problems = curriculumMapProblems(data, board);
    const rows = mappingRows(data);
    const coverage = rows.length ? Math.round((rows.filter((row) => row.assured).length / rows.length) * 100) : 0;
    setNodes((current) => current.map((node) => node.id === curriculumMapId
      ? { ...node, data: { ...node.data, status: problems.length ? `Validated — ${problems.length} issue(s)` : 'Validated — fully mapped', validatedAt: new Date().toISOString() } }
      : node));
    setNotice(t('noticeCurriculumMapValidated', { coverage, issues: problems.length }));
  }, [setNodes, t]);

  /**
   * `bibliography.import`'s GENERIC path — invoked with no reference text, so it
   * looks for a `.bib`/`.ris` export already sitting on the board as a document (the
   * same shape `canvas_import_resume` reads a résumé out of) and parses that. A
   * pasted or uploaded reference list goes through the dedicated
   * `canvas_import_references` tool instead, which has the text directly.
   */
  const importReferencesFromDocument = useCallback((bibliographyId: string) => {
    const all = nodesRef.current;
    const target = all.find((node) => node.id === bibliographyId && node.data.kind === 'bibliography');
    if (!target) return;
    const candidate = all
      .map((node) => ({ node, records: parseReferences(canvasDocument(node.data)?.markdown ?? '') }))
      .find((entry) => entry.records.length > 0);
    if (!candidate) { setNotice(t('noticeReferencesImportEmpty')); return; }
    const existing = Array.isArray(target.data.entries) ? target.data.entries : [];
    setNodes((current) => current.map((node) => node.id === bibliographyId
      ? { ...node, data: { ...node.data, entries: [...existing, ...candidate.records.map(entryRowFromRecord)] } }
      : node));
    setNotice(t('noticeReferencesImported', { count: candidate.records.length }));
  }, [setNodes, t]);

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
    else if (target.data.kind === 'evermind' && pending.action === 'train') openEvermindTraining();
    else if (target.data.kind === 'evermind' && pending.action === 'evaluate') evaluateEvermind(target.id);
    else if (target.data.kind === 'testPlan' && pending.action === 'gate') evaluateReleaseGate(target.id);
    else if (target.data.kind === 'investorUpdate' && pending.action === 'send') void sendUpdateToInvestors(target.id);
    else if (target.data.kind === 'assignment' && pending.action === 'distribute') distributeAssignment(target.id);
    else if (target.data.kind === 'cohort' && pending.action === 'import') void importCohortRosterFromLti(target.id);
    else if (target.data.kind === 'gradebook' && pending.action === 'compute') computeGradebook(target.id);
    else if (target.data.kind === 'submission' && pending.action === 'mark') markSubmission(target.id);
    else if (target.data.kind === 'curriculumMap' && pending.action === 'validate') validateCurriculumMap(target.id);
    else if (target.data.kind === 'bibliography' && pending.action === 'import') importReferencesFromDocument(target.id);
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
  }, [compareProjects, compileWorkflow, computeGradebook, convertObjectToDiagram, deliverMockup, distributeAssignment, evaluateEvermind, evaluateReleaseGate, expandMockupSet, expandProject, exportArtifact, generateVideo, importCohortRosterFromLti, importReferencesFromDocument, markSubmission, nodes, openBuild, openEvermindTraining, pendingBrainActions, persistence, plotDataset, profileDataset, publishWebsite, runCreativeAction, runWorkflow, selectedId, sendUpdateToInvestors, setEdges, setNodes, startStandup, validateCurriculumMap, visualizeDataset]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    if (persistence !== 'server') return;
    void creationSessionsApi.history.list(sessionId).then((result) => setHistory(result.snapshots))
      .catch((error) => setNotice(error instanceof Error ? error.message : t('noticeLoadHistoryFailed')));
  }, [persistence, sessionId]);

  const restoreRevision = useCallback((targetRevision: number) => {
    if (!canEdit || persistence !== 'server') return;
    setNotice(t('noticeRestoringRevision', { revision: targetRevision }));
    void creationSessionsApi.history.get(sessionId, targetRevision).then((snapshot) => {
      const restored = flowFromSnapshotGraph(snapshot.graph);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setHistoryOpen(false);
      setNotice(t('noticeRevisionRestored', { revision: targetRevision }));
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeRestoreRevisionFailed')));
  }, [canEdit, persistence, sessionId, setEdges, setNodes]);

  const createCheckpoint = useCallback(() => {
    if (persistence !== 'server' || !canEdit) return;
    const label = window.prompt('Name this checkpoint')?.trim(); if (!label) return;
    void creationSessionsApi.history.checkpoint(sessionId, label).then(() => {
      setNotice(t('noticeCheckpointSaved', { label }));
      return creationSessionsApi.history.list(sessionId);
    }).then((result) => setHistory(result.snapshots)).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeSaveCheckpointFailed')));
  }, [canEdit, persistence, sessionId]);

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
    }).catch((error) => setNotice(error instanceof Error ? error.message : t('noticeExportFailed')));
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
  const threeDNodes = useMemo(() => renderedNodes.filter((node) => node.hidden !== true), [renderedNodes]);
  /** Paints `taskDependencyAnalysis`'s critical path onto the board: the `blocks`
   *  edges connecting two critical-path tasks get a heavier, accented stroke instead
   *  of the shared default — the first per-edge styling this board does, so it is
   *  additive over `defaultEdgeOptions` rather than replacing it. */
  const renderedEdges = useMemo(() => edges.map((edge) => edge.data?.connectionKind === 'blocks' && criticalPathTaskIds.has(edge.source) && criticalPathTaskIds.has(edge.target)
    ? { ...edge, animated: true, style: { ...edge.style, stroke: 'var(--error-text)', strokeWidth: 3 } }
    : edge), [edges, criticalPathTaskIds]);
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
  const selectThreeDObject = useCallback((id: string) => {
    setInspectorFocus(null);
    setSelectedId(id);
    setSelectedIds([id]);
  }, []);
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
    if (!value) return;
    if (queuedTurns.submit(value)) {
      if (text === undefined) setPrompt('');
      return;
    }
    evaluateCanvasRef.current(text);
  }, [prompt, queuedTurns]);
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
    creation: (props) => <CreationNode {...props} canRun={canRun} onRun={runWorkflowFromNode} onExport={exportFromNode} onOpenBuiltinAgent={openBuiltinAgentSurfaceFromNode} onOpenPanel={openNodePanel} onInsertFrom={openInsertPicker} onOpenSurface={(nodeId, surface) => setSurface(surface, nodeId)} {...(cardsEditable ? { onEditData: updateNodeData } : {})} onOpenDetails={(nodeId, focus) => {
      setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
      // Asking for a specific section (knowledge, test, evaluation, delivery) is asking
      // for the WIDE panel directly — the short one has no such section to scroll to.
      setSelectedId(nodeId); setSelectedIds([nodeId]); openNodeInspector(nodeId, focus || null);
    }} />,
  }), [canRun, cardsEditable, exportFromNode, openBuiltinAgentSurfaceFromNode, openInsertPicker, openNodeInspector, openNodePanel, runWorkflowFromNode, setSurface, updateNodeData]);
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
      .catch((error) => setOutcomeMetricsError(error instanceof Error ? error.message : t('noticeOutcomeMetricsFailed')))
      .finally(() => setOutcomeMetricsLoading(false));
  }, [persistence, sessionId]);

  const formatOutcomeValue = useCallback((value: number | null, unit: string) => {
    if (value == null) return 'Not measured';
    if (unit === 'percent') return `${Math.round(value * 100)}%`;
    if (unit === 'usd') return `$${value.toFixed(2)}`;
    if (unit === 'seconds') return value >= 60 ? `${(value / 60).toFixed(value >= 600 ? 0 : 1)} min` : `${Math.round(value)} sec`;
    if (unit === 'agents') return `${value.toFixed(value % 1 ? 1 : 0)} agent${value === 1 ? '' : 's'}`;
    return value.toFixed(value % 1 ? 1 : 0);
  }, []);

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
      : inRoom && room.participants.length
        ? room.participants.map((person) => ({ userId: `guest:${person.name}:${person.joinedAt}`, displayName: person.name, role: person.isHost ? ('owner' as const) : ('editor' as const) }))
        : [{ userId: 'local', displayName: t('you'), role: 'owner' as const }]),
    [inRoom, members, persistence, room.participants, t],
  );

  const brainSurfaceOpen = !presentMode && brainDock.open;
  const brainCollaborators = useMemo(
    () => members.filter((member) => member.userId !== currentUserId),
    [currentUserId, members],
  );
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
  const brainSurface = useMemo<BrainSurfaceContextValue>(() => ({
    open: brainSurfaceOpen,
    canOpen: !presentMode,
    mode: brainPlacement,
    showExecutionDetail: brainDock.showExecutionDetail,
    running: thinking,
    runStartedAt: brainRunStartedAt,
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
    brainCollaborators, brainDock.showExecutionDetail, brainMessages, brainPlacement, brainRatings, brainRunStartedAt,
    brainSurfaceOpen, brainTrace, edges, guestSignupPrompt, joinedCollaborator, nodes, openBrainDock, persistence,
    presentMode, rateBrainMessage, replayBrainMessage, thinking, updateBrainDock,
  ]);

  /**
   * The prompt lives in the centre of the board, bottom-aligned — where ChatGPT and
   * every other chat product people already use puts it. It is deliberately NOT part
   * of the Brain surface: it stays put and stays reachable whether Brain is inline in
   * its Object, docked to either edge, or closed entirely.
  */
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

  /**
   * `data-testid` on the composer, the board, the palette and every node.
   *
   * ── WHY THESE EXIST ──────────────────────────────────────────────────────────
   * The canvas shipped with ZERO test ids, so `qa-e2e/tests/creation-canvas.spec.ts`
   * selected by accessible name — `/session title/i`, `/ask brain/i`. Two silent
   * consequences: the suite could not run in any of the four non-English locales the
   * product ships, and a copy edit turned it red with no behaviour change (which had
   * already happened for "Create free account" vs "Create a free account"). The
   * Agentic Tester has the same problem one layer down: `QaHeatZone.selector` wants a
   * stable selector for an element-level hot zone, and the product's most important
   * surface offered none.
   *
   * They are additive: every aria-label stays, because a test id is for a test and an
   * accessible name is for a person.
   */
  // When Brain IS the surface (chat mode), there is no separate dock to join and no board
  // behind it to hand the composer's space back to — it is the surface's only input, so it
  // stays fixed, centred and always open, exactly like `CanvasChatSurface`'s docs describe.
  // `float`/`docked`/`closed` remain a per-browser preference for every OTHER surface; chat
  // just declines to read it, the same way `BrainSurfaceActions` declines the dock toggle
  // (see the `onModeChange` comment in `CanvasChatSurface.tsx`).
  //
  // `docked` means the prompt is rendered INSIDE the Brain panel's column (see `BrainDock`),
  // so it only holds while that panel is actually on screen. With Brain closed, inline in
  // its Object, or replaced by a surface that IS the conversation, there is no column to be
  // the last row of — so the preference is untouched and the prompt floats until the panel
  // comes back, rather than being drawn into a panel that is not there.
  const brainDockDrawn = brainSurfaceOpen && brainPlacement === 'docked' && !surfaceDef.brainIsSurface;
  const effectivePromptPlacement: CanvasPromptPlacement = surfaceDef.brainIsSurface
    ? 'float'
    : promptPlacement === 'docked' && !brainDockDrawn ? 'float' : promptPlacement;
  const promptInBrainPanel = effectivePromptPlacement === 'docked';
  const composer = !presentMode && effectivePromptPlacement !== 'closed' && <div
    // Measured ONLY while it floats over the board. In the Brain panel it is that panel's
    // last row rather than the board's chrome, so the band the board reserves for it is
    // zero — publishing the panel-relative height instead would push every low-anchored
    // panel up by most of the window. `useChromeSpace` publishes `0px` the moment
    // this ref stops being handed the node.
    ref={promptInBrainPanel ? undefined : composerDockRef}
    data-testid="canvas-composer"
    className={styles.composerDock}
    data-placement={effectivePromptPlacement}
    data-tour="creation-brain-dock"
  >
    {/* The prompt's own header, and the only place the dock decision is made. Closing is
        offered from here and from the command bar; DOCKING is deliberate enough to belong
        only on the thing being docked. Neither is offered while chat is the surface.
        Inside the Brain panel the whole row stands down: that panel has a header of its
        own naming this conversation, and the way back out is a control in it. */}
    {!promptInBrainPanel && <div className={styles.promptChrome}>
      <span className={styles.promptChromeName}>{t('promptName')}</span>
      {!surfaceDef.brainIsSurface && <>
        <button
          type="button"
          data-testid="canvas-prompt-dock"
          aria-pressed={promptPlacement === 'docked'}
          aria-label={promptPlacement === 'docked' ? t('floatPrompt') : t('dockPrompt')}
          title={promptPlacement === 'docked' ? t('floatPrompt') : t('dockPrompt')}
          // Docking puts the prompt in the Brain panel, so it OPENS that panel: a control
          // whose whole effect is invisible until you separately find the launcher reads
          // as a control that did nothing.
          onClick={() => {
            const next = promptPlacement === 'docked' ? 'float' : 'docked';
            setPromptPlacement(next);
            if (next === 'docked' && !brainDockDrawn) updateBrainDock({ open: true, mode: 'docked' });
          }}
        ><Icon name={promptPlacement === 'docked' ? 'external-link' : 'message'} size={14} /></button>
        <button
          type="button"
          data-testid="canvas-prompt-close"
          aria-label={t('hidePrompt')}
          title={t('hidePrompt')}
          onClick={() => setPromptPlacement('closed')}
        ><Icon name="close" size={15} /></button>
      </>}
    </div>}
    <div className={styles.composerUtilities}>
      {/* Keep the settled receipt mounted after the run. Token consumption used
          to disappear at the exact moment the answer arrived because this whole
          component was conditional on `thinking`.

          Not in the Brain panel: that panel's own footer (`BrainActivityBar`) is the
          same reading of the same run, from the same `useBrainActivity` state, and two
          copies of "Executing… read object · 36s" eight pixels apart is one live turn
          reported twice. */}
      {!promptInBrainPanel && <BrainActivityIndicator
        running={thinking}
        trace={brainTrace}
        startedAt={brainRunStartedAt}
        variant="composer"
      />}
      {promptStarter}
    </div>
    <div className={styles.promptComposerShell} style={{ '--canvas-prompt-height': `${promptHeight}px` } as CSSProperties}>
      <div
        role="separator"
        tabIndex={0}
        className={styles.promptResizeHandle}
        aria-label={t('resizePrompt')}
        aria-orientation="horizontal"
        aria-valuemin={34}
        aria-valuemax={240}
        aria-valuenow={promptHeight}
        onPointerDown={handlePromptResizeStart}
        onPointerMove={handlePromptResizeMove}
        onPointerUp={handlePromptResizeEnd}
        onPointerCancel={handlePromptResizeEnd}
        onLostPointerCapture={() => { promptResizeRef.current = null; }}
        onKeyDown={handlePromptResizeKeyDown}
      >
        <span aria-hidden="true">↕</span>
      </div>
      <ChatInput
      className={styles.composer}
      value={prompt}
      onChange={setPrompt}
      onSubmit={startCanvasTurn}
      placeholder={t('askBrain')}
      submitLabel={t('sendBrain')}
      // NEVER disabled while Brain works. An empty composer offers Stop (which
      // interrupts the run); typing into it queues the next turn. The box being
      // greyed out for the length of a research turn was the single most common
      // way the canvas read as hung.
      running={thinking}
      onStop={stopCanvasRun}
      queuedCount={queuedTurns.count}
      rows={1}
      submitOnEnter
      contextControls={<>
        <label className={styles.scopeChip}>⌁ <span className="sr-only">{t('brainScope')}</span><select aria-label={t('brainScope')} value={scopeMode} onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)}><option value="auto">{scopeLabel}</option><option value="canvas">{t('entireCanvas')}</option><option value="selection" disabled={!effectiveSelectedIds.length}>{effectiveSelectedIds.length > 1 ? t('selectedObjects', { count: effectiveSelectedIds.length }) : t('selectedObject')}</option><option value="connected" disabled={!effectiveSelectedIds.length}>{t('connectedScope')}</option><option value="frame" disabled={selectedNode?.data.kind !== 'frame'}>{t('currentFrame')}</option></select></label>
      </>}
      onAttach={attachCanvasArtifact}
      onAddContext={openPalette}
      autoMode={autoApply}
      onAutoModeChange={setAutoApplyMode}
      modelSelection={modelSelection}
      modelOptions={canvasModelOptions}
      onModelSelectionChange={setModelSelection}
      modelIdentity={modelIdentity}
    // Mode and memory live in the `/` menu now — on a phone this row had grown to
    // eight unlabelled circles, and the two settings that actually decide what a turn
    // does were the two hardest to read. The menu's trigger names the armed mode, so
    // nothing has to be opened to see whether this turn can dispatch work.
      chatMode={sessionMode}
      onChatModeChange={setSessionMode}
      memoryEnabled={memoryEnabled}
      onMemoryChange={setMemoryMode}
      memoryUnavailableReason={evermindProjectId == null || persistence !== 'server' ? t('memoryNeedsProject') : undefined}
      showVoice
      />
    </div>
  </div>;

  /**
   * What each session action DOES. The registry owns the rest — the glyph, the name, the
   * cluster it belongs to and whether a phone keeps it in the bar or in the ••• sheet —
   * so this map is behaviour only, and the desktop bar and the phone sheet are driven by
   * the same entry rather than by two copies of the same `onClick`.
   */
  const sessionActionHandlers: Record<CanvasSessionActionId, CanvasSessionActionHandler> = (() => {
    // Every one of these can be pressed from the ••• sheet as well as from the bar, and a
    // sheet that stays open over the panel it just opened is a sheet in the way. Wrapping
    // once here is what keeps that true for an action added later.
    const act = (run: () => void, active?: boolean): CanvasSessionActionHandler =>
      ({ run: () => { setMoreOpen(false); run(); }, active });
    return {
      undo: act(undo),
      redo: act(redo),
      outcomes: act(openOutcomeMetrics, outcomeMetricsOpen),
      diagnostics: act(() => void openDiagnostics(), diagnosticsOpen),
      fullscreen: act(toggleFullscreen, fullscreen),
      // The call is a session action like any other, so it is in the bar on every
      // surface instead of in a band of chrome of its own. Two session facts decide how
      // it is drawn, and neither is something the registry could know:
      //   `disabled`  — there is no room to open here (a canvas that lives only on this
      //                 device and has not been shared has nobody to call).
      //   `available` — a call is ALREADY running, so the dock at the bottom of the
      //                 shell is the control from now on and this one withdraws rather
      //                 than sitting beside it lit up doing nothing.
      call: { ...act(() => liveRoom?.start()), disabled: !liveRoom?.canStart, available: liveRoom?.live !== true },
      // A local canvas opens the SAME share sheet a saved one does. It used to open a
      // sign-up gate, which answered a question nobody asked: they wanted to show
      // someone the board, not to create an account.
      share: act(() => setShareOpen((value) => !value), shareOpen),
      // The whole board, not a card: an application is the session, and this is the
      // door that was previously reachable only from a selected object's inspector
      // under "Sell in the marketplace". Same lifecycle, same gate — `openReleasesPanel`
      // already refuses a board with nothing on a server and says why.
      publish: act(() => openReleasesPanel(), releaseFocus !== null),
    };
  })();

  return (
    // Published to the whole shell, not just the board: the Brain surface's controls
    // render in three places and each needs the same answer to "is there a board to move
    // this conversation into?". One provider, read where it is needed.
    <CanvasSurfaceProvider value={surface}>
    <div
      ref={shellRef}
      className={`${styles.canvasShell} app-full-height`}
      data-fullscreen={fullscreen ? 'true' : 'false'}
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
          There is no chrome band any more. The board takes the whole shell and each
          piece of chrome floats over it in the region `lib/canvasChrome.ts` gives it:
          what this canvas IS (top left), how it is READ (top centre), how work LEAVES
          it (top right), and what you DO to it (the one bar, bottom centre).

          The band this replaced was 54px of full-width surface holding a title, a
          switcher, seven buttons, a roster and a save button — mostly empty space
          between things with nothing to do with each other, drawn ABOVE a hard line
          that made the board start below the chrome rather than run behind it. */}
      <CanvasSessionPill
        title={title}
        onTitleChange={setTitle}
        onTitleCommit={() => { if (persistence === 'server') void creationSessionsApi.update(sessionId, { title }).then(() => setNotice(t('saved'))).catch(() => setNotice(t('titleSaveFailed'))); }}
        notice={notice}
        // A board that lives only on this device has no connection to report, and
        //  is that absence rather than a fifth connection state — so it is
        // narrowed away here rather than given a label the pill would have to invent.
        realtimeState={realtimeState === 'local' ? undefined : realtimeState}
      />
      {/* Which surface this canvas is read through, ON the canvas rather than in a bar
          across it. The phone's copy of this decision lives in the board's control
          column; the stylesheet keeps exactly one on screen. */}
      {canvasChromeShows('surfaces', barCollapsed) && <div className={`${styles.floatCard} ${styles.surfaceChips}`}>
        <CanvasSurfaceSwitcher surface={surface} onChange={setSurface} variant="header" />
      </div>}
      <div ref={topChromeSpaceRef} className={`${styles.floatCard} ${styles.topRightCard}`} data-testid="canvas-handoff">
          {/* The two doors OUT of this canvas — bring a person in, or put the result
              where strangers can reach it. They are the only worded actions in the
              registry and they are here for the same reason they are worded: a glyph
              acts on the board, a word opens somewhere else. */}
          <CanvasSessionActions variant="handoff" surface={surface} collapsed={barCollapsed} handlers={sessionActionHandlers} />
          {canvasChromeShows('actions', barCollapsed) && <button className={`${styles.secondaryButton} ${styles.iconAction}`} aria-expanded={moreOpen} aria-label={t('moreActions')} title={t('moreActions')} onClick={() => { setMoreOpen((value) => !value); setShareOpen(false); }}><MoreActionsIcon /></button>}
          {canvasChromeShows('save', barCollapsed) && persistence === 'local' && <button className={`${styles.secondaryButton} ${styles.saveButton}`} aria-label={t('saveCollaborate')} onClick={() => requireAccount('save', t('gateSaveTitle'), t('gateSaveBody'))}><span className={styles.saveButtonFull}>{t('saveCollaborate')}</span><span className={styles.saveButtonShort} aria-hidden>{t('save')}</span></button>}
          {moreOpen && <div className={styles.moreMenu} data-testid="canvas-more-menu" aria-label={t('moreActions')}>
            {/* First, because these are the session-bar actions a phone gave up its
                room for — including the only way to invite anybody, which used to be
                reachable on a desktop and nowhere else. On a desktop the bar already
                draws them, so the section stands down. */}
            <div className={styles.moreMenuPhoneOnly}>
              <span className={styles.moreMenuHeading}>{t('moreMenuSessionActions')}</span>
              {/* Never collapsed: the ••• sheet IS the phone's expanded state, and folding the
                  actions out of the one place a phone can reach them would leave a small
                  screen with no undo and no way to share. */}
              <CanvasSessionActions variant="menu" surface={surface} handlers={sessionActionHandlers} />
            </div>
            <span className={styles.moreMenuHeading}>{t('createAndView')}</span>
            <button onClick={() => { setTemplateOpen(true); setMoreOpen(false); }}><span aria-hidden><Icon source="▦" size="1em" /></span>{t('templates')}</button>
            <button onClick={() => { setConversationOpen((value) => !value); setMoreOpen(false); }}><span aria-hidden><Icon source="◌" size="1em" /></span>{t('conversation')}</button>
            <button aria-pressed={drawingMode} onClick={() => { setDrawing((current) => current ? null : readDrawingPreferences()); setMoreOpen(false); }}><span aria-hidden>⌁</span>{drawingMode ? t('stopDrawing') : t('draw')}</button>
            <button onClick={() => { setPresentMode((value) => !value); setMoreOpen(false); }}><span aria-hidden><Icon source="▶" size="1em" /></span>{presentMode ? t('exitPresentation') : t('present')}</button>
            {/* Errands against a connected account, kept off the rail. Each one
                opens the SAME dock panel its rail button used to, drawn with the
                same glyph, so this is a move rather than a second entry point. */}
            <span className={styles.moreMenuHeading}>{t('connectedSources')}</span>
            <button aria-pressed={dockPanel === 'miro'} onClick={() => { if (connectedAccountGate(tMiro('title'))) toggleDockPanel('miro'); setMoreOpen(false); }}><span aria-hidden><CanvasMiroIcon /></span>{tMiro('title')}</button>
            <button aria-pressed={dockPanel === 'social'} onClick={() => { if (connectedAccountGate(tSocial('title'))) toggleDockPanel('social'); setMoreOpen(false); }}><span aria-hidden><CanvasSocialIcon /></span>{tSocial('title')}</button>
            <button aria-pressed={dockPanel === 'ads'} onClick={() => { if (connectedAccountGate(tAds('title'))) toggleDockPanel('ads'); setMoreOpen(false); }}><span aria-hidden><CanvasAdsIcon /></span>{tAds('title')}</button>
            <span className={styles.moreMenuHeading}>{t('sessionTools')}</span>
            <button onClick={() => { openHistory(); setMoreOpen(false); }}><span aria-hidden>↶</span>{t('history')}</button>
            <button onClick={() => { exportSession(); setMoreOpen(false); }}><span aria-hidden>↓</span>{t('exportCanvas')}</button>
            <button onClick={() => { sectionTour.openOffer(); setMoreOpen(false); }}><span aria-hidden>?</span>{t('tutorial')}</button>
            <button onClick={() => { setShowHidden((value) => !value); setMoreOpen(false); }}><span aria-hidden>◉</span>{showHidden ? t('hideHidden') : t('showHidden')}</button>
            <button onClick={() => { createBranch(); setMoreOpen(false); }}><span aria-hidden>⑂</span>{t('branch')}</button>
            {branchParentId && <button onClick={() => { prepareMerge(); setMoreOpen(false); }}><span aria-hidden>⇄</span>{t('merge')}</button>}
            <label><span><i aria-hidden>⌁</i>{t('edge')}</span><select aria-label={t('connectionKind')} value={connectionKind} onChange={(event) => setConnectionKind(event.target.value as CreationConnectionKind)}>{CREATION_CONNECTION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          </div>}
          {shareOpen && <div className={styles.shareMenu} role="dialog" aria-label={t('inviteCollaborators')}>
            <div className={styles.shareMenuHeader}>
              <strong>{t('inviteCollaborators')}</strong>
              <button type="button" className={styles.shareMenuClose} aria-label={t('closeInvitationPanel')} onClick={() => setShareOpen(false)}>×</button>
            </div>
            <p>{persistence === 'local' ? (inRoom ? t('sharedLiveHint') : t('sharedInviteHint')) : t('invitedCanBuild')}</p>
            {/* NO ACCOUNT: invite by link into a shared free session. Everyone edits
                the same board and shares one free-message allowance; signing up is
                offered as the way to KEEP it, not as the price of sharing it. */}
            {persistence === 'local' ? (inRoom && roomCode ? <>
              <GuestInviteLink code={roomCode} surface="canvas" full={room.participants.length >= (room.state?.maxParticipants ?? 0)} />
              <div className={styles.shareRoomPeople} aria-label={t('sharedPeopleHere', { count: room.participants.length })}>
                {room.participants.map((person) => <span key={`${person.name}-${person.joinedAt}`}>{person.name}{person.isHost ? ` ${t('sharedHostTag')}` : ''}</span>)}
              </div>
              <div className={styles.shareRoomActions}>
                <button type="button" onClick={() => void leaveSharedSession()}>{t('sharedStopSharing')}</button>
                <button type="button" onClick={() => requireAccount('save', t('gateSaveSessionTitle'), t('gateSaveBody'))}>{t('sharedSaveToKeep')}</button>
              </div>
              {/* No call button here. "Get someone in here" and "talk to them" are one
                  errand, but they are not one CONTROL: the call is a session action in
                  the bar on every surface and in both auth states, and a second copy in
                  this panel would be one decision with two homes. */}
            </> : <button disabled={roomBusy} onClick={() => void startSharedSession()}>{roomBusy ? t('sharedStarting') : t('sharedStart')}</button>) : <>
              <div><input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder={t('emailPlaceholder')} /><select aria-label={t('invitationRole')} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as CreationSessionSummary['role'])}><option value="viewer">{t('roleViewer')}</option><option value="commenter">{t('roleCommenter')}</option><option value="editor">{t('roleEditor')}</option><option value="runner">{t('roleRunner')}</option><option value="owner">{t('roleOwner')}</option></select><button disabled={!inviteEmail.trim()} onClick={() => { void creationSessionsApi.invite(sessionId, { email: inviteEmail.trim() }, inviteRole).then(async (result) => { if ('acceptPath' in result) { await copyTextToClipboard(`${canvasWebOrigin()}${result.acceptPath}`); setPendingInvitations((current) => [...current.filter((item) => item.id !== result.invitationId), { id: result.invitationId, email: result.email, role: result.role as CreationSessionSummary['role'], expiresAt: result.expiresAt, acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString() }]); setNotice(result.emailSent ? t('invitationEmailed') : t('invitationSavedLinkCopied')); } else { const detail = await creationSessionsApi.get(sessionId); setAllMembers(detail.members); setNotice(result.emailSent ? t('collaboratorInvitedEmail') : t('collaboratorInvited')); } setInviteEmail(''); }).catch((error) => setNotice(error instanceof Error ? error.message : t('inviteFailed'))); }}>{t('invite')}</button></div>
              {sessionRole === 'owner' && <div aria-label={t('sessionMembers')}>{allMembers.map((member) => <div key={member.userId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span>{member.displayName || t('collaborator')}{member.userId === currentUserId ? ` ${t('youSuffix')}` : ''}</span>
                <select aria-label={t('roleFor', { name: member.displayName || member.userId })} value={member.role} onChange={(event) => { const role = event.target.value as CreationSessionSummary['role']; void creationSessionsApi.members.update(sessionId, member.userId, role).then(() => setAllMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item))).catch((error) => setNotice(error instanceof Error ? error.message : t('roleUpdateFailed'))); }}><option value="viewer">{t('roleViewer')}</option><option value="commenter">{t('roleCommenter')}</option><option value="editor">{t('roleEditor')}</option><option value="runner">{t('roleRunner')}</option><option value="owner">{t('roleOwner')}</option></select>
                <button type="button" disabled={member.userId === currentUserId} aria-label={t('removeMember', { name: member.displayName || t('member') })} onClick={() => { void creationSessionsApi.members.remove(sessionId, member.userId).then(() => setAllMembers((current) => current.filter((item) => item.userId !== member.userId))).catch((error) => setNotice(error instanceof Error ? error.message : t('memberRemovalFailed'))); }}>×</button>
              </div>)}{!!pendingInvitations.length && <div aria-label={t('pendingInvitations')} style={{ marginTop: 10 }}><strong>{t('pendingInvitations')}</strong>{pendingInvitations.map((invitation) => <div key={invitation.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span>{invitation.email}</span><small>{invitation.role}</small><button type="button" aria-label={t('revokeInvitation', { email: invitation.email })} onClick={() => { void creationSessionsApi.invitations.revoke(sessionId, invitation.id).then(() => { setPendingInvitations((current) => current.filter((item) => item.id !== invitation.id)); setNotice(t('invitationRevoked')); }).catch((error) => setNotice(error instanceof Error ? error.message : t('invitationRevokeFailed'))); }}>×</button>
              </div>)}</div>}</div>}
            </>}
            <small>{t('accessLabel', { access: persistence === 'local' ? (inRoom ? t('sharedAnyoneWithLink') : t('privateOnDevice')) : inviteRole })}</small>
          </div>}
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
      </div>

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
        >{expanded ? <Inspector node={target} nodes={nodes} edges={edges} focus={inspectorFocus} timeline={timeline} brainTrace={brainTrace} sessionId={sessionId} persistence={persistence} role={sessionRole} editable={canEdit && !lockBlocked} members={members} onChange={(patch) => updateNodeData(target.id, patch)} onWebsiteViewportChange={(viewport) => updateWebsiteViewport(target.id, viewport)} onRun={runWorkflow} onPublishWebsite={() => publishWebsite(target.id)} onOpenBuild={() => openBuild(target.id)} onAttachBuild={(ide) => attachBuild(target.id, ide)} onDeleteBuildWorkspace={() => deleteBuildWorkspace(target.id)} onBuildWebsiteWithCode={() => buildWebsiteWithCode(target.id)} creatingBuild={creatingBuild} onGenerateVideo={() => generateVideo(target.id)} onRunCreativeAction={(action) => runCreativeAction(target.id, action)} onShipGame={() => openGamePanel(target.id)} onPublishListing={() => openPublishPanel(target.id)} onOpenReleases={() => openReleasesPanel(target.id)} onEditWorkflow={() => setWorkflowFocus({ nodeId: target.id, definitionId: target.data.resourceId?.startsWith('workflow:') ? target.data.resourceId.slice('workflow:'.length) : null })} onBuildWorkflow={() => { void compileWorkflow(target.id); }} onSaveAgent={saveAgent} onOpenBuiltinAgent={(intent) => openBuiltinAgentSurfaceFromNode(target.id, intent)} onAddAgentKnowledge={(content) => addAgentKnowledge(target.id, content)} onRunAgentTest={(testPrompt, expected) => runAgentTest(target.id, testPrompt, expected)} onSaveFramePreset={saveFramePreset} onExpandProject={expandProject} onLoadProjectQuality={loadProjectQuality} onCompareProjects={compareProjects} onDeliverMockup={deliverMockup} onExpandMockupSet={expandMockupSet} onImportDataset={importDataset} onVisualizeDataset={visualizeDataset} onPlotDataset={plotDataset} onProfileDataset={profileDataset} onAttachEvermindProject={attachEvermindProject} onExpandEvermindPipeline={expandEvermindPipeline} onTrainEvermind={openEvermindTraining} onStartStandup={startStandup} onConvertDiagram={async (format, diagramId) => { const result = await convertObjectToDiagram(target.id, format, diagramId); return result.ok ? t(diagramId && diagramId !== '__new__' ? 'diagramAddedStatus' : 'diagramCreatedStatus') : result.error || t('drawioAppendFailed'); }} onExportArtifact={(action) => exportArtifact(target.id, action)} onAskBrain={(request) => { openBrainDock(); evaluateCanvas(request); }} onResumeTailor={tailorResumeFromNode} onResumeDetach={detachResumeFromNode} onResumeShare={createResumeShare} onResumeSharesList={listResumeShares} onResumeShareRevoke={revokeResumeShare} /> : null}</CanvasNodePanel>;
      })()}

      {/* ONE picker, two doors: a node's `+` (insert, connected) and the command
          bar's category circles (add). Contents from `CREATION_PALETTE_GROUPS`, so it can
          never fall behind the object registry. */}
      {objectPicker && <CanvasObjectPicker
        anchor={objectPicker.anchor}
        {...(objectPicker.group ? { group: objectPicker.group } : {})}
        {...(objectPicker.fromNodeId ? { fromNodeId: objectPicker.fromNodeId } : {})}
        onPick={pickObject}
        onClose={() => setObjectPicker(null)}
      />}

      {/* THE bar. Everything you can do to what you are looking at, in one floating card
          — including whatever the SURFACE contributed, so an app's Run, its readings and
          the address it is running at land here rather than in a second toolbar of their
          own. See `CanvasCommandBar` for why one bar and why the bottom. */}
      <CanvasCommandBar
        // Its measured height becomes the band the prompt floats above. See the ref's
        // declaration: this used to be a literal that the App surface's own controls
        // overran, which is how the bar came to be drawn on top of the prompt.
        hostRef={commandBarSpaceRef}
        surface={surface}
        collapsed={barCollapsed}
        onToggleCollapse={() => setBarCollapsed(!barCollapsed)}
        handlers={sessionActionHandlers}
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
          setNodePanel(null);
          setObjectPicker({ anchor: { x: Math.min(Math.max(12, rect.left - 170), Math.max(12, window.innerWidth - 412)), y: Math.max(12, rect.top - 330) }, ...(group ? { group } : {}) });
        }}
        quickAddOpen={objectPicker !== null && !objectPicker.fromNodeId}
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
        view={<div className={styles.commandBarView} role="group" aria-label={t('canvasViewControls')}>
          <button type="button" onClick={zoomInAction} aria-label={t('zoomIn')} title={t('zoomIn')}><ZoomInIcon /></button>
          <button type="button" onClick={zoomOutAction} aria-label={t('zoomOut')} title={t('zoomOut')}><ZoomOutIcon /></button>
          <button type="button" onClick={fitViewAction} aria-label={threeDControls ? tCommands('threeD.reset') : t('fitCanvas')} title={threeDControls ? tCommands('threeD.reset') : t('fitCanvas')}>{threeDControls ? <ResetViewIcon /> : <FitViewIcon />}</button>
          <button type="button" onClick={cleanLayout} aria-label={t('arrangeObjects')} title={t('arrangeObjects')}><CleanLayoutIcon /></button>
          {/* WHAT THE BOARD ALONE HAS. A mini map is a map of the flat board, and pan vs
              marquee is a decision about dragging on one; neither means anything on a
              surface that has no board, so these two are the only view commands that read
              the surface at all. */}
          {surfaceDef.showsBoard && <>
            <button type="button" onClick={() => setMinimapOpen((open) => !open)} aria-pressed={minimapOpen} aria-label={minimapOpen ? tCommands('hideMiniMap') : tCommands('showMiniMap')} title={minimapOpen ? tCommands('hideMiniMap') : tCommands('showMiniMap')}><MinimapIcon /></button>
            <button type="button" onClick={() => setCanvasGesture((current) => (current === 'select' ? 'pan' : 'select'))} aria-pressed={canvasGesture === 'select'} aria-label={t('canvasGestureToggle')} title={canvasGesture === 'select' ? t('canvasGestureSelectActive') : t('canvasGesturePanActive')}><MarqueeSelectIcon /></button>
          </>}
          {/* WHAT THE SCENE ADDS while it is up. These were the last commands living on the
              bottom-left rail; with the rail gone they are contributed here, beside the
              zoom and reset that already switch to the scene's own camera. */}
          {threeDControls && <>
            <button type="button" onClick={threeDControls.toggleDepth} aria-pressed={threeDControls.depthMode !== 'flow'} aria-label={tCommands('threeD.depthGroup')} title={threeDControls.depthMode !== 'flow' ? tCommands('threeD.depthGroupActive') : tCommands('threeD.depthGroupInactive')}><DepthIcon /></button>
            <button type="button" onClick={threeDControls.toggleLayers} aria-pressed={threeDControls.layersVisible} aria-label={tCommands('threeD.layerGuides')} title={threeDControls.layersVisible ? tCommands('threeD.layerGuidesActive') : tCommands('threeD.layerGuidesInactive')}><LayerGuidesIcon /></button>
            {threeDControls.dropToLayers && <button type="button" onClick={threeDControls.dropToLayers} aria-label={tCommands('threeD.dropToLayers')} title={tCommands('threeD.dropToLayers')}><DropToLayersIcon /></button>}
          </>}
          {/* WHAT EVERY SURFACE HAS. This canvas's files and its readable outline are about
              the SESSION, not about which way it is being read. They used to be gated on
              the board here and drawn on the corner rail everywhere else — one control in
              two places, and neither of them where you last saw it. */}
          <button type="button" onClick={() => toggleDockPanel('files')} aria-pressed={dockPanel === 'files'} aria-label={tFiles('title')} title={tFiles('title')}><CanvasFilesIcon /></button>
          <button type="button" onClick={() => toggleDockPanel('outline')} aria-pressed={dockPanel === 'outline'} aria-label={t('canvasOutline')} title={t('canvasOutline')}><AccessibleOutlineIcon /></button>
        </div>}
        onTogglePrompt={presentMode || surfaceDef.brainIsSurface ? undefined : () => setPromptPlacement(toggledCanvasPromptPlacement(promptPlacement))}
        promptOpen={effectivePromptPlacement !== 'closed'}
        // The always-on seats, folded out of the shell's footer band and into the one
        // bar. Same component, same roster endpoint, same drag-to-board payload — the
        // band simply stands down on a stage route and draws itself here instead.
        team={<TeamBar variant="bar" />}
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
      />

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
                  .catch((error) => setNotice(error instanceof Error ? error.message : t('noticeSaveToAccountFailed')))
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
        {/* Both of these are chrome ABOUT the objects on this canvas — what is selected,
            and how many there are. They gate on whether the objects are on screen at
            all, not on which surface is drawn: the 3D space shows them and keeps both,
            the conversation shows none and would otherwise float a toolbar for things
            the reader cannot see. */}
        {!presentMode && surfaceDef.showsObjects && effectiveSelectedIds.length > 0 && <div className={styles.selectionToolbar} aria-label={t('selectionActions')}>
          <span>{t('selectedCount', { count: effectiveSelectedIds.length })}</span>
          <button onClick={focusSelection}>{t('focus')}</button>
          <button onClick={duplicateSelection} disabled={!canEdit}>{t('duplicate')}</button>
          {effectiveSelectedIds.length > 1 && <button onClick={alignSelection} disabled={!canEdit}>{t('align')}</button>}
          {effectiveSelectedIds.length > 1 && <button onClick={frameSelection} disabled={!canEdit}>{t('frame')}</button>}
          <button onClick={togglePlacementLock} disabled={!canEdit}>{effectiveSelectedIds.some((id) => nodes.find((node) => node.id === id)?.data.placementLocked !== true) ? t('lock') : t('unlock')}</button>
          <button onClick={toggleHidden} disabled={!canEdit}>{t('hide')}</button>
        </div>}
        {loadingSession && <div className={styles.canvasSkeleton} role="status" aria-live="polite"><span /><span /><span /><b>{t('loadingSession')}</b></div>}
        {surfaceDef.showsObjects && nodes.length > 100 && <div className={styles.performanceNotice} role="status"><strong>{t('largeSession', { count: nodes.length })}</strong><span>{t('largeSessionHint')}</span><button type="button" onClick={openPalette}>{t('frame')}</button></div>}
        <BrainSurfaceProvider value={brainSurface}>
        <ReactFlow<CreationFlowNode, Edge>
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={canvasNodeTypes}
          onNodesChange={onCanvasNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
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
          <RemoteCursors members={liveMembers} currentUserId={currentUserId} />
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

        {/* ── THE BOARD'S FLOATING CONTROLS ────────────────────────────────────────
            ONE rail on a phone, not two. The "add to canvas" toggle used to float on
            its own at the top-left while the view commands stacked at the bottom-left,
            which put two separate toolbars down the same edge of a 360px screen with
            nothing saying why the add button was not part of the set. They are siblings
            in one container now: on a desktop the container is `display:contents`, so
            the toggle keeps its own corner and the phone column stays stood down; on a
            phone the container IS the rail and the toggle is its first command.

            Every command draws its glyph from the shared canvas icon set, so the rail is
            one toolbar at one size rather than a column of whatever a phone font makes
            of ⌗ / ⌘ / ◱ next to two real icons. */}
        <div className={styles.boardRail}>
        {!presentMode && <button className={styles.paletteToggle} onClick={() => setPaletteOpen((value) => !value)} aria-label={t('toggleObjectPalette')}>{paletteOpen ? <ClosePaletteIcon /> : <AddObjectIcon />}</button>}
        {/* ZOOM, FIT AND ARRANGE ARE NOT HERE ANY MORE. They moved into the one command
            bar, which is where "what can I do to this canvas" now lives — keeping a copy
            on this rail would be the same decision with two controls, on two floating
            toolbars, which is the exact failure the surface registry was written to
            prevent. What stays is what the bar does not carry: the surface switcher's
            phone form, the panels, and the 3D-only commands. */}
        {/* The phone's column keeps ONLY what the bar does not carry: which surface this
            canvas is read through, in the form that fits a 360px screen. Files, the
            outline and the scene's depth/layer commands were duplicated here while the bar
            drew them on the board alone; the bar draws them on every surface now, so a
            second copy on the same screen is only a second place to look. */}
        <div className={styles.mobileCanvasActions} role="group" aria-label={t('canvasPanelControls')}>
          <CanvasSurfaceSwitcher surface={surface} onChange={setSurface} variant="mobile" />
        </div>
        </div>

        {/* The runtime that takes the centre. The board itself is not in the map — it is
            the React Flow tree above, rendered unconditionally so the viewport, the
            selection and every node's state survive a trip through another surface and
            back. Adding a runtime is a key here plus an entry in `canvasSurfaces.ts`. */}
        <CanvasSurfaceRouter
          surface={surface}
          surfaces={{
            scene3d: <Canvas3DView
              nodes={threeDNodes}
              edges={edges}
              describe={describeThreeD}
              measure={canvasNodeDimensions}
              selectedIds={effectiveSelectedIds}
              onSelect={selectThreeDObject}
              onMove={canEdit ? moveThreeDObjects : undefined}
              onExit={() => setSurface('graph')}
              initialDepthMode={comparisonModelIds.length >= 2 ? 'group' : 'flow'}
            />,
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
              trace={brainTrace}
              running={thinking}
              runStartedAt={brainRunStartedAt}
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
            />,
            // The four medium runtimes. Each takes the object the surface is ABOUT, so
            // each is rendered only when one resolves — `surfaceNode` going null is what
            // the effect above turns back into the board.
            page: surfaceNode ? <CanvasPageSurface
              data={surfaceNode.data}
              onExit={() => setSurface('graph')}
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
              onExit={() => setSurface('graph')}
              // Shipping opens OVER the surfacerather than replacing it: distribution is
              // a panel about a build you are still looking at.
              onShip={() => openGamePanel(surfaceNode.id)}
              // Who is on this canvas, and the canvas's OWN invite door — not a second
              // sharing model for games. Playing is when a person wants both.
              players={rosterMembers}
              onInvite={() => setShareOpen(true)}
            /> : null,
            site: surfaceNode ? <CanvasSiteSurface
              data={surfaceNode.data}
              onExit={() => setSurface('graph')}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            timeline: surfaceNode ? <CanvasTimelineSurface
              data={surfaceNode.data}
              onExit={() => setSurface('graph')}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
            /> : null,
            world: surfaceNode ? <CanvasWorldView
              data={surfaceNode.data}
              onExit={() => setSurface('graph')}
              {...(cardsEditable ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) } : {})}
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

        {!presentMode && paletteOpen && <aside id="canvas-object-palette" data-testid="canvas-palette" className={styles.palette}>
          <div className={styles.paletteHeader}><strong>{t('addToCanvas')}</strong><button onClick={() => setPaletteOpen(false)} aria-label={t('closePalette')}>×</button></div>
          <div className={styles.paletteSearchWrap}><span aria-hidden><Icon source="⌕" size="1em" /></span><input ref={paletteSearchRef} data-testid="canvas-palette-search" className={styles.search} aria-label={t('searchObjectTypes')} value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder={t('searchObjectTypes')} />{paletteSearch && <button type="button" aria-label={t('clearSearch')} onClick={() => setPaletteSearch('')}>×</button>}</div>
          <div className={styles.paletteSections}>{CREATION_PALETTE_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => `${t(`object.${item.kind}`)} ${t(`group.${item.group}`)} ${item.group} ${item.kind}`.toLowerCase().includes(paletteSearch.trim().toLowerCase())) })).filter((group) => group.items.length).map((group) => {
            const collapsed = !paletteSearch.trim() && collapsedPaletteGroups.has(group.group);
            const regionId = `canvas-palette-${group.group.toLowerCase()}`;
            return <section key={group.group} className={styles.paletteSection}>
              {/* Named explicitly: without it the control's accessible name is
                  its own contents — "Build 22 ⌄" — which tells a screen-reader
                  user nothing about what pressing it does, and silently changes
                  every time an object is added to the group. */}
              <button type="button" className={styles.paletteSectionToggle} aria-expanded={!collapsed} aria-controls={regionId} aria-label={t(collapsed ? 'expandPaletteGroup' : 'collapsePaletteGroup', { group: t(`group.${group.group}`) })} onClick={() => setCollapsedPaletteGroups((current) => { const next = new Set(current); if (next.has(group.group)) next.delete(group.group); else next.add(group.group); return next; })}>
                <span className={styles.paletteGroupIcon} aria-hidden><Icon source={PALETTE_GROUP_ICONS[group.group]} size={18} /></span><strong>{t(`group.${group.group}`)}</strong><small>{group.items.length}</small><span className={styles.paletteChevron} aria-hidden><Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} /></span>
              </button>
              {!collapsed && <div id={regionId} className={styles.paletteGrid}>{group.items.map((item) => <button key={item.kind} data-testid={`canvas-palette-${item.kind}`} aria-label={t(`object.${item.kind}`)} disabled={!canEdit} draggable={canEdit} onDragStart={(event) => { event.dataTransfer.setData(DND_MIME, item.kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addAtCenter(item.kind)}><span><Icon source={item.icon} size={20} /></span>{t(`object.${item.kind}`)}</button>)}</div>}
            </section>;
          })}</div>
        </aside>}


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

        {workflowFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label={t('workflowFocusEditor')}>
          <header><div><strong>{t('editWorkflowOnCanvas')}</strong><small>{t('editWorkflowHint')}</small></div><button type="button" onClick={() => setWorkflowFocus(null)} aria-label={t('closeWorkflowEditor')}>×</button></header>
          <div className={styles.workflowFocusBody}><ReactFlowProvider><WorkflowBuilder definitionId={workflowFocus.definitionId} embedded onSaved={(definitionId, name) => { setWorkflowFocus((current) => current ? { ...current, definitionId } : current); setNodes((current) => current.map((node) => node.id === workflowFocus.nodeId ? { ...node, data: { ...node.data, title: name, resourceId: `workflow:${definitionId}`, workflowExecutable: true, resourceSubtype: 'definition', status: 'Saved' } } : node)); setNotice(t('workflowSaved')); }} onRunStarted={(workflowId) => { setNodes((current) => current.map((node) => node.id === workflowFocus.nodeId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: workflowId } } : node)); setNotice(t('noticeWorkflowRunStarted', { id: workflowId })); }} /></ReactFlowProvider></div>
        </section>}

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

        {historyOpen && <aside className={styles.historyPanel}><header><div><strong>{t('versionHistory')}</strong><small>{t('versionHistoryHint')}</small></div><button onClick={() => setHistoryOpen(false)} aria-label={t('closeHistory')}>×</button></header>{persistence === 'local' ? <p>{t('historyLocalOnly')}</p> : <><button className={styles.primaryButton} onClick={createCheckpoint} disabled={!canEdit}>{t('nameCheckpoint')}</button><div>{history.length ? history.map((snapshot) => <button key={snapshot.revision} onClick={() => restoreRevision(snapshot.revision)} disabled={!canEdit}><b>{snapshot.label || t('revisionLabel', { revision: snapshot.revision })}</b><span>{t('revisionMeta', { revision: snapshot.revision, at: new Date(snapshot.createdAt).toLocaleString() })}</span></button>) : <p>{t('noRevisions')}</p>}</div></>}</aside>}
        {outcomeMetricsOpen && <aside className={`${styles.historyPanel} ${styles.outcomeMetricsPanel}`} aria-label={t('sessionOutcomeMetrics')}>
          <header><div><strong>{t('ideaToDelivery')}</strong><small>{outcomeMetrics ? t('sessionVsTenant', { count: outcomeMetrics.sampleSize }) : t('valueGenerated')}</small></div><button onClick={() => setOutcomeMetricsOpen(false)} aria-label={t('closeOutcomeMetrics')}>×</button></header>
          {persistence === 'local' ? <div className={styles.outcomeEmpty}><span aria-hidden><Icon source="↗" size="1em" /></span><strong>{t('saveForBaseline')}</strong><p>{t('saveForBaselineHint')}</p><button className={styles.primaryButton} onClick={() => requireAccount('metrics', t('gateMetricsTitle'), t('gateMetricsBody'))}>{t('saveAndMeasure')}</button></div> : outcomeMetricsLoading ? <p role="status">{t('calculatingValue')}</p> : outcomeMetricsError ? <div className={styles.outcomeEmpty}><strong>{t('metricsUnavailable')}</strong><p>{outcomeMetricsError}</p><button className={styles.secondaryButton} onClick={openOutcomeMetrics}>{t('retry')}</button></div> : outcomeMetrics ? <div className={styles.outcomeMetricList}>{outcomeMetrics.metrics.map((metric) => {
            const comparable = metric.current != null && metric.baseline != null;
            const delta = comparable ? metric.current! - metric.baseline! : null;
            const improving = delta == null ? null : metric.direction === 'higher' ? delta >= 0 : false;
            const favorable = improving == null ? null : improving || (metric.direction !== 'higher' && delta! <= 0);
            return <article key={metric.key} className={styles.outcomeMetric}>
              <div><strong>{metric.label}</strong><span>{formatOutcomeValue(metric.current, metric.unit)}</span></div>
              <small>{metric.baseline == null ? t('baselineGathering') : t('typicalValue', { value: formatOutcomeValue(metric.baseline, metric.unit) })}{delta != null && Math.abs(delta) > .0001 ? <em data-positive={favorable}>{favorable ? <Icon source="↗" size="1em" /> : <Icon source="↘" size="1em" />}</em> : null}</small>
            </article>;
          })}</div> : null}
          <footer><span>{t('correlationCoverage')}</span><small>{t('aggregatesScoped')}</small></footer>
        </aside>}
        {conversationOpen && <aside className={styles.historyPanel} aria-label={t('sessionConversation')}><header><div><strong>{t('sessionConversation')}</strong><small>{t('sessionConversationHint')}</small></div><span className={styles.panelHeaderActions}><CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyChatDiagnostics')} getText={buildDiagnostics} /><button onClick={() => setConversationOpen(false)} aria-label={t('closeConversation')}>×</button></span></header><div>{timeline.length ? timeline.map((message) => <article key={message.clientMessageId} style={{ padding: '9px 10px', borderBottom: '1px solid var(--border-subtle)' }}><strong style={{ textTransform: 'capitalize' }}>{message.metadata?.authoredBy?.name || (message.messageRole === 'assistant' ? 'Brain' : message.messageRole)}</strong><p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{message.body}</p><small>{new Date(message.createdAt).toLocaleString()}</small></article>) : <p>{t('brainEmpty')}</p>}</div></aside>}
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
          trace={brainTrace}
          running={thinking}
          runStartedAt={brainRunStartedAt}
          node={brainNode}
          nodes={nodes}
          edges={edges}
          collaborators={members.filter((member) => member.userId !== currentUserId)}
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
        {/* The way back to a closed Brain. An inline Brain that still has its Object on
            the board already offers one ("Open Brain chat"), so the pill would be a
            second control for the same thing — it appears only when there is no Object
            to click, which is exactly when the board has no other route back. */}
        {!presentMode && !brainDock.open && !surfaceDef.brainIsSurface && (brainPlacement === 'docked' || !brainNode) && <button
          type="button"
          className={styles.brainDockLauncher}
          data-side={brainDock.side}
          aria-label={t('openBrainDock')}
          title={t('openBrainDock')}
          onClick={() => updateBrainDock({ open: true })}
        ><span aria-hidden><Icon source="✦" size="1em" /></span>{t('brain')}</button>}
      </div>
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
    </CanvasSurfaceProvider>
  );
}

function GuidedTourInspector({ node, nodes, onChange }: { node: CreationFlowNode; nodes: CreationFlowNode[]; onChange: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.tourBuilder');
  const objectT = useTranslations('creationCanvas.object');
  const tour = canvasTourDesignFromNode(node.data);
  const update = (patch: Partial<CanvasTourDesign>) => {
    const next = { ...tour, ...patch };
    onChange({ tour: next, status: t('draftSteps', { count: next.steps.length }) });
  };
  const updateStep = (index: number, patch: Partial<CanvasTourDesign['steps'][number]>) => update({ steps: tour.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) });
  const targets = nodes.filter((candidate) => candidate.id !== node.id);
  return <section className={styles.tourInspector} aria-label={t('settings')}>
    <p className={styles.inspectorHint}>{t('settingsHint')}</p>
    <label>{t('offerTitle')}<input value={tour.offerTitle} onChange={(event) => update({ offerTitle: event.target.value })} /></label>
    <label>{t('offerBody')}<textarea rows={3} value={tour.offerBody} onChange={(event) => update({ offerBody: event.target.value })} /></label>
    <div className={styles.tourInspectorGrid}>
      <label>{t('version')}<input type="number" min={1} max={999} value={tour.version} onChange={(event) => update({ version: Number(event.target.value) || 1 })} /></label>
      <label>{t('minimumVisits')}<input type="number" min={1} max={20} value={tour.minimumVisits} onChange={(event) => update({ minimumVisits: Number(event.target.value) || 1 })} /></label>
    </div>
    <label className={styles.tourToggle}><input type="checkbox" checked={tour.blurBackground} onChange={(event) => update({ blurBackground: event.target.checked })} /><span>{t('blurBackground')}</span></label>
    <label className={styles.tourToggle}><input type="checkbox" checked disabled /><span>{t('escapeHatch')}</span></label>
    <div className={styles.tourStepEditor}>
      <div className={styles.tourStepEditorHeader}><strong>{t('steps')}</strong><button type="button" onClick={() => update({ steps: [...tour.steps, { id: crypto.randomUUID(), title: t('newStepTitle'), body: '', targetObjectId: '' }] })}>{t('addStep')}</button></div>
      {tour.steps.map((step, index) => <fieldset key={step.id} className={styles.tourStepFields}>
        <legend>{t('stepOf', { current: index + 1, total: tour.steps.length })}</legend>
        <label>{t('stepTitle')}<input value={step.title} onChange={(event) => updateStep(index, { title: event.target.value })} /></label>
        <label>{t('stepBody')}<textarea rows={2} value={step.body} onChange={(event) => updateStep(index, { body: event.target.value })} /></label>
        <label>{t('targetObject')}<select value={step.targetObjectId} onChange={(event) => updateStep(index, { targetObjectId: event.target.value })}><option value="">{t('chooseTarget')}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.data.title} · {objectT(target.data.kind)}</option>)}</select></label>
        <button type="button" disabled={tour.steps.length <= 1} onClick={() => update({ steps: tour.steps.filter((_, stepIndex) => stepIndex !== index) })}>{t('removeStep')}</button>
      </fieldset>)}
    </div>
  </section>;
}

function Inspector({ node, nodes, edges, focus, timeline, brainTrace, sessionId, persistence, role, editable, members, onChange, onWebsiteViewportChange, onRun, onPublishWebsite, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace, onBuildWebsiteWithCode, creatingBuild, onGenerateVideo, onRunCreativeAction, onShipGame, onPublishListing, onOpenReleases, onEditWorkflow, onBuildWorkflow, onSaveAgent, onOpenBuiltinAgent, onAddAgentKnowledge, onRunAgentTest, onSaveFramePreset, onExpandProject, onLoadProjectQuality, onCompareProjects, onDeliverMockup, onExpandMockupSet, onImportDataset, onVisualizeDataset, onPlotDataset, onProfileDataset, onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind, onStartStandup, onConvertDiagram, onExportArtifact, onAskBrain, onResumeTailor, onResumeDetach, onResumeShare, onResumeSharesList, onResumeShareRevoke }: { node: CreationFlowNode; nodes: CreationFlowNode[]; edges: Edge[]; focus: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null; timeline: CanvasTimelineMessage[]; brainTrace: BrainTraceEvent[]; sessionId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; editable: boolean; members: CreationSessionDetail['members']; onChange: (patch: Partial<CreationNodeData>) => void; onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => void; onRun: () => void; onPublishWebsite: () => void; onOpenBuild: () => void; onAttachBuild: (ide: IdeProject) => void; onDeleteBuildWorkspace: () => void; onBuildWebsiteWithCode: () => void; creatingBuild: boolean; onGenerateVideo: () => void; onRunCreativeAction: (action: string) => void; onShipGame: () => void; onPublishListing: () => void; onOpenReleases: () => void; onEditWorkflow: () => void; onBuildWorkflow: () => void; onSaveAgent: () => void; onOpenBuiltinAgent: (intent: BuiltinAgentSurfaceIntent) => void; onAddAgentKnowledge: (content: string) => void; onRunAgentTest: (testPrompt: string, expected: string) => void | Promise<void>; onSaveFramePreset: () => void; onExpandProject: () => void; onLoadProjectQuality: () => void; onCompareProjects: () => void; onDeliverMockup: () => void; onExpandMockupSet: () => void; onImportDataset: (file: File) => void | Promise<void>; onVisualizeDataset: () => void; onPlotDataset: () => void; onProfileDataset: (nodeId: string) => void; onAttachEvermindProject: () => void; onExpandEvermindPipeline: () => void; onTrainEvermind: () => void; onStartStandup: () => void; onConvertDiagram: (format: string, diagramId?: string) => Promise<string>; onExportArtifact: (action: CanvasExportAction) => Promise<string>;
  /** The ONE route from the inspector back to Brain. Learning controls compose
   *  their own request text (see LearningControls.tsx) rather than each adding a
   *  callback to a panel that already takes forty. */
  onAskBrain: (request: string) => void;
  onResumeTailor: (nodeId: string, request: string) => void;
  onResumeDetach: (nodeId: string, detachedData: Partial<CreationNodeData>) => void;
  onResumeShare: (nodeId: string, kind: 'view' | 'embed') => Promise<void>;
  onResumeSharesList: (nodeId: string) => Promise<CanvasResumeShare[]>;
  onResumeShareRevoke: (nodeId: string, shareId: string) => Promise<void>; }) {
  const t = useTranslations('creationCanvas');
  const kind = node.data.kind;
  const onWebsiteChange = (patch: Partial<CreationNodeData>) => onChange(patchWebsiteHero(node.data, patch));
  const websiteHero = websiteHeroFrom(node.data);
  const websiteTheme = websiteThemeFrom(node.data);
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  const [accessStatus, setAccessStatus] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState('');
  /* Only for scrolling a named section into view. The panel around this owns the width
     and the two readings it comes in — see `CanvasNodePanel`. */
  const inspectorRef = useRef<HTMLDivElement>(null);
  // The human half of the unified assignee picker — `tasksApi.assignees()` already
  // existed for this exact purpose (see its own doc comment) and was never called from
  // here, so a task could only ever be assigned to an agent even though `assignedUserId`
  // is a first-class column the read path already renders ("Assigned teammate").
  const [taskAssignees, setTaskAssignees] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (node.data.kind !== 'task' || persistence !== 'server') { setTaskAssignees([]); return; }
    let active = true;
    void tasksApi.assignees().then((result) => { if (active) setTaskAssignees(result); }).catch(() => { if (active) setTaskAssignees([]); });
    return () => { active = false; };
  }, [node.data.kind, persistence]);
  /** What this ticket cost to build. `runtimeApi.taskCost` (`GET
   *  /api/runtime/tasks/:taskId/cost`, read-through cached) already sums
   *  `llm_usage_log` by `task_id` — this was never called from the board, so a task
   *  assigned to an agent could never show what its runs cost. */
  const [taskCost, setTaskCost] = useState<{ estimatedCostUsd: number; totalTokens: number; requests: number } | null>(null);
  useEffect(() => {
    const match = node.data.kind === 'task' ? /^task:(\d+)$/.exec(node.data.resourceId || '') : null;
    if (!match || persistence !== 'server') { setTaskCost(null); return; }
    let active = true;
    void runtimeApi.taskCost(Number(match[1])).then((result) => { if (active) setTaskCost(result); }).catch(() => { if (active) setTaskCost(null); });
    return () => { active = false; };
  }, [node.data.kind, node.data.resourceId, persistence]);
  useEffect(() => {
    if (!focus) return;
    const frame = window.requestAnimationFrame(() => inspectorRef.current?.querySelector<HTMLElement>(`[data-inspector-section="${focus}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focus, node.id]);
  const deliverables = creationDeliverables(node.data);
  const taskId = kind === 'task' && /^task:\d+$/.test(node.data.resourceId || '') ? Number(node.data.resourceId!.slice(5)) : null;
  const taskAgents = nodes.filter((candidate) => candidate.data.kind === 'agent');
  const agentTools = Array.isArray(node.data.tools) ? node.data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const isExistingAgent = kind === 'agent' && typeof node.data.resourceId === 'string' && node.data.resourceId.startsWith('agent:');
  const isBuiltinAgent = kind === 'agent' && typeof node.data.agentDomain === 'string' && typeof node.data.agentSeat === 'string';
  const isBuiltinManager = isBuiltinAgent && node.data.agentDomain === 'delivery' && node.data.agentSeat === 'Manager';
  const connectedAgentKnowledge = kind === 'agent' ? nodes.filter((candidate) => ['knowledge', 'document', 'dataset', 'file', 'url'].includes(candidate.data.kind) && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : [];
  const connectedAgentEvaluation = kind === 'agent' ? nodes.find((candidate) => candidate.data.kind === 'evaluation' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const connectedAgentRelease = kind === 'agent' ? nodes.find((candidate) => candidate.data.kind === 'release' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const deliveryAgent = kind === 'release' ? (nodes.find((candidate) => candidate.data.kind === 'agent' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) || (nodes.filter((candidate) => candidate.data.kind === 'agent').length === 1 ? nodes.find((candidate) => candidate.data.kind === 'agent') : undefined)) : undefined;
  const deliveryKnowledgeCount = deliveryAgent ? nodes.filter((candidate) => ['knowledge', 'document', 'dataset', 'file', 'url'].includes(candidate.data.kind) && edges.some((edge) => (edge.source === deliveryAgent.id && edge.target === candidate.id) || (edge.target === deliveryAgent.id && edge.source === candidate.id))).length : 0;
  const availableAgentTools = ['Audience Analyzer', 'Copy Optimizer', 'Research', 'Browser'];
  const mockupProjects = nodes.filter((candidate) => candidate.data.kind === 'project');
  const mockupAgents = taskAgents;
  const defaultMockupProjectRef = mockupProjects[0]?.data.resourceId || mockupProjects[0]?.id || 'draft:builderforce-launch';
  const mockupProjectValue = typeof node.data.deliveryProjectRef === 'string' ? node.data.deliveryProjectRef : defaultMockupProjectRef;
  const defaultMockupAgentRef = mockupAgents[0]?.data.resourceId || mockupAgents[0]?.id || 'campaign-strategist';
  const mockupAgentValue = typeof node.data.mockupAgentRef === 'string' ? node.data.mockupAgentRef : defaultMockupAgentRef;
  const selectedTaskAgent = taskAgents.find((agent) => agent.data.title === node.data.assignee || agent.data.title === node.data.role);
  const taskAgentValue = typeof node.data.agentRef === 'string' ? node.data.agentRef : selectedTaskAgent ? (selectedTaskAgent.data.resourceId?.replace(/^agent:/, '') || selectedTaskAgent.id) : '';
  const connectedPrd = kind === 'task' ? nodes.find((candidate) => candidate.data.kind === 'prd' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const prdTitle = typeof connectedPrd?.data.title === 'string' ? connectedPrd.data.title : typeof node.data.prdTitle === 'string' ? node.data.prdTitle : '';
  const prdStatus = typeof connectedPrd?.data.status === 'string' ? connectedPrd.data.status : typeof node.data.prdStatus === 'string' ? node.data.prdStatus : '';
  const prdSummary = [connectedPrd?.data.markdown, connectedPrd?.data.content, connectedPrd?.data.subtitle, node.data.prdSummary].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const normalizedTaskStatus = String(node.data.status || 'ready').toLowerCase().replaceAll(' ', '_');
  const statusGuidance: Record<string, string> = {
    backlog: 'Add a clear description and PRD, set priority, and assign an agent to make this ready.',
    todo: 'Confirm the PRD and acceptance criteria, then move the task to Ready.',
    ready: 'The task is actionable. Start work by moving it to In progress or running its assigned agent.',
    assigned: 'The owner is set. Move the task to In progress when execution begins.',
    in_progress: 'Keep the description and acceptance criteria current; move to In review when evidence is ready.',
    in_review: 'Validate the work against the PRD and acceptance criteria, then mark Done or return it to In progress.',
    blocked: 'Record the blocker in the description, resolve its dependency, then return it to Ready or In progress.',
    done: 'This task is complete. Reopen it only when the PRD or acceptance criteria are not satisfied.',
  };
  const persistTaskPatch = async (apiPatch: Parameters<typeof tasksApi.update>[1], canvasPatch: Partial<CreationNodeData>) => {
    setActionStatus(t('savingTask'));
    try {
      if (taskId != null && persistence === 'server') await tasksApi.update(taskId, apiPatch);
      onChange(canvasPatch);
      setActionStatus(taskId != null && persistence === 'server' ? t('taskUpdated') : t('taskUpdatedLocal'));
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : t('taskUpdateFailed'));
    }
  };
  const runArtifactAction = async (action: CanvasExportAction) => {
    setActionStatus(t('preparing'));
    setActionStatus(await onExportArtifact(action));
  };
  // Everything a `custom.component` section might read, computed once per render —
  // see `KindSectionProps` for why this is one bag rather than eleven prop lists.
  const kindSectionProps: KindSectionProps = {
    node, nodes, data: node.data, editable, persistence, onChange,
    isBuiltinAgent, isBuiltinManager, isExistingAgent, connectedAgentKnowledge,
    agentTools, availableAgentTools, knowledgeDraft, setKnowledgeDraft,
    onOpenBuiltinAgent, onAddAgentKnowledge, onRunAgentTest, onSaveAgent,
    deliveryAgent, deliveryKnowledgeCount,
    websiteHero, websiteTheme, onWebsiteChange, onPublishWebsite, onBuildWebsiteWithCode, onWebsiteViewportChange,
    onGenerateVideo,
    onImportDataset, onProfileDataset, onVisualizeDataset, onPlotDataset,
    taskId, taskAgents, taskAgentValue, taskAssignees, taskCost, statusGuidance, normalizedTaskStatus,
    prdStatus, prdTitle, prdSummary, actionStatus, setActionStatus, persistTaskPatch,
    mockupProjects, mockupProjectValue, mockupAgents, mockupAgentValue, onDeliverMockup,
    onRunCreativeAction, onShipGame,
    creatingBuild, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace,
    onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind,
    onResumeTailor, onResumeDetach, onResumeShare, onResumeSharesList, onResumeShareRevoke,
  };
  // The manifest names an action by a stable string (`'refreshDashboard'`); this is the
  // one place that string resolves to the function it actually calls — everywhere else
  // (visibility, order, label) stays declared in the manifest, not here.
  const detailsActionHandlers: Record<string, () => void> = {
    loadProjectQuality: onLoadProjectQuality,
    expandProject: onExpandProject,
    compareProjects: onCompareProjects,
    editWorkflow: onEditWorkflow,
    buildWorkflow: onBuildWorkflow,
    run: onRun,
    startStandup: onStartStandup,
    expandMockupSet: onExpandMockupSet,
    deliverMockup: onDeliverMockup,
    saveFramePreset: onSaveFramePreset,
    refreshDashboard: () => onChange({ fetchedAt: new Date().toISOString(), status: 'Live' }),
    // The board half of "one board where the plan and the measurement of the plan are
    // the same artifact": pulls `pmoApi.rollup()` for this object's own `scopeKind`/
    // `scopeId` and flattens it onto the node exactly as `MUTABLE_FIELDS.deliveryRollup`
    // declares, so every stat the manifest locks as read-only has something real behind it.
    refreshDeliveryRollup: () => {
      const scopeKind = (typeof node.data.scopeKind === 'string' ? node.data.scopeKind : 'workspace') as PmoScopeKind;
      const scopeId = typeof node.data.scopeId === 'string' && node.data.scopeId ? node.data.scopeId : undefined;
      setActionStatus(t('preparing'));
      void pmoApi.rollup(scopeKind, scopeId).then((rollup) => {
        onChange({
          title: rollup.scope.name || node.data.title,
          totalTasks: rollup.delivery.totalTasks, completedCount: rollup.delivery.completedCount, openCount: rollup.delivery.openCount,
          avgCycleTimeHours: rollup.delivery.avgCycleTimeHours, throughputPerWeek: rollup.delivery.throughputPerWeek,
          agentLlmCostUsd: rollup.spend.agentLlmCostUsd,
          deploymentFrequencyPerDay: rollup.dora.deploymentFrequencyPerDay, leadTimeHours: rollup.dora.leadTimeHours,
          changeFailureRatePct: rollup.dora.changeFailureRatePct, mttrHours: rollup.dora.mttrHours,
          avgOkrProgress: rollup.okr.avgProgress,
          fetchedAt: new Date().toISOString(), status: 'Live',
        });
        setActionStatus('');
      }).catch((error) => setActionStatus(error instanceof Error ? error.message : t('taskUpdateFailed')));
    },
  };
  const kindCustomSection = KIND_DETAIL_SECTIONS[kindSettingsManifest(kind)?.custom?.component ?? ''];
  /**
   * The object's whole inspector, drawn INSIDE the panel anchored to its card.
   *
   * It keeps `aria-label="Details panel"` and the `.inspector` class — the class because
   * every field, label and footer rule in the stylesheet is written against it, the label
   * because this is still the details of one object and a screen reader should be told
   * which region it has entered. What it no longer has is a shell of its own: no fixed
   * position, no resize handle, no title bar and no close button, because the panel around
   * it already carries all four for the same object. Two headers naming the same card,
   * with two different closes, is how the old rail read next to the compact panel.
   */
  return <aside ref={inspectorRef} className={styles.inspector} aria-label="Details panel">
    <div className={styles.inspectorTabs}><button className={tab === 'details' ? styles.activeTab : ''} onClick={() => setTab('details')}>{t('details')}</button><button className={tab === 'activity' ? styles.activeTab : ''} onClick={() => setTab('activity')}>{t('activity')}</button></div>
    <div className={styles.inspectorBody}>
      {tab === 'details' ? <fieldset className={styles.inspectorFields} disabled={!editable}>
      {node.data.redacted === true && <><p className={styles.inspectorHint}>{t('redactedObject')}</p><button type="button" className={styles.fullButton} disabled={persistence !== 'server' || !!accessStatus} onClick={() => { setAccessStatus(t('requesting')); void creationSessionsApi.requestObjectAccess(sessionId, node.id).then(() => setAccessStatus(t('accessRequested'))).catch((error) => setAccessStatus(error instanceof Error ? error.message : t('requestFailed'))); }}>{accessStatus || t('requestAccess')}</button></>}
      {/* A built-in seat's name is locked here too, not only on the compact Persona
          panel — the object edited at either width must agree on what is actually
          editable, or renaming it from the wide reading would silently undo the lock
          the short one promised. */}
      <label>{t('name')}<input value={node.data.title} disabled={isCanvasPersonKind(kind) && canvasPersonOrigin(kind) === 'builtin'} onChange={(event) => onChange({ title: event.target.value })} /></label>
      {typeof node.data.pipelineStep === 'number' && <section className={styles.pipelineInspectorGuide} aria-label={t('evermindSetupStep', { step: node.data.pipelineStep })}><span>{t('evermindSetupOf5', { step: node.data.pipelineStep })}</span><strong>{node.data.pipelineStart === true ? t('startHere') : node.data.title}</strong><p>{String(node.data.pipelineInstruction || t('pipelineStageHint'))}</p>{node.data.pipelineStep === 1 && node.data.status !== 'Imported' && <small>{t('useFilePicker')}</small>}{node.data.pipelineStep === 1 && node.data.status === 'Imported' && <small>{t('dataReadyNext')}</small>}</section>}
      {/* Every kind below used to be its own `kind === 'x'` branch in this fieldset —
          ~30 of them, one 700-line conditional chain. Now each is a manifest entry
          (`lib/canvasKindSettings.*.ts`): plain fields render generically via
          `KindDetailsFields`, a kind with real cross-node state or file/network side
          effects (agent's workbench, a dataset's import, a task's PRD join…) names a
          `custom.component` looked up in `KIND_DETAIL_SECTIONS` — DATA, not a chain —
          and `KindDetailsActions` renders whatever buttons the manifest declares,
          wired through the ONE handler map built above. A kind in neither registry
          (spec-object kinds edit on their card; `chat` has its own surface) falls
          through to the same "this object lives on the board" hint every kind without
          settings always showed. */}
      <KindDetailsFields kind={kind} data={node.data} editable={editable} onChange={onChange} />
      {/* "Run on its own" belongs to EVERY object — the clock badge on the card says so.
          It is drawn here as well as in the compact panel's Advanced section because the
          wide reading of that panel REPLACES the compact one: without this, widening to
          see everything about an object would be the one action that hides its schedule.
          Same component both ways, so the two cannot drift on what an interval means. */}
      <TimingFields data={node.data} editable={editable} onChange={onChange} />
      {kindCustomSection && kindCustomSection(kindSectionProps)}
      {/* The panel decides for itself whether this object has anything to
          convert, and to which notations — so no kind list is maintained here. */}
      <DiagramConvertPanel node={node} nodes={nodes} onConvert={onConvertDiagram} />
      <KindDetailsActions kind={kind} data={node.data} editable={editable} handlers={detailsActionHandlers} />
      {!kindSettingsManifest(kind) && !isSpecObjectKind(kind) && kind !== 'chat' && <p className={styles.inspectorHint}>{t('objectLiveHint')}</p>}
      </fieldset> : <ActivityInspector sessionId={sessionId} objectId={node.id} data={node.data} persistence={persistence} role={role} members={members} />}
      {/* Where the evidence behind THIS object is shown — for every kind that
          carries it, not the two that happened to mount the list. `sources` is an
          authorable field on eighteen kinds (document, report, knowledge, chart,
          slides, roadmap, evaluation, pitch…), and Brain writes it whenever it
          grounds an answer, but only `projectComparison` and `mockupSet` rendered
          it: on everything else the citations were written, persisted, and never
          shown, so a grounded research document was indistinguishable from an
          invented one. The list decides its own visibility (null when empty), so
          one mount covers every kind and cannot drift from the field. */}
      {/* Learning controls. Each decides its own visibility from the object —
          the reading-level rewrite appears on anything whose body is prose (read
          off the registry, not a list here), and the two authoring panels on the
          kind that owns them. */}
      {tab === 'details' && <>
        <ReadingLevelControl data={node.data} editable={editable} onAskBrain={onAskBrain} />
        <CourseSubjectControl data={node.data} editable={editable} onChange={onChange} onAskBrain={onAskBrain} />
        <PracticeAuthoring data={node.data} editable={editable} onChange={onChange} onAskBrain={onAskBrain} />
      </>}
      {tab === 'details' && <SourceList sources={node.data.sources} />}
      {/* The step that used to be missing: an object that runs on this board and
          nowhere else becomes something a stranger can find, buy and play. The
          button decides its own visibility from the KIND — and, separately, whether
          THIS INSTANCE may be sold: a managed seat like a board's CMO is the same
          `agent` kind a hand-authored one is, but `kindSettingsSellable` reads the
          instance's own origin, which is the fix for a built-in collaborator showing
          "Sell this as a Agent" beside a card that says it is managed by BuilderForce. */}
      {tab === 'details' && (
        <SellInMarketplace
          kind={kind}
          disabled={!editable}
          sellable={kindSettingsSellable(kind, node.data)}
          onPublish={onPublishListing}
          onReleases={onOpenReleases}
        />
      )}
      {tab === 'details' && canvasExportActionsFor(node.data).length > 0 && <section aria-label={t('copyAndDownload')} style={{ display: 'grid', gap: 7, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('copyAndDownload')}</strong>
        <CanvasExportActions data={node.data} onExport={(action) => void runArtifactAction(action)} className={styles.panelActions} />
        {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
      </section>}
      {tab === 'details' && deliverables.length > 0 && <section aria-label={t('deliverables')} style={{ display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}><strong style={{ fontSize: 'var(--font-size-small)' }}>{t('deliveredOutputs')}</strong>{deliverables.slice(0, 6).map((deliverable) => <div key={deliverable.id} style={{ display: 'grid', gap: 2, fontSize: 'var(--font-size-small)' }}><span><b>{deliverable.artifactKind}</b> · {deliverable.status}</span><small>{deliverable.provider || 'Builderforce'} · {new Date(deliverable.completedAt || deliverable.createdAt).toLocaleString()}</small>{deliverable.url && !deliverable.url.startsWith('data:') && <a href={deliverable.url} target="_blank" rel="noreferrer">{t('openDeliverable')}</a>}{deliverable.error && <small style={{ color: 'var(--error-text)' }}>{deliverable.error}</small>}</div>)}</section>}
    </div>
    <footer><span>{t('resourceRole', { role })}</span><code>{node.data.resourceId || `session:${node.id}`}</code><button className={styles.fullButton} disabled={!editable} onClick={() => kind === 'task' ? setActionStatus(t('taskDetailsSaved')) : onChange({ status: 'Saved' })}>{kind === 'task' ? t('saveTaskDetails') : t('saveChanges')}</button></footer>
  </aside>;
}

/**
 * Everything a kind's wide-panel `custom.component` section might need. One shape
 * for all eleven, because the alternative — eleven different call signatures — is what
 * the dispatch table in `KIND_DETAIL_SECTIONS` exists to avoid: `Inspector` already
 * computes every one of these once, so handing the whole bag to whichever section is
 * about to mount costs nothing a per-kind prop list would have saved.
 */
interface KindSectionProps {
  node: CreationFlowNode;
  nodes: CreationFlowNode[];
  data: CreationNodeData;
  editable: boolean;
  persistence: 'local' | 'server';
  onChange: (patch: Partial<CreationNodeData>) => void;
  isBuiltinAgent: boolean;
  isBuiltinManager: boolean;
  isExistingAgent: boolean;
  connectedAgentKnowledge: CreationFlowNode[];
  agentTools: string[];
  availableAgentTools: string[];
  knowledgeDraft: string;
  setKnowledgeDraft: (value: string) => void;
  onOpenBuiltinAgent: (intent: BuiltinAgentSurfaceIntent) => void;
  onAddAgentKnowledge: (content: string) => void;
  onRunAgentTest: (testPrompt: string, expected: string) => void | Promise<void>;
  onSaveAgent: () => void;
  deliveryAgent: CreationFlowNode | undefined;
  deliveryKnowledgeCount: number;
  websiteHero: { heading: string; body: string; cta: string };
  websiteTheme: { accent?: string };
  onWebsiteChange: (patch: Partial<CreationNodeData>) => void;
  onPublishWebsite: () => void;
  onBuildWebsiteWithCode: () => void;
  onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => void;
  onGenerateVideo: () => void;
  onImportDataset: (file: File) => void | Promise<void>;
  onProfileDataset: (nodeId: string) => void;
  onVisualizeDataset: () => void;
  onPlotDataset: () => void;
  taskId: number | null;
  taskAgents: CreationFlowNode[];
  taskAgentValue: string;
  taskAssignees: { id: string; name: string }[];
  taskCost: { estimatedCostUsd: number; totalTokens: number; requests: number } | null;
  statusGuidance: Record<string, string>;
  normalizedTaskStatus: string;
  prdStatus: string | undefined;
  prdTitle: string;
  prdSummary: string | undefined;
  actionStatus: string;
  setActionStatus: (value: string) => void;
  persistTaskPatch: (apiPatch: Parameters<typeof tasksApi.update>[1], canvasPatch: Partial<CreationNodeData>) => Promise<void>;
  mockupProjects: CreationFlowNode[];
  mockupProjectValue: string;
  mockupAgents: CreationFlowNode[];
  mockupAgentValue: string;
  onDeliverMockup: () => void;
  onRunCreativeAction: (action: string) => void;
  onShipGame: () => void;
  // `build` and `evermind` dispatch straight to their existing components, which take
  // a few props no other section needs — carried here rather than given their own
  // narrower call shape, per this interface's own rationale above.
  creatingBuild: boolean;
  onOpenBuild: () => void;
  onAttachBuild: (ide: IdeProject) => void;
  onDeleteBuildWorkspace: () => void;
  onAttachEvermindProject: () => void;
  onExpandEvermindPipeline: () => void;
  onTrainEvermind: () => void;
  onResumeTailor: (nodeId: string, request: string) => void;
  onResumeDetach: (nodeId: string, detachedData: Partial<CreationNodeData>) => void;
  onResumeShare: (nodeId: string, kind: 'view' | 'embed') => Promise<void>;
  onResumeSharesList: (nodeId: string) => Promise<CanvasResumeShare[]>;
  onResumeShareRevoke: (nodeId: string, shareId: string) => Promise<void>;
}

/** The custom-authoring workbench for `agent` — extracted verbatim from the old
 *  `kind === 'agent'` branch. A built-in seat gets Execute (+ diagnostics for the
 *  delivery Manager); everything else gets the personality/tools/knowledge/test-bench
 *  authoring flow. Nothing about either branch changed — only that reaching this is now
 *  a manifest lookup instead of one link in a 700-line conditional chain. */
function AgentInspectorSection({
  data, onChange, isBuiltinAgent, isBuiltinManager, isExistingAgent, connectedAgentKnowledge,
  agentTools, availableAgentTools, knowledgeDraft, setKnowledgeDraft, onOpenBuiltinAgent,
  onAddAgentKnowledge, onRunAgentTest, onSaveAgent,
}: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  if (isBuiltinAgent) {
    return <>
      <section className={styles.agentSetupGuide} data-existing="true" aria-label={t('agentSetupProgress')}>
        <strong>{t('agentBuiltin')}</strong>
        <p>{t('agentBuiltinHint', { seat: String(data.agentSeat) })}</p>
      </section>
      <div className={styles.agentWorkbench}>
        <button type="button" className={styles.fullButton} onClick={() => onOpenBuiltinAgent('execute')}>{t('node.executeBuiltin')}</button>
        {isBuiltinManager && <button type="button" className={styles.secondaryFullButton} onClick={() => onOpenBuiltinAgent('diagnostics')}>{t('node.builtinDiagnostics')}</button>}
      </div>
    </>;
  }
  return <>
    <section className={styles.agentSetupGuide} data-existing={isExistingAgent} aria-label={t('agentSetupProgress')}>
      <strong>{isExistingAgent ? t('agentExisting') : t('agentPrepareNew')}</strong>
      <p>{isExistingAgent ? t('agentExistingHint') : t('agentPrepareHint')}</p>
      {!isExistingAgent && <div className={styles.agentSetupSteps}><span data-done={!!String(data.personality || '').trim()}>{t('agentStepPersonality')}</span><span data-done={connectedAgentKnowledge.length > 0}>{connectedAgentKnowledge.length ? t('agentStepTrainingAdded') : t('agentStepTrainingNeeded')}</span><span data-done={!!String(data.instructions || '').trim()}>{t('agentStepDirection')}</span><span data-done={!!data.testResponse}>{data.testResponse ? t('agentStepTestRun') : t('agentStepTestNeeded')}</span></div>}
    </section>
    {!isExistingAgent && <label>{t('personality')}<textarea aria-label={t('personality')} value={typeof data.personality === 'string' ? data.personality : ''} onChange={(event) => onChange({ personality: event.target.value })} rows={3} placeholder={t('personalityPlaceholder')} /></label>}
    <label>{t('model')}<select value={String(data.model || 'auto')} onChange={(event) => onChange({ model: event.target.value })}><option value="auto">{t('modelAuto')}</option><option value="gpt-4o">gpt-4o</option><option value="claude-3.5-sonnet">claude-3.5-sonnet</option><option value="Evermind">Evermind</option></select></label>
    <label>{isExistingAgent ? t('instructions') : t('agentDirection')}<textarea aria-label={t('instructions')} value={typeof data.instructions === 'string' ? data.instructions : String(data.subtitle || '')} onChange={(event) => onChange({ instructions: event.target.value, subtitle: event.target.value })} rows={5} placeholder={isExistingAgent ? undefined : t('agentDirectionPlaceholder')} /></label>
    <label>{t('tools')}<div className={styles.inspectorPills}>{agentTools.map((tool) => <button type="button" key={tool} aria-label={t('removeTool', { tool })} onClick={() => onChange({ tools: agentTools.filter((candidate) => candidate !== tool) })}>{tool} ×</button>)}<button type="button" disabled={availableAgentTools.every((tool) => agentTools.includes(tool))} onClick={() => { const next = availableAgentTools.find((tool) => !agentTools.includes(tool)); if (next) onChange({ tools: [...agentTools, next] }); }}>{t('addTool')}</button></div></label>
    <label>{t('autonomy')}<select value={typeof data.autonomy === 'string' ? data.autonomy : 'medium'} onChange={(event) => onChange({ autonomy: event.target.value })}><option value="medium">{t('autonomyMedium')}</option><option value="low">{t('autonomyLow')}</option><option value="high">{t('autonomyHigh')}</option></select></label>
    <section className={styles.agentWorkbench} aria-label={t('agentKnowledge')} data-inspector-section="knowledge">
      <div className={styles.workbenchHeading}><strong>{t('knowledge')}</strong><span>{t('connectedCount', { count: connectedAgentKnowledge.length })}</span></div>
      {connectedAgentKnowledge.length > 0 && <div className={styles.knowledgeList}>{connectedAgentKnowledge.map((item) => <span key={item.id}>{item.data.kind} · {item.data.title}</span>)}</div>}
      <label>{t('addKnowledge')}<textarea rows={4} value={knowledgeDraft} onChange={(event) => setKnowledgeDraft(event.target.value)} placeholder={t('addKnowledgePlaceholder')} /></label>
      <button type="button" className={styles.fullButton} disabled={!knowledgeDraft.trim()} onClick={() => { onAddAgentKnowledge(knowledgeDraft); setKnowledgeDraft(''); }}>{t('addAndConnectKnowledge')}</button>
    </section>
    <section className={styles.agentWorkbench} aria-label={t('agentTestBench')} data-inspector-section="test">
      <div className={styles.workbenchHeading}><strong>{t('testBench')}</strong><span>{String(data.testStatus || t('notRun'))}</span></div>
      <label>{t('customerMessage')}<textarea rows={3} value={typeof data.testPrompt === 'string' ? data.testPrompt : ''} onChange={(event) => onChange({ testPrompt: event.target.value })} placeholder={t('customerMessagePlaceholder')} /></label>
      <label>{t('expectedSignals')}<textarea rows={2} value={typeof data.testExpected === 'string' ? data.testExpected : ''} onChange={(event) => onChange({ testExpected: event.target.value })} placeholder={t('expectedSignalsPlaceholder')} /></label>
      <button type="button" className={styles.fullButton} disabled={!String(data.testPrompt || '').trim() || data.testStatus === 'Running'} onClick={() => void onRunAgentTest(String(data.testPrompt || ''), String(data.testExpected || ''))}>{data.testStatus === 'Running' ? t('runningTest') : t('runAgentTest')}</button>
      {typeof data.testResponse === 'string' && data.testResponse && <div className={styles.testResponse}><strong>{t('agentResponse')}</strong><p>{data.testResponse}</p></div>}
    </section>
    <button type="button" className={styles.fullButton} onClick={onSaveAgent}>{isExistingAgent ? t('saveAgentEverywhere') : t('createInviteAgent')}</button>
  </>;
}

function EvaluationInspectorSection({ data, onChange }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <section data-inspector-section="evaluation">
    <div className={styles.evaluationSummary}><strong>{String(data.verdict || t('notRun'))}</strong><span>{typeof data.passRate === 'number' ? t('passRate', { rate: data.passRate }) : t('runTestForResult')}</span></div>
    <label>{t('evaluationCriteria')}<textarea rows={5} value={typeof data.criteria === 'string' ? data.criteria : typeof data.content === 'string' ? data.content : ''} onChange={(event) => onChange({ criteria: event.target.value })} placeholder={t('evaluationCriteriaPlaceholder')} /></label>
    <p className={styles.inspectorHint}>{t('evaluationHint')}</p>
    {Array.isArray(data.testResults) && data.testResults.length > 0 && <div className={styles.testResults}>{data.testResults.slice(0, 10).map((value, index) => { const result = value as Record<string, unknown>; return <div key={String(result.id || index)}><b>{String(result.status || t('completed'))}</b><span>{String(result.prompt || t('testCase'))}</span><small>{String(result.runAt || '')}</small></div>; })}</div>}
  </section>;
}

function ReleaseInspectorSection({ deliveryAgent, deliveryKnowledgeCount }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <section className={styles.deliveryChecklist} data-inspector-section="delivery" aria-label={t('agentDeliveryChecklist')}>
    <strong>{t('deliveryChecklist')}</strong>
    <span>{`${deliveryAgent ? '✓' : '○'} ${t('agentSelected')} ${deliveryAgent ? `· ${deliveryAgent.data.title}` : `· ${t('connectAgentCard')}`}`}</span>
    <span>{`${deliveryKnowledgeCount > 0 ? '✓' : '○'} ${t('knowledgeConnected')} ${deliveryKnowledgeCount ? `· ${t('sourceCount', { count: deliveryKnowledgeCount })}` : ''}`}</span>
    <span>{`${deliveryAgent?.data.testResponse ? '✓' : '○'} ${t('testResponseRecorded')}`}</span>
    <span>{`${deliveryAgent?.data.resourceId ? '✓' : '○'} ${t('workforceAgentSaved')}`}</span>
    <p className={styles.inspectorHint}>{deliveryAgent?.data.resourceId ? t('deliveryConnectedHint') : t('deliveryPendingHint')}</p>
  </section>;
}

function WebsiteInspectorSection({
  data, onChange, websiteHero, websiteTheme, onWebsiteChange, onPublishWebsite, onBuildWebsiteWithCode, onWebsiteViewportChange,
}: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  const kind = data.kind;
  return <>
    <label>{t('headline')}<input value={websiteHero.heading} onChange={(event) => onWebsiteChange({ websiteHeadline: event.target.value })} /></label>
    <label>{t('supportingCopy')}<textarea rows={3} value={websiteHero.body} onChange={(event) => onWebsiteChange({ websiteBody: event.target.value })} /></label>
    <label>{t('callToAction')}<input value={websiteHero.cta} onChange={(event) => onWebsiteChange({ websiteCta: event.target.value })} /></label>
    <label>{t('accentColor')}<input type="color" value={websiteTheme.accent && /^#[0-9a-f]{6}$/i.test(websiteTheme.accent) ? websiteTheme.accent : AUTHORED_WEBSITE_ACCENT} onChange={(event) => onChange({ websiteAccent: event.target.value, websiteTheme: { ...(typeof data.websiteTheme === 'object' && data.websiteTheme ? data.websiteTheme as Record<string, unknown> : {}), accent: event.target.value } })} /></label>
    <label>{t('viewport')}<select value={typeof data.viewport === 'string' ? data.viewport : 'desktop'} onChange={(event) => onWebsiteViewportChange(event.target.value as 'desktop' | 'tablet' | 'mobile')}><option value="desktop">{t('viewportDesktop')}</option><option value="tablet">{t('viewportTablet')}</option><option value="mobile">{t('viewportMobile')}</option></select></label>
    {kind === 'website' && <>
      <label>{t('subdomain')}<input value={typeof data.subdomain === 'string' ? data.subdomain : ''} placeholder={t('subdomainPlaceholder')} onChange={(event) => onChange({ subdomain: event.target.value })} /></label>
      <button type="button" className={styles.fullButton} onClick={onPublishWebsite}>{t('publishWebsite')}</button>
      {typeof data.siteUrl === 'string' && <a href={data.siteUrl} target="_blank" rel="noreferrer">{t('openPublishedSite')}</a>}
      <button type="button" className={styles.secondaryFullButton} onClick={onBuildWebsiteWithCode}>{t('build.websiteWithCode')}</button>
      <p className={styles.inspectorHint}>{t('build.websiteWithCodeHint')}</p>
    </>}
    <p className={styles.inspectorHint}>{t('websiteLiveHint')}</p>
  </>;
}

function VideoInspectorSection({ data, onChange, onGenerateVideo }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('prompt')}<textarea rows={5} value={typeof data.prompt === 'string' ? data.prompt : ''} onChange={(event) => onChange({ prompt: event.target.value })} placeholder={t('videoPromptPlaceholder')} /></label>
    <label>{t('publishedEvermindModel')}<input value={typeof data.modelSlug === 'string' ? data.modelSlug : ''} onChange={(event) => onChange({ modelSlug: event.target.value })} placeholder={t('mediaModelPlaceholder')} /></label>
    <label>{t('frames')}<input type="number" min="1" max="64" value={typeof data.maxFrames === 'number' ? data.maxFrames : 16} onChange={(event) => onChange({ maxFrames: Math.max(1, Math.min(64, Number(event.target.value) || 16)) })} /></label>
    <button type="button" className={styles.fullButton} onClick={onGenerateVideo}>{t('generateVideo')}</button>
    {typeof data.videoUrl === 'string' && <img src={data.videoUrl} alt={t('videoFirstFrame')} style={{ width: '100%', borderRadius: 'var(--radius-lg)' }} />}
  </>;
}

function DatasetInspectorSection({ node, data, onImportDataset, onProfileDataset, onVisualizeDataset, onPlotDataset }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('datasetImportLabel')}<input type="file" accept=".csv,.tsv,.tab,.json,.jsonl,.xlsx,.xlsm,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportDataset(file); }} /></label>
    <p className={styles.inspectorHint}>{t('datasetImportHint')}</p>
    <DatasetProfileSummary data={data} />
    <button type="button" className={styles.fullButton} onClick={() => onProfileDataset(node.id)}>{t('datasetProfileAction')}</button>
    <button type="button" className={styles.fullButton} onClick={onVisualizeDataset}>{t('datasetVisualizeAction')}</button>
    <DatasetPlotAction data={data} onPlot={onPlotDataset} />
  </>;
}

/**
 * The résumé's Details + Tools, mounted beside the card rather than on top of it. The
 * card itself now shows only the rendered document (see `CanvasResumeEditor`'s `variant`
 * prop) — everything that used to sit above that document in its own header (version,
 * privacy, template, page setup) and below it (the three AI accordions) lives here
 * instead, reached the same way every other rich kind's settings are: click the card,
 * open the inspector. `variant="inspector"` is what drops this instance's own copy of
 * the rendered document — the card behind this panel is already showing it. */
function ResumeInspectorSection({ node, onChange, onResumeTailor, onResumeDetach, onResumeShare, onResumeSharesList, onResumeShareRevoke }: KindSectionProps) {
  return <CanvasResumeEditor
    variant="inspector"
    data={node.data}
    onEdit={onChange}
    onTailor={(prompt) => onResumeTailor(node.id, prompt)}
    onDetach={(patch) => onResumeDetach(node.id, patch)}
    shareActions={{
      create: (kind) => onResumeShare(node.id, kind),
      list: () => onResumeSharesList(node.id),
      revoke: (shareId) => onResumeShareRevoke(node.id, shareId),
    }}
  />;
}

function WebPageInspectorSection({ data, onChange }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('webPage.addressLabel')}<input
      type="url"
      inputMode="url"
      spellCheck={false}
      value={typeof data.url === 'string' ? data.url : ''}
      placeholder={t('webPage.addressPlaceholder')}
      onChange={(event) => onChange({ url: event.target.value })}
      onBlur={(event) => { const next = normalizeWebPageUrl(event.target.value); if (next) onChange({ url: next, frameCheckedUrl: '', frameable: true, frameBlockedBy: null }); }}
    /></label>
    <label>{t('viewport')}<select value={canvasViewport(data.viewport)} onChange={(event) => onChange({ viewport: event.target.value })}>
      <option value="desktop">{t('viewportDesktop')}</option>
      <option value="tablet">{t('viewportTablet')}</option>
      <option value="mobile">{t('viewportMobile')}</option>
    </select></label>
    <button type="button" className={styles.fullButton} disabled={!canvasWebPageUrl(data)} onClick={() => onChange({ frameCheckedUrl: '' })}>{t('webPage.reread')}</button>
    <p className={styles.inspectorHint}>{t('webPage.inspectorHint')}</p>
    {data.frameable === false && <p className={styles.inspectorHint}>{t('webPage.blockedHint')}</p>}
  </>;
}

function TaskInspectorSection({
  data, onChange, taskId, taskAgents, taskAgentValue, taskAssignees, taskCost, statusGuidance, normalizedTaskStatus,
  prdStatus, prdTitle, prdSummary, actionStatus, setActionStatus, persistTaskPatch, persistence,
}: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <div className={styles.taskInspectorGrid}>
      <label>{t('status')}<select value={String(data.status || 'ready')} onChange={(event) => void persistTaskPatch({ status: event.target.value }, { status: event.target.value })}>
        {!['backlog', 'todo', 'ready', 'assigned', 'in_progress', 'in_review', 'blocked', 'done'].includes(String(data.status || 'ready')) && <option value={String(data.status)}>{String(data.status)}</option>}
        <option value="backlog">{t('statusBacklog')}</option><option value="todo">{t('statusTodo')}</option><option value="ready">{t('statusReady')}</option><option value="assigned">{t('statusAssigned')}</option><option value="in_progress">{t('statusInProgress')}</option><option value="in_review">{t('statusInReview')}</option><option value="blocked">{t('statusBlocked')}</option><option value="done">{t('statusDone')}</option>
      </select></label>
      <label>{t('priority')}<select value={typeof data.priority === 'string' ? data.priority : 'medium'} onChange={(event) => void persistTaskPatch({ priority: event.target.value as 'low' | 'medium' | 'high' | 'urgent' }, { priority: event.target.value })}><option value="low">{t('priorityLow')}</option><option value="medium">{t('priorityMedium')}</option><option value="high">{t('priorityHigh')}</option><option value="urgent">{t('priorityUrgent')}</option></select></label>
      {/* The scheduling triple `tasksApi.update` has always accepted — see its own note —
          plus sprint assignment. Writable through the board sync and Brain since the
          fields were added to `MUTABLE_FIELDS.task`; this is the first surface that lets
          a person set them directly. */}
      <label>{t('storyPoints')}<input type="number" min={0} step={1} value={typeof data.storyPoints === 'number' ? data.storyPoints : ''} onChange={(event) => { const value = event.target.value === '' ? null : Number(event.target.value); void persistTaskPatch({ storyPoints: value }, { storyPoints: value ?? undefined }); }} /></label>
      <label>{t('startDate')}<input type="date" value={typeof data.startDate === 'string' ? data.startDate.slice(0, 10) : ''} onChange={(event) => { const value = event.target.value || null; void persistTaskPatch({ startDate: value }, { startDate: value ?? undefined }); }} /></label>
      <label>{t('dueDate')}<input type="date" value={typeof data.dueDate === 'string' ? data.dueDate.slice(0, 10) : ''} onChange={(event) => { const value = event.target.value || null; void persistTaskPatch({ dueDate: value }, { dueDate: value ?? undefined }); }} /></label>
      <label>{t('sprintId')}<input value={typeof data.sprintId === 'string' ? data.sprintId : ''} onChange={(event) => onChange({ sprintId: event.target.value || undefined })} onBlur={(event) => void persistTaskPatch({ sprintId: event.target.value || null }, { sprintId: event.target.value || undefined })} /></label>
    </div>
    <div className={styles.statusGuidance}><b>{t('howToMoveForward')}</b><p>{statusGuidance[normalizedTaskStatus] || t('taskGuidanceFallback')}</p></div>
    <label>{t('assignedAgent')}<select
      value={typeof data.assignedUserId === 'string' && data.assignedUserId ? `user:${data.assignedUserId}` : taskAgentValue}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw.startsWith('user:')) {
          const userId = raw.slice(5);
          const human = taskAssignees.find((member) => member.id === userId);
          void persistTaskPatch(
            { assignedUserId: userId, assignedAgentRef: null, assignedAgentHostId: null },
            { agentRef: undefined, assignee: human?.name, role: undefined },
          );
          return;
        }
        const selected = taskAgents.find((agent) => (agent.data.resourceId?.replace(/^agent:/, '') || agent.id) === raw);
        const agentRef = selected?.data.resourceId?.startsWith('agent:') ? selected.data.resourceId.slice(6) : null;
        if (taskId != null && persistence === 'server' && selected && !agentRef) { setActionStatus(t('saveAgentBeforeAssign')); return; }
        void persistTaskPatch({ assignedAgentRef: agentRef, assignedAgentHostId: null, assignedUserId: null }, { agentRef: raw || undefined, assignee: selected?.data.title || undefined, role: selected?.data.title || undefined });
      }}
    >
      <option value="">{t('unassigned')}</option>
      {taskAgents.length > 0 && <optgroup label={t('assigneeGroupAgents')}>{taskAgents.map((agent) => { const value = agent.data.resourceId?.replace(/^agent:/, '') || agent.id; return <option key={agent.id} value={value}>{agent.data.title}{agent.data.model ? ` · ${String(agent.data.model)}` : ''}</option>; })}</optgroup>}
      {taskAssignees.length > 0 && <optgroup label={t('assigneeGroupPeople')}>{taskAssignees.map((member) => <option key={member.id} value={`user:${member.id}`}>{member.name}</option>)}</optgroup>}
    </select></label>
    <label>{t('description')}<textarea rows={5} value={typeof data.content === 'string' ? data.content : typeof data.subtitle === 'string' ? data.subtitle : ''} onChange={(event) => onChange({ content: event.target.value })} onBlur={(event) => { if (taskId != null && persistence === 'server') void persistTaskPatch({ description: event.target.value || null }, { content: event.target.value }); }} /></label>
    <label>{t('acceptanceCriteria')}<textarea rows={4} value={typeof data.acceptanceCriteria === 'string' ? data.acceptanceCriteria : ''} placeholder={t('acceptanceCriteriaPlaceholder')} onChange={(event) => onChange({ acceptanceCriteria: event.target.value })} /></label>
    <section className={styles.taskPrdSummary} aria-label={t('taskPrd')}>
      <div><span>{t('prd')}</span>{prdStatus && <small>{prdStatus}</small>}</div>
      {prdTitle ? <><strong>{prdTitle}</strong>{prdSummary && <p>{prdSummary.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 360)}</p>}</> : <><strong>{t('noPrdLinked')}</strong><p>{t('noPrdLinkedHint')}</p></>}
    </section>
    {taskCost && taskCost.requests > 0 && <section className={styles.taskPrdSummary} aria-label={t('costToBuild')}>
      <div><span>{t('costToBuild')}</span></div>
      <strong>{taskCost.estimatedCostUsd < 0.01 ? t('costUnderOneCent') : `$${taskCost.estimatedCostUsd.toFixed(2)}`}</strong>
      <p>{t('costRunsAndTokens', { requests: taskCost.requests, tokens: taskCost.totalTokens.toLocaleString() })}</p>
    </section>}
    {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
  </>;
}

function MockupInspectorSection({ data, onChange, mockupProjects, mockupProjectValue, mockupAgents, mockupAgentValue, onDeliverMockup }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('deliveryProject')}<select value={mockupProjectValue} onChange={(event) => { const project = mockupProjects.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ deliveryProjectRef: event.target.value, deliveryProjectName: project?.data.title || (event.target.value === 'draft:builderforce-launch' ? 'BuilderForce launch' : t('noProject')) }); }}><option value="draft:builderforce-launch">BuilderForce launch</option>{mockupProjects.filter((project) => (project.data.resourceId || project.id) !== 'draft:builderforce-launch').map((project) => <option key={project.id} value={project.data.resourceId || project.id}>{project.data.title}</option>)}<option value="">{t('noProject')}</option></select></label>
    <label>{t('assignAgent')}<select value={mockupAgentValue} onChange={(event) => { const agent = mockupAgents.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ mockupAgentRef: event.target.value, mockupAgentName: agent?.data.title || (event.target.value === 'web-analyst' ? 'Web Analyst' : t('unassigned')) }); }}><option value="campaign-strategist">Campaign Strategist</option>{mockupAgents.filter((agent) => (agent.data.resourceId || agent.id) !== 'campaign-strategist').map((agent) => <option key={agent.id} value={agent.data.resourceId || agent.id}>{agent.data.title}</option>)}<option value="web-analyst">Web Analyst</option><option value="">{t('unassigned')}</option></select></label>
    <button className={styles.fullButton} onClick={onDeliverMockup}>{t('addToProjectAssign')}</button>
  </>;
}

function DrawingInspectorSection({ data, onChange }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  return <>
    <label>{t('strokeColor')}<input
      type="color"
      value={canvasStrokes(data)[0]?.stroke.startsWith('#') ? canvasStrokes(data)[0]!.stroke : AUTHORED_DRAWING_STROKE}
      onChange={(event) => onChange(restyleDrawing(data, { stroke: event.target.value }))}
    /></label>
    <label>{t('strokeWidth')}<input
      type="range" min="1" max="12"
      value={canvasStrokes(data)[0]?.strokeWidth ?? 3}
      onChange={(event) => onChange(restyleDrawing(data, { strokeWidth: Number(event.target.value) }))}
    /></label>
    <p className={styles.inspectorHint}>{t('drawingHint')}</p>
  </>;
}

function CreativeGeneratorSection({ data, onChange, onRunCreativeAction, onShipGame }: KindSectionProps) {
  const t = useTranslations('creationCanvas');
  const kind = data.kind;
  return <>
    <label>{t('creativeBrief')}<textarea rows={5} value={typeof data.prompt === 'string' ? data.prompt : typeof data.content === 'string' ? data.content : ''} onChange={(event) => onChange({ prompt: event.target.value, content: event.target.value })} placeholder={t('creativeBriefPlaceholder', { label: creationObjectDefinition(kind).label.toLowerCase() })} /></label>
    <label>{t('templateId')}<input value={typeof data.templateId === 'string' ? data.templateId : ''} onChange={(event) => onChange({ templateId: event.target.value })} placeholder={kind === 'template' ? t('browseWithBrain') : t('optionalTemplate')} /></label>
    <label>{t('outputFormat')}<select value={typeof data.outputFormat === 'string' ? data.outputFormat : ''} onChange={(event) => onChange({ outputFormat: event.target.value })}><option value="">{t('chooseOnExport')}</option>{(CREATIVE_OUTPUTS[kind] || []).map((format) => <option key={format} value={format}>{format}</option>)}</select></label>
    <section className={styles.taskPrdSummary} aria-label={t('nativeCreativeCapability')}><div><span>{t('creativeCapability')}</span><small>{typeof data.provider === 'string' ? data.provider : 'native'}</small></div><strong>{typeof data.capabilityId === 'string' ? data.capabilityId : `creative.${kind}`}</strong><p>{t('creativeCapabilityHint')}</p></section>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button type="button" className={styles.fullButton} onClick={() => onRunCreativeAction(kind === 'template' ? 'apply' : 'generate')}>{kind === 'template' ? t('applyTemplate') : t('generateLabel', { label: creationObjectDefinition(kind).label })}</button>
      {typeof data.outputUrl === 'string' && <><button type="button" onClick={() => onRunCreativeAction('preview')}>{t('preview')}</button><button type="button" onClick={() => onRunCreativeAction('export')}>{t('download')}</button></>}
      {/* A game is the one creative artifact that can be played somewhere other than here — the
          phone, an app store, Roblox. The panel behind this is where that happens; it stays out
          of the inspector because it is a flow with its own state, not another action button. */}
      {kind === 'game' && typeof data.outputUrl === 'string' && <button type="button" onClick={onShipGame}>{t('game.shipAction')}</button>}
    </div>
  </>;
}

/** Dispatch table for `custom.component` — DATA, not a `kind === 'x'` chain: adding a
 *  kind here is a row plus a section, never a new branch at the call site. The six
 *  entries that were already components (`guidedTour`… `pitch`) are adapted to the
 *  shared `KindSectionProps` shape so every entry in this table has the same call. */
const KIND_DETAIL_SECTIONS: Record<string, (props: KindSectionProps) => JSX.Element | null> = {
  agent: AgentInspectorSection,
  evaluation: EvaluationInspectorSection,
  release: ReleaseInspectorSection,
  website: WebsiteInspectorSection,
  video: VideoInspectorSection,
  dataset: DatasetInspectorSection,
  resume: ResumeInspectorSection,
  webPage: WebPageInspectorSection,
  task: TaskInspectorSection,
  mockup: MockupInspectorSection,
  drawing: DrawingInspectorSection,
  creative: CreativeGeneratorSection,
  guidedTour: ({ node, nodes, onChange }) => <GuidedTourInspector node={node} nodes={nodes} onChange={onChange} />,
  build: ({ node, editable, creatingBuild, persistence, onChange, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace }) => (
    <BuildInspectorSection node={node} editable={editable} creating={creatingBuild} persistence={persistence} onChange={onChange} onOpenBuild={onOpenBuild} onAttachBuild={onAttachBuild} onDeleteBuildWorkspace={onDeleteBuildWorkspace} />
  ),
  voice: ({ node, persistence, onChange }) => <CanvasVoiceInspector node={node} persistence={persistence} onChange={onChange} />,
  email: ({ data, editable, persistence, onChange }) => <CanvasEmailComposer data={data} editable={editable} persistence={persistence} onChange={onChange} />,
  evermind: ({ node, persistence, onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind }) => (
    <EvermindInspector node={node} persistence={persistence} onAttach={onAttachEvermindProject} onExpand={onExpandEvermindPipeline} onTrain={onTrainEvermind} />
  ),
  pitch: ({ node, editable, onChange }) => <PitchInspector node={node} editable={editable} onChange={onChange} />,
};

/** The full-surface fields a kind's manifest declares, plus its one hint paragraph.
 *  Declaration order is the render order — see `SettingsFieldControl`. */
function KindDetailsFields({ kind, data, editable, onChange }: {
  kind: string; data: CreationNodeData; editable: boolean; onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas');
  const manifest = kindSettingsManifest(kind);
  const fields = kindSettingsFields(kind, data, 'full');
  return <>
    {fields.map((field) => <SettingsFieldControl key={field.name} field={field} data={data} editable={editable} variant="full" translate={(key) => t(key as never)} onChange={onChange} />)}
    {manifest?.hintKey && <p className={styles.inspectorHint}>{t(manifest.hintKey as never)}</p>}
  </>;
}

/** A kind's declared actions, rendered as buttons wired through the ONE handler map the
 *  inspector builds from the functions it already receives as props — the manifest says
 *  which actions exist and when; the function each one calls stays exactly what it was. */
function KindDetailsActions({ kind, data, editable, handlers }: {
  kind: string; data: CreationNodeData; editable: boolean; handlers: Record<string, () => void>;
}) {
  const t = useTranslations('creationCanvas');
  const actions = kindSettingsActions(kind, data);
  if (!actions.length) return null;
  return <>{actions.map((action) => {
    const handler = handlers[action.handler];
    if (!handler) return null;
    return <button
      key={action.name}
      type="button"
      className={action.style === 'primary' ? styles.fullButton : styles.secondaryFullButton}
      disabled={!editable || (action.disabled ? action.disabled(data) : false)}
      onClick={handler}
    >{t(action.labelKey as never)}</button>;
  })}</>;
}

/**
 * "Plot on a map", offered only when the rows can actually be plotted.
 *
 * It decides its own visibility rather than taking a `canPlot` prop, because the same
 * `detectGeoColumns` call that answers "should this button exist" also answers "what
 * would it plot" — splitting those across a parent and a child is how the two get to
 * disagree. Absent (not disabled) when there are no coordinates: an inert control on a
 * dataset that will never have geography is noise, whereas the button APPEARING the
 * moment a lat/lng column lands is the affordance itself.
 */
function DatasetPlotAction({ data, onPlot }: { data: CreationNodeData; onPlot: () => void }) {
  const t = useTranslations('creationCanvas');
  const source = tabularFromObject(data as Record<string, unknown>);
  if (!source.columns.length || !source.rows.length) return null;
  const columns = detectGeoColumns(source);
  if (!columns.latitude || !columns.longitude) return null;
  return <>
    <button type="button" className={styles.fullButton} onClick={onPlot}>{t('datasetPlotAction')}</button>
    <p className={styles.inspectorHint}>{t('datasetPlotHint', { latitude: columns.latitude, longitude: columns.longitude })}</p>
  </>;
}

/**
 * Column-level shape of an imported dataset. This is what tells a user whether
 * the column they want to analyze actually survived the import, and it is the
 * same profile Brain reads before it queries.
 */
function DatasetProfileSummary({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas');
  const profile = Array.isArray(data.profile) ? data.profile as Array<Record<string, unknown>> : [];
  const rowCount = Number(data.rowCount) || (Array.isArray(data.rows) ? data.rows.length : 0);
  if (!profile.length) return <p className={styles.inspectorHint}>{rowCount ? t('datasetProfilePending') : t('datasetProfileEmpty')}</p>;
  return <section className={styles.datasetProfile} aria-label={t('datasetProfileLabel')}>
    <div className={styles.datasetProfileHead}><strong>{t('datasetProfileLabel')}</strong><span>{t('dataGridShape', { rows: rowCount.toLocaleString(), columns: profile.length })}</span></div>
    <div className={styles.datasetProfileList}>
      {profile.slice(0, 40).map((column, index) => {
        const filled = Number(column.filled) || 0;
        const coverage = rowCount ? Math.round(filled / rowCount * 100) : 0;
        const top = Array.isArray(column.topValues) ? column.topValues as Array<Record<string, unknown>> : [];
        return <article key={`${String(column.name)}-${index}`}>
          <div><b>{String(column.name)}</b><small>{t(`datasetColumnType_${String(column.type)}` as 'datasetColumnType_text')}</small></div>
          <p>{t('datasetColumnCoverage', { coverage, distinct: Number(column.distinct) || 0 })}</p>
          {column.type === 'number' && column.min != null
            ? <small>{t('datasetColumnRange', { min: String(column.min), max: String(column.max), sum: String(column.sum ?? 0) })}</small>
            : top.length ? <small>{top.slice(0, 3).map((value) => `${String(value.value)} (${Number(value.count) || 0})`).join(' · ')}</small> : null}
        </article>;
      })}
    </div>
  </section>;
}

function SourceList({ sources }: { sources: unknown }) {
  const t = useTranslations('creationCanvas');
  if (!Array.isArray(sources) || !sources.length) return null;
  return <div className={styles.sourceList}><strong>{t('evidenceSources')}</strong>{sources.map((source, index) => { const item = source as { label?: string; resource?: string }; return <div key={`${item.resource}-${index}`}><span>{index + 1}</span><p><b>{item.label || t('source')}</b><code>{item.resource || t('canonicalApi')}</code></p></div>; })}</div>;
}

/**
 * Pitch inspector — one panel for all four pitch objects.
 *
 * They differ in what they hold and agree on everything else: they are entered
 * in a competition, they are scored or timed against that competition's own
 * rules, and their content is a list of items a person edits one at a time.
 * Splitting that into four inspectors would have duplicated the competition
 * picker four times and let them drift, so the shape is chosen once here and the
 * rows are chosen by kind.
 *
 * Editing MATERIALIZES: the arrays start empty and the preset supplies the
 * defaults, so the first edit writes the whole normalized list back. After that
 * the object owns its content and a competition change never silently discards
 * what someone wrote.
 */
const DERIVED_PITCH_FIELDS: ReadonlySet<string> = new Set(['labelKey', 'written', 'answered', 'over', 'chars']);

function PitchInspector({ node, editable, onChange }: {
  node: CreationFlowNode;
  editable: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.pitch');
  const data = node.data;
  const kind = data.kind;
  const competition = pitchCompetitionFor(data);
  /** A preset row is product copy and translates; a renamed row is the author's
   * own words and is shown exactly as they typed it. */
  const label = (item: PitchLabelled) => (item.labelKey && t.has(item.labelKey) ? t(item.labelKey) : item.label);
  /**
   * Write the whole list back with one row changed.
   *
   * The normalized rows carry derived state — the catalog key, whether a beat is
   * written, whether an answer is over length — which is recomputed on every
   * read and must never be persisted; storing it would let a stale `over: false`
   * outlive the text that made it true.
   */
  const patchList = <T extends object>(field: string, items: readonly T[], index: number, change: Partial<T>) => {
    onChange({
      [field]: items.map((item, position) => Object.fromEntries(
        Object.entries({ ...item, ...(position === index ? change : {}) })
          .filter(([key]) => !DERIVED_PITCH_FIELDS.has(key)),
      )),
    });
  };
  const scoreInput = (current: number, onPick: (score: number) => void, name: string) => (
    <div className={styles.pitchScoreInput} role="group" aria-label={t('scoreOutOf', { max: PITCH_MAX_SCORE, name })}>
      {Array.from({ length: PITCH_MAX_SCORE }, (_, index) => index + 1).map((score) => (
        <button
          key={score}
          type="button"
          disabled={!editable}
          aria-pressed={current === score}
          aria-label={t('scoreValue', { score, max: PITCH_MAX_SCORE })}
          onClick={() => onPick(current === score ? 0 : score)}
        >{score}</button>
      ))}
    </div>
  );

  const beats = pitchBeats(data);
  const criteria = pitchCriteria(data);
  const questions = pitchQaItems(data);
  const answers = pitchApplicationAnswers(data);
  const eligibility = pitchEligibility(data);
  const spoken = pitchSpokenSeconds(beats);

  return <section data-inspector-section="pitch">
    <label>{t('competition')}<select
      value={competition.id}
      disabled={!editable}
      onChange={(event) => onChange({ competitionId: event.target.value })}
    >{PITCH_COMPETITIONS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
    <p className={styles.inspectorHint}>{t('competitionHint', {
      pitch: formatPitchDuration(competition.pitchSeconds),
      qa: formatPitchDuration(competition.qaSeconds),
      criteria: competition.criteria.length,
    })}</p>
    {competition.url && <a href={competition.url} target="_blank" rel="noreferrer">{t('officialRules')}</a>}

    {kind === 'pitch' && <>
      <div className={styles.pitchInspectorRow}>
        <div className={styles.pitchInspectorItem} data-over={pitchTimingTone(spoken, competition.pitchSeconds) === 'risk' ? 'true' : 'false'}>
          <strong>{formatPitchDuration(spoken)}</strong>
          <span>{t('spokenAt130', { limit: formatPitchDuration(competition.pitchSeconds) })}</span>
        </div>
        <div className={styles.pitchInspectorItem}>
          <strong>{formatPitchDuration(pitchRuntimeSeconds(beats))}</strong>
          <span>{t('budgetedAcrossBeats', { count: beats.length })}</span>
        </div>
      </div>
      {beats.map((beat, index) => <div key={beat.id} className={styles.pitchInspectorItem}>
        <strong>{label(beat)}</strong>
        <span>{beat.prompt}</span>
        <label>{t('seconds')}<input
          type="number" min="0" max="600" value={beat.seconds} disabled={!editable}
          onChange={(event) => patchList('beats', beats, index, { seconds: Math.max(0, Math.min(600, Number(event.target.value) || 0)) })}
        /></label>
        <label>{t('script')}<textarea
          rows={3} value={beat.script} disabled={!editable} placeholder={beat.prompt}
          onChange={(event) => patchList('beats', beats, index, { script: event.target.value })}
        /></label>
      </div>)}
    </>}

    {kind === 'pitchScorecard' && <>
      <div className={styles.pitchInspectorItem}>
        <strong>{t('readinessPercent', { value: pitchReadiness(criteria) })}</strong>
        <span>{t('readinessHint')}</span>
      </div>
      {criteria.map((criterion, index) => <div key={criterion.id} className={styles.pitchInspectorItem}>
        <strong>{label(criterion)}</strong>
        <span>{criterion.prompt}</span>
        {scoreInput(criterion.score, (score) => patchList('criteria', criteria, index, { score }), label(criterion))}
        <label>{t('evidence')}<textarea
          rows={3} value={criterion.evidence} disabled={!editable} placeholder={t('evidencePlaceholder')}
          onChange={(event) => patchList('criteria', criteria, index, { evidence: event.target.value })}
        /></label>
        <label>{t('gap')}<input
          value={criterion.gap} disabled={!editable} placeholder={t('gapPlaceholder')}
          onChange={(event) => patchList('criteria', criteria, index, { gap: event.target.value })}
        /></label>
      </div>)}
    </>}

    {kind === 'pitchQa' && <>
      <div className={styles.pitchInspectorItem}>
        <strong>{t('rehearsedOf', { answered: pitchQaCoverage(questions).answered, total: questions.length })}</strong>
        <span>{t('qaHint', { qa: formatPitchDuration(competition.qaSeconds) })}</span>
      </div>
      {questions.map((item, index) => <div key={item.id} className={styles.pitchInspectorItem}>
        <label>{t('question')}<input
          value={item.question} disabled={!editable}
          onChange={(event) => patchList('questions', questions, index, { question: event.target.value })}
        /></label>
        <label>{t('answer')}<textarea
          rows={3} value={item.answer} disabled={!editable} placeholder={t('answerPlaceholder')}
          onChange={(event) => patchList('questions', questions, index, { answer: event.target.value })}
        /></label>
        {scoreInput(item.strength, (strength) => patchList('questions', questions, index, { strength }), item.question)}
      </div>)}
      <button type="button" className={styles.fullButton} disabled={!editable} onClick={() => onChange({
        questions: [...questions, { id: `question-${questions.length + 1}-${Date.now().toString(36)}`, question: '', answer: '', strength: 0 }],
      })}>{t('addQuestion')}</button>
    </>}

    {kind === 'pitchApplication' && <>
      <div className={styles.pitchInspectorItem}>
        <strong>{t('completePercent', { value: pitchApplicationReadiness(answers, eligibility).percent })}</strong>
        <span>{pitchApplicationReadiness(answers, eligibility).submittable ? t('readyToSubmit') : t('applicationHint')}</span>
      </div>
      {competition.categories.length > 0 && <label>{t('category')}<select
        value={typeof data.category === 'string' ? data.category : ''}
        disabled={!editable}
        onChange={(event) => onChange({ category: event.target.value })}
      ><option value="">{t('chooseCategory')}</option>{competition.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>}
      {eligibility.map((rule, index) => <label key={rule.id} className={styles.inspectorHint}>
        <input
          type="checkbox" checked={rule.met} disabled={!editable}
          onChange={(event) => patchList('eligibility', eligibility, index, { met: event.target.checked })}
        /> {label(rule)}
      </label>)}
      {answers.map((answer, index) => <div key={answer.id} className={styles.pitchInspectorItem} data-over={answer.over ? 'true' : 'false'}>
        <strong>{label(answer)}</strong>
        <span>{answer.maxChars > 0 ? t('charCount', { chars: answer.chars, max: answer.maxChars }) : t('noLimit')}</span>
        <textarea
          rows={4} value={answer.answer} disabled={!editable} aria-label={label(answer)}
          onChange={(event) => patchList('answers', answers, index, { answer: event.target.value })}
        />
      </div>)}
    </>}
  </section>;
}

/**
 * Builder inspector — pick what to build, then open the workspace.
 *
 * The type list is Builder's modality registry, so Canvas offers every supported
 * project type and each one seeds its own starter template.
 * Type is fixed once the workspace exists (a project's modality
 * is set at creation, not switched mid-session).
 */
function BuildInspectorSection({ node, editable, creating, persistence, onChange, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace }: {
  node: CreationFlowNode;
  editable: boolean;
  creating: boolean;
  persistence: 'local' | 'server';
  onChange: (patch: Partial<CreationNodeData>) => void;
  onOpenBuild: () => void;
  onAttachBuild: (ide: IdeProject) => void;
  onDeleteBuildWorkspace: () => void;
}) {
  const t = useTranslations('creationCanvas.build');
  const modalities = useLocalizedModalities();
  const active = useModalityCopy()(typeof node.data.modality === 'string' ? node.data.modality : null);
  const binding = canvasBuildBinding(node.data);
  // Existing workspaces, so a Builder object can adopt work already under way
  // instead of only ever provisioning a second one. Only fetched while unbound.
  const [existing, setExisting] = useState<IdeProject[]>([]);
  useEffect(() => {
    if (binding || persistence !== 'server') { setExisting([]); return; }
    let alive = true;
    void listIdeProjects().then((projects) => { if (alive) setExisting(projects); }).catch(() => { if (alive) setExisting([]); });
    return () => { alive = false; };
  }, [binding, persistence]);
  return <section data-inspector-section="build">
    <label>{t('typeLabel')}
      <select
        value={active.id}
        disabled={!editable || !!binding || creating}
        onChange={(event) => onChange({ modality: event.target.value as ProjectModality })}
      >
        {modalities.map((modality) => <option key={modality.id} value={modality.id} disabled={!!modality.comingSoon}>{modality.label}</option>)}
      </select>
    </label>
    <p className={styles.inspectorHint}>{binding ? t('typeLockedHint') : active.tagline}</p>
    <button type="button" className={styles.fullButton} disabled={!editable || creating} onClick={onOpenBuild}>
      {creating ? t('creating') : binding ? t('openBuilder') : t('createWorkspace')}
    </button>
    {!binding && existing.length > 0 && <label>{t('attachLabel')}
      <select
        value=""
        disabled={!editable || creating}
        onChange={(event) => { const chosen = existing.find((project) => String(project.id) === event.target.value); if (chosen) onAttachBuild(chosen); }}
      >
        <option value="">{t('attachPlaceholder')}</option>
        {existing.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>}
    <p className={styles.inspectorHint}>{binding ? t('boundHint') : t('unboundHint')}</p>
    {binding && <>
      <button type="button" className={styles.secondaryFullButton} disabled={!editable} onClick={onDeleteBuildWorkspace}>{t('deleteWorkspace')}</button>
      <p className={styles.inspectorHint}>{t('deleteWorkspaceHint')}</p>
    </>}
  </section>;
}

function CanvasVoiceInspector({ node, persistence, onChange }: { node: CreationFlowNode; persistence: 'local' | 'server'; onChange: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas');
  const storageProjectId = useMemo(() => canvasProjectId(node.data), [node.data]);
  const voice = useVoiceStudio({ enabled: persistence === 'server', storageProjectId });
  const loadedNode = useRef<string | null>(null);
  const savedResult = useRef<unknown>(null);

  useEffect(() => {
    if (loadedNode.current === node.id) return;
    loadedNode.current = node.id;
    voice.setText(typeof node.data.voiceScript === 'string' && node.data.voiceScript.trim() ? node.data.voiceScript : '');
  }, [node.data.voiceScript, node.id, voice.setText]);

  useEffect(() => {
    const savedCloneId = Number(node.data.voiceCloneId);
    if (Number.isInteger(savedCloneId) && savedCloneId > 0 && voice.clones.some((clone) => clone.id === savedCloneId) && voice.selectedCloneId !== savedCloneId) {
      voice.setSelectedCloneId(savedCloneId);
    }
  }, [node.data.voiceCloneId, voice.clones, voice.selectedCloneId, voice.setSelectedCloneId]);

  useEffect(() => {
    if (!voice.result || savedResult.current === voice.result) return;
    savedResult.current = voice.result;
    onChange({
      voiceScript: voice.text,
      voiceTranscript: voice.text,
      voiceCloneId: voice.selectedCloneId,
      voiceDurationMs: voice.result.durationMs,
      voiceEngine: voice.result.engineId,
      voiceAudioResource: voice.result.audioUrl ?? null,
      voiceWordTimestamps: voice.result.wordTimestamps,
      status: 'Generated',
      subtitle: voice.text,
    });
  }, [onChange, voice.result, voice.selectedCloneId, voice.text]);

  const dictate = () => {
    const browserWindow = window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) { onChange({ status: 'Voice dictation is not supported by this browser' }); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      voice.setText(transcript);
      onChange({ voiceScript: transcript, voiceTranscript: transcript, subtitle: transcript, status: 'Transcribed' });
    };
    recognition.onerror = () => onChange({ status: t('voiceTranscriptionFailed') });
    recognition.onend = null;
    recognition.start();
  };

  if (persistence === 'local') return <p className={styles.inspectorHint}>{t('voiceLocalHint')}</p>;
  return <div className={styles.canvasVoiceStudio}>
    <button type="button" className={styles.fullButton} onClick={dictate}>{t('dictateScript')}</button>
    <VoiceConfigPanel voice={voice} />
    <button type="button" className={styles.fullButton} disabled={voice.busy || !voice.selectedCloneId || !voice.text.trim()} onClick={() => { onChange({ voiceScript: voice.text, voiceTranscript: voice.text, status: t('generatingVoiceStatus') }); void voice.synth(); }}>{voice.busy ? t('generating') : t('generateVoice')}</button>
    <div className={styles.canvasVoiceOutput}><VoiceOutput result={voice.result} audioUrl={voice.audioUrl} busy={voice.busy} unavailable={voice.unavailable} /></div>
  </div>;
}

function EvermindInspector({ node, persistence, onAttach, onExpand, onTrain }: { node: CreationFlowNode; persistence: 'local' | 'server'; onAttach: () => void; onExpand: () => void; onTrain: () => void }) {
  const t = useTranslations('creationCanvas');
  const rawProjectId = node.data.resourceId?.startsWith('evermind:') ? node.data.resourceId.slice('evermind:'.length) : '';
  const projectId = /^\d+$/.test(rawProjectId) ? Number(rawProjectId) : null;
  return <>
    <div className={styles.evermindStartGuide}><span>{node.data.pipelineExpanded === true ? t('guidedSetupAdded') : t('newModel')}</span><strong>{node.data.pipelineExpanded === true ? t('continueFromStep1') : t('startWithExamples')}</strong><p>{node.data.pipelineExpanded === true ? t('guidedSetupAddedHint') : t('guidedSetupHint')}</p></div>
    <button className={styles.fullButton} onClick={onExpand}>{node.data.pipelineExpanded === true ? t('goToStep1') : t('startGuidedSetup')}</button>
    <button className={styles.fullButton} onClick={onTrain}>{t('trainLoraAdapter')}</button>
    {persistence === 'local' && <p className={styles.inspectorHint}>{t('blueprintNoAccountHint')}</p>}
    {persistence === 'server' && projectId == null && <button className={styles.fullButton} onClick={onAttach}>{t('useProjectOnCanvas')}</button>}
    {persistence === 'server' && projectId != null && <div className={styles.evermindConsoleHost}><EvermindValidationProvider><ProjectEvermindPanel projectId={projectId} /></EvermindValidationProvider></div>}
  </>;
}

function ActivityInspector({ sessionId, objectId, data, persistence, role, members }: { sessionId: string; objectId: string; data: CreationNodeData; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; members: Array<{ userId: string; displayName: string | null; role: string }> }) {
  const t = useTranslations('creationCanvas');
  const [comments, setComments] = useState<CreationSessionComment[]>([]);
  const [activity, setActivity] = useState<CreationSessionActivity[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(persistence === 'local' ? 'Save this session to collaborate.' : t('noticeLoadingActivity'));
  const resumeFamily = data.kind === 'resume' ? resumeFamilyFromNode(data) : null;
  const resumeRevision = resumeFamily ? activeResumeRevision(resumeFamily) : null;
  const [resumeSection, setResumeSection] = useState('basics');
  const [resumeField, setResumeField] = useState('summary');
  const canComment = role !== 'viewer';

  const reload = useCallback(async () => {
    if (persistence !== 'server') return;
    try {
      const [commentResult, activityResult] = await Promise.all([
        creationSessionsApi.comments.list(sessionId, objectId),
        creationSessionsApi.activity(sessionId, 50),
      ]);
      setComments(commentResult.comments);
      setActivity(activityResult.activity.filter((item) => !item.objectId || item.objectId === objectId));
      setStatus(commentResult.comments.length || activityResult.activity.length ? '' : t('noticeNoActivityYet'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('noticeLoadActivityFailed'));
    }
  }, [objectId, persistence, sessionId]);

  useEffect(() => { void reload(); }, [reload]);

  const submit = () => {
    const body = draft.trim();
    if (!body || persistence !== 'server' || !canComment) return;
    const normalized = body.toLowerCase();
    const mentions = members.filter((member) => member.displayName && normalized.includes(`@${member.displayName.toLowerCase()}`)).map((member) => member.userId);
    setStatus('Posting comment…');
    const anchor: CreationSessionComment['anchor'] = resumeRevision ? { kind: 'resume-field', revisionId: resumeRevision.id, section: resumeSection, ...(resumeField ? { field: resumeField } : {}) } : null;
    void creationSessionsApi.comments.create(sessionId, { body, objectId, mentions, ...(anchor ? { anchor } : {}) }).then(() => {
      setDraft('');
      setStatus('Comment posted');
      void reload();
    }).catch((error) => setStatus(error instanceof Error ? error.message : t('noticePostCommentFailed')));
  };

  const resolve = (comment: CreationSessionComment) => {
    void creationSessionsApi.comments.resolve(sessionId, comment.id, !comment.resolvedAt).then(() => void reload())
      .catch((error) => setStatus(error instanceof Error ? error.message : t('commentUpdateFailed')));
  };

  if (persistence === 'local') return <div className={styles.activityEmpty}><strong>{t('collaborationStartsOnSave')}</strong><p>{t('collaborationStartsHint')}</p></div>;

  return <div className={styles.activityPanel}>
    <section className={styles.commentComposer}>
      {resumeRevision && <div className={styles.commentAnchorFields}>
        <label>{t('resumeCommentSection')}<select value={resumeSection} onChange={(event) => setResumeSection(event.target.value)}>{['basics', 'work', 'education', 'skills', 'volunteer', 'projects', 'awards', 'certificates', 'publications', 'languages', 'interests', 'references'].map((section) => <option key={section} value={section}>{t(`resumeCommentSection_${section}`)}</option>)}</select></label>
        <label>{t('resumeCommentField')}<input value={resumeField} onChange={(event) => setResumeField(event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64))} placeholder={t('resumeCommentFieldPlaceholder')} /></label>
      </div>}
      <label>{t('commentOnObject')}<textarea rows={3} value={draft} disabled={!canComment} onChange={(event) => setDraft(event.target.value)} placeholder={canComment ? t('commentPlaceholder') : t('viewOnlyAccess')} /></label>
      <button className={styles.fullButton} disabled={!canComment || !draft.trim()} onClick={submit}>{t('postComment')}</button>
    </section>
    {status && <p className={styles.inspectorHint}>{status}</p>}
    <section className={styles.commentList} aria-label={t('objectComments')}>
      {comments.map((comment) => <article key={comment.id} className={comment.resolvedAt ? styles.commentResolved : ''}>
        <header><b>{comment.authorName || t('collaborator')}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></header>
        <p>{comment.body}</p>
        {comment.anchor?.kind === 'resume-field' && <small className={styles.commentAnchor}>{t('resumeCommentAnchor', { section: t(`resumeCommentSection_${comment.anchor.section}`), field: comment.anchor.field || t('resumeCommentWholeSection') })}</small>}
        {canComment && <button onClick={() => resolve(comment)}>{comment.resolvedAt ? t('reopen') : t('resolve')}</button>}
      </article>)}
    </section>
    <section className={styles.activityList} aria-label={t('objectActivity')}>
      <h4>{t('recentActivity')}</h4>
      {activity.filter((item) => item.kind === 'event').map((item) => <div key={item.id}><span>•</span><p><b>{item.actorName || 'BuilderForce'}</b>{` ${item.type.replaceAll('.', ' ')}`}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
    </section>
  </div>;
}

export function CreationCanvas({ sessionId, persistence = 'server', initialFocusId, initialShareOpen, initialBuildOpen, initialBuildChatId, initialBuildTicket, initialPrompt, initialPresent, initialModelComparisonIds, stageActive = true }: { sessionId: string; persistence?: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialBuildOpen?: boolean; initialBuildChatId?: number | null; initialBuildTicket?: { kind: string; ref: string } | null; initialPrompt?: string | null; initialPresent?: boolean; initialModelComparisonIds?: readonly string[]; stageActive?: boolean }) {
  // The 3D scene publishes its view commands to the canvas rail rather than
  // carrying a toolbar of its own, so both live under one provider — and the app
  // surface publishes ITS controls into the session bar for the same reason, which
  // is what leaves this canvas with one bar instead of one per runtime.
  return <ReactFlowProvider><Canvas3DControlsProvider><CanvasSurfaceActionsProvider><CanvasInner sessionId={sessionId} persistence={persistence} initialFocusId={initialFocusId} initialShareOpen={initialShareOpen} initialBuildOpen={initialBuildOpen} initialBuildChatId={initialBuildChatId} initialBuildTicket={initialBuildTicket} initialPrompt={initialPrompt} initialPresent={initialPresent} initialModelComparisonIds={initialModelComparisonIds} stageActive={stageActive} /></CanvasSurfaceActionsProvider></Canvas3DControlsProvider></ReactFlowProvider>;
}
