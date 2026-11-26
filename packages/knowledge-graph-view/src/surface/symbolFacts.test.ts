import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { symbolFacts } from './symbolFacts';
import { buildStations } from './stations';

const graph = surfaceFixture();
const facts = symbolFacts(graph, buildStations(graph));
const ref = (path: string) => `src:sys::${path}`;

describe('symbolFacts (PRD 43 C2)', () => {
    it('antiPatternOf: a restructurable finding sits on its offender file, for the file and for every symbol in it', () => {
        const pv = graph.findings.find((f) => f.kind === 'partition-violation')!;
        const found = { kind: 'partition-violation', findingId: pv.id, restructurable: true };
        expect(facts.antiPatternOf(ref('cron/job.ts'))).toEqual(found);
        expect(facts.antiPatternOf(`${ref('cron/job.ts')}#run`)).toEqual(found);
        expect(facts.antiPatternOf(`${ref('cron/job.ts')}#Job.tick`)).toEqual(found);
    });

    it('antiPatternOf: the partner file, a file with no finding and a non-file ref are null', () => {
        expect(facts.antiPatternOf(ref('api/useCase.ts'))).toBeNull();
        expect(facts.antiPatternOf(ref('web/main.tsx'))).toBeNull();
        expect(facts.antiPatternOf('fact:claim:x')).toBeNull();
    });

    it('antiPatternOf: a kind with no proposer still shows (warning, name) but is not restructurable', () => {
        // The clone-group on db/repo.ts and api/routes.ts has no proposer.
        const clone = facts.antiPatternOf(ref('db/repo.ts'))!;
        expect(clone.kind).toBe('clone-group');
        expect(clone.restructurable).toBe(false);
        const cycle = { ...graph.findings[0]!, id: 'cyc', kind: 'cycle', nodes: [ref('web/main.tsx')] as never };
        const withCycle = symbolFacts({ findings: [cycle] }, buildStations(graph));
        expect(withCycle.antiPatternOf(ref('web/main.tsx'))).toEqual({ kind: 'cycle', findingId: 'cyc', restructurable: false });
    });

    it('antiPatternOf: a restructurable finding outranks one that is not; among equals the first in graph order wins', () => {
        const god = { ...graph.findings[0]!, id: 'god', kind: 'god-module', nodes: [ref('cron/job.ts')] as never };
        const cycle = { ...graph.findings[0]!, id: 'cyc', kind: 'cycle', nodes: [ref('cron/job.ts')] as never };
        const both = symbolFacts({ findings: [god, ...graph.findings] }, buildStations(graph));
        expect(both.antiPatternOf(ref('cron/job.ts'))).toEqual({ kind: 'god-module', findingId: 'god', restructurable: true });
        const cycleFirst = symbolFacts({ findings: [cycle, god] }, buildStations(graph));
        expect(cycleFirst.antiPatternOf(ref('cron/job.ts'))).toEqual({ kind: 'god-module', findingId: 'god', restructurable: true });
    });

    it('untested: a symbol is untested when its file\'s station reads under the question\'s line', () => {
        expect(facts.untested(ref('db/repo.ts'))).toBe(true); // coverage 0.2
        expect(facts.untested(`${ref('db/repo.ts')}#Repo.save`)).toBe(true);
        expect(facts.untested(ref('api/useCase.ts'))).toBe(false); // station coverage 0.8
        expect(facts.untested(`${ref('api/useCase.ts')}#UseCase.run`)).toBe(false);
    });

    it('testReach: reached, none, and unknown (no coverage reading) are three states', () => {
        expect(facts.testReach(ref('api/useCase.ts'))).toBe('reached');
        expect(facts.testReach(ref('db/repo.ts'))).toBe('none');
        expect(facts.testReach(ref('web/main.tsx'))).toBe('unknown');
        expect(facts.testReach('src:sys::nowhere/else.ts#x')).toBe('unknown');
    });

    it('untested: no reading, or an unknown ref, is not "untested" (never an invented zero)', () => {
        expect(facts.untested(ref('web/main.tsx'))).toBe(false);
        expect(facts.untested('src:sys::nowhere/else.ts#x')).toBe(false);
    });
});
