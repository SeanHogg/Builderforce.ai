import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { ReplicaState } from '../../types';
import { syncPill } from '../syncPill';
import { packBytes, replicaPackText, replicaPartsText } from './replicaPack';
import { replicaPhase } from './replicaState';

const base: ReplicaState = { dirty: 0, sending: false, failed: [] };

describe('the replica row reads the pack (PRD 41 A11 rule 6)', () => {
    it('names the last pack: compressed size, percent of the JSON size and files', () => {
        const text = replicaPackText(L, { ...base, lastPack: { bytes: 2_621_440, jsonBytes: 52_428_800, percent: 5, parts: 1, files: 20_000, mode: 'full' } });
        expect(text).toContain('2.5 MB');
        expect(text).toContain('5%');
        expect(text).toContain('20,000');
        expect(replicaPackText(L, base)).toBeNull();
    });

    it('names the parts sent and left only for a multi-part pack', () => {
        expect(replicaPartsText(L, { ...base, parts: { sent: 1, total: 4 } })).toBe('Sending part 2 of 4 (2 left).');
        expect(replicaPartsText(L, { ...base, parts: { sent: 0, total: 1 } })).toBeNull();
        expect(replicaPartsText(L, base)).toBeNull();
    });

    it('sizes read in B, KB and MB', () => {
        expect(packBytes(L, 312)).toMatch(/312 B/);
        expect(packBytes(L, 2048)).toMatch(/2 KB/);
        expect(packBytes({ ...L, surface: { ...L.surface, sync: { ...L.surface.sync, replicaUnitKB: '{value} Ko' } } }, 2048)).toMatch(/2 Ko/);
    });

    it('the phase counts dirty keys, and the pill shows the parts while a pack goes', () => {
        expect(replicaPhase({ ...base, dirty: 3 })).toEqual({ kind: 'queued' });
        const sync = { local: { files: 5 }, server: { files: 5 }, replica: { ...base, dirty: 2, sending: true, parts: { sent: 0, total: 3 } } } as never;
        const pill = syncPill({ labels: L, review: { status: 'idle' } as never, stale: false, refreshFailed: false, sync });
        expect(pill).toEqual({ kind: 'uploading', state: 'syncing', text: 'Sending part 1 of 3 (2 left).', tab: 'server' });
    });
});
