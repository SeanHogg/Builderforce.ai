import { resolveExportColor } from '../exportColors';
import { escapeHtml } from '@builderforce/creation-canvas-contract';
import { dimensionGeometry, DEFAULT_STROKE_MM, shapeColor, visibleShapes } from './cadGeometry';
import type { CadShape, CadState } from './cadState';

/**
 * The drawing as an SVG 1.1 document, in millimetres: `width`/`height` carry the unit
 * and the `viewBox` matches, so a viewer that honours physical size shows the sheet at
 * true scale. SVG is Y-down like the editor, so no coordinate is flipped.
 */
export function renderCadSvg(state: CadState, paper: string = resolveExportColor('paper')): string {
  const body = visibleShapes(state).map((shape) => shapeToSvg(state, shape)).filter(Boolean).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${state.widthMm}mm" height="${state.heightMm}mm" viewBox="0 0 ${state.widthMm} ${state.heightMm}">
  <rect x="0" y="0" width="${state.widthMm}" height="${state.heightMm}" fill="${escapeHtml(paper)}"/>
  ${body}
</svg>`;
}

function shapeToSvg(state: CadState, shape: CadShape): string {
  const color = escapeHtml(shapeColor(state, shape));
  const stroke = `stroke="${color}" stroke-width="${shape.strokeWidthMm ?? DEFAULT_STROKE_MM}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  switch (shape.kind) {
    case 'line':
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${stroke}/>`;
    case 'rect': {
      const radius = shape.cornerRadius ? ` rx="${shape.cornerRadius}" ry="${shape.cornerRadius}"` : '';
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${radius} ${stroke}/>`;
    }
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.radius}" ${stroke}/>`;
    case 'polyline':
      return `<${shape.closed ? 'polygon' : 'polyline'} points="${shape.points.map((point) => `${point.x},${point.y}`).join(' ')}" ${stroke}/>`;
    case 'dimension': {
      const geometry = dimensionGeometry(shape, state.unit);
      if (!geometry) return '';
      const segments = [geometry.line, ...geometry.extensions]
        .map(([from, to]) => `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ${stroke}/>`).join('');
      return `<g>${segments}<text x="${geometry.labelAt.x}" y="${geometry.labelAt.y - 1}" font-size="3" text-anchor="middle" fill="${color}">${escapeHtml(geometry.label)}</text></g>`;
    }
    case 'text': {
      const rotation = shape.rotation ? ` transform="rotate(${-shape.rotation} ${shape.x} ${shape.y})"` : '';
      return `<text x="${shape.x}" y="${shape.y}" font-size="${shape.heightMm}" fill="${color}"${rotation}>${escapeHtml(shape.text)}</text>`;
    }
  }
}
