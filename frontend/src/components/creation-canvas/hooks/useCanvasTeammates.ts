/** Seating a teammate on the board — dropped from the roster or announced by the team surface. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from 'react';
import type { TeammatePayload } from '@/lib/team/teammate';
import type { CreationNodeData, CreationObjectKind } from '../types';
import { canvasObjectTwin } from '@/domains/canvas/domain/canvasBoard';
import { TITLE_IS_CONTENT_KINDS } from '../creationObjectAuthorship';
import { newNode } from '../canvasNodeHelpers';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CreationFlowNode } from '../CreationNode';

export interface UseCanvasTeammatesDeps {
  addAtCenter: (kind: CreationObjectKind, data?: Partial<CreationNodeData>, size?: { width: number; height: number; }) => void;
  canEdit: boolean;
  nodesRef: RefObject<CanvasObject[]>;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  revealObjectRef: RefObject<(objectId: string) => void>;
  sessionId: string;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasTeammates({ addAtCenter, canEdit, nodesRef, placeAppendedRef, revealObjectRef, sessionId, setNodes, setNotice, setPrompt, setSelectedId, setSelectedIds, t }: UseCanvasTeammatesDeps) {
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
  }, [addAtCenter, canEdit, nodesRef, placeAppendedRef, revealObjectRef, setNodes, setNotice, setPrompt, setSelectedId, setSelectedIds, t]);
  return { seatTeammate };
}
