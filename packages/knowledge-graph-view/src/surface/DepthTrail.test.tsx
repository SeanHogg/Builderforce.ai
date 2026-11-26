// @vitest-environment jsdom
/** The depth trail's crumbs (system › module › class › method) and the plain-words walkthrough sentence of a journey step. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { depthCrumbs, type DepthFrame } from './DepthTrail';
import type { PathModel } from './path';
import { walkthroughSentence } from './walkthrough';

const stack: DepthFrame[] = [
    { level: 'package', name: 'Billing' },
    { level: 'class', name: 'Invoice' },
    { level: 'function', name: 'charge' },
];

const journey: PathModel = {
    stops: [{ id: 'a', name: 'Login' }, { id: 'b', name: 'Accounts' }],
    hops: [{ kind: 'references', count: 2 }],
};

describe('depthCrumbs', () => {
    it('reads the drill stack as system › module › class › method', () => {
        const crumbs = depthCrumbs(stack, 'App', L.surface.depth);
        expect(crumbs.map((c) => c.level)).toEqual(['system', 'module', 'class', 'method']);
        expect(crumbs.map((c) => c.name)).toEqual(['App', 'Billing', 'Invoice', 'charge']);
        expect(crumbs.map((c) => c.depth)).toEqual([0, 1, 2, 3]);
    });

    it('uses the System word when the root has no name', () => {
        expect(depthCrumbs([], '  ', L.surface.depth)[0]).toEqual({ depth: 0, level: 'system', name: 'System' });
    });
});

describe('the walkthrough sentence', () => {
    it('narrates the current step of a journey', () => {
        expect(walkthroughSentence(journey, 1, L.surface.walk)).toBe('Walk the hallway from Login to Accounts (2 calls). Leave through the door Accounts.');
    });
});
