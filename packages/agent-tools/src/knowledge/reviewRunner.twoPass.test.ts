import { describe, expect, it } from 'vitest';
import type { ReviewProgress } from '@seanhogg/builderforce-memory/knowledge';
import { runKnowledgeReview } from './reviewRunner.js';
import { countingJudgement, ports } from './reviewRunner.fixtures.test-util.js';

describe('the two-pass review (PRD 41 A10)', () => {
    it('maps first with no model call, says `mapped`, then judges in the same run within the file budget', async () => {
        const judge = countingJudgement();
        const phases: ReviewProgress['phase'][] = [];
        const callsAtMapped: number[] = [];
        const p = ports(judge);
        const report = await runKnowledgeReview(p, {
            judgeFiles: 1,
            onProgress: (e) => { if (phases.at(-1) !== e.phase) phases.push(e.phase); if (e.phase === 'mapped') callsAtMapped.push(judge.calls); },
        });
        expect(callsAtMapped).toEqual([0]); // the map was complete before any model call
        expect(phases.indexOf('mapped')).toBeGreaterThan(phases.indexOf('write'));
        expect(phases.indexOf('judge')).toBeGreaterThan(phases.indexOf('mapped'));
        expect(phases.at(-1)).toBe('done');
        expect(report.awaitingJudge).toHaveLength(1); // two docs, a budget of one file: the other waits
        expect(report.awaitingJudgeCount).toBe(1);

        // The next run judges only what is still owed.
        const callsBefore = judge.calls;
        const next = await runKnowledgeReview(p, { judgeFiles: 5 });
        expect(judge.calls).toBeGreaterThan(callsBefore);
        expect(next.awaitingJudge).toEqual([]);
    });

    it('the judge pass restates what the map pass recorded it was measured with — never "no analyzers" (PRD 41 §C9)', async () => {
        const p = ports(countingJudgement());
        // Pass 1 ran the analyzers: its digest write records them (the judge pass runs without the analyzer port).
        const mapPass = { extractorVersion: '6', toolVersions: { knip: '5.30.0' } };
        const write = p.store.write.bind(p.store);
        let digestWrites = 0;
        p.store.write = (batch) => write(batch.scope.lastDigest && digestWrites++ === 0 ? { ...batch, scope: { ...batch.scope, measured: mapPass } } : batch);
        await runKnowledgeReview(p, { judgeFiles: 1 });
        expect(digestWrites).toBeGreaterThan(1); // the judge pass wrote its own digest too
        expect((await p.store.scopes())[0]!.measured).toEqual(mapPass);
    });

    it('a budget of 0 leaves a complete map and every judged file owed', async () => {
        const judge = countingJudgement();
        const report = await runKnowledgeReview(ports(judge), { judgeFiles: 0 });
        expect(judge.calls).toBe(0);
        expect(report.awaitingJudge).toHaveLength(2);
    });
});
