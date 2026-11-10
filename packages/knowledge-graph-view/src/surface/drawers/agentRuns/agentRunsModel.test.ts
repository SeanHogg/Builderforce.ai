import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { surfaceFixture } from '../../../testing';
import type { AgentRunFinding, AgentRunTurn } from '../../../types';
import { evidenceNoteText, evidenceText, fileRefFor, findingText, formatParam, sortFindings, stripGeometry, turnTitle } from './agentRunsModel';

const t = L.surface.agentRuns;
const turn = (index: number, promptTokens: number, kind: AgentRunTurn['kind'] = 'read'): AgentRunTurn =>
    ({ index, role: 'code', model: 'm1', kind, toolCalls: 2, promptTokens, completionTokens: 10, durationMs: 1500 });
const finding = (id: string, severity: AgentRunFinding['severity'], kind = 'edit_churn'): AgentRunFinding =>
    ({ id, kind, severity, params: { path: 'src/a.ts', writes: 5 }, evidence: [] });

describe('agentRunsModel', () => {
    it('sorts findings worst first and keeps the host order inside one severity', () => {
        const out = sortFindings([finding('a', 'info'), finding('b', 'error'), finding('c', 'warn'), finding('d', 'error')]);
        expect(out.map((f) => f.id)).toEqual(['b', 'd', 'c', 'a']);
    });

    it('draws one bar per turn with height proportional to prompt tokens', () => {
        const bars = stripGeometry([turn(1, 100), turn(2, 50), turn(3, 0)], 31, 40, 1);
        expect(bars).toHaveLength(3);
        expect(bars[0]!.height).toBe(40);
        expect(bars[1]!.height).toBe(20);
        expect(bars[1]!.y).toBe(20);
        expect(bars[2]!.height).toBe(0);
        expect(bars[0]!.width).toBeCloseTo(29 / 3);
        expect(bars[1]!.x).toBeCloseTo(29 / 3 + 1);
        expect(stripGeometry([], 100, 40)).toEqual([]);
    });

    it('keeps a tiny turn visible at the minimum height', () => {
        const bars = stripGeometry([turn(1, 100_000), turn(2, 1)], 100, 40);
        expect(bars[1]!.height).toBe(2);
    });

    it('fills a finding description from its params and falls back to the kind for an unknown one', () => {
        expect(findingText(finding('a', 'warn'), t)).toEqual({ title: t.findings.edit_churn.title, description: 'src/a.ts was written 5 times.' });
        expect(findingText(finding('x', 'info', 'not_a_kind'), t)).toEqual({ title: 'not_a_kind', description: '' });
    });

    it('formats params: grouped integers, one-decimal fractions, text as sent', () => {
        expect(formatParam(1234567)).toBe('1,234,567');
        expect(formatParam(52.345)).toBe('52.3');
        expect(formatParam('edit_file')).toBe('edit_file');
    });

    it('words an evidence row with or without its turn', () => {
        expect(evidenceText({ step: 3, turn: 2, label: 'edit_file' }, t)).toBe('Turn 2 · edit_file');
        expect(evidenceText({ step: 3, label: 'edit_file' }, t)).toBe('edit_file');
    });

    it('words an evidence note from the localized template with its numbers formatted', () => {
        const e = { step: 5, turn: 3, label: 'edit_file', note: 'slowTurn' as const, params: { ms: 72000, completionTokens: 1200, argBytes: 3456 } };
        expect(evidenceNoteText(e, t)).toBe('72,000 ms · 1,200 completion tokens · 3,456 bytes of arguments');
        const localized = { ...t, evidenceNotes: { ...t.evidenceNotes, slowTurn: '{ms} ms lang' } };
        expect(evidenceNoteText(e, localized)).toBe('72,000 ms lang');
        expect(evidenceNoteText({ step: 1, label: 'x', excerpt: 'kept' }, t)).toBeUndefined();
    });

    it('titles a bar with its numbers and its kind in words', () => {
        expect(turnTitle(turn(4, 2000, 'write'), t)).toBe('Turn 4 · code · m1 · Write · 2,000 prompt tokens · 10 completion tokens · 2 tool calls · 1.5 s');
    });

    it('finds the graph file for a relative, a backslashed or an absolute path under the root, and nothing for an unknown one', () => {
        const graph = surfaceFixture();
        expect(fileRefFor(graph, 'cron/job.ts')).toBe('src:sys::cron/job.ts');
        expect(fileRefFor(graph, './cron/job.ts')).toBe('src:sys::cron/job.ts');
        expect(fileRefFor(graph, 'C:\\repo\\cron\\job.ts', 'C:\\repo')).toBe('src:sys::cron/job.ts');
        expect(fileRefFor(graph, 'c:\\Repo\\cron\\job.ts', 'C:\\repo\\')).toBe('src:sys::cron/job.ts');
        expect(fileRefFor(graph, '/work/repo/cron/job.ts', '/work/repo')).toBe('src:sys::cron/job.ts');
        expect(fileRefFor(graph, 'nowhere/else.ts')).toBeUndefined();
    });

    it('places an absolute path only under the root, and never by a one-segment suffix', () => {
        const base = surfaceFixture();
        const job = base.nodes.find((n) => n.ref === 'src:sys::cron/job.ts')!;
        const graph = { ...base, nodes: [...base.nodes, { ...job, ref: 'src:sys::index.ts' as typeof job.ref }] };
        // No root, or a path outside it: not this graph's file.
        expect(fileRefFor(graph, 'C:\\repo\\cron\\job.ts')).toBeUndefined();
        expect(fileRefFor(graph, 'C:\\other\\cron\\job.ts', 'C:\\repo')).toBeUndefined();
        expect(fileRefFor(graph, 'C:\\repository\\cron\\job.ts', 'C:\\repo')).toBeUndefined();
        // The root-level index.ts is matched exactly, never as the tail of a nested one.
        expect(fileRefFor(graph, 'C:\\repo\\index.ts', 'C:\\repo')).toBe('src:sys::index.ts');
        expect(fileRefFor(graph, 'C:\\repo\\packages\\x\\index.ts', 'C:\\repo')).toBeUndefined();
        expect(fileRefFor(graph, '/elsewhere/pkg/index.ts', '/work/repo')).toBeUndefined();
        // A two-segment suffix under the root still lands.
        expect(fileRefFor(graph, 'C:\\repo\\nested\\cron\\job.ts', 'C:\\repo')).toBe('src:sys::cron/job.ts');
        // A relative path is exact only.
        expect(fileRefFor(graph, 'packages/x/index.ts')).toBeUndefined();
    });
});
