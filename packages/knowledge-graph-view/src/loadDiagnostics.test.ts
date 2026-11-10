import { describe, expect, it } from 'vitest';
import { loadDiagnosticSection } from './loadDiagnostics';
import type { LoadTimelineSnapshot } from './loadTimeline';
import type { LoadTrace } from './loadTraceTypes';

const painted: LoadTimelineSnapshot = {
    nowMs: 3_000,
    marks: [
        { call: 'lastSeen', startMs: 2, endMs: 40, outcome: 'ok', nodes: 900, edges: 2000 },
        { call: 'scopes', startMs: 2, endMs: 300, outcome: 'ok', count: 2 },
        { call: 'load', rootId: 'r', startMs: 300, endMs: 2_500, outcome: 'ok', nodes: 900, edges: 2001 },
    ],
    firstPaint: { ms: 45, from: 'lastSeen' },
    freshMs: 2_510,
};

const host: LoadTrace = {
    now: 50_000,
    entries: [{
        op: 'load', rootId: 'r', startedAt: 1, durationMs: 2_150, outcome: 'ok', via: 'local', focus: false,
        phases: [{ phase: 'partitions', ms: 20 }, { phase: 'index', ms: 5 }, { phase: 'nearDuplicates', ms: 900 }, { phase: 'build', ms: 1_200 }],
        nodes: 900, edges: 2001, sources: 400, nearDuplicates: 12, hostLag: { maxMs: 850, p99Ms: 700, meanMs: 3 },
    }],
    inFlight: [],
};

describe('loadDiagnosticSection', () => {
    it('lists the view timeline then the host calls with their phases', () => {
        const s = loadDiagnosticSection({ timeline: painted, host });
        expect(s.id).toBe('load');
        expect(s.attention).toBe(false);
        expect(s.lines).toEqual([
            'first paint: 45ms from lastSeen',
            'fresh graph: 2510ms',
            'view lastSeen: +2ms · 38ms · ok · nodes=900 edges=2000',
            'view scopes: +2ms · 298ms · ok · count=2',
            'view load: +300ms · root=r · 2200ms · ok · nodes=900 edges=2001',
            'host load: root=r · 2150ms · ok · via=local · partitions=20ms index=5ms nearDuplicates=900ms build=1200ms · nodes=900 edges=2001 sources=400 · nearDuplicates=12 · focus=no · lag max=850ms p99=700ms',
        ]);
    });

    it('flags a load stuck in a phase, and says how long it has been there', () => {
        const stuck: LoadTrace = {
            now: 200_000, entries: [],
            inFlight: [{ op: 'load', rootId: 'r', startedAt: 20_000, phases: [{ phase: 'build', startedAt: 25_000 }], hostLag: { maxMs: 90_000, p99Ms: 60_000, meanMs: 400 } }],
        };
        const timeline: LoadTimelineSnapshot = { nowMs: 180_000, marks: [{ call: 'load', rootId: 'r', startMs: 300 }] };
        const s = loadDiagnosticSection({ timeline, host: stuck });
        expect(s.attention).toBe(true);
        expect(s.lines).toEqual([
            'first paint: not yet (180000ms since open)',
            'fresh graph: not yet',
            'view load: +300ms · root=r · running 179700ms',
            'host running: load · root=r · 180000ms · in build for 175000ms · lag max=90000ms p99=60000ms',
        ]);
    });

    it('flags a slow first paint, and says when the host reports no trace or it is not read yet', () => {
        const slow = { ...painted, firstPaint: { ms: 12_000, from: 'fresh' as const } };
        expect(loadDiagnosticSection({ timeline: slow }).attention).toBe(true);
        expect(loadDiagnosticSection({ timeline: painted }).lines).toContain('host trace: not reported by this host');
        expect(loadDiagnosticSection({ timeline: painted, host: null }).lines).toContain('host trace: not read yet');
    });
});
