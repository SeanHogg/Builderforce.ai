/** Branching a board and reviewing the merge back into its parent. */
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { canvasNavigate } from '@/lib/canvasHost';
import { faultText } from '@/lib/apiClient';
import { flowFromSession } from '../canvasBoardLoad';
import type { MergeItem, MergeReview } from '../canvasBoardTypes';
import { persistedGraphFromBoard } from '@/domains/canvas/domain/canvasBoard';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';

export interface UseCanvasBranchingDeps {
  branchParentId: string | null;
  edges: Edge[];
  mergeReview: MergeReview | null;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  requireAccount: (action: string, title: string, description: string) => void;
  sessionId: string;
  setMergeReview: Dispatch<SetStateAction<MergeReview | null>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  title: string;
}

export function useCanvasBranching({ branchParentId, edges, mergeReview, nodes, persistence, requireAccount, sessionId, setMergeReview, setNotice, t, title }: UseCanvasBranchingDeps) {
  const createBranch = useCallback(() => {
    if (persistence !== 'server') { requireAccount('branch', 'Create an account to branch this canvas', 'Branches need durable version history so you can compare and merge safely without losing your local work.'); return; }
    setNotice(t('noticeCreatingBranch'));
    void creationSessionsApi.branch(sessionId, `${title} — branch`).then(async ({ session }) => {
      canvasNavigate(`/create/${session.id}`);
    }).catch((error) => setNotice(faultText(error, t('noticeCreateBranchFailed'))));
  }, [persistence, requireAccount, sessionId, setNotice, t, title]);

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
  }, [branchParentId, nodes, persistence, setMergeReview, setNotice, t]);

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
  }, [edges, mergeReview, setNotice, t]);
  return { createBranch, prepareMerge, applyMerge };
}
