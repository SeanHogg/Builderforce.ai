/**
 * Excalidraw reader and writer.
 *
 * Excalidraw is where a diagram STARTS — it is the whiteboard people actually
 * sketch a system on, and its `.excalidraw` file is plain JSON with real
 * geometry and real bindings, so a sketch is not a picture of a diagram, it IS
 * one. Reading it is the shortest path from "we drew this in a workshop" to
 * "this is on the board with the work it describes"; writing it back is how
 * that work returns to a whiteboard when it needs to be argued about again.
 *
 * ── THE `.json` TRAP ─────────────────────────────────────────────────────────
 * Excalidraw exports as `.excalidraw` AND, commonly, as `.excalidraw.json` or a
 * bare `.json`. A `.json` file was read as a data export, so a sketch saved
 * that way became a Dataset with one row whose cells were JSON fragments —
 * queryable in principle, renderable by nothing. That is the same defect the
 * JSON-résumé path documents, so the importer checks THIS first: a JSON file
 * that declares `type: "excalidraw"` is a drawing, whatever it is named.
 */

import {
  MAX_DIAGRAM_CELLS, diagramGraph,
  type DiagramEdge, type DiagramGraph, type DiagramShape, type DiagramVertex,
} from './diagramGraph';

const SHAPE_BY_TYPE: Readonly<Record<string, DiagramShape>> = {
  rectangle: 'rect', diamond: 'rhombus', ellipse: 'ellipse', image: 'rect', frame: 'rect', embeddable: 'rect',
};

const TYPE_BY_SHAPE: Readonly<Record<DiagramShape, string>> = {
  rect: 'rectangle', rounded: 'rectangle', ellipse: 'ellipse', rhombus: 'diamond',
  // Excalidraw's shape vocabulary is exactly three closed shapes. A hexagon, a
  // wedge, a cylinder and a note all become the rectangle they are closest to,
  // rather than being dropped for want of an exact match.
  triangle: 'diamond', hexagon: 'rectangle', cylinder: 'ellipse', note: 'rectangle', text: 'text',
};

interface ExcalidrawElement {
  id?: unknown; type?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown;
  text?: unknown; containerId?: unknown; label?: unknown; points?: unknown; isDeleted?: unknown;
  strokeColor?: unknown; backgroundColor?: unknown; strokeStyle?: unknown; fontSize?: unknown;
  startBinding?: unknown; endBinding?: unknown; endArrowhead?: unknown; boundElements?: unknown;
}

const SAFE_COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const colorOf = (value: unknown): string | undefined => typeof value === 'string' && SAFE_COLOR.test(value.trim()) ? value.trim().toLowerCase() : undefined;
const numberOf = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const stringOf = (value: unknown): string => typeof value === 'string' ? value : '';

/** The parsed scene, or `null` for JSON that is not an Excalidraw file. */
export function parseExcalidraw(source: string): ExcalidrawElement[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(source.replace(/^﻿/, '')) as unknown; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const scene = parsed as { type?: unknown; elements?: unknown };
  const declared = typeof scene.type === 'string' && /^excalidraw/i.test(scene.type);
  if (!declared || !Array.isArray(scene.elements)) return null;
  return scene.elements as ExcalidrawElement[];
}

export function isExcalidrawSource(source: string): boolean {
  return /"type"\s*:\s*"excalidraw/i.test(source.slice(0, 4_000)) && parseExcalidraw(source) !== null;
}

const bindingId = (value: unknown): string | undefined => {
  const id = (value as { elementId?: unknown } | null)?.elementId;
  return typeof id === 'string' && id ? id : undefined;
};

export function readExcalidraw(source: string): DiagramGraph | null {
  const elements = parseExcalidraw(source);
  if (!elements) return null;

  const live = elements.filter((element) => element.isDeleted !== true).slice(0, MAX_DIAGRAM_CELLS * 2);
  // A bound text element is the LABEL of its container, not a shape of its own.
  const labelByContainer = new Map<string, string>();
  for (const element of live) {
    const container = stringOf(element.containerId);
    if (element.type === 'text' && container) {
      const text = stringOf(element.text);
      if (text) labelByContainer.set(container, labelByContainer.has(container) ? `${labelByContainer.get(container)}\n${text}` : text);
    }
  }

  const vertices: DiagramVertex[] = [];
  const edges: DiagramEdge[] = [];
  for (const element of live) {
    const type = stringOf(element.type);
    const id = stringOf(element.id) || `element-${vertices.length + edges.length + 1}`;
    const x = numberOf(element.x);
    const y = numberOf(element.y);

    if (type === 'arrow' || type === 'line') {
      const raw = Array.isArray(element.points) ? element.points : [];
      const points = raw
        .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
        .map(([dx, dy]) => ({ x: x + numberOf(dx), y: y + numberOf(dy) }));
      if (points.length < 2) continue;
      const label = (element.label as { text?: unknown } | undefined)?.text;
      edges.push({
        id,
        label: stringOf(label),
        points,
        ...(colorOf(element.strokeColor) ? { stroke: colorOf(element.strokeColor)! } : {}),
        dashed: stringOf(element.strokeStyle) === 'dashed' || stringOf(element.strokeStyle) === 'dotted',
        arrow: type === 'arrow' && element.endArrowhead !== null,
        ...(bindingId(element.startBinding) ? { source: bindingId(element.startBinding)! } : {}),
        ...(bindingId(element.endBinding) ? { target: bindingId(element.endBinding)! } : {}),
      });
      continue;
    }

    if (type === 'text') {
      if (stringOf(element.containerId)) continue;
      const text = stringOf(element.text);
      if (!text) continue;
      vertices.push({
        id, label: text, x, y,
        width: Math.max(numberOf(element.width, text.length * 8), 24),
        height: Math.max(numberOf(element.height, 20), 12),
        shape: 'text',
        ...(colorOf(element.strokeColor) ? { fontColor: colorOf(element.strokeColor)! } : {}),
        fontSize: Math.min(Math.max(numberOf(element.fontSize, 16), 6), 48),
        dashed: false,
      });
      continue;
    }

    const shape = SHAPE_BY_TYPE[type];
    if (!shape) continue;
    const background = colorOf(element.backgroundColor);
    vertices.push({
      id,
      label: labelByContainer.get(id) ?? '',
      x, y,
      width: Math.max(numberOf(element.width, 120), 1),
      height: Math.max(numberOf(element.height, 60), 1),
      shape,
      ...(background && background !== 'transparent' ? { fill: background } : {}),
      ...(colorOf(element.strokeColor) ? { stroke: colorOf(element.strokeColor)! } : {}),
      fontSize: Math.min(Math.max(numberOf(element.fontSize, 16), 6), 48),
      dashed: stringOf(element.strokeStyle) === 'dashed' || stringOf(element.strokeStyle) === 'dotted',
    });
  }

  return diagramGraph(vertices, edges);
}

