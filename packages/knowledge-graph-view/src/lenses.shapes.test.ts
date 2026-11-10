import { describe, expect, it } from 'vitest';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { kindShape } from './lenses';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as DEFAULT_LABELS } from './labels';
import {
    dominantType, FALLBACK_TYPE, KNOWN_NODE_KINDS, MARK_TYPE_ORDER, markTypeOf, NODE_SHAPES, SHAPE_OUTLINES, SHAPE_PATHS,
    TYPE_SHAPE, typeLegendKey, typesPresent, type MarkType,
} from './shapes';

const node = (kind: string, path = 'src/x.ts', extra: Partial<KNode> = {}): KNode => ({
    ref: `src:r::${path}` as KNode['ref'], kind, label: path, pack: 'code', importance: 0.5, origin: 'extracted', ...extra,
});

describe('markTypeOf (PRD 43 B1a rule 2)', () => {
    it('regression: every known node kind (memory NODE_KINDS + missing) has a type with a drawable shape', () => {
        for (const kind of KNOWN_NODE_KINDS) {
            const type = markTypeOf(node(kind));
            expect(MARK_TYPE_ORDER, kind).toContain(type);
            expect(SHAPE_PATHS[TYPE_SHAPE[type]], kind).toMatch(/^M/);
        }
    });

    it('regression: the code pack\'s file nodes are no longer one shape — the type follows what the file is', () => {
        expect(markTypeOf(node('file', 'src/orders.ts'))).toBe('source');
        expect(markTypeOf(node('file', 'src/orders.test.ts'))).toBe('test');
        expect(markTypeOf(node('file', 'docs/guide.md'))).toBe('doc');
        expect(markTypeOf(node('file', 'tsconfig.json'))).toBe('config');
        expect(markTypeOf(node('file', 'src/app.css'))).toBe('style');
        expect(markTypeOf(node('file', 'db/schema.sql'))).toBe('data');
        expect(markTypeOf(node('file', 'prisma/schema.prisma'))).toBe('data');
        expect(markTypeOf(node('file', 'api/migrations/0001_init.ts'))).toBe('data');
        expect(markTypeOf(node('file', 'assets/logo.png'))).toBe(FALLBACK_TYPE);
        const shapes = ['src/a.ts', 'src/a.test.ts', 'a.md', 'tsconfig.json', 'a.css', 'a.sql'].map((p) => kindShape(node('file', p)));
        expect(new Set(shapes).size).toBe(shapes.length);
    });

    it('reads symbols by symbolSort, and the knowledge kinds by kind', () => {
        expect(markTypeOf(node('symbol', 'a.ts#Widget', { label: 'Widget' }))).toBe('class');
        expect(markTypeOf(node('symbol', 'a.ts#run', { label: 'run' }))).toBe('function');
        expect(markTypeOf(node('symbol', 'a.ts#W.run', { label: 'Widget.run' }))).toBe('function');
        expect(markTypeOf(node('symbol', 'a.ts#X', { label: 'x', badges: { symbolKind: 'interface' } }))).toBe('class');
        expect(markTypeOf(node('section'))).toBe('section');
        expect(markTypeOf(node('entity'))).toBe('entity');
        expect(markTypeOf(node('claim'))).toBe('claim');
        expect(markTypeOf(node('fact'))).toBe('claim');
        expect(markTypeOf(node('missing'))).toBe('external');
    });

    it('gives an unknown kind the fallback type', () => {
        expect(markTypeOf(node('something-new'))).toBe(FALLBACK_TYPE);
    });

    it('draws the approved vocabulary', () => {
        expect(TYPE_SHAPE).toEqual({
            class: 'square', function: 'circle', source: 'roundedSquare', test: 'diamond', doc: 'tile', config: 'triangle',
            style: 'roundedTriangle', data: 'drum', section: 'bookmark', entity: 'pentagon', claim: 'smallStar',
            external: 'octagon', system: 'hexagon',
        });
        expect(new Set(Object.values(TYPE_SHAPE)).size).toBe(MARK_TYPE_ORDER.length);
    });
});

describe('aggregates', () => {
    it('takes the members\' dominant type, ties in legend order, empty ⇒ fallback', () => {
        expect(dominantType(['test', 'test', 'source'])).toBe('test');
        expect(dominantType(['data', 'class'])).toBe('class');
        expect(dominantType([])).toBe('source');
    });

    it('lists the types present in legend order', () => {
        expect(typesPresent(['doc', 'class', 'doc', 'external'] as MarkType[])).toEqual(['class', 'doc', 'external']);
    });
});

describe('SHAPE_PATHS / SHAPE_OUTLINES', () => {
    it('gives every shape a distinct unit-radius path drawn from its outline', () => {
        const paths = NODE_SHAPES.map((s) => SHAPE_PATHS[s]);
        for (const p of paths) expect(p).toMatch(/^M/);
        expect(new Set(paths).size).toBe(NODE_SHAPES.length);
        for (const s of NODE_SHAPES) {
            const r = Math.max(...SHAPE_OUTLINES[s].map(([x, y]) => Math.hypot(x, y)));
            expect(r, s).toBeGreaterThan(0.6);
            expect(r, s).toBeLessThan(1.4);
        }
    });

    it('names every type in the labels', () => {
        expect(DEFAULT_LABELS.legend.shapesTitle).toBeTruthy();
        for (const t of MARK_TYPE_ORDER) expect(DEFAULT_LABELS.legend[typeLegendKey(t)], t).toBeTruthy();
    });
});
