/** Canvas diagnostics and outcome metrics. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { buildCreationCanvasDiagnosticsReport } from '@/lib/creationCanvasDiagnostics';
import { safeTraceJson } from '../canvasArtifactExport';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { type CreationOutcomeMetrics, type CreationSessionInvitation, creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { buildProofJourneyDiagnosticsReport } from '@/lib/proofJourneyDiagnostics';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { faultMessage } from '@/lib/apiClient';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { BrainAction, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { ChatModelSelection } from '@/components/ChatInput';
import type { CanvasAiCompletion } from '@/lib/creationCanvasAi';
import type { CanvasJournal } from '@/lib/canvasActionJournal';
import type { ToastApi } from '@/components/ToastProvider';
import type { useTranslations } from 'next-intl';

export interface UseCanvasDiagnosticsDeps {
  allMembers: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  autoApplyRef: RefObject<boolean>;
  brainRunStartedAt: number | null;
  brainRuntime: RefObject<{ completions: CanvasAiCompletion[]; disabledModels: string[]; }>;
  brainTrace: BrainTraceEvent[];
  canvasActions: BrainAction<unknown, unknown>[];
  currentGraph: RefObject<string>;
  edges: Edge[];
  effectiveSelectedIds: string[];
  journal: RefObject<CanvasJournal>;
  lastSavedGraph: RefObject<string>;
  memoryEnabled: boolean;
  modelSelection: ChatModelSelection;
  nodes: CanvasObject[];
  pendingInvitations: CreationSessionInvitation[];
  persistence: 'local' | 'server';
  proposedChanges: ProposedCanvasChange[];
  realtimeState: 'local' | 'connecting' | 'online' | 'reconnecting' | 'offline';
  resolvedScopeMode: 'frame' | 'selection' | 'canvas' | 'connected';
  revision: RefObject<number>;
  saveInFlight: RefObject<boolean>;
  scopedNodeIds: Set<string>;
  scopedNodes: CanvasObject[];
  sessionId: string;
  sessionMode: 'chat' | 'work';
  sessionRole: 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';
  setDiagnosticsOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setOutcomeMetrics: Dispatch<SetStateAction<CreationOutcomeMetrics | null>>;
  setOutcomeMetricsError: Dispatch<SetStateAction<string | null>>;
  setOutcomeMetricsLoading: Dispatch<SetStateAction<boolean>>;
  setOutcomeMetricsOpen: Dispatch<SetStateAction<boolean>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
  title: string;
  toast: ToastApi;
  undoStack: RefObject<string[]>;
}

export function useCanvasDiagnostics({ allMembers, autoApplyRef, brainRunStartedAt, brainRuntime, brainTrace, canvasActions, currentGraph, edges, effectiveSelectedIds, journal, lastSavedGraph, memoryEnabled, modelSelection, nodes, pendingInvitations, persistence, proposedChanges, realtimeState, resolvedScopeMode, revision, saveInFlight, scopedNodeIds, scopedNodes, sessionId, sessionMode, sessionRole, setDiagnosticsOpen, setHistoryOpen, setOutcomeMetrics, setOutcomeMetricsError, setOutcomeMetricsLoading, setOutcomeMetricsOpen, t, thinking, timeline, title, toast, undoStack }: UseCanvasDiagnosticsDeps) {
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
  return { openOutcomeMetrics, openDiagnostics, buildDiagnostics, buildProofJourneyDiagnostics };
}
