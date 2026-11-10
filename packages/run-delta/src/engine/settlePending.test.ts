/** A phase-1 delta settled after a restart (PRD 41 §6): pending → failed/interrupted, reasons and blocking re-coded, a new digest. */

import { describe, expect, it } from 'vitest';
import { ANALYZER_RULES } from '../registry/analyzers.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture } from '../testing/fixturePorts.js';
import { computeRunDelta } from './computeRunDelta.js';
import { digestOf } from './digest.js';
import { hasPendingAnalyzers, settlePendingAnalyzers } from './settlePending.js';

describe('settlePendingAnalyzers', () => {
    it('turns every pending analyzer into failed / interrupted, re-codes its reasons and blocking codes, and recomputes the digest', async () => {
        const { input, ports } = fixture({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' }, { mode: 'autonomous' });
        const blocking = [...DEFAULT_REGISTRIES.blocking, 'secret-leak'];
        const phase1 = await computeRunDelta(input, defaultDimensionRegistry({ ...DEFAULT_REGISTRIES, blocking }), ports, { analyzers: 'pending' });
        expect(hasPendingAnalyzers(phase1)).toBe(true);
        const settled = settlePendingAnalyzers(phase1, 'interrupted', ANALYZER_RULES, blocking);
        expect(hasPendingAnalyzers(settled)).toBe(false);
        const security = settled.dimensions.find((d) => d.id === 'security')!;
        expect(security.measuredBy).toContainEqual({ tool: 'gitleaks', version: '', status: 'failed', reason: 'interrupted', side: 'after' });
        expect(security.reasons).toContain('analyzer-not-measured:gitleaks');
        expect(security.reasons.some((r) => r.startsWith('analyzer-pending:'))).toBe(false);
        expect(settled.blocking).toContain('not-comparable:secret-leak');
        expect(settled.blocking.some((c) => c.startsWith('analyzer-pending:'))).toBe(false);
        const { digest, ...body } = settled;
        expect(digest).toBe(digestOf(body));
        expect(digest).not.toBe(phase1.digest);
        // Nothing moves a verdict: a pending tool never counted as having measured.
        expect(settled.dimensions.map((d) => d.verdict)).toEqual(phase1.dimensions.map((d) => d.verdict));
    });

    it('a delta with nothing pending is returned as it is', async () => {
        const { input, ports } = fixture({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' });
        const final = await computeRunDelta(input, defaultDimensionRegistry(), ports);
        expect(settlePendingAnalyzers(final, 'interrupted', ANALYZER_RULES)).toBe(final);
    });
});
