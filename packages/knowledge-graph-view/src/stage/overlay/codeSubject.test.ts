import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '../../types';
import { codeRefForStop, codeSubject, focusLine, targetForMark } from './CodeDock';

const records: SymbolRecord[] = [
    { ref: 'src:api.ts::get', name: 'get', kind: 'function', parent: 'src:api.ts', line: 12, exported: true },
    { ref: 'src:other.ts::main', name: 'main', kind: 'function', parent: 'src:other.ts', line: 4, exported: false },
];

describe('codeSubject', () => {
    it('resolves a station key to its first file and that file\'s source line, named with the station', () => {
        const subject = codeSubject('st:api', { name: 'API', refs: ['src:api.ts', 'src:other.ts'] });
        expect(subject).toEqual({ ref: 'src:api.ts', name: 'API' });
        expect(targetForMark(subject.ref, subject.name, records)?.startLine).toBe(12);
        // Selection wins over a journey stop.
        expect(focusLine(records, subject.ref, 'src:other.ts::main')).toBe(12);
    });

    it('a station with no files is named but has no source line', () => {
        expect(codeSubject('st:empty', { name: 'Empty', refs: [] })).toEqual({ ref: null, name: 'Empty' });
        expect(codeSubject('st:missing', null)).toEqual({ ref: null, name: '' });
    });

    it('a node key is the ref, and a journey stop still scrolls when there is no mark', () => {
        expect(codeSubject('node:src:api.ts::get', null)).toEqual({ ref: 'src:api.ts::get', name: '' });
        expect(focusLine(records, null, 'src:other.ts::main')).toBe(4);
    });

    it('a journey stop that is a station id scrolls to that station\'s first file', () => {
        const ref = codeRefForStop('api', { refs: ['src:api.ts', 'src:other.ts'] });
        expect(ref).toBe('src:api.ts');
        expect(targetForMark(ref, 'API', records)?.startLine).toBe(12);
        expect(focusLine(records, null, ref)).toBe(12);
        // Selection still wins over the step.
        expect(focusLine(records, 'src:other.ts::main', ref)).toBe(4);
        expect(codeRefForStop('src:other.ts::main', null)).toBe('src:other.ts::main');
        expect(codeRefForStop('empty', { refs: [] })).toBeNull();
        expect(codeRefForStop(null, null)).toBeNull();
    });
});
