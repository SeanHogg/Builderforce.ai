/**
 * Take the diagram that is ON the board and turn it into a standalone .svg.
 *
 * Both diagram notations already render to SVG in the card — Draw.io through
 * `DrawioCanvas`, Mermaid through the Mermaid renderer — so reading the rendered
 * element is the only way to export both from ONE implementation. Re-deriving
 * shapes from the source would mean a second renderer per notation, kept in step
 * with the first by hand, and Mermaid's is not ours to reimplement at all.
 *
 * The catch is that the card draws itself from the canvas palette, which is CSS
 * custom properties — `var(--canvas-line)` resolves to nothing in a file opened
 * outside the app, so a naively serialized SVG comes out invisible. Computed
 * styles are therefore resolved and written onto each node as presentation
 * attributes before serializing, which is what makes the exported file
 * self-contained.
 */

/** The properties that carry a diagram's appearance. A whole computed style is
 * ~340 declarations per node, which would balloon the file and drag inherited
 * document defaults into a standalone drawing. */
import { canvasStrokes, strokesSvg } from './canvasDrawing';
import { creativePreviewImageUrl } from './creationDeliverables';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const PRESENTATION_PROPERTIES = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'color', 'font-family', 'font-size', 'font-style', 'font-weight',
  'text-anchor', 'dominant-baseline', 'letter-spacing',
] as const;

/** Values that mean "nothing was set" — writing them back adds bytes and can
 * override an SVG default that was already correct. */
const INERT = new Set(['', 'none', 'normal', 'auto', 'initial', 'rgba(0, 0, 0, 0)']);

function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = window.getComputedStyle(source);
  for (const property of PRESENTATION_PROPERTIES) {
    const value = computed.getPropertyValue(property).trim();
    // `fill: none` IS meaningful on a shape, unlike `font-style: normal`.
    if (!value || (INERT.has(value) && property !== 'fill' && property !== 'stroke')) continue;
    if (value === 'none' && property !== 'fill' && property !== 'stroke') continue;
    clone.setAttribute(property, value);
  }
  clone.removeAttribute('class');
  clone.removeAttribute('style');
}

/**
 * Serialize a rendered `<svg>` into a standalone document.
 *
 * Returns `null` when there is nothing rendered to take — a diagram still
 * resolving its source, or an unreadable one — so the caller reports that
 * honestly rather than downloading an empty file.
 */
export function serializeRenderedSvg(source: SVGSVGElement | null | undefined): string | null {
  if (!source || typeof window === 'undefined') return null;
  const clone = source.cloneNode(true) as SVGSVGElement;
  const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  // `cloneNode(true)` guarantees the two walks are the same shape, which is what
  // lets a style read off the live node be written onto its copy by position.
  if (sourceNodes.length !== cloneNodes.length) return null;
  sourceNodes.forEach((node, index) => inlineComputedStyles(node, cloneNodes[index]!));

  const box = source.getBoundingClientRect();
  const width = source.getAttribute('width') ?? (box.width ? String(Math.round(box.width)) : '800');
  const height = source.getAttribute('height') ?? (box.height ? String(Math.round(box.height)) : '600');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${parseFloat(width) || 800} ${parseFloat(height) || 600}`);
  // A drawing viewed on its own sits on paper, not on the board's tinted surface.
  if (!clone.style.background) clone.setAttribute('style', 'background:#ffffff');

  const markup = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}

/**
 * The `<svg>` a canvas object is currently rendering, found through React Flow's
 * own `data-id` on the node wrapper. The board is the only place this element
 * exists, so the lookup belongs with the serializer that needs it rather than
 * being threaded as a ref through every card body that might one day export.
 */
export function renderedNodeSvg(nodeId: string): SVGSVGElement | null {
  if (typeof document === 'undefined') return null;
  const wrapper = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  return wrapper?.querySelector('svg') ?? null;
}

/** The SVG a creative artifact was DRAWN as, decoded from the preview data URL
 * the generator recorded. A CAD profile is a DXF file plus a drawing of it; the
 * drawing is the thing a person wants as a picture or on a page. */
function creativePreviewSvg(data: CreationNodeData): string | null {
  const url = creativePreviewImageUrl(data);
  if (!url?.startsWith('data:image/svg+xml')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const payload = url.slice(comma + 1);
  try {
    return url.slice(0, comma).includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/**
 * The vector drawing this object currently has, whichever way it got one.
 *
 * A diagram is rendered live in the card, so it is read off the DOM; a CAD
 * profile was drawn once by the generator and stored as a preview data URL. One
 * question, one answer, so the SVG download and the PDF print agree about what
 * the picture is.
 */
export function canvasObjectSvg(data: CreationNodeData, nodeId: string): string | null {
  if (data.kind === 'diagram') return serializeRenderedSvg(renderedNodeSvg(nodeId));
  // A hand-made drawing IS vector data — it does not need to be read back off
  // the DOM or decoded from a generator's preview. It was serialized from its
  // strokes here rather than from the rendered node so that a sketch drawn in a
  // theme colour exports with the colour it was drawn in.
  if (data.kind === 'drawing') {
    return strokesSvg(
      canvasStrokes(data),
      typeof data.drawingWidth === 'number' ? data.drawingWidth : 640,
      typeof data.drawingHeight === 'number' ? data.drawingHeight : 420,
    );
  }
  return creativePreviewSvg(data);
}

/** Whether this object HAS a drawing to take away, asked before the button is
 * offered rather than after it fails. Deliberately does not touch the DOM: a
 * diagram that has resolved its source will render one. */
export function hasCanvasDrawing(data: CreationNodeData): boolean {
  if (data.kind === 'diagram') return true;
  // A drawing with marks on it can always be taken away. This asked for a
  // generator preview URL, which a hand-drawn sketch never has — so the SVG
  // download was hidden on the one object kind that is nothing BUT a drawing.
  if (data.kind === 'drawing') return canvasStrokes(data).length > 0;
  return !!creativePreviewImageUrl(data)?.startsWith('data:image/svg+xml');
}
