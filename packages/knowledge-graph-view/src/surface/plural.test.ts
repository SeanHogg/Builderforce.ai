/** `counted()`: the ONE way count text is pluralised, and every pair in the defaults is a real singular/plural. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, resolveLabels } from '../labels';
import { counted, isOne, type CountedWord } from './plural';

describe('counted', () => {
    it('picks the singular for exactly 1 and the plural otherwise (0 is plural)', () => {
        expect(counted(L, 'station', 1)).toBe('1 station');
        expect(counted(L, 'station', 3)).toBe('3 stations');
        expect(counted(L, 'station', 0)).toBe('0 stations');
        expect(isOne(1)).toBe(true);
        expect(isOne(2)).toBe(false);
    });

    it('fills the sentence\'s own params, and a given count overrides the shown number', () => {
        expect(counted(L, 'issueAt', 1, { scope: 'Web app' })).toBe('At Web app · 1 issue');
        expect(counted(L, 'issueAt', 3, { scope: 'Web app' })).toBe('At Web app · 3 issues');
        expect(counted(L, 'fileBoth', 15994, { count: '15,994' })).toBe('15,994 files here and on the server');
    });

    it('has a One and an Other row for every word, and the English pair differs (the plural is not the singular repeated)', () => {
        const c = L.surface.counts;
        const words = Object.keys(c).filter((k) => k.endsWith('One')).map((k) => k.slice(0, -3) as CountedWord);
        expect(words.length).toBeGreaterThan(10);
        for (const w of words) {
            expect(typeof c[`${w}Other`], w).toBe('string');
            expect(c[`${w}One`], w).not.toBe(c[`${w}Other`]);
        }
    });

    it('survives a host label set that lacks a row (reads empty, never throws)', () => {
        const partial = resolveLabels({ surface: { ...L.surface, counts: {} as typeof L.surface.counts } });
        expect(() => counted(partial, 'station', 2)).not.toThrow();
    });
});
