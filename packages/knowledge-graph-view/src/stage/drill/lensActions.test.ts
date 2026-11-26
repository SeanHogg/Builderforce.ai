import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SymbolFacts } from '../../surface/symbolFacts';
import type { Lens } from './codeText';
import { LENS_ACTIONS, visibleLensActions, type LensActionId, type LensCtx } from './lensActions';

const t = L.surface.code;
const CLASS: Lens = { ref: 'src:sys::order.ts#Order', kind: 'class', count: 4 };
const METHOD: Lens = { ref: 'src:sys::order.ts#place', kind: 'method', count: 1 };

const facts = (over: Partial<{ untested: string[]; anti: Record<string, string> }> = {}): SymbolFacts => ({
    untested: (ref) => (over.untested ?? []).includes(ref),
    antiPatternOf: (ref) => (over.anti?.[ref] ? { kind: over.anti[ref]!, findingId: `f:${ref}` } : null),
});
const ctx = (f: SymbolFacts, handled: LensActionId[] = [], inside: string | null = null): LensCtx => ({ facts: f, inside, has: (id) => handled.includes(id) || ['references', 'show', 'callers', 'drill'].includes(id) });
const ids = (lens: Lens, c: LensCtx | null) => visibleLensActions(lens, c).map((r) => r.id);

describe('the lens actions table', () => {
    it('the old four are rows: a class shows references and show, a method callers and drill, with no context at all', () => {
        expect(ids(CLASS, null)).toEqual(['references', 'show']);
        expect(ids(METHOD, null)).toEqual(['callers', 'drill']);
        expect(LENS_ACTIONS.map((r) => r.id)).toEqual(['references', 'show', 'callers', 'drill', 'out', 'simulate', 'restructure']);
    });

    it('labels come from the label keys, filled', () => {
        const row = (id: LensActionId) => LENS_ACTIONS.find((r) => r.id === id)!;
        expect(row('references').label(t, CLASS, null)).toBe(fillTemplate(t.lensReferences, { count: 4 }));
        expect(row('callers').label(t, METHOD, null)).toBe(fillTemplate(t.lensCaller, { count: 1 }));
        expect(row('callers').label(t, { ...METHOD, count: 3 }, null)).toBe(fillTemplate(t.lensCallers, { count: 3 }));
        expect(row('drill').label(t, METHOD, null)).toBe(t.drillIn);
    });

    it('out shows only on the symbol whose level you are inside, and only with a handler', () => {
        const f = facts();
        expect(ids(METHOD, ctx(f, ['out'], METHOD.ref))).toContain('out');
        expect(ids(METHOD, ctx(f, ['out'], CLASS.ref))).not.toContain('out');
        expect(ids(METHOD, ctx(f, [], METHOD.ref))).not.toContain('out');
    });

    it('simulate shows for an untested symbol with a handler, labelled "No test · Simulate"', () => {
        const f = facts({ untested: [METHOD.ref] });
        const rows = visibleLensActions(METHOD, ctx(f, ['simulate']));
        expect(rows.map((r) => r.id)).toContain('simulate');
        expect(rows.find((r) => r.id === 'simulate')!.label(t, METHOD, null)).toBe('No test · Simulate');
        expect(ids(METHOD, ctx(f, []))).not.toContain('simulate');
        expect(ids(CLASS, ctx(f, ['simulate']))).not.toContain('simulate');
    });

    it('restructure carries the anti-pattern name, shows on a class or a method, and hides without a handler', () => {
        const f = facts({ anti: { [CLASS.ref]: 'god-module' } });
        const rows = visibleLensActions(CLASS, ctx(f, ['restructure']));
        expect(rows.find((r) => r.id === 'restructure')!.label(t, CLASS, ctx(f, ['restructure']))).toBe('god-module');
        expect(ids(CLASS, ctx(f, []))).not.toContain('restructure');
        expect(ids(METHOD, ctx(f, ['restructure']))).not.toContain('restructure');
    });

    it('keeps the display order with every new row on', () => {
        const f = facts({ untested: [METHOD.ref], anti: { [METHOD.ref]: 'partition-violation' } });
        expect(ids(METHOD, ctx(f, ['out', 'simulate', 'restructure'], METHOD.ref))).toEqual(['callers', 'drill', 'out', 'simulate', 'restructure']);
    });
});
