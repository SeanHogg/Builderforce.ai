/**
 * "Turn this into a diagram" — the one use case, for every source and every
 * destination.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * There was one conversion, hard-wired end to end: an Image or a freehand
 * Drawing became a `.drawio` file with the picture EMBEDDED in it. That is the
 * right answer for a photograph of a whiteboard and the wrong answer for
 * everything else — an SVG exported from Lucidchart came out as a draw.io file
 * containing a picture of a diagram, with not one editable shape in it, and a
 * diagram already on the board could not be converted at all.
 *
 * A conversion now resolves its source to one of two things:
 *
 *  • a GRAPH — real shapes and real connections, which can be written to any
 *    notation that has a writer. This is what an SVG, a CAD drawing and a
 *    diagram in another notation all resolve to.
 *  • an ASSET — a bitmap, which can only ever be embedded. A photo has no
 *    shapes to find, and pretending otherwise would produce a diagram whose
 *    contents are invented.
 *
 * Keeping those apart is what lets the UI offer a person the destinations that
 * will actually work, instead of failing after the click.
 */

import { canvasDiagram } from './canvasDocuments';
import { canvasStrokes, strokesSvg } from './canvasDrawing';
import {
  DIAGRAM_TARGETS, conversionFromGraph, diagramNotation, readDiagramSource,
  type CanvasDiagramFormat, type DiagramConversion, type DiagramNotation,
} from './diagramNotations';
import { readSvgShapes } from './diagramSvg';
import type { DiagramGraph } from './diagramGraph';
import type { DrawioImageAsset } from './drawioImageCanvas';
import type { CreationNodeData } from '@/components/creation-canvas/types';

export type DiagramConvertSource =
  | { kind: 'graph'; graph: DiagramGraph; from: CanvasDiagramFormat | null }
  | { kind: 'asset'; asset: DrawioImageAsset };

const DEFAULT_DRAWING_WIDTH = 640;
const DEFAULT_DRAWING_HEIGHT = 420;

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The SVG text behind a `data:image/svg+xml` URL, in either of the two forms a
 * browser produces: percent-encoded, or base64. */
export function svgFromDataUrl(url: string): string | null {
  const match = /^data:image\/svg\+xml(;[^,]*)?,([\s\S]*)$/i.exec(url.trim());
  if (!match) return null;
  const payload = match[2]!;
  try {
    if (/;base64/i.test(match[1] ?? '')) return atob(payload);
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/**
 * The picture an object carries, ready to embed.
 *
 * A drawing has no stored image, so its strokes are drawn to SVG here — every
 * stroke, not just the first path, which is what a sketch converted to draw.io
 * used to arrive with.
 */
export function diagramImageAsset(data: CreationNodeData): DrawioImageAsset | null {
  const direct = [data.outputUrl, data.thumbnailUrl].find((value) => typeof value === 'string' && value.startsWith('data:image/'));
  if (typeof direct === 'string') {
    return {
      name: stringField(data.fileName) || data.title,
      dataUrl: direct,
      ...(typeof data.imageWidth === 'number' ? { width: data.imageWidth } : {}),
      ...(typeof data.imageHeight === 'number' ? { height: data.imageHeight } : {}),
    };
  }
  if (data.kind !== 'drawing') return null;
  const strokes = canvasStrokes(data);
  const width = typeof data.drawingWidth === 'number' ? data.drawingWidth : DEFAULT_DRAWING_WIDTH;
  const height = typeof data.drawingHeight === 'number' ? data.drawingHeight : DEFAULT_DRAWING_HEIGHT;
  const svg = strokesSvg(strokes, width, height);
  return svg ? { name: `${data.title}.svg`, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width, height } : null;
}

/**
 * What this object can be converted FROM.
 *
 * A freehand Drawing deliberately resolves to an ASSET even though its strokes
 * could be read as shapes: a pen stroke is a pen stroke, and turning a
 * hand-drawn line into a "connection between two shapes" invents structure the
 * person never drew. A CAD drawing and a vector image resolve to a GRAPH,
 * because there the shapes are real and were authored as shapes.
 */
export async function diagramConvertSource(data: CreationNodeData): Promise<DiagramConvertSource | null> {
  if (data.kind === 'diagram') {
    const diagram = canvasDiagram(data);
    const graph = diagram ? await readDiagramSource(diagram.format, diagram.source) : null;
    return graph && diagram ? { kind: 'graph', graph, from: diagram.format } : null;
  }

  if (data.kind !== 'drawing') {
    const vector = [data.outputUrl, data.thumbnailUrl]
      .map((value) => (typeof value === 'string' ? svgFromDataUrl(value) : null))
      .find((svg): svg is string => Boolean(svg));
    const graph = vector ? readSvgShapes(vector) : null;
    if (graph) return { kind: 'graph', graph, from: 'svg' };
  }

  const asset = diagramImageAsset(data);
  return asset ? { kind: 'asset', asset } : null;
}

/**
 * Notations this source can actually be written to.
 *
 * Taken from the registry, so a notation that gains a writer appears in the
 * picker with nothing else to change. An ASSET can only be embedded, and
 * draw.io is the only notation here that carries a picture; a graph can go
 * anywhere except back to the notation it is already in.
 */
export function diagramConvertTargets(source: DiagramConvertSource): DiagramNotation[] {
  if (source.kind === 'asset') return DIAGRAM_TARGETS.filter((notation) => notation.id === 'drawio');
  return DIAGRAM_TARGETS.filter((notation) => notation.id !== source.from);
}

/** Write a resolved graph source to the destination notation. */
export function convertGraphSource(source: DiagramConvertSource, to: CanvasDiagramFormat): DiagramConversion | null {
  const target = diagramNotation(to);
  if (source.kind !== 'graph' || !target?.write) return null;
  return conversionFromGraph(source.graph, target);
}
