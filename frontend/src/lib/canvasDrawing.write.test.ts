import { describe, it, expect } from 'vitest';
import {
  admitStrokes, beginStrokePath, canvasStrokes, drawingHasRoom, extendStrokePath, MAX_POINTS, MAX_STROKES, MAX_TOTAL_POINTS, mintStrokeId, patchedStroke,
  retainStrokes, strokeFromPath, totalPoints, type CanvasStroke,
} from './canvasDrawing';

const stroke = (x: number, extra: Partial<CanvasStroke> = {}): CanvasStroke => ({ tool: 'pen', points: [{ x, y: 0 }, { x: x + 1, y: 1 }], stroke: 'currentColor', strokeWidth: 3, ...extra });

describe('the bounded stroke write path', () => {
  it('rounds captured points to one decimal', () => {
    const made = strokeFromPath({ tool: 'pen', color: 'currentColor', width: 3 }, [{ x: 1.23456, y: 2.98765 }, { x: 3.14159, y: 4 }]);
    expect(made?.points).toEqual([{ x: 1.2, y: 3 }, { x: 3.1, y: 4 }]);
  });

  it('stops growing a path at the point cap but keeps following the pointer', () => {
    const ref = { current: [] as Array<{ x: number; y: number }> };
    beginStrokePath(ref, { x: 0, y: 0 });
    for (let index = 1; index < MAX_POINTS + 500; index += 1) extendStrokePath(ref, { x: index, y: 0 });
    expect(ref.current).toHaveLength(MAX_POINTS);
    expect(ref.current[ref.current.length - 1]).toEqual({ x: MAX_POINTS + 499, y: 0 });
  });

  it('thins points closer than the minimum distance but ends exactly where the pointer did', () => {
    const ref = { current: [] as Array<{ x: number; y: number }> };
    beginStrokePath(ref, { x: 0, y: 0 });
    for (let index = 1; index <= 10; index += 1) extendStrokePath(ref, { x: index * 0.1, y: 0 }, 0.75);
    expect(ref.current.length).toBeLessThan(11);
    expect(ref.current[ref.current.length - 1]).toEqual({ x: 1, y: 0 });
  });

  it('admitStrokes sanitises, de-duplicates ids and refuses past the cap', () => {
    const admitted = admitStrokes([stroke(0, { id: 'a' })], [stroke(1, { id: 'a' }), stroke(2, { stroke: 'url(#x)' })]);
    expect(admitted).toHaveLength(2);
    expect(new Set(['a', ...admitted.map((item) => item.id)]).size).toBe(3);
    expect(admitted[1]!.stroke).toBe('var(--indigo-bright)');
    const full = Array.from({ length: MAX_STROKES }, (_, index) => stroke(index, { id: `s${index}` }));
    expect(admitStrokes(full, [stroke(1)])).toEqual([]);
  });

  it('admitStrokes holds a drawing to MAX_TOTAL_POINTS in total, not just MAX_STROKES', () => {
    const long = (id: string, n: number): CanvasStroke => ({ id, tool: 'pen', points: Array.from({ length: n }, (_, index) => ({ x: index, y: 0 })), stroke: 'currentColor', strokeWidth: 3 });
    const existing = Array.from({ length: 19 }, (_, index) => long(`l${index}`, 2_000)); // 38 000 points
    expect(totalPoints(existing)).toBe(38_000);
    expect(drawingHasRoom(existing)).toBe(true);
    expect(admitStrokes(existing, [long('n', 2_000)])).toHaveLength(1); // lands exactly on the budget
    expect(admitStrokes(existing, [long('n', 2_000), long('o', 2)])).toHaveLength(1); // nothing past it
    expect(admitStrokes(existing, [long('n', 1_999), long('m', 2)])).toHaveLength(1);
    const full = [...existing, long('f', 2_000)];
    expect(drawingHasRoom(full)).toBe(false);
    expect(admitStrokes(full, [stroke(1)])).toEqual([]);
    expect(MAX_TOTAL_POINTS).toBe(40_000);
  });

  it('patchedStroke refuses a patch that grows the drawing past the point budget, but allows shrinking', () => {
    const base: CanvasStroke = { id: 'a', tool: 'pen', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], stroke: 'currentColor', strokeWidth: 3 };
    const filler: CanvasStroke = { id: 'f', tool: 'pen', points: Array.from({ length: MAX_TOTAL_POINTS - 2 }, (_, index) => ({ x: index, y: 0 })), stroke: 'currentColor', strokeWidth: 3 };
    const longer = { points: [...base.points, { x: 2, y: 2 }] };
    expect(patchedStroke(base, longer, [base, filler])).toBeNull();
    expect(patchedStroke(base, longer)).not.toBeNull();
    expect(patchedStroke(base, { strokeWidth: 5 }, [base, filler])).toMatchObject({ strokeWidth: 5 });
  });

  it('retainStrokes keeps the NEWEST strokes of an over-long existing list and unique ids', () => {
    const many = Array.from({ length: MAX_STROKES * 4 + 5 }, (_, index) => stroke(index, { id: `s${index}` }));
    const kept = retainStrokes(many);
    expect(kept).toHaveLength(MAX_STROKES * 4);
    expect(kept[kept.length - 1]!.id).toBe(`s${many.length - 1}`);
    expect(new Set(retainStrokes([stroke(1, { id: 'x' }), stroke(2, { id: 'x' })]).map((item) => item.id)).size).toBe(2);
  });

  it('patchedStroke re-sanitises and keeps the id', () => {
    expect(patchedStroke(stroke(0, { id: 'a' }), { strokeWidth: 9999, stroke: 'javascript:1' })).toMatchObject({ id: 'a', strokeWidth: 48, stroke: 'var(--indigo-bright)' });
  });

  it('never silently drops the newest strokes when reading an over-long list', () => {
    const many = Array.from({ length: MAX_STROKES * 4 + 10 }, (_, index) => stroke(index, { id: `s${index}` }));
    const read = canvasStrokes({ strokes: many });
    expect(read[read.length - 1]!.id).toBe(`s${MAX_STROKES * 4 + 9}`);
  });

  it('mints distinct full-length ids', () => {
    const a = mintStrokeId();
    expect(a).not.toBe(mintStrokeId());
    expect(a.length).toBeGreaterThan(20);
  });
});
