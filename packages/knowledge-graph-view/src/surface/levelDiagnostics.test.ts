import { describe, expect, it } from 'vitest';
import type { LevelDescriptor } from '../stage/types';
import type { CodeFile } from './codeHierarchy';
import { levelDiagnosticLines, outlineTopOf } from './levelDiagnostics';

const file = (ref: string, system: string, isCode = true): CodeFile => ({
    ref, name: ref, path: `${system}/${ref}`, isCode, filesystem: [], architecture: isCode ? [{ id: `system:${system}`, name: system }] : [],
});
const files = new Map<string, CodeFile>([
    ['a1', file('a1', 'hired.video')], ['a2', file('a2', 'hired.video')], ['b1', file('b1', 'chrome-extension')], ['n1', file('n1', '.plans', false)],
]);
const child = (name: string): LevelDescriptor['children'][number] => ({ slot: 1, key: `dir:${name}`, name, kind: 'system', form: 'slab', w: 2.4, d: 1.6, h: 0.45, files: 1, minis: 3 });
const world = (...names: string[]): LevelDescriptor => ({
    level: 'world', ref: null, name: 'root', children: names.map(child), total: names.length, notOnMap: { stations: 1, files: 1, examples: ['.plans'] },
});
const input = (level: LevelDescriptor) => ({ camera: 'map', flat: false, level, stack: [], rootTitle: 'starter', files, stations: 4, classes: 0, methods: 0 });

describe('levelDiagnosticLines', () => {
    it('the outline and the map name the same two systems', () => {
        const lines = levelDiagnosticLines(input(world('hired.video', 'chrome-extension')));
        expect(outlineTopOf(files)).toEqual(['hired.video', 'chrome-extension']);
        expect(lines.find((l) => l.startsWith('outline vs map'))).toMatch(/· match$/);
        expect(lines[0]).toContain('drawn=2/2');
        expect(lines.find((l) => l.startsWith('not on the map'))).toContain('.plans');
    });

    it('a map that draws a non-code station reports the mismatch', () => {
        const lines = levelDiagnosticLines(input(world('hired.video', '.plans')));
        expect(lines.find((l) => l.startsWith('outline vs map'))).toContain('MISMATCH');
    });
});
