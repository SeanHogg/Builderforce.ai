/** Résumé objects — tailor, detach, and manage share links. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import type { CreationNodeData } from '../types';
import { creationSessionsApi } from '@/lib/builderforceApi';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';

export interface UseCanvasResumeSharesDeps {
  persistence: 'local' | 'server';
  sessionId: string;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setScopeMode: Dispatch<SetStateAction<'auto' | 'canvas' | 'selection' | 'connected' | 'frame'>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  startCanvasTurnRef: RefObject<(text?: string) => void>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasResumeShares({ persistence, sessionId, setNodes, setNotice, setScopeMode, setSelectedId, setSelectedIds, startCanvasTurnRef, t }: UseCanvasResumeSharesDeps) {
  const tailorResumeFromNode = useCallback((nodeId: string, request: string) => {
    setSelectedId(nodeId);
    setSelectedIds([nodeId]);
    setScopeMode('selection');
    // Selection/scope are React state. Start the turn after that state commits so
    // the Recruiter receives the intended résumé, not the previous canvas scope.
    window.setTimeout(() => startCanvasTurnRef.current(`Target Canvas resume object ID: ${nodeId}\n\n${request}`), 0);
  }, [setScopeMode, setSelectedId, setSelectedIds, startCanvasTurnRef]);
  const detachResumeFromNode = useCallback((nodeId: string, detachedData: Partial<CreationNodeData>) => {
    const detachedId = crypto.randomUUID();
    setNodes((current) => {
      const source = current.find((node) => node.id === nodeId);
      if (!source) return current;
      return [...current, { ...source, id: detachedId, selected: true, position: { x: source.position.x + 64, y: source.position.y + 64 }, data: { ...source.data, ...detachedData } }];
    });
    setSelectedId(detachedId);
    setSelectedIds([detachedId]);
  }, [setNodes, setSelectedId, setSelectedIds]);
  const createResumeShare = useCallback(async (nodeId: string, kind: 'view' | 'embed') => {
    if (persistence !== 'server') throw new Error(t('resumeShareSaveFirst'));
    const share = await creationSessionsApi.resumeShares.create(sessionId, nodeId);
    const path = kind === 'embed' ? share.embedPath : share.viewPath;
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setNotice(t(kind === 'embed' ? 'resumeEmbedCopied' : 'resumeLinkCopied'));
  }, [persistence, sessionId, setNotice, t]);
  const listResumeShares = useCallback((nodeId: string) => persistence === 'server'
    ? creationSessionsApi.resumeShares.list(sessionId, nodeId).then((result) => result.shares)
    : Promise.resolve([]), [persistence, sessionId]);
  const revokeResumeShare = useCallback(async (nodeId: string, shareId: string) => {
    await creationSessionsApi.resumeShares.revoke(sessionId, nodeId, shareId);
    setNotice(t('resumeShareRevoked'));
  }, [sessionId, setNotice, t]);
  return { tailorResumeFromNode, detachResumeFromNode, createResumeShare, listResumeShares, revokeResumeShare };
}
