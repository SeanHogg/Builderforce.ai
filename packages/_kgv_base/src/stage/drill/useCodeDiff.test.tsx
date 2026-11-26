import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SourceReader, SourceReaderAt, SourceText } from '../../types';
import { useCodeDiff, type CodeCompare } from './useCodeDiff';

const text = (lines: string[]): SourceText => ({ startLine: 1, lines, truncated: false });
const today = text(['a', 'new', 'b']);
const older = text(['a', 'gone', 'b']);

const readSource: SourceReader = vi.fn(async () => today);
const readAt: SourceReaderAt = vi.fn(async () => older);
const revs = { before: 'c'.repeat(40), after: null };
const compare = (side: CodeCompare['side'], over: Partial<CodeCompare['revs']> = {}): CodeCompare => ({ side, revs: { ...revs, ...over } });

describe('useCodeDiff', () => {
    it('is the plain pane when nothing is compared (a restructure passes no compare)', () => {
        const { result } = renderHook(() => useCodeDiff(undefined, readSource, readAt, 'a.ts'));
        expect(result.current.reader).toBe(readSource);
        expect(result.current.marks).toBeNull();
        expect(result.current.unavailable).toBe(false);
    });

    it('After reads today and marks the lines the earlier version lacks', async () => {
        const { result } = renderHook(() => useCodeDiff(compare('after'), readSource, readAt, 'a.ts'));
        expect(result.current.reader).toBe(readSource);
        act(() => result.current.onText(today));
        await waitFor(() => expect(result.current.marks).not.toBeNull());
        expect([...result.current.marks!.added]).toEqual([2]);
        expect(readAt).toHaveBeenCalledWith('a.ts', revs.before, expect.objectContaining({ startLine: 1 }));
        expect(result.current.unavailable).toBe(false);
    });

    it('Before reads the earlier revision through readSourceAt and marks what it has that today lacks', async () => {
        const { result } = renderHook(() => useCodeDiff(compare('before'), readSource, readAt, 'a.ts'));
        expect(result.current.reader).not.toBe(readSource);
        await result.current.reader!('a.ts', { startLine: 1, endLine: 10 });
        expect(readAt).toHaveBeenLastCalledWith('a.ts', revs.before, { startLine: 1, endLine: 10 });
        act(() => result.current.onText(older));
        await waitFor(() => expect(result.current.marks).not.toBeNull());
        expect([...result.current.marks!.removed]).toEqual([2]);
    });

    it('without readSourceAt, or without the revision, shows today\'s file and says the earlier one is not available', () => {
        const noReader = renderHook(() => useCodeDiff(compare('before'), readSource, undefined, 'a.ts'));
        expect(noReader.result.current.reader).toBe(readSource);
        expect(noReader.result.current.unavailable).toBe(true);
        expect(noReader.result.current.marks).toBeNull();

        const noRev = renderHook(() => useCodeDiff(compare('before', { before: null }), readSource, readAt, 'a.ts'));
        expect(noRev.result.current.reader).toBe(readSource);
        expect(noRev.result.current.unavailable).toBe(true);
    });

    it('a failed read of the other side marks nothing and says so', async () => {
        const failing: SourceReaderAt = async () => { throw new Error('refused'); };
        const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderHook(() => useCodeDiff(compare('after'), readSource, failing, 'a.ts'));
        act(() => result.current.onText(today));
        await waitFor(() => expect(result.current.unavailable).toBe(true));
        expect(result.current.marks).toBeNull();
        expect(reported).toHaveBeenCalledWith(expect.stringContaining('could not be read'), expect.objectContaining({ message: 'refused' }));
        reported.mockRestore();
    });

    it('a restructure reads today\'s file on both sides and marks the moved definitions\' lines removed, naming the modules', async () => {
        const moved = new Map([['src:r::a.ts#f@2', 'src:r::a.f.ts']]);
        const spans = [{ path: 'a.ts', from: 2, to: 3, module: 'src:r::a.f.ts' }];
        for (const side of ['before', 'after'] as const) {
            const { result } = renderHook(() => useCodeDiff({ side, revs: { before: null, after: null }, moved, spans }, readSource, readAt, 'a.ts'));
            expect(result.current.reader).toBe(readSource);
            act(() => result.current.onText(today));
            await waitFor(() => expect(result.current.marks).not.toBeNull());
            expect([...result.current.marks!.removed]).toEqual([2, 3]);
            expect(result.current.movedTo).toEqual(['a.f.ts']);
            expect(result.current.unavailable).toBe(false);
        }
    });

    it('a file the earlier version does not have (null) marks the whole file as added, not unavailable', async () => {
        const absent: SourceReaderAt = async () => null;
        const { result } = renderHook(() => useCodeDiff(compare('after'), readSource, absent, 'a.ts'));
        act(() => result.current.onText(today));
        await waitFor(() => expect(result.current.marks).not.toBeNull());
        expect([...result.current.marks!.added]).toEqual([1, 2, 3]);
        expect(result.current.unavailable).toBe(false);
    });
});
