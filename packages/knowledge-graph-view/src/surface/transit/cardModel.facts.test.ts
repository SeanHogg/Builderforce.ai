import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { SymbolFacts, TestReach } from '../symbolFacts';
import { selectionFacts } from './cardModel';

const REACH: Record<string, TestReach> = { a: 'none', b: 'reached', c: 'reached', u: 'unknown' };
const facts: SymbolFacts = {
    antiPatternOf: (ref) => (ref === 'b' ? { kind: 'god-module', findingId: 'f1', restructurable: true } : ref === 'cy' ? { kind: 'cycle', findingId: 'f2', restructurable: false } : null),
    testReach: (ref) => REACH[ref] ?? 'unknown',
    untested: (ref) => REACH[ref] === 'none',
};

describe('selectionFacts', () => {
    it('is null with no facts or no refs', () => {
        expect(selectionFacts(undefined, ['a'], L)).toBeNull();
        expect(selectionFacts(facts, [], L)).toBeNull();
    });

    it('names the anti-pattern and says no test reaches it when any ref is untested', () => {
        const f = selectionFacts(facts, ['a', 'b'], L)!;
        expect(f.tests).toBe('none');
        expect(f.antiPattern).toEqual({ kind: 'god-module', findingId: 'f1', restructurable: true, name: L.findingKinds.godModule });
    });

    it('reads reached and no anti-pattern for a clean, tested selection', () => {
        expect(selectionFacts(facts, ['c'], L)).toEqual({ tests: 'reached', antiPattern: null });
    });

    it('reads unknown (null), never "reached", when no ref has a coverage reading', () => {
        expect(selectionFacts(facts, ['u'], L)!.tests).toBeNull();
        expect(selectionFacts(facts, ['u', 'nowhere'], L)!.tests).toBeNull();
        expect(selectionFacts(facts, ['u', 'c'], L)!.tests).toBe('reached');
    });

    it('a multi-file selection finds the offender on any ref; a restructurable one outranks one that is not', () => {
        expect(selectionFacts(facts, ['c', 'cy'], L)!.antiPattern).toMatchObject({ kind: 'cycle', restructurable: false });
        expect(selectionFacts(facts, ['cy', 'b'], L)!.antiPattern).toMatchObject({ kind: 'god-module', restructurable: true });
    });
});
