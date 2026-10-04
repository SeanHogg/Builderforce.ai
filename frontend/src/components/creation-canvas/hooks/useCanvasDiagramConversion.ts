/** Converting a board object into a diagram in a chosen notation. */
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { convertGraphSource, diagramConvertSource, diagramConvertTargets } from '@/lib/canvasDiagramConvert';
import { canvasDiagram } from '@/lib/canvasDocuments';
import { appendImageToDrawioCanvas, createDrawioImageCanvas } from '@/lib/drawioImageCanvas';
import { newNode } from '../canvasNodeHelpers';
import { safeDownloadName } from '../canvasArtifactExport';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';

export interface UseCanvasDiagramConversionDeps {
  canEdit: boolean;
  nodes: CanvasObject[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasDiagramConversion({ canEdit, nodes, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t }: UseCanvasDiagramConversionDeps) {
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
  }, [canEdit, nodes, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t]);
  return { convertObjectToDiagram };
}
