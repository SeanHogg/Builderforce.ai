import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { surfaceFixture } from '../testing';
import { buildLines } from './lines';
import { answerFor, answerLine, litStations, MORE_QUESTIONS, PRIMARY_QUESTIONS, QUESTIONS, questionDef, questionForLens, type QuestionContext, type QuestionId } from './questions';
import { buildStations } from './stations';

const graph = surfaceFixture();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const ctx = (over: Partial<QuestionContext> = {}): QuestionContext => ({ lines, line: null, selected: null, ...over });
const lit = (id: QuestionId, c = ctx()) => {
    const set = litStations(id, model.stations, c);
    return set === null ? null : model.stations.filter((s) => set.has(s.id)).map((s) => s.name).sort();
};

describe('the question registry', () => {
    it('holds the 11 questions, five as chips and six under More', () => {
        expect(QUESTIONS.map((q) => q.id)).toEqual(['where', 'wrong', 'untested', 'patterns', 'changed', 'callers', 'copied', 'unused', 'claims', 'layers', 'knowledge']);
        expect(PRIMARY_QUESTIONS).toHaveLength(5);
        expect(MORE_QUESTIONS).toHaveLength(6);
    });

    it('maps to valid lens ids, each lens at most once, and back', () => {
        const lenses = QUESTIONS.flatMap((q) => (q.lens ? [q.lens] : []));
        for (const id of lenses) expect(LENSES[id]).toBeDefined();
        expect(new Set(lenses).size).toBe(lenses.length);
        expect(lenses.sort()).toEqual(['claims', 'duplication', 'knowledge', 'links', 'live', 'partitions', 'structure', 'unused']);
        expect(questionForLens('duplication')).toBe('copied');
        expect(questionForLens('compare')).toBeUndefined();
        expect(questionDef('layers').lens).toBe('partitions');
    });
});

describe('predicates', () => {
    it('where lights the selected line ONLY (intended, as in the prototype: the default line is the selected one), or everything without one', () => {
        expect(lit('where')).toBeNull();
        expect(lit('where', ctx({ line: lines.lines[1]! }))).toEqual(['API', 'cron', 'repositories']);
        expect(lit('where', ctx({ line: lines.lines[0]! }))).toEqual(['API', 'Web app', 'main.tsx', 'repositories']);
    });
    it('a question whose data is not set up dims nothing', () => {
        const bare = model.stations.map((s) => ({ ...s, cov: undefined }));
        expect(litStations('untested', bare, ctx())).toBeNull();
    });
    it('wrong lights stations with findings', () => expect(lit('wrong')).toEqual(['API', 'cron', 'repositories']));
    it('untested lights low coverage only where coverage exists', () => expect(lit('untested')).toEqual(['repositories']));
    it('patterns lights stations with patterns', () => expect(lit('patterns')).toEqual(['API']));
    it('changed lights nothing until something changed', () => expect(lit('changed')).toEqual([]));
    it('copied lights clone groups', () => expect(lit('copied')).toEqual(['repositories']));
    it('layers lights every station', () => expect(lit('layers')).toBeNull());
    it('callers lights interchanges, or the stations sharing a line with the selection', () => {
        expect(lit('callers')).toEqual(['API', 'repositories']);
        const web = model.stations.find((s) => s.name === 'Web app')!;
        expect(lit('callers', ctx({ selected: web }))).toEqual(['API', 'Web app', 'main.tsx', 'repositories']);
    });
});

describe('answerFor', () => {
    const surface = (lit: Set<string> | null, stations = model.stations) => ({ stations: { stations }, lit });
    it('reads the four answers: not set up, none, a count, and every station', () => {
        expect(answerFor('untested', surface(null, model.stations.map((s) => ({ ...s, cov: undefined }))))).toEqual({ kind: 'not-set-up' });
        expect(answerFor('changed', surface(new Set()))).toEqual({ kind: 'none' });
        expect(answerFor('wrong', surface(new Set(['a', 'b'])))).toEqual({ kind: 'count', count: 2 });
        expect(answerFor('layers', surface(null))).toEqual({ kind: 'all' });
    });
    it('puts the answer in words, from the labels', () => {
        expect(answerLine({ kind: 'none' }, L)).toBe(L.surface.answerNone);
        expect(answerLine({ kind: 'not-set-up' }, L)).toBe(L.surface.answerNotSetUp);
        expect(answerLine({ kind: 'count', count: 3 }, L)).toBe('3 stations');
        expect(answerLine({ kind: 'all' }, L)).toBe('');
    });
});

describe('status and notes', () => {
    it('says a question needs data that is not there', () => {
        expect(questionDef('untested').status(model.stations)).toBe('ready');
        expect(questionDef('untested').status(model.stations.map((s) => ({ ...s, cov: undefined })))).toBe('not-set-up');
        expect(questionDef('patterns').status(model.stations.map((s) => ({ ...s, patterns: [] })))).toBe('not-set-up');
    });
    it('is not set up for unused / copied / claims / knowledge when no file carries the reading', () => {
        const none = model.stations.map((s) => ({ ...s, dup: 0, unused: 0, claims: 0, facts: 0 }));
        for (const id of ['copied', 'unused', 'claims', 'knowledge'] as const) {
            expect(questionDef(id).status(none), id).toBe('not-set-up');
            expect(litStations(id, none, ctx()), id).toBeNull(); // dims nothing
        }
        // ready as soon as one station carries it
        expect(questionDef('copied').status(model.stations)).toBe('ready'); // the fixture has a clone group
        expect(questionDef('unused').status(none.map((s, i) => (i === 0 ? { ...s, unused: 2 } : s)))).toBe('ready');
        expect(questionDef('claims').status(none.map((s, i) => (i === 0 ? { ...s, claims: 1 } : s)))).toBe('ready');
        expect(questionDef('knowledge').status(none.map((s, i) => (i === 0 ? { ...s, facts: 1 } : s)))).toBe('ready');
    });

    it('narrows the patterns question to a family', () => {
        expect(lit('patterns', ctx({ family: 'repository' }))).toEqual(['API']);
        expect(lit('patterns', ctx({ family: 'nope' }))).toEqual([]);
        expect(lit('patterns', ctx({ family: null }))).toEqual(['API']);
    });

    it('notes what a lit station answers', () => {
        const api = model.stations.find((s) => s.name === 'API')!;
        expect(questionDef('patterns').note(api)).toEqual({ key: 'patterns', value: 'adapter · repository' });
        expect(questionDef('layers').note(api)).toEqual({ key: 'layers', value: 'presentation' });
        expect(questionDef('copied').note(api)).toBeNull();
    });
});
