/**
 * The diagram NOTATION REGISTRY — the one place a drawing format is declared.
 *
 * ── WHY A REGISTRY AND NOT A SWITCH ──────────────────────────────────────────
 * Before this, "draw.io" was spelled out in nine places: the importer's file
 * test, the object's stored format, the card's renderer, the inspector's format
 * picker, the convert action, the export extension, the export MIME type, the
 * MCP tool's description, and the notice a person read afterwards. Adding a
 * second notation meant finding all nine, and the two that were missed are why
 * a Mermaid diagram could be SELECTED in the inspector but exported with a
 * `.drawio` extension.
 *
 * A notation is now DATA: one row here declares how it is recognised, how it is
 * read into the shared graph, whether it can be written back, and what it is
 * called. Every consumer reads this table, so a tenth notation is a row — not a
 * tenth place to remember.
 *
 * ── READ, WRITE, AND WHY SOME ROWS HAVE NO WRITER ────────────────────────────
 * `read` is what makes a format IMPORTABLE. `write` is what makes it a
 * CONVERSION TARGET, and three formats deliberately lack one:
 *
 *  • Visio — a `.vsdx` is an OPC package that Visio refuses to open at all if
 *    any part is subtly wrong, and draw.io (which Visio imports) is the honest
 *    route back.
 *  • ArchiMate — writing one means choosing an element TYPE per box, which is
 *    the entire content of an ArchiMate model and is not something a rectangle
 *    carries.
 *  • SVG — `renderedSvg.ts` already writes the SVG the card actually drew, for
 *    every notation including Mermaid. A second writer here would be the same
 *    picture derived twice.
 *
 * Those three convert OUT to everything and are never offered as a destination,
 * which is what lets the UI be honest instead of failing after the click.
 */

import { readArchimate, isArchimateSource } from './diagramArchimate';
import { isBpmnSource, readBpmn, writeBpmn } from './diagramBpmn';
import { readDot, writeDot } from './diagramDot';
import { isExcalidrawSource, readExcalidraw, writeExcalidraw } from './diagramExcalidraw';
import { readMermaid, writeMermaid } from './diagramMermaid';
import { readPlantuml, writePlantuml } from './diagramPlantuml';
import { isSvgSource, readSvgShapes } from './diagramSvg';
import { readVsdx } from './diagramVsdx';
import { readDrawio, writeDrawio } from './drawioDiagram';
import { resolveEdgeEndpoints, type DiagramGraph } from './diagramGraph';

export type CanvasDiagramFormat =
  | 'drawio' | 'mermaid' | 'plantuml' | 'dot' | 'bpmn' | 'excalidraw' | 'archimate' | 'svg' | 'vsdx';

export interface CanvasDiagramSource {
  format: CanvasDiagramFormat;
  source: string;
}

export interface DiagramNotation {
  id: CanvasDiagramFormat;
  /**
   * The notation's own name, as its makers spell it.
   *
   * NOT translated, and deliberately: "Draw.io", "Mermaid", "BPMN 2.0" and
   * "Visio" are product and standard names, which the localization rule leaves
   * literal exactly as it leaves brand names and env values. It also removes a
   * duplicate — the five message catalogs each carried an identical
   * `diagramFormatDrawio: "Draw.io"`, five copies of a string no locale
   * changes, which is the shape a name drifts out of step in.
   */
  name: string;
  /** Lower-case, no leading dot. The FIRST is what a download is named. */
  extensions: readonly string[];
  mimeType: string;
  /** How the card draws it. `mermaid` renders through Mermaid's own renderer,
   * which is not ours to reimplement; everything else draws from the graph. */
  renderer: 'graph' | 'mermaid';
  /** Recognise the notation from a text payload alone. Absent for formats that
   * must be identified by extension — a binary container, or a shape (SVG)
   * whose presence in a field does not mean the object is a diagram. */
  detect?: (source: string) => boolean;
  /** Text → graph. Absent only for a binary container, which uses `readBytes`. */
  read?: (source: string) => Promise<DiagramGraph | null>;
  /** Binary container → graph. */
  readBytes?: (bytes: Uint8Array) => Promise<DiagramGraph | null>;
  /** Graph → text. Its presence is what makes this a conversion target and a
   * format a diagram object may be STORED in. */
  write?: (graph: DiagramGraph) => string;
  /** The notation can only express an edge between two NAMED shapes (`A --> B`)
   * — so an edge whose ends could not be resolved is dropped on the way out and
   * has to be reported. Geometry notations keep such an edge as loose points. */
  requiresEndpoints?: boolean;
}

