/**
 * Draw.io (mxGraph) reader and writer for the Creation Canvas.
 *
 * A `.drawio` file is an XML scene graph, not a picture — pointing an `<img>` at
 * one only ever renders a broken tile. This reads the scene into the shared
 * `DiagramGraph` the canvas draws itself, so a diagram an agent produced is
 * VISIBLE on the board with no external editor, no CDN script, and no network
 * round-trip.
 *
 * Only the parts a generated diagram actually uses are modelled: vertices with a
 * shape, a fill, a stroke and a label; edges with waypoints and an arrow head.
 * Anything unrecognised degrades to a labelled rectangle rather than vanishing.
 *
 * The WRITER is the other half: any notation the canvas can read becomes a
 * portable `.drawio` file, because draw.io is the format a person is most
 * likely to be asked for and the one every diagramming tool can open.
 */

import {
  DIAGRAM_DEFAULT_FONT_SIZE, MAX_DIAGRAM_CELLS, clipToBox, diagramGraph,
  type DiagramEdge, type DiagramGraph, type DiagramShape, type DiagramPoint, type DiagramVertex,
} from './diagramGraph';

const SAFE_COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|none)$/i;

function numeric(value: string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : undefined;
}

function safeImageUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml|avif);/i.test(trimmed) ? trimmed : undefined;
}

/** `rounded=1;fillColor=#dae8fc;ellipse` → a flat lookup, keyless tokens included. */
export function parseDrawioStyle(style: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const tokens = style.split(';');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const trimmed = token.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) entries[trimmed.toLowerCase()] = '1';
    else {
      const key = trimmed.slice(0, separator).trim().toLowerCase();
      let value = trimmed.slice(separator + 1).trim();
      // A data URL's media-type separator is also a semicolon. It belongs to
      // the image value, not to mxGraph's surrounding style list.
      if (key === 'image' && /^data:image\//i.test(value) && !value.includes(',') && tokens[index + 1]?.includes(',')) {
        value += `;${tokens[index + 1]!.trim()}`;
        index += 1;
      }
      entries[key] = value;
    }
  }
  return entries;
}

function shapeFromStyle(style: Record<string, string>): DiagramShape {
  const named = (style.shape ?? '').toLowerCase();
  if (style.ellipse === '1' || named === 'ellipse') return 'ellipse';
  if (style.rhombus === '1' || named === 'rhombus') return 'rhombus';
  if (style.triangle === '1' || named === 'triangle') return 'triangle';
  if (named === 'hexagon') return 'hexagon';
  if (named.startsWith('cylinder')) return 'cylinder';
  if (named === 'note') return 'note';
  if (style.text === '1' || named === 'text') return 'text';
  return style.rounded === '1' ? 'rounded' : 'rect';
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Draw.io labels carry inline HTML. Read them back as the text a person sees. */
export function drawioLabelText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (match, entity: string) => ENTITIES[entity.toLowerCase()] ?? (entity.startsWith('#') ? String.fromCharCode(Number(entity.slice(1))) : match))
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    .slice(0, 400);
}

type RawCell = { element: Element; label: string };

function collectCells(model: Element): RawCell[] {
  const cells: RawCell[] = [];
  for (const element of Array.from(model.getElementsByTagName('*'))) {
    if (element.tagName !== 'mxCell') continue;
    const wrapper = element.parentElement;
    const wrapped = wrapper && (wrapper.tagName === 'object' || wrapper.tagName === 'UserObject');
    const label = wrapped ? (wrapper.getAttribute('label') ?? '') : (element.getAttribute('value') ?? '');
    cells.push({ element, label: drawioLabelText(label) });
    if (cells.length >= MAX_DIAGRAM_CELLS) break;
  }
  return cells;
}

function cellId(cell: RawCell): string {
  const wrapper = cell.element.parentElement;
  const wrapped = wrapper && (wrapper.tagName === 'object' || wrapper.tagName === 'UserObject');
  return (wrapped ? wrapper.getAttribute('id') : null) ?? cell.element.getAttribute('id') ?? '';
}

function geometryOf(element: Element): Element | null {
  return Array.from(element.children).find((child) => child.tagName === 'mxGeometry') ?? null;
}

/**
 * Read a draw.io scene into geometry. Returns `null` when the payload is not a
 * parseable mxGraph model, so callers can fall back to showing the source.
 */
