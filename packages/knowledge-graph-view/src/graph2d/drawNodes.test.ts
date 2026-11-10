/** The canvas pass's paint queue: an index cursor over the shape buckets, batch by batch, buckets left intact. */
import { describe, expect, it } from 'vitest';
import { bucketByShape, paintQueue, type NodeMark } from './drawNodes';

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

    it('is done at once with nothing to paint, and says done on the batch that drains it', () => {
        expect(paintQueue([]).next(10, () => undefined)).toBe(true);
        const q = paintQueue(bucketByShape([mark('a', 'circle'), mark('b', 'circle')]));
        expect(q.next(2, () => undefined)).toBe(true);
    });
});
