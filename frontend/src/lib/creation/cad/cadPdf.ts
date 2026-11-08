import { dimensionGeometry, DEFAULT_STROKE_MM, rectOutline, shapeColor, visibleShapes, type Point } from './cadGeometry';
import { createPdfBuilder, pdfBytesToString } from '../pdf/pdfDocument';
import type { CadShape, CadState } from './cadState';

/**
 * The drawing as a one-page VECTOR PDF, the page being the sheet at true size.
 *
 * Each shape is written as a native PDF path, so the file stays sharp at any zoom and a
 * print comes out at the sheet's real dimensions — the reason to export a drawing as a
 * PDF rather than as a picture of one. Text uses the built-in Helvetica, which every
 * reader has; characters outside ASCII are written as `?` rather than as garbage.
 *
 * The file is pure ASCII, so the byte offsets in the cross-reference table are string
 * lengths and the result can be handed to a `Blob` as text.
 */

const POINTS_PER_MM = 72 / 25.4;
/** Bézier control distance for a quarter circle. */
const KAPPA = 0.5522847498;

const n = (value: number): string => (Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, '') || '0' : '0');

function rgb(hexColor: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  const value = match ? parseInt(match[1]!, 16) : 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => n(channel / 255)).join(' ');
}

function pdfText(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '?');
}

export function renderCadPdf(state: CadState): string {
  const k = POINTS_PER_MM;
  const pageW = state.widthMm * k;
  const pageH = state.heightMm * k;
  const px = (x: number): string => n(x * k);
  const py = (y: number): string => n((state.heightMm - y) * k);

  const path = (points: readonly Point[], closed: boolean): string =>
    `${points.map((point, index) => `${px(point.x)} ${py(point.y)} ${index ? 'l' : 'm'}`).join(' ')}${closed ? ' h' : ''} S`;

  const ops: string[] = [];
  for (const shape of visibleShapes(state)) {
    ops.push('q', `${rgb(shapeColor(state, shape))} RG ${rgb(shapeColor(state, shape))} rg`, `${n((shape.strokeWidthMm ?? DEFAULT_STROKE_MM) * k)} w 1 J 1 j`);
    ops.push(...shapeOps(state, shape, { px, py, path, k }));
    ops.push('Q');
  }
  const content = ops.join('\n');

  const pdf = createPdfBuilder({ binary: false });
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const pageId = pdf.reserve();
  const contentId = pdf.reserve();
  const fontId = pdf.reserve();
  pdf.pageTree(catalogId, pagesId, [pageId]);
  pdf.object(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  pdf.stream(contentId, '', content);
  pdf.object(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  return pdfBytesToString(pdf.build(catalogId));
}

interface Emit {
  px: (x: number) => string;
  py: (y: number) => string;
  path: (points: readonly Point[], closed: boolean) => string;
  k: number;
}

function shapeOps(state: CadState, shape: CadShape, emit: Emit): string[] {
  const { px, py, path } = emit;
  switch (shape.kind) {
    case 'line': return [path([{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }], false)];
    case 'rect': return [path(rectOutline(shape), true)];
    case 'polyline': return [path(shape.points, shape.closed === true)];
    case 'circle': {
      const [cx, cy, r] = [shape.cx, shape.cy, shape.radius];
      const c = r * KAPPA;
      // Four cubic quarter-arcs, starting at the right-hand point and going round.
      const curve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
        `${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(x3)} ${py(y3)} c`;
      return [
        `${px(cx + r)} ${py(cy)} m`,
        curve(cx + r, cy + c, cx + c, cy + r, cx, cy + r),
        curve(cx - c, cy + r, cx - r, cy + c, cx - r, cy),
        curve(cx - r, cy - c, cx - c, cy - r, cx, cy - r),
        curve(cx + c, cy - r, cx + r, cy - c, cx + r, cy),
        'h S',
      ];
    }
    case 'dimension': {
      const geometry = dimensionGeometry(shape, state.unit);
      if (!geometry) return [];
      return [
        ...[geometry.line, ...geometry.extensions].map(([from, to]) => path([from, to], false)),
        ...textOps(geometry.label, geometry.labelAt, 3, 0, emit, true),
      ];
    }
    case 'text': return textOps(shape.text, { x: shape.x, y: shape.y }, shape.heightMm, shape.rotation ?? 0, emit, false);
  }
}

function textOps(text: string, at: Point, heightMm: number, rotation: number, { px, py, k }: Emit, centered: boolean): string[] {
  const size = heightMm * k;
  const radians = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  // Helvetica's average glyph is about half an em wide — enough to centre a short label.
  const shift = centered ? -(text.length * size * 0.5) / 2 : 0;
  return [`BT /F1 ${n(size)} Tf ${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${px(at.x)} ${py(at.y)} Tm ${n(shift)} 0 Td (${pdfText(text)}) Tj ET`];
}