export function parseDrawioXml(xml: string): DiagramGraph | null {
  if (typeof DOMParser === 'undefined') return null;
  let document: Document;
  try {
    document = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  if (document.getElementsByTagName('parsererror').length) return null;
  const model = document.getElementsByTagName('mxGraphModel')[0] ?? document.getElementsByTagName('root')[0];
  if (!model) return null;

  const cells = collectCells(model);
  const parentById = new Map<string, string>();
  const vertexById = new Map<string, DiagramVertex>();
  const edgeCells: RawCell[] = [];
  const edgeLabels = new Map<string, string>();

  for (const cell of cells) {
    const id = cellId(cell);
    if (!id) continue;
    parentById.set(id, cell.element.getAttribute('parent') ?? '');
    if (cell.element.getAttribute('edge') === '1') edgeCells.push(cell);
  }

  for (const cell of cells) {
    if (cell.element.getAttribute('vertex') !== '1') continue;
    const id = cellId(cell);
    const parent = parentById.get(id) ?? '';
    const geometry = geometryOf(cell.element);
    if (!geometry) continue;
    // A vertex parented to an edge is that edge's floating label, not a shape.
    if (edgeCells.some((edge) => cellId(edge) === parent)) {
      if (cell.label) edgeLabels.set(parent, cell.label);
      continue;
    }
    const style = parseDrawioStyle(cell.element.getAttribute('style') ?? '');
    const container = vertexById.get(parent);
    const width = numeric(geometry.getAttribute('width'), 120);
    const height = numeric(geometry.getAttribute('height'), 60);
    vertexById.set(id, {
      id,
      label: cell.label,
      x: numeric(geometry.getAttribute('x')) + (container?.x ?? 0),
      y: numeric(geometry.getAttribute('y')) + (container?.y ?? 0),
      width: Math.max(width, 1),
      height: Math.max(height, 1),
      shape: shapeFromStyle(style),
      ...(safeColor(style.fillcolor) ? { fill: safeColor(style.fillcolor) } : {}),
      ...(safeColor(style.strokecolor) ? { stroke: safeColor(style.strokecolor) } : {}),
      ...(safeColor(style.fontcolor) ? { fontColor: safeColor(style.fontcolor) } : {}),
      fontSize: Math.min(Math.max(numeric(style.fontsize, DIAGRAM_DEFAULT_FONT_SIZE), 6), 48),
      dashed: style.dashed === '1',
      ...(safeImageUrl(style.image) ? { imageUrl: safeImageUrl(style.image) } : {}),
    });
  }

  const edges: DiagramEdge[] = [];
  for (const cell of edgeCells) {
    const id = cellId(cell);
    const style = parseDrawioStyle(cell.element.getAttribute('style') ?? '');
    const geometry = geometryOf(cell.element);
    const waypoints = geometry
      ? Array.from(geometry.children).filter((child) => child.tagName === 'Array' && child.getAttribute('as') === 'points')
        .flatMap((array) => Array.from(array.children).filter((point) => point.tagName === 'mxPoint'))
        .map((point) => ({ x: numeric(point.getAttribute('x')), y: numeric(point.getAttribute('y')) }))
      : [];
    const fixedPoint = (as: string): DiagramPoint | null => {
      const point = geometry ? Array.from(geometry.children).find((child) => child.tagName === 'mxPoint' && child.getAttribute('as') === as) : null;
      return point ? { x: numeric(point.getAttribute('x')), y: numeric(point.getAttribute('y')) } : null;
    };
    const sourceId = cell.element.getAttribute('source') ?? '';
    const targetId = cell.element.getAttribute('target') ?? '';
    const source = vertexById.get(sourceId);
    const target = vertexById.get(targetId);
    const sourceCenter = source ? { x: source.x + source.width / 2, y: source.y + source.height / 2 } : fixedPoint('sourcePoint');
    const targetCenter = target ? { x: target.x + target.width / 2, y: target.y + target.height / 2 } : fixedPoint('targetPoint');
    if (!sourceCenter || !targetCenter) continue;
    const start = source ? clipToBox(sourceCenter, waypoints[0] ?? targetCenter, source) : sourceCenter;
    const end = target ? clipToBox(targetCenter, waypoints[waypoints.length - 1] ?? sourceCenter, target) : targetCenter;
    edges.push({
      id,
      label: cell.label || edgeLabels.get(id) || '',
      points: [start, ...waypoints, end],
      ...(safeColor(style.strokecolor) ? { stroke: safeColor(style.strokecolor) } : {}),
      dashed: style.dashed === '1',
      arrow: style.endarrow !== 'none',
      // Carried so a text notation can be written from this scene. Waypoints
      // alone cannot say "A --> B", and dropping the endpoints here is what
      // would silently lose every connector on the way out to Mermaid.
      ...(source ? { source: sourceId } : {}),
      ...(target ? { target: targetId } : {}),
    });
  }

  return diagramGraph([...vertexById.values()], edges);
}

const DIAGRAM_TAG = /<diagram\b[^>]*>([\s\S]*?)<\/diagram>/i;

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/\s+/g, ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Draw.io writes either plain XML or a deflate-compressed, URI-encoded payload
 * inside `<diagram>`. Both arrive here; the caller only ever sees mxGraph XML.
 */
export async function resolveDrawioXml(source: string): Promise<string | null> {
  const value = source.trim();
  if (!value) return null;
  if (/<mxGraphModel\b/i.test(value)) return value;
  const payload = DIAGRAM_TAG.exec(value)?.[1]?.trim();
  if (!payload) return null;
  if (/<mxGraphModel\b/i.test(payload)) return payload;
  const bytes = base64Bytes(payload);
  if (!bytes || typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const inflated = await new Response(stream).text();
    return decodeURIComponent(inflated);
  } catch {
    return null;
  }
}

/** The reader, taking either wrapper. One entry point so every caller handles
 * the compressed form without knowing it exists. */
export async function readDrawio(source: string): Promise<DiagramGraph | null> {
  const xml = await resolveDrawioXml(source);
  return xml ? parseDrawioXml(xml) : null;
}

/* ------------------------------------------------------------- writer --- */

function xmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** The mxGraph style tokens each shape is drawn with. Rect is the default
 * shape, so it contributes nothing but its fill. */
const STYLE_BY_SHAPE: Readonly<Record<DiagramShape, string>> = {
  rect: '',
  rounded: 'rounded=1;',
  ellipse: 'ellipse;',
  rhombus: 'rhombus;',
  triangle: 'triangle;',
  hexagon: 'shape=hexagon;',
  cylinder: 'shape=cylinder3;boundedLbl=1;',
  note: 'shape=note;',
  text: 'text;html=1;strokeColor=none;fillColor=none;',
};

function vertexStyle(vertex: DiagramVertex): string {
  const parts = [STYLE_BY_SHAPE[vertex.shape], 'whiteSpace=wrap;html=1;'];
  if (vertex.imageUrl) return `shape=image;imageAspect=0;aspect=fixed;image=${vertex.imageUrl};`;
  if (vertex.fill) parts.push(`fillColor=${vertex.fill};`);
  if (vertex.stroke) parts.push(`strokeColor=${vertex.stroke};`);
  if (vertex.fontColor) parts.push(`fontColor=${vertex.fontColor};`);
  if (vertex.fontSize !== DIAGRAM_DEFAULT_FONT_SIZE) parts.push(`fontSize=${vertex.fontSize};`);
  if (vertex.dashed) parts.push('dashed=1;');
  return parts.join('');
}

function edgeStyle(edge: DiagramEdge): string {
  const parts = ['edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;'];
  if (!edge.arrow) parts.push('endArrow=none;');
  if (edge.dashed) parts.push('dashed=1;');
  if (edge.stroke) parts.push(`strokeColor=${edge.stroke};`);
  return parts.join('');
}

/**
 * A portable `.drawio` file for any graph the canvas holds.
 *
 * Written UNCOMPRESSED on purpose: draw.io reads plain mxGraph XML happily, and
 * a plain file is one a person can read in a diff, an agent can edit as text,
 * and this module can re-read without a decompression step that is not
 * available in every runtime.
 */
export function writeDrawio(graph: DiagramGraph, name = 'Page-1'): string {
  const cells = [
    ...graph.vertices.map((vertex) =>
      `<mxCell id="${xmlAttribute(vertex.id)}" value="${xmlAttribute(vertex.label.replaceAll('\n', '<br/>'))}" style="${xmlAttribute(vertexStyle(vertex))}" vertex="1" parent="1"><mxGeometry x="${Math.round(vertex.x)}" y="${Math.round(vertex.y)}" width="${Math.round(vertex.width)}" height="${Math.round(vertex.height)}" as="geometry" /></mxCell>`),
    ...graph.edges.map((edge) => {
      const endpoints = `${edge.source ? ` source="${xmlAttribute(edge.source)}"` : ''}${edge.target ? ` target="${xmlAttribute(edge.target)}"` : ''}`;
      // An edge with no endpoints still has to land somewhere, so its first and
      // last waypoints are written as fixed points rather than dropped.
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];
      const fixed = !edge.source && first ? `<mxPoint x="${Math.round(first.x)}" y="${Math.round(first.y)}" as="sourcePoint" />` : '';
      const fixedEnd = !edge.target && last ? `<mxPoint x="${Math.round(last.x)}" y="${Math.round(last.y)}" as="targetPoint" />` : '';
      return `<mxCell id="${xmlAttribute(edge.id)}" value="${xmlAttribute(edge.label)}" style="${xmlAttribute(edgeStyle(edge))}" edge="1" parent="1"${endpoints}><mxGeometry relative="1" as="geometry">${fixed}${fixedEnd}</mxGeometry></mxCell>`;
    }),
  ].join('');
  return `<mxfile host="Builderforce" agent="Builderforce Creation Canvas"><diagram id="builderforce-diagram" name="${xmlAttribute(name)}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" />${cells}</root></mxGraphModel></diagram></mxfile>`;
}
