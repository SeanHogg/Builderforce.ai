import { describe, expect, it } from 'vitest';
import { MARK_TYPE_ORDER } from '../../shapes';
import { legendTypesOf } from './stageLegend';

describe('legendTypesOf', () => {
    it('lists each MarkSet type index once, in legend order, and skips an unknown index', () => {
        const type = new Uint8Array([
            MARK_TYPE_ORDER.indexOf('function'),
            MARK_TYPE_ORDER.indexOf('class'),
            MARK_TYPE_ORDER.indexOf('function'),
            99,
        ]);
        expect(legendTypesOf(type)).toEqual(['class', 'function']);
        expect(legendTypesOf(undefined)).toEqual([]);
        expect(legendTypesOf(new Uint8Array())).toEqual([]);
    });
});
