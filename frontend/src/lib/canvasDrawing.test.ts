import { describe, expect, it } from 'vitest';
import { canvasStrokes, drawingPatch, eraseStrokes, normalizeStrokes, strokesSvg, type CanvasStroke } from './canvasDrawing';

const pen: CanvasStroke = { tool: 'pen', points: [{ x: 10, y: 10 }, { x: 40, y: 40 }], stroke: '#123456', strokeWidth: 3 };
const highlighter: CanvasStroke = { tool: 'highlighter', points: [{ x: 100, y: 10 }, { x: 160, y: 12 }], stroke: '#ffcc00', strokeWidth: 4 };

describe('reading strokes off an object', () => {
  it('reads a drawing made before strokes existed as one pen stroke', () => {
    const strokes = canvasStrokes({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], stroke: '#abcdef', strokeWidth: 5 });
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ tool: 'pen', stroke: '#abcdef', strokeWidth: 5 });
  });

  it('drops a mark that cannot be drawn, and keeps text placed with one point', () => {
    const strokes = canvasStrokes({ strokes: [pen, { tool: 'pen', points: [{ x: 1, y: 1 }] }, { tool: 'text', points: [{ x: 5, y: 5 }], text: 'see this' }] });
    expect(strokes.map((stroke) => stroke.tool)).toEqual(['pen', 'text']);
    expect(strokes[1]).toMatchObject({ text: 'see this' });
  });
});

describe('growing a drawing', () => {
  it('re-origins every stroke and reports where the card has to sit', () => {
    const normalized = normalizeStrokes([pen, highlighter], 8);
    expect(normalized.offsetX).toBe(2);
    expect(normalized.offsetY).toBe(2);
    expect(normalized.strokes[0]!.points[0]).toEqual({ x: 8, y: 8 });
    expect(normalized.width).toBe(166);
  });

  it('writes the size, the origin and a legacy path in one patch', () => {
    const patch = drawingPatch([pen, highlighter]);
    expect(patch).toMatchObject({ drawingOriginX: 2, drawingOriginY: 2, stroke: '#123456', strokeWidth: 3 });
    expect(Array.isArray(patch.strokes) && patch.strokes).toHaveLength(2);
    // A client that predates strokes still opens the board and sees a line.
    expect(patch.points).toEqual((patch.strokes as CanvasStroke[])[0]!.points);
  });
});

describe('erasing', () => {
  it('removes the whole stroke the eraser was dragged across, and leaves the rest', () => {
    const kept = eraseStrokes([pen, highlighter], [{ x: 25, y: 25 }], 6);
    expect(kept.map((stroke) => stroke.tool)).toEqual(['highlighter']);
  });

  it('leaves everything alone when the eraser misses', () => {
    expect(eraseStrokes([pen, highlighter], [{ x: 400, y: 400 }], 6)).toHaveLength(2);
  });
});

describe('taking a drawing away', () => {
  it('serializes every tool, with the highlighter translucent', () => {
    const svg = strokesSvg([
      pen,
      highlighter,
      { tool: 'rect', points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], stroke: '#f00', strokeWidth: 2 },
      { tool: 'ellipse', points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], stroke: '#f00', strokeWidth: 2 },
      { tool: 'text', points: [{ x: 4, y: 8 }], stroke: '#000', strokeWidth: 3, text: 'label' },
    ], 200, 100)!;
    expect(svg).toContain('<path');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('>label</text>');
    expect(svg).toContain('opacity="0.35"');
  });

  it('has nothing to serialize for a drawing with no marks', () => {
    expect(strokesSvg([], 100, 100)).toBeNull();
  });
});
