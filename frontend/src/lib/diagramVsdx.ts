/**
 * Visio (`.vsdx`) reader.
 *
 * Visio is the diagram format that arrives from OUTSIDE — from a client, a
 * compliance pack, an infrastructure team, a process auditor. It is also the
 * format Lucidchart, SmartDraw and Visio's own web app all export to, which
 * makes one reader the way in from most of the commercial diagramming market.
 * Until now a `.vsdx` landed as an attachment icon: the person could see they
 * had a file and nothing else.
 *
 * ── WHAT A VSDX ACTUALLY IS ──────────────────────────────────────────────────
 * An OPC ZIP, like a `.docx`. `visio/pages/pages.xml` lists the pages and their
 * size; `visio/pages/page1.xml` holds the shapes. Every coordinate is in INCHES
 * from the BOTTOM-left, and every shape is positioned by its CENTRE (`PinX`,
 * `PinY`) rather than its corner — so a reader that treats those as top-left
 * pixels produces a drawing that is upside down and half a shape out of place.
 * Both corrections happen here, once.
 *
 * ── READ-ONLY, AND WHY ───────────────────────────────────────────────────────
 * Writing a `.vsdx` means writing a valid OPC package: content types, three
 * relationship parts, a document part, a masters part, and a page part whose
 * shapes reference masters that must also exist. A file that is subtly wrong
 * does not degrade — Visio refuses to open it at all. A Visio drawing therefore
 * converts OUT to every other notation here, and draw.io (which Visio can
 * import) is the honest route back.
 */

import { openZip } from './officeFormats';
import {
  DIAGRAM_DEFAULT_FONT_SIZE, MAX_DIAGRAM_CELLS, diagramGraph,
  type DiagramEdge, type DiagramGraph, type DiagramShape, type DiagramVertex,
} from './diagramGraph';

/** Visio measures in inches; the canvas draws in CSS pixels. */
const PIXELS_PER_INCH = 96;
const DEFAULT_PAGE_HEIGHT_INCHES = 11;

function localName(element: Element): string {
  return element.localName || element.tagName.replace(/^.*:/, '');
}

function parseXml(source: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  try {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    return document.getElementsByTagName('parsererror').length ? null : document;
  } catch {
    return null;
  }
}

/** `<Cell N='PinX' V='4.25'/>` children, as a lookup. Only the shape's OWN
 * cells — a child shape's cells belong to the child. */
function cells(shape: Element): Record<string, number> {
  const found: Record<string, number> = {};
  for (const child of Array.from(shape.children)) {
    if (localName(child) !== 'Cell') continue;
    const name = child.getAttribute('N');
    const value = Number(child.getAttribute('V'));
    if (name && Number.isFinite(value)) found[name] = value;
  }
  return found;
}

/** A shape's visible text. Visio splits a label into character-formatting runs,
 * so the markup has to be flattened rather than read from one node. */
function shapeText(shape: Element): string {
  const text = Array.from(shape.children).find((child) => localName(child) === 'Text');
  return text ? (text.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) : '';
}

/**
 * The shape a Visio master draws as.
 *
 * Visio carries no shape primitive — a "decision" is a master called `Decision`
 * whose geometry happens to be a diamond. Matching the master name is therefore
 * the only signal available without evaluating Visio's ShapeSheet formulas, and
 * it covers the flowchart, BPMN and network stencils people actually use.
 */
function shapeForMaster(name: string): DiagramShape {
  const master = name.toLowerCase();
  if (/decision|diamond/.test(master)) return 'rhombus';
  if (/terminator|start|end|ellipse|circle|oval|event/.test(master)) return 'ellipse';
  if (/database|data ?store|disk|cylinder/.test(master)) return 'cylinder';
  if (/document|note|annotation|comment/.test(master)) return 'note';
  if (/preparation|hexagon/.test(master)) return 'hexagon';
  if (/process|task|activity|rounded/.test(master)) return 'rounded';
  return 'rect';
}

interface PageGeometry { heightInches: number }

function pageGeometry(document: Document | null): PageGeometry {
  const page = document ? Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'PageSheet') : null;
  const height = page ? cells(page).PageHeight : undefined;
  return { heightInches: Number.isFinite(height) && height! > 0 ? height! : DEFAULT_PAGE_HEIGHT_INCHES };
}

