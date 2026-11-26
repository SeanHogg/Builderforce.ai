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
        const found = { kind: 'partition-violation', findingId: pv.id };
        expect(facts.antiPatternOf(ref('cron/job.ts'))).toEqual(found);
        expect(facts.antiPatternOf(`${ref('cron/job.ts')}#run`)).toEqual(found);
        expect(facts.antiPatternOf(`${ref('cron/job.ts')}#Job.tick`)).toEqual(found);
    });

    it('antiPatternOf: the partner file, a file with no finding and a kind with no proposer are null', () => {
        expect(facts.antiPatternOf(ref('api/useCase.ts'))).toBeNull();
        expect(facts.antiPatternOf(ref('web/main.tsx'))).toBeNull();
        // The clone-group on db/repo.ts and api/routes.ts has no proposer.
        expect(facts.antiPatternOf(ref('db/repo.ts'))).toBeNull();
        expect(facts.antiPatternOf('fact:claim:x')).toBeNull();
    });

    it('antiPatternOf: the first finding in graph order wins a file with two', () => {
        const god = { ...graph.findings[0]!, id: 'god', kind: 'god-module', nodes: [ref('cron/job.ts')] as never };
        const both = symbolFacts({ findings: [god, ...graph.findings] }, buildStations(graph));
        expect(both.antiPatternOf(ref('cron/job.ts'))).toEqual({ kind: 'god-module', findingId: 'god' });
    });

    it('untested: a symbol is untested when its file\'s station reads under the question\'s line', () => {
        expect(facts.untested(ref('db/repo.ts'))).toBe(true); // coverage 0.2
        expect(facts.untested(`${ref('db/repo.ts')}#Repo.save`)).toBe(true);
        expect(facts.untested(ref('api/useCase.ts'))).toBe(false); // station coverage 0.8
        expect(facts.untested(`${ref('api/useCase.ts')}#UseCase.run`)).toBe(false);
    });

    it('untested: no reading, or an unknown ref, is not "untested" (never an invented zero)', () => {
        expect(facts.untested(ref('web/main.tsx'))).toBe(false);
        expect(facts.untested('src:sys::nowhere/else.ts#x')).toBe(false);
    });
});