/** `graph TD` / `flowchart LR`, or one of Mermaid's other diagram types. The
 * non-flowchart types have no graph reader, but they are still Mermaid: they
 * render, they export, and they are recognised HERE so a dropped
 * `sequenceDiagram` is a diagram and not an unknown text file. */
const MERMAID_MARKER = /^\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|requirementDiagram|C4Context|sankey-beta|block-beta|architecture-beta)\b/m;
const DRAWIO_MARKER = /<(?:mxfile|mxGraphModel)\b/;
const PLANTUML_MARKER = /@startuml\b/i;
const DOT_MARKER = /^\s*(?:strict\s+)?(?:di)?graph\s+(?:"[^"]*"|[\w.]+)?\s*\{/im;

export const DIAGRAM_NOTATIONS: readonly DiagramNotation[] = [
  {
    id: 'drawio',
    name: 'Draw.io',
    extensions: ['drawio', 'xml'],
    mimeType: 'application/vnd.jgraph.mxfile',
    renderer: 'graph',
    detect: (source) => DRAWIO_MARKER.test(source),
    read: readDrawio,
    write: writeDrawio,
  },
  {
    id: 'mermaid',
    name: 'Mermaid',
    extensions: ['mmd', 'mermaid'],
    mimeType: 'text/vnd.mermaid',
    renderer: 'mermaid',
    detect: (source) => MERMAID_MARKER.test(source),
    read: async (source) => readMermaid(source),
    write: writeMermaid,
    requiresEndpoints: true,
  },
  {
    id: 'plantuml',
    name: 'PlantUML',
    extensions: ['puml', 'plantuml', 'iuml', 'pu'],
    mimeType: 'text/vnd.plantuml',
    renderer: 'graph',
    detect: (source) => PLANTUML_MARKER.test(source),
    read: async (source) => readPlantuml(source),
    write: writePlantuml,
    requiresEndpoints: true,
  },
  {
    id: 'dot',
    name: 'Graphviz DOT',
    extensions: ['dot', 'gv'],
    mimeType: 'text/vnd.graphviz',
    renderer: 'graph',
    detect: (source) => DOT_MARKER.test(source),
    read: async (source) => readDot(source),
    write: writeDot,
    requiresEndpoints: true,
  },
  {
    id: 'bpmn',
    name: 'BPMN 2.0',
    extensions: ['bpmn', 'bpmn20.xml'],
    mimeType: 'application/bpmn+xml',
    renderer: 'graph',
    detect: isBpmnSource,
    read: async (source) => readBpmn(source),
    write: writeBpmn,
    requiresEndpoints: true,
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw',
    extensions: ['excalidraw'],
    mimeType: 'application/vnd.excalidraw+json',
    renderer: 'graph',
    detect: isExcalidrawSource,
    read: async (source) => readExcalidraw(source),
    write: writeExcalidraw,
  },
  {
    id: 'archimate',
    name: 'ArchiMate',
    extensions: ['archimate'],
    mimeType: 'application/vnd.archimatetool+xml',
    renderer: 'graph',
    detect: isArchimateSource,
    read: async (source) => readArchimate(source),
  },
  {
    id: 'svg',
    name: 'SVG',
    extensions: ['svg'],
    mimeType: 'image/svg+xml',
    renderer: 'graph',
    // No `detect`: an SVG in a field is a picture. It is read as a diagram only
    // when a person asks for that conversion, or drops a `.svg` explicitly.
    read: async (source) => (isSvgSource(source) ? readSvgShapes(source) : null),
  },
  {
    id: 'vsdx',
    name: 'Visio',
    extensions: ['vsdx', 'vsd', 'vdx'],
    mimeType: 'application/vnd.ms-visio.drawing',
    renderer: 'graph',
    readBytes: readVsdx,
  },
];

const BY_ID = new Map(DIAGRAM_NOTATIONS.map((notation) => [notation.id, notation] as const));

export function diagramNotation(id: string | null | undefined): DiagramNotation | null {
  return id ? BY_ID.get(id.trim().toLowerCase() as CanvasDiagramFormat) ?? null : null;
}

