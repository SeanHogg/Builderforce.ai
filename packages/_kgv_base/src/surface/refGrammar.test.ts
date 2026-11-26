/** The view reads refs through memory's grammar (refs.ts), never a drifted copy of its own. */
import { describe, expect, it } from 'vitest';
import { fileRefOf as memoryFileRefOf, pathOfRef, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../graphModel';
import { fileRefOf, stationOfRef } from './stations';
import { staticReach } from './staticReach';

describe('ref grammar is memory\'s', () => {
    it('regression: a fact: ref containing # is its own file ref (only a src: ref is cut, after its ::)', () => {
        expect(fileRefOf('fact:claim:a#b')).toBe('fact:claim:a#b');
        expect(fileRefOf('ent:code:x#y')).toBe('ent:code:x#y');
        expect(fileRefOf('src:r::p/a.ts#sec')).toBe('src:r::p/a.ts');
        // A `#` in the root id (before `::`) is not a section anchor.
        expect(fileRefOf('src:r#1::p/a.ts')).toBe(memoryFileRefOf('src:r#1::p/a.ts'));
        expect(fileRefOf('src:r#1::p/a.ts')).toBe('src:r#1::p/a.ts');
    });

    it('regression: a fact: ref with # never lands in the station of the ref before its #', () => {
        const model = { stationOf: new Map([['fact:claim:a', 'folder:p']]) };
        expect(stationOfRef(model, 'fact:claim:a#b')).toBeUndefined();
    });

    it('pathOf is memory\'s pathOfRef', () => {
        expect(pathOf).toBe(pathOfRef);
        expect(pathOf('fact:x#y')).toBeUndefined();
        expect(pathOf('src:r::p/a.ts#sec')).toBe('p/a.ts');
    });

    it('regression: static reach follows a section edge to its file, and keeps a fact: ref whole at its #', () => {
        const graph = {
            nodes: [
                { ref: 'src:r::p/a.test.ts', kind: 'file', label: 'a.test.ts', importance: 1 },
                { ref: 'src:r::p/b.ts', kind: 'file', label: 'b.ts', importance: 1 },
                { ref: 'src:r::p/b.ts#run', kind: 'section', label: 'run', importance: 1 },
            ],
            edges: [
                { from: 'src:r::p/a.test.ts', to: 'src:r::p/b.ts#run', kind: 'references', weight: 1, origin: 'extracted' },
                { from: 'src:r::p/a.test.ts', to: 'fact:claim:x#y', kind: 'references', weight: 1, origin: 'extracted' },
            ],
        } as unknown as KnowledgeGraph;
        const reach = staticReach(graph);
        expect(reach?.reached.has('src:r::p/b.ts')).toBe(true);
        expect(reach?.reached.has('fact:claim:x#y')).toBe(true);
        expect(reach?.reached.has('fact:claim:x')).toBe(false);
    });
});
