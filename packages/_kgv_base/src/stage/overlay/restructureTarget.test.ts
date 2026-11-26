import { describe, expect, it } from 'vitest';
import { restructureOf, restructureTargetOf } from './restructureTarget';

const facts = { antiPatternOf: (ref: string) => (ref === 'f#god' ? { kind: 'god-module', name: 'God', findingId: 'x', restructurable: true } : ref === 'f#warn' ? { kind: 'other', name: 'Other', findingId: 'y', restructurable: false } : null) };

describe('restructureTarget', () => {
    it('picks the first restructurable ref and ignores a plain warning', () => {
        expect(restructureTargetOf(facts as never, ['f#warn', 'f#god'])).toBe('f#god');
        expect(restructureTargetOf(facts as never, ['f#warn', 'g'])).toBeUndefined();
    });

    it('is ready for a god-module whose symbols are not loaded (a click loads them), and disabled only while loading', () => {
        expect(restructureOf(facts as never, ['f#god'], false)).toEqual({ ref: 'f#god', ready: true });
        expect(restructureOf(facts as never, ['f#god'], true)).toEqual({ ref: 'f#god', ready: false });
    });
});
