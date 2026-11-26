/** The surface's half of the copied diagnostics: map source, data coverage, lines, scope, sync, findings. */
import { describe, expect, it } from 'vitest';
import { graphDiagnosticsText, type GraphDiagnosticsInput } from './graphDiagnostics';
import { buildLines } from './surface/lines';
import { dataCoverage } from './surface/dataCoverage';
import { outlineFixture, truncatedFixture } from './surface/outlineFixture';
import { buildStations } from './surface/stations';
import type { SurfaceDiagnosticsInput } from './surfaceDiagnostics';
import type { SyncStatus } from './types';

const surfaceOf = (graph: ReturnType<typeof truncatedFixture>, over: Partial<SurfaceDiagnosticsInput> = {}): SurfaceDiagnosticsInput => {
    const stations = buildStations(graph);
    return {
        graph, stations, lines: buildLines(graph, stations), coverage: dataCoverage(graph), scopeName: null, scope: null,
        lensFindings: 0, listedFindings: 0, queue: { open: 0, shown: 0, repo: 0 }, sync: null, ...over,
    };
};
const out = (graph: ReturnType<typeof truncatedFixture>, over: Partial<SurfaceDiagnosticsInput> = {}) => {
    const i: GraphDiagnosticsInput = {
        status: 'ready', rootId: 'sys', graph, drawn: { nodes: 1, edges: 0 }, showAll: false, webgl: false, reducedMotion: true, mode: 'system',
        width: 800, compact: false, lens: 'structure', review: { status: 'idle' }, time: 't', surface: surfaceOf(graph, over),
    };
    return graphDiagnosticsText(i).split('\n');
};

describe('surface diagnostics', () => {
    it('says the map is the cut graph when the server sent no outline, and why every channel is empty', () => {
        const lines = out(truncatedFixture(false));
        expect(lines).toContain('map source: cut graph — the server sent no outline (server older than the outline release); the map shows 1 of 5 files');
        expect(lines).toContain('  complexity: 0/1 files — no outline: the server sent only the cut graph');
        expect(lines).toContain('  coverage: 0/1 files — no outline: the server sent only the cut graph');
        expect(lines).toContain('lines note: 1 line because 1 entry point found (in the cut graph\'s files only)');
    });

    it('reports the outline, per-channel counts and the tier split', () => {
        const lines = out(truncatedFixture(true));
        expect(lines).toContain(`map source: outline (files=5, stations=${buildStations(truncatedFixture(true)).stations.length}, capped=no)`);
        expect(lines).toContain('  complexity: 1/5 files');
        expect(lines.find((l) => l.startsWith('  churn:'))).toContain('not collected');
        expect(lines).toContain('partitions: files without a placement=0/5 (0%) · placed by community=0');
        expect(lines.find((l) => l.startsWith('communities:'))).toBeUndefined();
        expect(lines.find((l) => l.startsWith('stations by tier:'))).toBeTruthy();
        expect(lines.find((l) => l.startsWith('lines: drawn='))).toContain('entry points found=2');
    });

    it('prints the community modularity Q and its method from the graph stats (PRD 38 P1)', () => {
        const g = truncatedFixture(true);
        const lines = out({ ...g, stats: { ...g.stats, modularity: 0.412345, communityMethod: 'louvain' } });
        expect(lines).toContain('communities: modularity Q=0.412345 (louvain)');
    });

    it('explains "0 here" as a server-only review and keeps the existing lines', () => {
        const sync: SyncStatus = { local: { files: 0, docs: 0 }, server: { files: 2945, docs: 0 }, sources: [] };
        const lines = out(truncatedFixture(false), { sync });
        expect(lines).toContain('sync: local=0 server=2945 files');
        expect(lines.find((l) => l.startsWith('sync meaning:'))).toContain('no local snapshot');
        expect(lines).toContain('status: ready');
        expect(lines.at(-1)).toBe('time: t');
    });

    it('lays the three findings counts side by side and explains why they differ', () => {
        const lines = out(truncatedFixture(true), { lensFindings: 4, listedFindings: 0, queue: { open: 0, shown: 0, repo: 13 }, scopeName: 'web line' });
        expect(lines.find((l) => l.startsWith('findings:'))).toBe('findings: in the graph=0 · in this lens=4 · listed (lens and scope)=0 · fix queue=0 open of 0 shown · 13 in the repo');
        expect(lines.find((l) => l.startsWith('scope: web line'))).toContain('nodes in scope=1');
        expect(lines.find((l) => l.startsWith('findings note:'))).toBeUndefined();
    });

    it('carries the digest and a missing review time as unknown', () => {
        const lines = out(truncatedFixture(true));
        expect(lines).toContain('graph digest: d');
        expect(lines.find((l) => l.startsWith('reviewedAt:'))).toContain('unknown');
        expect(outlineFixture().files.length).toBe(5);
    });
});