/* ------------------------------------------------------------- writer --- */

/**
 * A deterministic stand-in for the random `seed`/`versionNonce` every
 * Excalidraw element carries.
 *
 * Excalidraw uses those to make its hand-drawn strokes look hand-drawn and to
 * order concurrent edits. Using a random number here would make the same
 * diagram export to a different file every time, so it is derived from the
 * element's own id — stable across exports, still different per element.
 */
function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 2_000_000_000;
}

function baseElement(id: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seedFrom(id),
    version: 1,
    versionNonce: seedFrom(`${id}:nonce`),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

export function writeExcalidraw(graph: DiagramGraph): string {
  const elements: Array<Record<string, unknown>> = [];

  for (const vertex of graph.vertices) {
    if (vertex.shape === 'text') {
      elements.push(baseElement(vertex.id, {
        type: 'text', x: vertex.x, y: vertex.y, width: vertex.width, height: vertex.height,
        ...(vertex.fontColor ? { strokeColor: vertex.fontColor } : {}),
        fontSize: vertex.fontSize, fontFamily: 1, text: vertex.label, textAlign: 'left', verticalAlign: 'top',
        containerId: null, originalText: vertex.label, lineHeight: 1.25, autoResize: true,
      }));
      continue;
    }
    const labelId = vertex.label ? `${vertex.id}-label` : null;
    elements.push(baseElement(vertex.id, {
      type: TYPE_BY_SHAPE[vertex.shape], x: vertex.x, y: vertex.y, width: vertex.width, height: vertex.height,
      ...(vertex.fill ? { backgroundColor: vertex.fill } : {}),
      ...(vertex.stroke ? { strokeColor: vertex.stroke } : {}),
      ...(vertex.shape === 'rounded' ? { roundness: { type: 3 } } : {}),
      ...(vertex.dashed ? { strokeStyle: 'dashed' } : {}),
      ...(labelId ? { boundElements: [{ id: labelId, type: 'text' }] } : {}),
    }));
    if (!labelId) continue;
    // A label is its own element bound to the container — Excalidraw has no
    // "text on a shape" property, and a shape written without this arrives
    // blank however carefully its geometry was preserved.
    elements.push(baseElement(labelId, {
      type: 'text', x: vertex.x + 8, y: vertex.y + vertex.height / 2 - 10,
      width: Math.max(vertex.width - 16, 10), height: 20,
      fontSize: vertex.fontSize + 4, fontFamily: 1, text: vertex.label, textAlign: 'center', verticalAlign: 'middle',
      containerId: vertex.id, originalText: vertex.label, lineHeight: 1.25,
    }));
  }

  for (const edge of graph.edges) {
    const points = edge.points.length >= 2 ? edge.points : null;
    if (!points) continue;
    const origin = points[0]!;
    const box = points.reduce((acc, point) => ({
      width: Math.max(acc.width, Math.abs(point.x - origin.x)),
      height: Math.max(acc.height, Math.abs(point.y - origin.y)),
    }), { width: 0, height: 0 });
    elements.push(baseElement(edge.id, {
      type: 'arrow', x: origin.x, y: origin.y, width: box.width, height: box.height,
      ...(edge.stroke ? { strokeColor: edge.stroke } : {}),
      ...(edge.dashed ? { strokeStyle: 'dashed' } : {}),
      points: points.map((point) => [point.x - origin.x, point.y - origin.y]),
      lastCommittedPoint: null,
      startArrowhead: null,
      endArrowhead: edge.arrow ? 'arrow' : null,
      startBinding: edge.source ? { elementId: edge.source, focus: 0, gap: 4 } : null,
      endBinding: edge.target ? { elementId: edge.target, focus: 0, gap: 4 } : null,
      elbowed: false,
    }));
  }

  return `${JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://builderforce.ai',
    elements,
    appState: { gridSize: 20, viewBackgroundColor: '#ffffff' },
    files: {},
  }, null, 2)}\n`;
}
