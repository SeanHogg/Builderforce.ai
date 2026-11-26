import { describe, expect, it } from 'vitest';
import { nearestHit, type HitCandidate } from './hitTest';

const important: HitCandidate = { id: 'a-important', x: 0, y: 0, importance: 0.9 };
const minor: HitCandidate = { id: 'b-minor', x: 1, y: 0, importance: 0.1 };

describe('nearestHit', () => {
    it('picks the node nearer the pointer, whatever the list order', () => {
        for (const list of [[important, minor], [minor, important]]) {
            expect(nearestHit(list, 0.2, 0, 2)).toBe('a-important');
            expect(nearestHit(list, 0.8, 0, 2)).toBe('b-minor');
        }
    });

    it('selects nothing outside every radius', () => {
        expect(nearestHit([important, minor], 10, 10, 2)).toBeNull();
        expect(nearestHit([], 0, 0, 2)).toBeNull();
    });

    it('breaks an exact tie by importance, then id', () => {
        expect(nearestHit([minor, important], 0.5, 0, 2)).toBe('a-important');
        const twin: HitCandidate = { ...minor, id: 'a-twin' };
        expect(nearestHit([minor, twin], 1, 0, 2)).toBe('a-twin');
    });
});
