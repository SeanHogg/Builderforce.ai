/** The L3 analyzer tier (PRD 41 §B7, §C9, §8 done-checks): lineage, tool-version comparability, failure as not_measured. */

import { describe, expect, it } from 'vitest';
import { composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import type { AnalyzerFinding, AnalyzerResult, DeltaPorts, DimensionId, DimensionRegistry, RunDelta } from '../contract.js';
import { ANALYZER_RULES } from '../registry/analyzers.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture } from '../testing/fixturePorts.js';
import { computeRunDelta } from './computeRunDelta.js';

const dim = (d: RunDelta, id: DimensionId) => d.dimensions.find((x) => x.id === id)!;

function cloneGroup(fragment: string, files: string[]): AnalyzerFinding {
    const members = [...files].sort();
    return {
        kind: 'clone-group',
        identity: { id: `clone-group:${fragment}:${members.join('|')}`, anchor: composeAnchor('clone-group', 1, 'group', fragment), anchorKind: 'group', members },
        severity: 'warn', confidence: 'measured', params: { members: members.length },
        evidence: members.map((path) => ({ side: 'after' as const, path })),
    };
}

const ok = (tool: string, version: string, findings: AnalyzerFinding[] = [], metrics?: AnalyzerResult['metrics']): AnalyzerResult =>
    ({ tool, version, status: 'ok', findings, ...(metrics ? { metrics } : {}) });

/** The fixture's ports plus an `analyze` answering from per-side tables (a tool with no entry is skipped). */
function withAnalyzers(base: DeltaPorts, before: Record<string, AnalyzerResult>, after: Record<string, AnalyzerResult>): DeltaPorts & { asked: string[] } {
    const asked: string[] = [];
    return {
        ...base, asked,
        analyze: async (side, tool) => {
            asked.push(`${side}:${tool}`);
            return (side === 'before' ? before : after)[tool] ?? { tool, version: '', status: 'skipped', reason: 'tool-absent', findings: [] };
        },
    };
}

const FILES = fixture({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 2;\n' });
const onlyJscpd: DimensionRegistry = {
    dimensions: ['ilities.maintainability'], rules: [], metrics: [], registries: DEFAULT_REGISTRIES,
    analyzers: ANALYZER_RULES.filter((r) => r.tool === 'jscpd'),
};

describe('the L3 analyzer tier', () => {
    it('reads a clone group gaining a member as changed (grew), not resolved plus introduced', async () => {
        const ports = withAnalyzers(FILES.ports,
            { jscpd: ok('jscpd', '4.0.5', [cloneGroup('frag', ['src/a.ts', 'src/b.ts'])]) },
            { jscpd: ok('jscpd', '4.0.5', [cloneGroup('frag', ['src/a.ts', 'src/b.ts', 'src/c.ts'])]) });
        const delta = await computeRunDelta(FILES.input, defaultDimensionRegistry(), ports);
        const clones = dim(delta, 'ilities.maintainability').findings.filter((f) => f.ruleId === 'clone-group');
        expect(clones.map((f) => [f.lineage, f.change])).toEqual([['changed', 'grew']]);
        expect(dim(delta, 'ilities.maintainability').measuredBy).toContainEqual({ tool: 'jscpd', version: '4.0.5', status: 'ok' });
    });

    it('an analyzer version bump between sides makes that kind not_comparable and emits no introduced or resolved entries', async () => {
        const ports = withAnalyzers(FILES.ports,
            { jscpd: ok('jscpd', '4.0.5', [cloneGroup('old', ['src/x.ts', 'src/y.ts'])]) },
            { jscpd: ok('jscpd', '4.1.0', [cloneGroup('new', ['src/a.ts', 'src/b.ts'])]) });
        const delta = await computeRunDelta(FILES.input, onlyJscpd, ports);
        const d = dim(delta, 'ilities.maintainability');
        expect(d.verdict).toBe('not_comparable');
        expect(d.reasons).toContain('tool-version-changed:jscpd');
        expect(d.findings.map((f) => f.lineage)).toEqual(['present']);
        expect(d.findings.some((f) => f.lineage === 'introduced' || f.lineage === 'resolved')).toBe(false);
    });

    it('an analyzer failure shows as not_measured with a reason, never as zero findings', async () => {
        const ports = withAnalyzers(FILES.ports, { jscpd: ok('jscpd', '4.0.5') }, { jscpd: { tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', findings: [] } });
        const alone = dim(await computeRunDelta(FILES.input, onlyJscpd, ports), 'ilities.maintainability');
        expect(alone).toMatchObject({ verdict: 'not_measured', findings: [] });
        expect(alone.reasons).toEqual(['analyzer-not-measured:jscpd']);
        expect(alone.measuredBy).toEqual([{ tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', side: 'after' }]);

        // Beside other rules the dimension still says, by name, that the tool did not measure — and the static
        // `clone-group` rule it would have superseded STAYS (the tool did not measure this run).
        const full = dim(await computeRunDelta(FILES.input, defaultDimensionRegistry(), ports), 'ilities.maintainability');
        expect(full.reasons).toContain('analyzer-not-measured:jscpd');
        expect(full.measuredBy).toContainEqual({ tool: 'clone-group', version: '1', status: 'ok' });
        expect(full.measuredBy).toContainEqual({ tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', side: 'after' });
    });

    it('supersedes the static twin only when the tool measured both sides', async () => {
        const failedBefore = withAnalyzers(FILES.ports,
            { jscpd: { tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', findings: [] } },
            { jscpd: ok('jscpd', '4.0.5', [cloneGroup('frag', ['src/a.ts', 'src/b.ts'])]) });
        const kept = dim(await computeRunDelta(FILES.input, defaultDimensionRegistry(), failedBefore), 'ilities.maintainability');
        expect(kept.measuredBy).toContainEqual({ tool: 'clone-group', version: '1', status: 'ok' });
        expect(kept.findings.some((f) => f.ruleId === 'clone-group' && f.lineage === 'present')).toBe(false);
        expect(kept.measuredBy).toContainEqual({ tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', side: 'before' });

        const measured = withAnalyzers(FILES.ports, { jscpd: ok('jscpd', '4.0.5') }, { jscpd: ok('jscpd', '4.0.5') });
        const replaced = dim(await computeRunDelta(FILES.input, defaultDimensionRegistry(), measured), 'ilities.maintainability');
        expect(replaced.measuredBy.map((m) => m.tool)).not.toContain('clone-group');
    });

    it('phase 1 (pending): asks nothing, reports every tool pending, and a blocking kind waits as analyzer-pending', async () => {
        const { input, ports: base } = fixture({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' }, { mode: 'autonomous' });
        const ports = withAnalyzers(base, {}, {});
        const registry = defaultDimensionRegistry({ ...DEFAULT_REGISTRIES, blocking: [...DEFAULT_REGISTRIES.blocking, 'secret-leak'] });
        const delta = await computeRunDelta(input, registry, ports, { analyzers: 'pending' });
        expect(ports.asked).toEqual([]);
        expect(dim(delta, 'security').measuredBy).toContainEqual({ tool: 'gitleaks', version: '', status: 'pending' });
        expect(dim(delta, 'security').reasons).toContain('analyzer-pending:gitleaks');
        expect(delta.blocking).toContain('analyzer-pending:gitleaks');
        // The static twin stands while the tool measures.
        expect(dim(delta, 'ilities.maintainability').measuredBy.map((m) => m.tool)).toContain('clone-group');
    });

    it('without a host tier a blocking analyzer kind fails closed and names its tool', async () => {
        const { input, ports } = fixture({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' }, { mode: 'autonomous' });
        const registry = defaultDimensionRegistry({ ...DEFAULT_REGISTRIES, blocking: [...DEFAULT_REGISTRIES.blocking, 'secret-leak'] });
        const delta = await computeRunDelta(input, registry, ports);
        expect(delta.blocking).toContain('not-comparable:secret-leak');
        expect(dim(delta, 'security').measuredBy).toContainEqual({ tool: 'gitleaks', version: '', status: 'skipped', reason: 'no-analyzer-host' });
        expect(dim(delta, 'security').reasons).toContain('analyzer-not-measured:gitleaks');
    });

    it('vulnerability data older than 14 days (or undated) is not comparable; fresh data on both sides is', async () => {
        const vuln: AnalyzerFinding = {
            kind: 'vulnerable-dependency', severity: 'error', confidence: 'measured', params: { package: 'lodash' },
            identity: { id: 'vulnerable-dependency:package-lock.json:npm/lodash:GHSA-1', anchor: composeAnchor('vulnerable-dependency', 1, 'package', 'npm/lodash#GHSA-1'), anchorKind: 'package', members: ['package-lock.json'] },
            evidence: [{ side: 'after', path: 'package-lock.json' }],
        };
        const run = (date?: string) => ({ ...ok('osv-scanner', '1.9.1', [vuln]), ...(date ? { dataAsOf: date } : {}) });
        const only: DimensionRegistry = { dimensions: ['security'], rules: [], metrics: [], registries: DEFAULT_REGISTRIES, analyzers: ANALYZER_RULES.filter((r) => r.tool === 'osv-scanner') };
        const at = async (date: string | undefined) => dim(await computeRunDelta(FILES.input, only, withAnalyzers(FILES.ports,
            { 'osv-scanner': { ...ok('osv-scanner', '1.9.1'), ...(date ? { dataAsOf: date } : {}) } }, { 'osv-scanner': run(date) }), { asOf: '2026-11-10' }), 'security');
        expect((await at('2026-10-01')).reasons).toContain('analyzer-data-stale:osv-scanner');
        expect((await at(undefined)).reasons).toContain('analyzer-data-stale:osv-scanner');
        const fresh = await at('2026-11-05');
        expect(fresh.reasons).not.toContain('analyzer-data-stale:osv-scanner');
        expect(fresh.findings.map((f) => f.lineage)).toEqual(['introduced']);
    });

    it('a skipped (absent) tool is not_measured with its reason', async () => {
        const ports = withAnalyzers(FILES.ports, {}, {});
        const d = dim(await computeRunDelta(FILES.input, onlyJscpd, ports), 'ilities.maintainability');
        expect(d.verdict).toBe('not_measured');
        expect(d.measuredBy).toEqual([{ tool: 'jscpd', version: '', status: 'skipped', reason: 'tool-absent', side: 'after' }]);
    });

    it('a before side that failed makes the kind not_comparable and shows the after findings as present', async () => {
        const ports = withAnalyzers(FILES.ports,
            { jscpd: { tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', findings: [] } },
            { jscpd: ok('jscpd', '4.0.5', [cloneGroup('frag', ['src/a.ts', 'src/b.ts'])]) });
        const d = dim(await computeRunDelta(FILES.input, onlyJscpd, ports), 'ilities.maintainability');
        expect(d.verdict).toBe('not_comparable');
        expect(d.reasons).toContain('analyzer-failed:jscpd');
        expect(d.findings.map((f) => f.lineage)).toEqual(['present']);
        expect(d.measuredBy).toContainEqual({ tool: 'jscpd', version: '4.0.5', status: 'failed', reason: 'timeout', side: 'before' });
    });

    it('a port that throws is a failed run, never an engine error', async () => {
        const ports: DeltaPorts = { ...FILES.ports, analyze: async () => { throw new Error('boom'); } };
        const d = dim(await computeRunDelta(FILES.input, onlyJscpd, ports), 'ilities.maintainability');
        expect(d.measuredBy[0]).toMatchObject({ tool: 'jscpd', status: 'failed', reason: 'analyzer-threw' });
    });

    it('asks the after side only of an after-only tool, and its metric has no before value', async () => {
        const coverage = { metricId: 'coverage.diff', value: 750, step: 0.001, unit: 'ratio', betterWhen: 'higher' as const, threshold: { warn: 0.1, error: 0.3, kind: 'abs' as const } };
        const ports = withAnalyzers(FILES.ports, {}, { coverage: ok('coverage', '1', [], [coverage]) });
        const delta = await computeRunDelta(FILES.input, defaultDimensionRegistry(), ports);
        expect(ports.asked).toContain('after:coverage');
        expect(ports.asked).not.toContain('before:coverage');
        expect(dim(delta, 'quality').metrics.find((m) => m.metricId === 'coverage.diff')).toMatchObject({ before: null, after: 750 });
    });

    it('without an analyze port nothing changes: no analyzer rows, the static-tier kinds stand', async () => {
        const delta = await computeRunDelta(FILES.input, defaultDimensionRegistry(), FILES.ports);
        const tools = delta.dimensions.flatMap((d) => d.measuredBy.map((m) => m.tool));
        expect(tools).toContain('clone-group');
        expect(tools).not.toContain('jscpd');
    });

    it('an introduced error of a blocking analyzer kind blocks an autonomous run', async () => {
        const { input, ports: base } = fixture({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' }, { mode: 'autonomous' });
        const leak: AnalyzerFinding = {
            kind: 'secret-leak', severity: 'error', confidence: 'measured', params: { rule: 'aws-access-token' },
            identity: { id: 'secret-leak:src/a.ts:aws-access-token:1', anchor: composeAnchor('secret-leak', 1, 'file', 'src/a.ts#aws-access-token'), anchorKind: 'file', members: ['src/a.ts'] },
            evidence: [{ side: 'after', path: 'src/a.ts', line: 1 }],
        };
        const registry = defaultDimensionRegistry({ ...DEFAULT_REGISTRIES, blocking: [...DEFAULT_REGISTRIES.blocking, 'secret-leak'] });
        const ports = withAnalyzers(base, { gitleaks: ok('gitleaks', '8.18.4') }, { gitleaks: ok('gitleaks', '8.18.4', [leak]) });
        const delta = await computeRunDelta(input, registry, ports);
        expect(dim(delta, 'security').findings.find((f) => f.ruleId === 'secret-leak')).toMatchObject({ lineage: 'introduced', severity: 'error' });
        expect(delta.blocking).toContain('secret-leak');
    });

    it('gives one digest for shuffled analyzer output', async () => {
        const groups = [cloneGroup('f1', ['src/a.ts', 'src/b.ts']), cloneGroup('f2', ['src/c.ts', 'src/d.ts'])];
        const a = await computeRunDelta(FILES.input, onlyJscpd, withAnalyzers(FILES.ports, { jscpd: ok('jscpd', '1', []) }, { jscpd: ok('jscpd', '1', groups) }));
        const b = await computeRunDelta(FILES.input, onlyJscpd, withAnalyzers(FILES.ports, { jscpd: ok('jscpd', '1', []) }, { jscpd: ok('jscpd', '1', [...groups].reverse()) }));
        expect(a.digest).toBe(b.digest);
    });
});
