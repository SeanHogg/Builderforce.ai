/** What the Brain is looking at — the selection, the resolved scope and the objects in it. */
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import type { CanvasJournal } from '@/lib/canvasActionJournal';

export interface UseCanvasScopeDeps {
  edges: Edge[];
  journal: RefObject<CanvasJournal>;
  nodes: CanvasObject[];
  scopeMode: 'auto' | 'canvas' | 'selection' | 'connected' | 'frame';
  selectedId: string | null;
  selectedIds: string[];
  selectedNode: CanvasObject | null;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasScope({ edges, journal, nodes, scopeMode, selectedId, selectedIds, selectedNode, t }: UseCanvasScopeDeps) {
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
  return { scopedNodes, scopedNodeIds, effectiveSelectedIds, resolvedScopeMode, scopeLabel };
}
