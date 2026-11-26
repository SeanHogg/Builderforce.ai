import { describe, expect, it } from 'vitest';
import { graphDiagnostics, graphDiagnosticsText, truncationReasons, type GraphDiagnosticsInput } from './graphDiagnostics';
import { splitLine } from './diagnosticSection';
import { codeFixture, FIXTURE_REPORT } from './testing';
import type { ReviewState } from './useReviewRun';

const g = codeFixture();
const base = (extra: Partial<GraphDiagnosticsInput> = {}): GraphDiagnosticsInput => ({
    status: 'ready', rootId: 'code', graph: g, drawn: { nodes: g.nodes.length, edges: g.edges.length }, showAll: false,
    webgl: false, reducedMotion: true, mode: 'graph', width: 800.4, compact: false, lens: 'structure',
    review: { status: 'idle' }, time: '2026-11-03T00:00:00.000Z', ...extra,
});
const lines = (i: GraphDiagnosticsInput) => graphDiagnosticsText(i).split('\n');

describe('graphDiagnosticsText', () => {
    it('reports status, root, packs, stats, view, container, lens and time', () => {
        const out = lines(base());
        expect(out[0]).toBe('Knowledge graph diagnostics');
        expect(out).toContain('status: ready');
        expect(out).toContain('root: code');
        expect(out).toContain('packs: code');
        expect(out).toContain('stats: nodes=6 edges=7 sources=6');
        expect(out).toContain('webgl: no · reduced-motion: yes · view: graph');
        expect(out).toContain('container: width=800 compact=no');
        expect(out).toContain('lens: structure');
        expect(out).toContain('review: idle');
        expect(out.at(-1)).toBe('time: 2026-11-03T00:00:00.000Z');
    });

    it('keeps no-WebGL and reduced motion apart', () => {
        expect(lines(base({ webgl: true, reducedMotion: false, mode: '3d' }))).toContain('webgl: yes · reduced-motion: no · view: 3d');
    });

    it('counts kinds, origins and findings as sorted k=v pairs, and lists the partitions', () => {
        const out = lines(base());
        expect(out).toContain('nodes by kind: file=6');
        expect(out).toContain('edges by kind: duplicate=1, references=6');
        expect(out).toContain('edges by origin: extracted=7');
        expect(out).toContain('findings by kind: clone-group=1, cycle=1, partition-violation=2, unused-file=1');
        expect(out).toContain('partitions: application, domain, infrastructure, presentation');
    });

    it('is deterministic whatever the order of the graph arrays', () => {
        const shuffled = { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse(), findings: [...g.findings].reverse() };
        expect(graphDiagnosticsText(base({ graph: shuffled }))).toBe(graphDiagnosticsText(base()));
    });

    it('says what is drawn against the total, and why it is cut', () => {
        expect(lines(base())).toContain('drawn: nodes=6/6 edges=7/7 · truncated: no');
        expect(lines(base()).some((l) => l.startsWith('truncation reason'))).toBe(false);
        const compact = lines(base({ drawn: { nodes: 3, edges: 1 }, compact: true }));
        expect(compact).toContain('drawn: nodes=3/6 edges=1/7 · truncated: yes');
        expect(compact).toContain('truncation reason: compact focus (top nodes only)');
        expect(truncationReasons(g, 3, false, false)).toEqual(['max drawn nodes']);
        expect(truncationReasons(g, 3, true, true)).toEqual(['max drawn nodes']);
        expect(truncationReasons({ ...g, stats: { ...g.stats, truncated: true } }, 6, false, false)).toEqual(['graph truncated by the server']);
    });

    it('adds the running phase, and the finished report with files per second', () => {
        const running: ReviewState = { status: 'running', progress: { phase: 'extract', done: 1, total: 2, path: 'a' } };
        expect(lines(base({ review: running, lastPhase: 'extract' }))).toContain('review: running (extract 1/2) · last phase extract');
        const done = lines(base({ review: { status: 'done', rootId: 'docs', report: FIXTURE_REPORT } }));
        expect(done).toContain('review: done');
        expect(done).toContain('report: extracted=2 judged=4 readErrors=0 duration=10ms files/s=200.0');
    });

    it('appends the failure details after a failed review', () => {
        const failed: ReviewState = { status: 'error', message: 'boom', at: '2026-11-03T00:00:00.000Z' };
        const text = graphDiagnosticsText(base({ review: failed }));
        expect(text).toContain('review: error');
        expect(text).toContain('Knowledge review failed');
        expect(text).toContain('message: boom');
    });

    it('still reports without a graph', () => {
        const out = lines(base({ graph: null, drawn: null, status: 'loading' }));
        expect(out).toContain('status: loading');
        expect(out.some((l) => l.startsWith('stats:'))).toBe(false);
        expect(out).toContain('lens: structure');
    });
});

describe('graphDiagnostics (the one source of the text and of the Diagnostics tab)', () => {
    it('builds the text from the same lines the groups hold: the title, every group in order, then the time', () => {
        const d = graphDiagnostics(base());
        expect(d.sections.map((s) => s.id)).toEqual(['graph', 'review']);
        expect(d.takenAt).toBe('2026-11-03T00:00:00.000Z');
        expect(d.text).toBe(['Knowledge graph diagnostics', ...d.sections.flatMap((s) => s.lines), 'time: 2026-11-03T00:00:00.000Z'].join('\n'));
        expect(d.text).toBe(graphDiagnosticsText(base()));
    });

    it('adds the First load group after the review when the load timings are given', () => {
        const d = graphDiagnostics(base({ load: { timeline: { nowMs: 900, marks: [], firstPaint: { ms: 800, from: 'fresh' }, freshMs: 800 } } }));
        expect(d.sections.map((s) => s.id)).toEqual(['graph', 'review', 'load']);
        expect(d.text).toContain('first paint: 800ms from fresh');
    });

    it('sorts the lines into groups by what they are, not by an English prefix', () => {
        const d = graphDiagnostics(base({ review: { status: 'done', rootId: 'docs', report: FIXTURE_REPORT } }));
        const graph = d.sections.find((s) => s.id === 'graph')!.lines;
        const review = d.sections.find((s) => s.id === 'review')!.lines;
        expect(graph).toContain('status: ready');
        expect(graph).toContain('lens: structure');
        expect(review[0]).toBe('review: done');
        expect(review.some((l) => l.startsWith('report: extracted=2'))).toBe(true);
    });

    it('marks the review group for attention when the review failed, and not otherwise', () => {
        const failed: ReviewState = { status: 'error', message: 'boom', at: '2026-11-03T00:00:00.000Z' };
        expect(graphDiagnostics(base({ review: failed })).sections.find((s) => s.id === 'review')!.attention).toBe(true);
        expect(graphDiagnostics(base()).sections.find((s) => s.id === 'review')!.attention).toBe(false);
    });
});

describe('splitLine', () => {
    it('splits a key from its value at the first colon, and leaves a continuation line whole', () => {
        expect(splitLine('stats: nodes=10 edges=4')).toEqual({ key: 'stats', value: 'nodes=10 edges=4' });
        expect(splitLine('  replica failed: 503')).toEqual({ value: 'replica failed: 503' });
        expect(splitLine('no colon here')).toEqual({ value: 'no colon here' });
    });
});
