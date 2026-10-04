import { type Dispatch, type SetStateAction, useCallback, useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import { parseResourceRef } from '@builderforce/creation-canvas-contract';
import { ceremonySessionsApi } from '@/lib/builderforceApi';
import { faultText } from '@/lib/apiClient';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { resolveStandupProject } from '@/lib/canvas/standupProject';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import type { CreationFlowNode } from '../CreationNode';
import type { useCanvasAccountGate } from './useCanvasAccountGate';

export interface UseCanvasStandupDeps {
  nodes: CreationFlowNode[];
  selectedNode: CreationFlowNode | null;
  persistence: 'local' | 'server';
  requireAccount: ReturnType<typeof useCanvasAccountGate>['requireAccount'];
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

/** The selected stand-up card's Start, and which project this board is about. */
export function useCanvasStandup({ nodes, selectedNode, persistence, requireAccount, setNodes, setEdges, setNotice, t }: UseCanvasStandupDeps) {
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
  }, [boardProjectId, nodes, persistence, requireAccount, scopeProjectId, selectedNode, setEdges, setNodes, setNotice, t]);

  return { boardProjectId, startStandup };
}
