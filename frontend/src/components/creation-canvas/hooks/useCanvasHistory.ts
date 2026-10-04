/** Board history — revisions, local checkpoints, restore and session export. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { localCheckpointSummaries, type LocalCheckpointSummary, readLocalCheckpoint, saveLocalCheckpoint } from '@/lib/creationCheckpoints';
import { creationSessionsApi, type CreationSnapshotSummary } from '@/lib/builderforceApi';
import { faultText } from '@/lib/apiClient';
import { flowFromSnapshotGraph } from '../canvasBoardLoad';
import { safeDownloadName } from '../canvasArtifactExport';
import { downloadJson } from '@/lib/download';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';

export interface UseCanvasHistoryDeps {
  canEdit: boolean;
  checkpointName: string;
  edges: Edge[];
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  sessionId: string;
  setCheckpointName: Dispatch<SetStateAction<string>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setHistory: Dispatch<SetStateAction<CreationSnapshotSummary[]>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setLocalCheckpoints: Dispatch<SetStateAction<LocalCheckpointSummary[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  timeline: CanvasTimelineMessage[];
  title: string;
  viewportRef: RefObject<{ x: number; y: number; zoom: number; }>;
}

export function useCanvasHistory({ canEdit, checkpointName, edges, flowRef, nodes, persistence, sessionId, setCheckpointName, setEdges, setHistory, setHistoryOpen, setLocalCheckpoints, setNodes, setNotice, t, timeline, title, viewportRef }: UseCanvasHistoryDeps) {
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
  return { exportSession, openHistory, createCheckpoint, restoreRevision, restoreLocalCheckpoint };
}