/** Page parts, in page order. A multi-page drawing reads its FIRST page: a
 * canvas object is one diagram, and silently concatenating five pages on top of
 * each other is worse than reading the one the file opens on. */
function pageParts(names: readonly string[]): string[] {
  return names
    .filter((name) => /^visio\/pages\/page\d+\.xml$/i.test(name))
    .sort((left, right) => Number(/(\d+)\.xml$/i.exec(left)?.[1] ?? 0) - Number(/(\d+)\.xml$/i.exec(right)?.[1] ?? 0));
}

export async function readVsdx(bytes: Uint8Array): Promise<DiagramGraph | null> {
  const zip = openZip(bytes);
  if (!zip) return null;
  const parts = pageParts(zip.names);
  const first = parts[0];
  if (!first) return null;

  const [pageXml, pagesXml] = await Promise.all([zip.readText(first), zip.readText('visio/pages/pages.xml')]);
  if (!pageXml) return null;
  const document = parseXml(pageXml);
  if (!document) return null;
  const { heightInches } = pageGeometry(pagesXml ? parseXml(pagesXml) : null);

  const masterNames = new Map<string, string>();
  const shapes = Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'Shape');

  const vertices: DiagramVertex[] = [];
  const connectors = new Map<string, { id: string; points: Array<{ x: number; y: number }>; label: string }>();

  for (const shape of shapes) {
    if (vertices.length + connectors.size >= MAX_DIAGRAM_CELLS) break;
    const id = shape.getAttribute('ID');
    if (!id) continue;
    const measures = cells(shape);
    const name = shape.getAttribute('NameU') ?? shape.getAttribute('Name') ?? '';
    masterNames.set(id, name);
    const label = shapeText(shape);

    // A one-dimensional shape — Visio's connector — is positioned by its two
    // ends, not by a box, and carries Begin/End cells instead of Width/Height.
    if (Number.isFinite(measures.BeginX) && Number.isFinite(measures.EndX)) {
      connectors.set(id, {
        id,
        label,
        points: [
          { x: measures.BeginX! * PIXELS_PER_INCH, y: (heightInches - (measures.BeginY ?? 0)) * PIXELS_PER_INCH },
          { x: measures.EndX! * PIXELS_PER_INCH, y: (heightInches - (measures.EndY ?? 0)) * PIXELS_PER_INCH },
        ],
      });
      continue;
    }

    const width = (measures.Width ?? 0) * PIXELS_PER_INCH;
    const height = (measures.Height ?? 0) * PIXELS_PER_INCH;
    if (!(width > 1) || !(height > 1)) continue;
    const centreX = (measures.PinX ?? 0) * PIXELS_PER_INCH;
    // Visio's origin is the BOTTOM-left of the page and the canvas's is the
    // top-left, so the page height is what turns one into the other.
    const centreY = (heightInches - (measures.PinY ?? 0)) * PIXELS_PER_INCH;
    vertices.push({
      id,
      label,
      x: centreX - width / 2,
      y: centreY - height / 2,
      width,
      height,
      shape: shapeForMaster(name || label),
      fontSize: DIAGRAM_DEFAULT_FONT_SIZE,
      dashed: false,
    });
  }
  if (!vertices.length) return null;

  // `<Connects>` is the only place a Visio file states which shapes a connector
  // joins; the connector's own geometry is just where the line was drawn.
  const known = new Set(vertices.map((vertex) => vertex.id));
  const endpoints = new Map<string, { source?: string; target?: string }>();
  for (const connect of Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'Connect')) {
    const connector = connect.getAttribute('FromSheet');
    const attached = connect.getAttribute('ToSheet');
    const cell = connect.getAttribute('FromCell') ?? '';
    if (!connector || !attached || !known.has(attached)) continue;
    const current = endpoints.get(connector) ?? {};
    if (/^Begin/i.test(cell)) current.source = attached;
    else if (/^End/i.test(cell)) current.target = attached;
    endpoints.set(connector, current);
  }

  const edges: DiagramEdge[] = [...connectors.values()].map((connector) => {
    const ends = endpoints.get(connector.id) ?? {};
    return {
      id: connector.id,
      label: connector.label,
      points: connector.points,
      dashed: false,
      arrow: true,
      ...(ends.source ? { source: ends.source } : {}),
      ...(ends.target ? { target: ends.target } : {}),
    };
  });

  return diagramGraph(vertices, edges);
}
