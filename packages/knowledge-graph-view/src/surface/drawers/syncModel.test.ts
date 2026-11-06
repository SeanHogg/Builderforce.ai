import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../../types';
import { parityNote, syncGap } from './syncModel';

const base: SyncStatus = { local: { files: 10, docs: 0 }, sources: [] };

describe('syncGap', () => {
    it('takes the missing count and the too-large part from ONE reading', () => {
        const gap = syncGap({ ...base, skipped: [{ path: 'a', reason: 'too-large' }, { path: 'b', reason: 'binary' }, { path: 'c', reason: 'too-large' }] });
        expect(gap).toEqual({ missing: 3, tooLarge: 2 });
        expect(gap.tooLarge).toBeLessThanOrEqual(gap.missing);
    });
    it('falls back to the count gap, with nothing called too large', () => {
        expect(syncGap({ ...base, server: { files: 7, docs: 0 } })).toEqual({ missing: 3, tooLarge: 0 });
    });
    it('does not count excluded folders as missing files', () => {
        expect(syncGap({ ...base, server: { files: 10, docs: 0 }, skipped: [{ path: 'v', reason: 'nested-checkout' }] })).toEqual({ missing: 0, tooLarge: 0 });
    });
    it('is empty without a status', () => {
        expect(syncGap(null)).toEqual({ missing: 0, tooLarge: 0 });
    });
});

describe('parityNote', () => {
    it('says the server has all of it, or how many are not there yet, or nothing when unread', () => {
        expect(parityNote(10, 10)).toEqual({ kind: 'all' });
        expect(parityNote(10, 7)).toEqual({ kind: 'missing', count: 3 });
        expect(parityNote(10, undefined)).toBeNull();
        expect(parityNote(undefined, 3)).toBeNull();
    });
});
