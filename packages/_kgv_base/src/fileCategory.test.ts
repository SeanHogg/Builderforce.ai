/** The file classifier reads a ref's path through memory's ref grammar. */
import { describe, expect, it } from 'vitest';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { fileCategory } from './fileCategory';

const of = (ref: string) => fileCategory({ ref: ref as KNode['ref'] });

describe('fileCategory', () => {
    it('classifies by path', () => {
        expect(of('src:r::p/a.ts')).toBe('source');
        expect(of('src:r::p/a.test.ts')).toBe('test');
        expect(of('src:r::docs/x.md')).toBe('doc');
        expect(of('src:r::tsconfig.json')).toBe('config');
        expect(of('src:r::dist/a.js')).toBe('other');
    });

    it('regression: a #section is not part of the path (the extension is read before it)', () => {
        expect(of('src:r::p/a.ts#run')).toBe('source');
        expect(of('src:r::README.md#install')).toBe('doc');
        expect(of('src:r::p/a.test.ts#case')).toBe('test');
    });

    it('regression: a root id ending in ":" still categorises the file', () => {
        expect(of('src:c:::p/a.ts')).toBe('source');
        expect(of('src:c:::p/styles/x.css#a')).toBe('style');
    });
});
