/** The canvas pass's paint queue: an index cursor over the shape buckets, batch by batch, buckets left intact. */
import { describe, expect, it } from 'vitest';
import { bucketByShape, drawMark, paintQueue, type NodeMark } from './drawNodes';
import { markTypeOf, SHAPE_PATHS, TYPE_SHAPE, type NodeShape } from '../shapes';
import type { ThemeColors } from '../scene/themeColors';

const mark = (id: string, shape: NodeMark['shape']): NodeMark => ({ id, x: 0, y: 0, r: 1, tone: 'accent', dim: false, shape });

describe('paintQueue', () => {
    it('hands out every mark once, in bucket order, at most `limit` per call', () => {
        const buckets = bucketByShape([mark('a', 'circle'), mark('b', 'square'), mark('c', 'circle'), mark('d', 'square'), mark('e', 'circle')]);
        const queue = paintQueue(buckets);
        const seen: string[][] = [];
        let done = false;
        while (!done) {
            const batch: string[] = [];
            done = queue.next(2, (m, shape) => { expect(m.shape).toBe(shape); batch.push(m.id); });
            seen.push(batch);
        }
        expect(seen).toEqual([['a', 'c'], ['e', 'b'], ['d']]);
    });

    it('regression: the pass reads the buckets without shifting them (no O(n) dequeue per mark)', () => {
        const marks = Array.from({ length: 1000 }, (_, i) => mark(String(i), i % 2 ? 'circle' : 'square'));
        const buckets = bucketByShape(marks);
        const queue = paintQueue(buckets);
        let drawn = 0;
        while (!queue.next(400, () => { drawn++; }));
        expect(drawn).toBe(1000);
        expect(buckets.reduce((n, b) => n + b.marks.length, 0)).toBe(1000);
    });

    it('regression: a graph of code files buckets into one Path2D per mark type, not one shape for all', () => {
        const files = ['src/a.ts', 'src/a.test.ts', 'docs/a.md', 'tsconfig.json', 'db/a.sql'];
        const marks = files.map((p) => mark(p, TYPE_SHAPE[markTypeOf({ kind: 'file', ref: `src:r::${p}` as never, label: p })]));
        const buckets = bucketByShape(marks);
        expect(buckets.map((b) => b.shape)).toEqual(['window', 'diamond', 'tile', 'triangle', 'drum']);
        expect(new Set(buckets.map((b) => SHAPE_PATHS[b.shape])).size).toBe(buckets.length);
    });

    it('is done at once with nothing to paint, and says done on the batch that drains it', () => {
        expect(paintQueue([]).next(10, () => undefined)).toBe(true);
        const q = paintQueue(bucketByShape([mark('a', 'circle'), mark('b', 'circle')]));
        expect(q.next(2, () => undefined)).toBe(true);
    });
});

describe('drawMark', () => {
    const calls = (shape: NodeShape) => {
        const log: string[] = [];
        const ctx = {
            save: () => undefined, restore: () => undefined, translate: () => undefined, scale: () => undefined,
            setLineDash: (d: number[]) => log.push(`dash:${d.length}`),
            fill: (p: unknown) => log.push(`fill:${String(p)}`), stroke: () => log.push('stroke'),
            set fillStyle(v: string) { log.push(`fillStyle:${v}`); }, set strokeStyle(v: string) { log.push(`strokeStyle:${v}`); },
            set lineWidth(_v: number) { /* recorded by the fill/stroke order */ }, set globalAlpha(_v: number) { /* n/a */ },
        } as unknown as CanvasRenderingContext2D;
        const colors = { accent: 'A', bg: 'B' } as unknown as ThemeColors;
        drawMark(ctx, mark('m', shape), `path:${shape}` as unknown as Path2D, colors, 'B');
        return log;
    };

    it('fills the shape\'s own path in its tone with a background outline', () => {
        expect(calls('square')).toEqual(['fillStyle:A', 'strokeStyle:B', 'fill:path:square', 'stroke']);
        expect(calls('drum')).toContain('fill:path:drum');
    });

    it('draws the outside (missing / external) hollow with a dashed outline', () => {
        expect(calls('cross')).toEqual(['fillStyle:B', 'strokeStyle:A', 'dash:2', 'fill:path:cross', 'stroke']);
    });
});
