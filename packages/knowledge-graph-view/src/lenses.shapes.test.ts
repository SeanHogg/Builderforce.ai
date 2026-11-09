import { describe, expect, it } from 'vitest';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { kindShape, type NodeShape } from './lenses';
import { SHAPE_PATHS } from './shapes';

const node = (kind: string): KNode => ({
    ref: 'src:r::x' as KNode['ref'], kind, label: 'x', pack: 'code', importance: 0.5, origin: 'extracted',
});

describe('kindShape', () => {
    it('maps the base kinds to their silhouettes', () => {
        expect(kindShape(node('file'))).toBe('circle');
        expect(kindShape(node('section'))).toBe('square');
        expect(kindShape(node('symbol'))).toBe('diamond');
        expect(kindShape(node('entity'))).toBe('hexagon');
        expect(kindShape(node('claim'))).toBe('triangle');
        expect(kindShape(node('fact'))).toBe('octagon');
        expect(kindShape(node('missing'))).toBe('star');
        expect(kindShape(node('area'))).toBe('pentagon');
    });

    it('gives finer code-symbol kinds their own silhouettes instead of collapsing to the dot', () => {
        // These are the class/method/etc shapes the Map, 3D and 2D views must reflect.
        expect(kindShape(node('class'))).toBe('hexagon');
        expect(kindShape(node('method'))).toBe('triangle');
        expect(kindShape(node('function'))).toBe('triangle');
        expect(kindShape(node('interface'))).toBe('square');
        expect(kindShape(node('enum'))).toBe('octagon');
        // And they must differ from one another: no two of these share a silhouette with the base set.
        const shapes = ['class', 'method', 'function', 'interface', 'enum'].map((k) => kindShape(node(k)));
        expect(new Set(shapes).size).toBeGreaterThan(1);
    });

    it('keeps the neutral circle default for a kind it has no silhouette for', () => {
        expect(kindShape(node('something-new'))).toBe('circle');
    });
});

describe('SHAPE_PATHS', () => {
    it('has unit-radius path data for every NodeShape the table can return', () => {
        const shapes: NodeShape[] = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'octagon', 'pentagon', 'star'];
        for (const shape of shapes) expect(SHAPE_PATHS[shape]).toMatch(/^M/);
    });
});
