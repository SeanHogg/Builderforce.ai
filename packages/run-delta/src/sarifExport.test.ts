/**
 * PRD 41 §8 done-check: the SARIF export validates against the official 2.1.0 schema (vendored in
 * `packages/sarif/schema`), and `baselineState` + the anchor fingerprint round-trip through the SARIF
 * import (`@builderforce/sarif` `readSarifResults`).
 */

import Ajv from 'ajv-draft-04';
import schema from '../../sarif/schema/sarif-schema-2.1.0.json';
import { ANCHOR_FINGERPRINT, readSarifResults } from '@builderforce/sarif';
import { describe, expect, it } from 'vitest';
import type { DeltaFinding, DimensionResult, Lineage, RunDelta } from './contract.js';
import { baselineStateOf, RUN_DELTA_TOOL, runDeltaToSarif } from './sarifExport.js';
import { summarizeRunDelta } from './summary.js';

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function finding(ruleId: string, lineage: Lineage, extra: Partial<DeltaFinding> = {}): DeltaFinding {
    const anchor = `${ruleId}@1:file:src/${ruleId}.ts#k`;
    return {
        identity: { id: `${anchor}|src/${ruleId}.ts`, anchor, anchorKind: 'file', members: [`src/${ruleId}.ts`] },
        dimension: 'security',
        ruleId,
        ruleVersion: 1,
        severity: 'error',
        lineage,
        confidence: 'heuristic',
        params: { route: 'POST /x' },
        evidence: [
            { side: 'before', path: `src/${ruleId}.ts`, line: 3, snippet: 'before()' },
            { side: 'after', path: `src/${ruleId}.ts`, line: 7, snippet: 'after()' },
        ],
        ...extra,
    };
}

function dimension(id: DimensionResult['id'], findings: DeltaFinding[], verdict: DimensionResult['verdict']): DimensionResult {
    return { id, verdict, reasons: [], findings, metrics: [], measuredBy: [{ tool: 'Semgrep OSS', version: '1.90.0', status: 'ok' }] };
}

const delta: RunDelta = {
    version: 1,
    runId: 'run-1',
    before: { manifestGeneration: 'g1', merkleRoot: 'm1' },
    after: { manifestGeneration: 'g2', merkleRoot: 'm2' },
    impact: { changedFiles: ['src/a.ts'], renamed: [], dependents: [], entryPoints: [] },
    excluded: [],
    dimensions: [
        dimension('quality', [finding('test-skipped', 'persisting', { severity: 'warn', dimension: 'quality' })], 'same'),
        dimension('security', [
            finding('guard-removed', 'introduced'),
            finding('weak-crypto', 'resolved', { severity: 'info' }),
            finding('secret-added', 'changed', { change: 'grew' }),
            finding('js.eval', 'present', { params: { tool: 'Semgrep OSS', sarifRule: 'js.eval' } }),
        ], 'worse'),
    ],
    headline: 'worse',
    summary: { verdict: 'worse', clauses: [{ dimension: 'security', verdict: 'worse', code: 'guard-removed', count: 1 }], unchanged: ['quality'], notMeasured: [] },
    blastRadius: { score: 0.42, band: 'medium', formula: 'v1', reasons: [] },
    blocking: ['guard-removed'],
    digest: 'd'.repeat(64),
};

describe('runDeltaToSarif', () => {
    const log = runDeltaToSarif(delta);

    it('validates against the SARIF 2.1.0 schema', () => {
        const ok = validate(JSON.parse(JSON.stringify(log)));
        expect(validate.errors ?? []).toEqual([]);
        expect(ok).toBe(true);
    });

    it('writes one run per tool, sorted, the engine version on its own run', () => {
        expect(log.runs.map((r) => r.tool.driver.name)).toEqual(['Semgrep OSS', RUN_DELTA_TOOL]);
        expect(log.runs[0]?.tool.driver.version).toBe('1.90.0');
        expect(log.runs[1]?.tool.driver.version).toBe('1');
        expect(log.runs[1]?.automationDetails?.id).toBe('run-delta/run-1');
    });

    it('exports an external tool\'s finding under that tool\'s own rule id, the delta rule in properties', () => {
        const external = runDeltaToSarif({
            ...delta,
            dimensions: [dimension('security', [finding('semgrep', 'introduced', { params: { tool: 'Semgrep OSS', sarifRule: 'js.eval' } })], 'worse')],
        });
        const [result] = external.runs[0]!.results;
        expect(result?.ruleId).toBe('js.eval');
        expect(result?.properties?.deltaRule).toBe('semgrep');
        expect(external.runs[0]!.tool.driver.rules?.map((r) => r.id)).toEqual(['js.eval']);
    });

    it('round-trips baselineState and the anchor fingerprint through the SARIF import', () => {
        const read = readSarifResults(JSON.parse(JSON.stringify(log)));
        const all = delta.dimensions.flatMap((d) => d.findings);
        expect(read).toHaveLength(all.length);
        for (const f of all) {
            const r = read.find((x) => x.partialFingerprints[ANCHOR_FINGERPRINT] === f.identity.anchor);
            expect(r, f.ruleId).toBeDefined();
            expect(r?.baselineState ?? undefined).toBe(baselineStateOf(f.lineage));
            expect(r?.properties.lineage).toBe(f.lineage);
        }
    });

    it('maps lineage → baselineState and reads a resolved finding on its before side', () => {
        expect(['introduced', 'resolved', 'changed', 'persisting', 'present'].map((l) => baselineStateOf(l as Lineage)))
            .toEqual(['new', 'absent', 'updated', 'unchanged', undefined]);
        const resolved = log.runs[1]?.results.find((r) => r.ruleId === 'weak-crypto');
        expect(resolved?.locations?.[0]?.physicalLocation.region?.startLine).toBe(3);
        expect(resolved?.level).toBe('note');
    });

    it('is deterministic', () => {
        expect(JSON.stringify(runDeltaToSarif(delta))).toBe(JSON.stringify(log));
    });
});

describe('summarizeRunDelta', () => {
    it('projects the stored summary: verdicts per dimension and introduced/resolved counts', () => {
        const s = summarizeRunDelta(delta, { repoKey: 'r1', surface: 'vscode', mode: 'autonomous', computedAt: '2026-11-10T00:00:00.000Z' });
        expect(s).toEqual({
            runId: 'run-1', repoKey: 'r1', surface: 'vscode', mode: 'autonomous', computedAt: '2026-11-10T00:00:00.000Z',
            headline: 'worse', summary: delta.summary, verdicts: { quality: 'same', security: 'worse' },
            counts: { introduced: 1, resolved: 1 }, blastRadius: { score: 0.42, band: 'medium' }, blocking: ['guard-removed'], digest: delta.digest,
        });
    });
});
