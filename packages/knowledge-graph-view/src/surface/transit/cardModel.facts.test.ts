import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { selectionFacts } from './cardModel';

const facts = {
    antiPatternOf: (ref: string) => (ref === 'b' ? { kind: 'god-module', findingId: 'f1' } : null),
    untested: (ref: string) => ref === 'a',
};

describe('selectionFacts', () => {
    it('is null with no facts or no refs', () => {
        expect(selectionFacts(undefined, ['a'], L)).toBeNull();
        expect(selectionFacts(facts, [], L)).toBeNull();
    });

    it('names the first anti-pattern and says no test reaches it when any ref is untested', () => {
        const f = selectionFacts(facts, ['a', 'b'], L)!;
        expect(f.tests).toBe('none');
        expect(f.antiPattern).toEqual({ kind: 'god-module', findingId: 'f1', name: L.findingKinds.godModule });
    });

    it('reads reached and no anti-pattern for a clean, tested selection', () => {
        expect(selectionFacts(facts, ['c'], L)).toEqual({ tests: 'reached', antiPattern: null });
    });
});
