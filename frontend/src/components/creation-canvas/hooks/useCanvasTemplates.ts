/** Applying template packs, frame presets and server templates to the board. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { expandTemplateWorkflows } from '../expandTemplateWorkflows';
import { newNode } from '../canvasNodeHelpers';
import { buildLlmCourse, isWorkedLlmCourse } from '@/lib/courseLms';
import { creationObjectMutableFields } from '../creationObjectRegistry';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import type { FramePreset } from '../canvasBoardTypes';
import { persistedGraphFromBoard } from '@/domains/canvas/domain/canvasBoard';
import { creationSessionsApi, type CreationTemplate as ServerCreationTemplate } from '@/lib/builderforceApi';
import { faultText } from '@/lib/apiClient';
import { flowFromSession } from '../canvasBoardLoad';
import type { useTranslations } from 'next-intl';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { CreationFlowNode } from '../CreationNode';

export interface UseCanvasTemplatesDeps {
  canEdit: boolean;
  canvasText: CanvasTextTranslator;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  locale: string;
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  revision: RefObject<number>;
  selectedNode: CanvasObject | null;
  sessionId: string;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setFramePresets: Dispatch<SetStateAction<FramePreset[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPersistedObjectIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setServerTemplates: Dispatch<SetStateAction<ServerCreationTemplate[]>>;
  setTemplateOpen: Dispatch<SetStateAction<boolean>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  templateText: (template: CreationTemplate, field: 'name' | 'description') => string;
}

export function useCanvasTemplates({ canEdit, canvasText, flowRef, locale, persistence, placeAppendedRef, revision, selectedNode, sessionId, setEdges, setFramePresets, setNodes, setNotice, setPersistedObjectIds, setSelectedId, setServerTemplates, setTemplateOpen, t, templateText }: UseCanvasTemplatesDeps) {
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
  return { applyTemplate, applyServerTemplate, addFramePreset, saveFramePreset };
}
