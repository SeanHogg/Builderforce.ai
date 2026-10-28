import { describe, expect, it, vi } from 'vitest';
import { canDeleteFact, factRightsCache, type FactsListing } from './factRights.js';

const member = { userId: '7', canAdmin: false };
const admin = { userId: '1', canAdmin: true };

describe('canDeleteFact — the delete route rule', () => {
    it('lets an admin delete any fact, even one this root does not list', () => {
        expect(canDeleteFact(admin, { createdBy: '9' })).toBe(true);
        expect(canDeleteFact(admin, undefined)).toBe(true);
    });

    it('lets the author delete their fact, whatever type the id arrives as', () => {
        expect(canDeleteFact(member, { createdBy: '7' })).toBe(true);
        expect(canDeleteFact(member, { createdBy: 7 })).toBe(true);
        expect(canDeleteFact(member, { createdBy: '8' })).toBe(false);
    });

    it('lets anyone delete an authorless fact, and no one a fact it does not know', () => {
        expect(canDeleteFact(member, { createdBy: null })).toBe(true);
        expect(canDeleteFact(member, {})).toBe(true);
        expect(canDeleteFact(member, undefined)).toBe(false);
        expect(canDeleteFact({ userId: null, canAdmin: false }, { createdBy: '7' })).toBe(false);
    });
});

describe('factRightsCache', () => {
    const listing: FactsListing = { viewer: member, facts: [{ key: 'mine', createdBy: '7' }, { key: 'theirs', createdBy: '8' }] };

    it('reads the facts ONCE per graph version, however many nodes are clicked', async () => {
        const load = vi.fn(async () => listing);
        const rights = factRightsCache(load);
        rights.loaded('r', 'd1');
        expect(await rights.canDelete('r', 'mine')).toBe(true);
        expect(await rights.canDelete('r', 'theirs')).toBe(false);
        expect(await rights.canDelete('r', 'unknown')).toBe(false);
        expect(load).toHaveBeenCalledTimes(1);
        rights.loaded('r', 'd1');
        await rights.canDelete('r', 'mine');
        expect(load).toHaveBeenCalledTimes(1);
        rights.loaded('r', 'd2');
        await rights.canDelete('r', 'mine');
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('re-reads after an invalidation, and does not cache a failed read', async () => {
        const load = vi.fn<(rootId: string) => Promise<FactsListing | null>>()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(listing);
        const rights = factRightsCache(load);
        await expect(rights.canDelete('r', 'mine')).rejects.toThrow('offline');
        expect(await rights.canDelete('r', 'mine')).toBe(true);
        rights.invalidate('r');
        await rights.canDelete('r', 'mine');
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('offers nothing for an unknown root', async () => {
        const rights = factRightsCache(async () => null);
        expect(await rights.canDelete('r', 'mine')).toBe(false);
    });
});
