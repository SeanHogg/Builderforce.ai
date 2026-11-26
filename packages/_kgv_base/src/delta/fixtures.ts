/**
 * Run delta fixtures for the card and panel tests: a run that made security and quality worse
 * (a route lost its guard, tests weakened, one heuristic finding), with a metric, unmeasured
 * dimensions, an excluded file and a snippet that must render as text.
 */

import type { DeltaFinding, DimensionId, DimensionResult, RunDelta } from '@builderforce/run-delta/contract';

const identity = (id: string) => ({ id, anchor: `${id}@1:file:x`, anchorKind: 'file' as const, members: [id] });

export function finding(over: Partial<DeltaFinding> & Pick<DeltaFinding, 'ruleId' | 'dimension'>): DeltaFinding {
    return {
        identity: identity(`${over.ruleId}:${over.lineage ?? 'introduced'}:${over.evidence?.[0]?.path ?? 'a.ts'}`),
        ruleVersion: 1,
        severity: 'error',
        lineage: 'introduced',
        confidence: 'measured',
        params: {},
        evidence: [],
        ...over,
    };
}

const dimension = (id: DimensionId, over: Partial<DimensionResult> = {}): DimensionResult => ({
    id, verdict: 'same', reasons: [], findings: [], metrics: [], measuredBy: [], ...over,
});

export const SCRIPT_SNIPPET = '<script>alert("x")</script>';

export function worseDelta(): RunDelta {
    const dimensions: DimensionResult[] = [
        dimension('ilities.reliability', { verdict: 'not_measured', reasons: ['rule-not-built'] }),
        dimension('performance', {
            verdict: 'same', reasons: ['static-only'],
            metrics: [{ metricId: 'complexity.max', before: 300, after: 725, step: 0.01, unit: 'cyclomatic', betterWhen: 'lower', threshold: { warn: 5, error: 10, kind: 'abs' } }],
        }),
        dimension('quality', {
            verdict: 'worse', reasons: ['tests-weakened'],
            findings: [
                finding({ ruleId: 'test-deleted', dimension: 'quality', evidence: [{ side: 'before', path: 'src/a.test.ts', line: 4 }] }),
                finding({ ruleId: 'assertions-reduced', dimension: 'quality', lineage: 'resolved', severity: 'warn', evidence: [{ side: 'after', path: 'src/b.test.ts' }] }),
                finding({ ruleId: 'only-added', dimension: 'quality', lineage: 'persisting', severity: 'warn', evidence: [{ side: 'after', path: 'src/c.test.ts', line: 9 }] }),
            ],
        }),
        dimension('security', {
            verdict: 'worse', reasons: ['heuristic'],
            findings: [
                // Shown as present now, without lineage (C9): the contract's `present` lineage.
                finding({ ruleId: 'weak-crypto', dimension: 'security', lineage: ('present' as string) as DeltaFinding['lineage'], severity: 'warn', evidence: [{ side: 'after', path: 'src/hash.ts', line: 3 }] }),
                finding({
                    ruleId: 'guard-removed', dimension: 'security', confidence: 'heuristic', params: { route: 'POST /api/x', guard: 'requireAuth' },
                    evidence: [
                        { side: 'before', path: 'src/routes.ts', line: 10, snippet: 'app.post("/api/x", requireAuth, h)' },
                        { side: 'after', path: 'src/routes.ts', line: 12, snippet: SCRIPT_SNIPPET, note: 'POST /api/x' },
                    ],
                }),
            ],
        }),
    ];
    return {
        version: 1,
        runId: 'host-run:7:abc',
        before: { manifestGeneration: 'g1', merkleRoot: 'm1' },
        after: { manifestGeneration: 'g2', merkleRoot: 'm2' },
        impact: { changedFiles: ['src/routes.ts'], renamed: [], dependents: [], entryPoints: [] },
        excluded: [{ path: 'assets/logo.png', reason: 'binary' }],
        dimensions,
        headline: 'worse',
        summary: {
            verdict: 'worse',
            clauses: [
                { dimension: 'quality', verdict: 'worse', code: 'tests-weakened', count: 1 },
                { dimension: 'security', verdict: 'worse', code: 'guard-removed', count: 1 },
            ],
            unchanged: ['performance'],
            notMeasured: ['ilities.reliability'],
        },
        blastRadius: { score: 1.25, band: 'high', formula: 'v1', reasons: ['insufficient-history'] },
        blocking: ['guard-removed'],
        digest: 'd',
    };
}
