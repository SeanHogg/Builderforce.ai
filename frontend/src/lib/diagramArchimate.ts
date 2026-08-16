/**
 * ArchiMate reader (Archi's native `.archimate` model file).
 *
 * ArchiMate is the notation enterprise architecture is actually recorded in,
 * and Archi is the tool that records it. A `.archimate` file is a MODEL with
 * views drawn over it: the elements and relationships live once, and a view is
 * a set of boxes that REFER to them. So the label on a box is not in the box —
 * it is on the element the box points at, which is why a naive XML reader gets
 * an architecture diagram full of empty rectangles.
 *
 * ── READ-ONLY, AND WHY ───────────────────────────────────────────────────────
 * Writing ArchiMate would mean choosing an element TYPE for every box —
 * business actor, application component, technology node, and forty more — and
 * that choice is the entire content of an ArchiMate model. A rectangle on a
 * canvas does not carry it, and inventing one would produce a file that opens
 * in Archi and states something the author never said. So an ArchiMate model
 * converts OUT to every other notation here, and is not a conversion target.
 */

import {
  DIAGRAM_DEFAULT_FONT_SIZE, MAX_DIAGRAM_CELLS, diagramGraph,
  type DiagramEdge, type DiagramGraph, type DiagramShape, type DiagramVertex,
} from './diagramGraph';

const ARCHIMATE_MARKER = /<archimate:model|xmlns:archimate=|archimate:ArchimateDiagramModel/i;

export function isArchimateSource(source: string): boolean {
  return ARCHIMATE_MARKER.test(source.slice(0, 8_000));
}

/**
 * How an ArchiMate element type draws.
 *
 * ArchiMate's own notation distinguishes forty-odd element types by a corner
 * badge on the same rounded rectangle, which this canvas does not draw. Matched
 * on the SUFFIX of the type name, because the layer prefix (Business /
 * Application / Technology) changes the colour in Archi and not the shape.
 */
function shapeForType(type: string): DiagramShape {
  const name = type.replace(/^archimate:/i, '').toLowerCase();
  if (name.endsWith('actor') || name.endsWith('role') || name.endsWith('stakeholder')) return 'rounded';
  if (name.endsWith('service') || name.endsWith('interface')) return 'ellipse';
  if (name.endsWith('object') || name.endsWith('artifact') || name.endsWith('deliverable') || name.endsWith('contract')) return 'note';
  if (name.endsWith('node') || name.endsWith('device') || name.endsWith('equipment')) return 'rect';
  if (name.endsWith('junction')) return 'ellipse';
  if (name.endsWith('systemsoftware') || name.endsWith('component')) return 'rect';
  if (name.endsWith('assessment') || name.endsWith('driver') || name.endsWith('goal') || name.endsWith('outcome')) return 'ellipse';
  return 'rounded';
}

function localName(element: Element): string {
  return element.localName || element.tagName.replace(/^.*:/, '');
}

function typeAttribute(element: Element): string {
  return element.getAttribute('xsi:type') ?? element.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ?? '';
}

function numeric(value: string | null, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readArchimate(source: string): DiagramGraph | null {
  if (typeof DOMParser === 'undefined' || !isArchimateSource(source)) return null;
  let document: Document;
  try {
    document = new DOMParser().parseFromString(source, 'application/xml');
  } catch {
    return null;
  }
  if (document.getElementsByTagName('parsererror').length) return null;

  // Pass one: every element in the model, by id, so a view object can be given
  // the name of the thing it refers to.
  const modelNames = new Map<string, { name: string; type: string }>();
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    const id = element.getAttribute('id');
    if (!id || localName(element) !== 'element') continue;
    modelNames.set(id, { name: element.getAttribute('name') ?? '', type: typeAttribute(element) });
  }

  // Relationship id → its own name, for connection labels ("serves", "flows to"
  // and the like are the type; a named relationship carries its own label).
  const relationshipNames = new Map<string, string>();
  for (const [id, entry] of modelNames) if (/relationship$/i.test(entry.type)) relationshipNames.set(id, entry.name);

  const views = Array.from(document.getElementsByTagName('*'))
    .filter((element) => /ArchimateDiagramModel|SketchModel/i.test(typeAttribute(element)));
  const view = views[0];
  if (!view) return null;

  const vertices: DiagramVertex[] = [];
  const connections: Array<{ id: string; source: string; target: string; label: string; dashed: boolean }> = [];

  const walk = (parent: Element, offsetX: number, offsetY: number): void => {
    for (const child of Array.from(parent.children)) {
      const name = localName(child);
      if (name === 'sourceConnection') {
        const source = child.getAttribute('source');
        const target = child.getAttribute('target');
        const relationship = child.getAttribute('archimateRelationship') ?? '';
        if (source && target) {
          connections.push({
            id: child.getAttribute('id') ?? `${source}-${target}`,
            source,
            target,
            label: relationshipNames.get(relationship) ?? '',
            dashed: /realization|access|influence/i.test(modelNames.get(relationship)?.type ?? ''),
          });
        }
        continue;
      }
      if (name !== 'children' && name !== 'child') continue;
      if (vertices.length >= MAX_DIAGRAM_CELLS) return;
      const bounds = Array.from(child.children).find((node) => localName(node) === 'bounds');
      const id = child.getAttribute('id');
      if (!id || !bounds) { walk(child, offsetX, offsetY); continue; }
      // Archi writes a nested object's bounds RELATIVE to its container, so an
      // element inside a grouping lands on top of the grouping unless the
      // offsets accumulate on the way down.
      const x = numeric(bounds.getAttribute('x')) + offsetX;
      const y = numeric(bounds.getAttribute('y')) + offsetY;
      const width = Math.max(numeric(bounds.getAttribute('width'), 120), 1);
      const height = Math.max(numeric(bounds.getAttribute('height'), 55), 1);
      const referenced = child.getAttribute('archimateElement');
      const model = referenced ? modelNames.get(referenced) : undefined;
      vertices.push({
        id,
        label: (child.getAttribute('name') ?? model?.name ?? '').trim(),
        x, y, width, height,
        shape: shapeForType(model?.type ?? typeAttribute(child)),
        fontSize: DIAGRAM_DEFAULT_FONT_SIZE,
        dashed: false,
      });
      walk(child, x, y);
    }
  };
  walk(view, 0, 0);
  if (!vertices.length) return null;

  const byId = new Map(vertices.map((vertex) => [vertex.id, vertex] as const));
  const edges: DiagramEdge[] = connections.flatMap((connection, index) => {
    const from = byId.get(connection.source);
    const to = byId.get(connection.target);
    if (!from || !to) return [];
    return [{
      id: connection.id || `connection-${index + 1}`,
      label: connection.label,
      points: [
        { x: from.x + from.width / 2, y: from.y + from.height / 2 },
        { x: to.x + to.width / 2, y: to.y + to.height / 2 },
      ],
      dashed: connection.dashed,
      arrow: true,
      source: connection.source,
      target: connection.target,
    }];
  });

  return diagramGraph(vertices, edges);
}