/** Notations a diagram can be CONVERTED TO — the ones with a writer. Ordered as
 * declared, so the picker is stable and draw.io leads. */
export const DIAGRAM_TARGETS: readonly DiagramNotation[] = DIAGRAM_NOTATIONS.filter((notation) => Boolean(notation.write));

export function isDiagramTarget(id: string | null | undefined): boolean {
  return Boolean(diagramNotation(id)?.write);
}

/** The notation a file name declares, if any. */
export function notationForFileName(fileName: string): DiagramNotation | null {
  const name = fileName.trim().toLowerCase();
  return DIAGRAM_NOTATIONS.find((notation) => notation.extensions.some((extension) => name.endsWith(`.${extension}`))) ?? null;
}

const FENCED_MERMAID = /```mermaid\s*\n([\s\S]*?)```/i;
const FENCED_ANY = /```(?:xml|drawio|dot|graphviz|plantuml|puml)?\s*\n([\s\S]*?)```/i;

/**
 * Recognise a diagram inside a text payload.
 *
 * Fenced blocks are unwrapped first, because a model asked for a diagram
 * returns one inside a code fence far more often than bare. `.svg` and `.vsdx`
 * are deliberately NOT sniffed here: an SVG string in a field is a picture, and
 * a binary container never reaches this function as text.
 */
export function detectDiagramSource(raw: string): CanvasDiagramSource | null {
  const value = raw.trim();
  if (!value) return null;
  const mermaidBlock = FENCED_MERMAID.exec(value)?.[1]?.trim();
  if (mermaidBlock) return { format: 'mermaid', source: mermaidBlock };
  const fenced = FENCED_ANY.exec(value)?.[1]?.trim();
  for (const candidate of [fenced, value]) {
    if (!candidate) continue;
    const notation = DIAGRAM_NOTATIONS.find((entry) => entry.detect?.(candidate));
    if (notation) return { format: notation.id, source: candidate };
  }
  return null;
}

/** Read any notation's text into the shared graph. */
export async function readDiagramSource(format: CanvasDiagramFormat, source: string): Promise<DiagramGraph | null> {
  const notation = diagramNotation(format);
  if (!notation?.read) return null;
  try {
    return await notation.read(source);
  } catch {
    // A malformed file is a normal thing to be handed. The caller shows the
    // source instead of the drawing; it never takes the card down.
    return null;
  }
}

export interface DiagramConversion {
  source: string;
  format: CanvasDiagramFormat;
  shapes: number;
  connections: number;
  /** Connections the destination notation could not express. Reported rather
   * than discovered later as a missing arrow. */
  droppedConnections: number;
}

/**
 * Convert a diagram from one notation to another, through the shared graph.
 *
 * Returns `null` when the source could not be read (a Mermaid sequence diagram,
 * a `.drawio` this cannot parse) or the destination cannot be written, so the
 * caller reports a reason instead of writing an empty file.
 */
export async function convertDiagramSource(
  source: string,
  from: CanvasDiagramFormat,
  to: CanvasDiagramFormat,
): Promise<DiagramConversion | null> {
  const target = diagramNotation(to);
  if (!target?.write) return null;
  const graph = await readDiagramSource(from, source);
  if (!graph) return null;
  return conversionFromGraph(graph, target);
}

/**
 * The same result shape, for a graph that did not come from a text notation —
 * a Visio package, or an SVG picture being turned into shapes.
 *
 * Endpoints are resolved HERE, once, before any writer runs. A geometry
 * notation may give an edge only its waypoints, and every text writer needs to
 * know which two shapes an edge joins; doing it per-writer meant four copies of
 * the same recovery, three of which would eventually disagree.
 */
export function conversionFromGraph(graph: DiagramGraph, target: DiagramNotation): DiagramConversion | null {
  if (!target.write) return null;
  const resolved: DiagramGraph = { ...graph, edges: resolveEdgeEndpoints(graph) };
  return {
    source: target.write(resolved),
    format: target.id,
    shapes: resolved.vertices.length,
    connections: resolved.edges.length,
    droppedConnections: target.requiresEndpoints
      ? resolved.edges.filter((edge) => !edge.source || !edge.target).length
      : 0,
  };
}
