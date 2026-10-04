/** Placing new objects on the board — at the viewport centre, from the palette, or from a composer idea. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import type { CreationNodeData, CreationObjectKind } from '../types';
import { newNode } from '../canvasNodeHelpers';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { IDEA_KIND, ideaFromScratch } from '@/lib/ideaLog';
import { type PaletteChoice, parsePaletteChoice, stencilSeed, stencilSize } from '@/lib/canvasStencils';
import { isStepChoice, parseStepChoice } from '@/domains/workflow/domain/flowStepObject';
import { nodeKindLabel } from '@/domains/workflow/domain/stepCatalog';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import { addEdge, type Edge, type ReactFlowInstance } from '@xyflow/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { CreationFlowNode } from '../CreationNode';
import type { useTranslations } from 'next-intl';
import type { CreationObjectGroup } from '../creationObjectRegistry';

export interface UseCanvasObjectPlacementDeps {
  canEdit: boolean;
  cardsEditable: boolean;
  connectionKind: 'presentation' | 'data' | 'delivery' | 'control' | 'reference' | 'membership' | 'blocks' | 'verifies';
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  localizedTourDefaults: () => Partial<CreationNodeData>;
  nodes: CanvasObject[];
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  sessionId: string;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setObjectPicker: Dispatch<SetStateAction<{ anchor: { x: number; y: number; }; group?: CreationObjectGroup; fromNodeId?: string; } | null>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  tStep: ReturnType<typeof useTranslations<'evermindBuild'>>;
  timeline: CanvasTimelineMessage[];
}

export function useCanvasObjectPlacement({ canEdit, cardsEditable, connectionKind, flowRef, localizedTourDefaults, nodes, openNodeInspector, placeAppendedRef, sessionId, setEdges, setNodes, setNotice, setObjectPicker, setPrompt, setSelectedId, setSelectedIds, t, tStep, timeline }: UseCanvasObjectPlacementDeps) {
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
  return { addAtCenter, choiceSeed, captureIdeaFromComposer, pickObject, appendAtCenter };
}
