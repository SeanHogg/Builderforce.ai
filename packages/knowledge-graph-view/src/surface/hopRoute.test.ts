/** Hop route labels: facts from route and payload badges, never a guess. */
import { describe, expect, it } from 'vitest';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { formatBytes } from '../formatBytes';
import { hopRouteLabel, hopRouteLabels } from './sequenceText';
import type { PathModel } from './path';

const file = (badges: Record<string, string | number>): Pick<KNode, 'badges'> => ({ badges });

describe('formatBytes', () => {
    it('reads like a person would', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(3.2 * 1024)).toBe('3.2 KB');
        expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
    });
});

describe('hopRouteLabel', () => {
    it('is the method and the size when both are known', () => {
        expect(hopRouteLabel([file({ routes: 'PUT /orders/:id; GET /orders', payloadBytes: 1.4 * 1024 * 1024 })])).toBe('PUT 1.4 MB');
    });
    it('is the whole route with no size, and the size alone with no route', () => {
        expect(hopRouteLabel([file({ routes: 'GET /users/:id' })])).toBe('GET /users/:id');
        expect(hopRouteLabel([file({ payloadBytes: 2048 })])).toBe('2.0 KB');
    });
    it('takes the largest payload among the files', () => {
        expect(hopRouteLabel([file({ routes: 'POST /a', payloadBytes: 100 }), file({ payloadBytes: 4096 })])).toBe('POST 4.0 KB');
    });
    it('is null when nothing is known (no label, never a guess), including a zero or junk size', () => {
        expect(hopRouteLabel([])).toBeNull();
        expect(hopRouteLabel([file({ complexity: 3 })])).toBeNull();
        expect(hopRouteLabel([file({ payloadBytes: 0 }), file({ payloadBytes: 'big' })])).toBeNull();
    });
});

describe('hopRouteLabels', () => {
    const path: PathModel = { stops: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], hops: [{ kind: 'references', count: 1 }, { kind: 'references', count: 1 }] };
    it('labels each hop from the files of the stop it enters', () => {
        const nodes = new Map<string, KNode>([['f1', { ref: 'f1', badges: { routes: 'PUT /x', payloadBytes: 1024 } } as unknown as KNode]]);
        const stations = new Map([['b', { refs: ['f1'] }], ['c', { refs: ['missing'] }]]);
        expect(hopRouteLabels(path, stations, nodes)).toEqual(['PUT 1.0 KB', null]);
    });
});
