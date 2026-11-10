import { describe, expect, it } from 'vitest';
import { codeLanguageOf } from '@builderforce/agent-tools/code-mask';
import { codeLineTokens, trainTrigram } from './ngram.js';
import {
    MAX_SCORED_LINES, MIN_BASELINE_LINES, NATURALNESS_MODEL_ID, NATURALNESS_PREDICTION_ID, UNUSUAL_Z, naturalnessCollector, naturalnessLanguageOf, predictNaturalness,
    type NaturalnessBaselineFile,
} from './naturalness.js';

/** A repository file: a few shapes, varied by index, and an identifier (`local`) no other file uses. */
function repoFile(path: string, n: number, local = 'shared', offset = 0): NaturalnessBaselineFile {
    const lines: string[] = [];
    for (let k = offset; k < offset + n; k++) {
        lines.push(`export function ${local}Handler${k % 11}(input: string): number {`);
        lines.push(`    const value${k % 7} = ${local}Compute(item${k % 5}, ${k % 3});`);
        lines.push(`    if (value${k % 7} > limit) return value${k % 7};`);
        lines.push(`    return input.length + ${k % 4};`);
        lines.push('}');
    }
    return { path, text: lines.join('\n') };
}

const LOCALS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
/** Ten files, each with its own local identifier: five train, five are held out. */
const BASELINE = LOCALS.map((local, i) => repoFile(`src/${local}.ts`, 30, local, i * 3));
const BEFORE = ['export function handler1(input: string): number {', '    return input.length + 1;', '}'].join('\n');
const AFTER = [
    'export function handler1(input: string): number {',
    '    const value2 = sharedCompute(item3, 1);',
    '    // a comment ^^^ $$$ ~~~ is never scored',
    '    x ^= ~~y >>> 3 ?? (q as never)!.z % @w;',
    '    return input.length + 1;',
    '}',
].join('\n');

describe('naturalness (PRD 41 §D6)', () => {
    it('flags the unusual changed line, and only it, deterministically, naming it by code', () => {
        const input = { changed: [{ path: 'src/c.ts', before: BEFORE, after: AFTER }], baseline: BASELINE };
        const first = predictNaturalness(input);
        expect(predictNaturalness(input)).toEqual(first);
        expect(first.prediction).toMatchObject({ id: NATURALNESS_PREDICTION_ID, modelId: NATURALNESS_MODEL_ID, status: 'ok', value: 1 });
        expect(first.scoredLines).toBe(2); // the comment line has no code tokens
        expect(first.unusual.map((u) => [u.path, u.line])).toEqual([['src/c.ts', 4]]);
        expect(first.unusual[0]!.z).toBeGreaterThan(UNUSUAL_Z);
        expect(first.prediction.explanation).toEqual([{ feature: 'line#0', contribution: first.unusual[0]!.z }]);
        expect(first.prediction.interval).toBeUndefined();
        expect(first.prediction.inputDigest).toMatch(/^[0-9a-f]{64}$/);
        for (const v of [first.languages[0]!.baseline.mean, first.languages[0]!.baseline.sd, first.unusual[0]!.surprisal, first.unusual[0]!.z]) {
            expect(Math.round(v * 100) / 100).toBe(v);
        }
    });

    it('splits the baseline by FILE: an idiomatic line using a file-local identifier is not unusual', () => {
        const after = [
            'export function zorblaxHandler3(input: string): number {',
            '    const value2 = zorblaxCompute(item3, 1);',
            '    if (value2 > limit) return value2;',
            '    return input.length + 2;',
            '}',
        ].join('\n');
        const result = predictNaturalness({ changed: [{ path: 'src/zorblax.ts', after }], baseline: BASELINE });
        expect(result.prediction.status).toBe('ok');
        expect(result.languages[0]!.baseline).toMatchObject({ trainFiles: 5, heldOutFiles: 5 });
        expect(result.unusual).toEqual([]);
    });

    it('pins μ, σ and z on a fixed corpus (golden numbers)', () => {
        const result = predictNaturalness({ changed: [{ path: 'src/c.ts', before: BEFORE, after: AFTER }], baseline: BASELINE });
        const lang = result.languages[0]!;
        expect([lang.baseline.heldOutLines, lang.baseline.mean, lang.baseline.sd, result.unusual[0]!.surprisal, result.unusual[0]!.z])
            .toEqual(GOLDEN);
    });

    it('is independent of the order files arrive in', () => {
        const changed = [{ path: 'src/c.ts', before: BEFORE, after: AFTER }, { path: 'src/d.ts', after: AFTER }];
        expect(predictNaturalness({ changed: [...changed].reverse(), baseline: [...BASELINE].reverse() }))
            .toEqual(predictNaturalness({ changed, baseline: BASELINE }));
    });

    it('answers insufficient-data below the held-out threshold, and for a flat baseline (σ = 0)', () => {
        const small = predictNaturalness({ changed: [{ path: 'src/c.ts', before: BEFORE, after: AFTER }], baseline: BASELINE.slice(0, 2) });
        expect(small.languages[0]!.baseline.heldOutLines).toBeLessThan(MIN_BASELINE_LINES);
        expect(small.prediction).toMatchObject({ status: 'insufficient-data', value: 0, explanation: [] });
        expect(small.unusual).toEqual([]);

        const flatText = Array.from({ length: 400 }, () => 'const a = b;').join('\n');
        const flat = predictNaturalness({
            changed: [{ path: 'src/c.ts', before: BEFORE, after: AFTER }],
            baseline: [{ path: 'src/f1.ts', text: flatText }, { path: 'src/f2.ts', text: flatText }],
        });
        expect(flat.languages[0]!.baseline.heldOutLines).toBeGreaterThanOrEqual(MIN_BASELINE_LINES);
        expect(flat.prediction.status).toBe('insufficient-data');
    });

    it('is not-applicable with no scorable changed line, and model-disabled under the kill switch, before any baseline work', () => {
        const c = naturalnessCollector();
        c.addChanged({ path: 'src/c.ts', before: BEFORE, after: BEFORE });
        expect(c.scorableLines).toBe(0);
        expect(c.finish().prediction.status).toBe('not-applicable');
        expect(predictNaturalness({ changed: [{ path: 'src/c.ts', after: AFTER }], baseline: BASELINE, disabled: true }).prediction.status)
            .toBe('model-disabled');
    });

    it(`scores at most ${MAX_SCORED_LINES} changed lines, spread across them`, () => {
        const many = Array.from({ length: MAX_SCORED_LINES * 2 }, (_, i) => `const v${i} = f(${i});`).join('\n');
        const result = predictNaturalness({ changed: [{ path: 'src/big.ts', after: many }], baseline: BASELINE });
        expect(result.scoredLines).toBe(MAX_SCORED_LINES);
        expect(result.capped).toBe(true);
    });

    it('keeps one model per language: a .md file is ignored and a .py minority is not pooled into the .ts baseline', () => {
        const py = Array.from({ length: 20 }, (_, k) => `def handler${k % 5}(value):\n    return value + ${k % 3}`).join('\n');
        const result = predictNaturalness({
            changed: [
                { path: 'src/c.ts', before: BEFORE, after: AFTER },
                { path: 'docs/notes.md', after: 'x ^= ~~y >>> 3 ?? weird @@ words\nmore ^^ text here' },
                { path: 'tools/run.py', after: 'def run(value):\n    return value ** 2 // 7' },
            ],
            baseline: [...BASELINE, { path: 'tools/a.py', text: py }, { path: 'tools/b.py', text: py }],
        });
        const ts = codeLanguageOf('a.ts')!;
        const python = codeLanguageOf('a.py')!;
        expect(naturalnessLanguageOf('a.md')).toBeUndefined();
        expect(result.languages.map((l) => [l.language, l.status])).toEqual([[python, 'insufficient-data'], [ts, 'ok']].sort());
        expect(result.languages.find((l) => l.language === ts)!.baseline).toMatchObject({ trainFiles: 5, heldOutFiles: 5 });
        expect(result.prediction.status).toBe('ok');
        expect(result.unusual.every((u) => u.path === 'src/c.ts')).toBe(true);
    });
});

describe('naturalness baseline budget and language keys (PRD 41 §D6)', () => {
    const pyFile = (path: string, n: number, local: string): NaturalnessBaselineFile => ({
        path,
        text: Array.from({ length: n }, (_, k) => [
            `def ${local}_handler${k % 5}(value):`,
            `    total = ${local}_compute(value, ${k % 7})`,
            `    return total + ${k % 3}`,
        ].join('\n')).join('\n'),
    });

    it('shares the line cap between languages: a large .ts baseline sorted first does not starve .py', () => {
        // 10 × 2,000 eligible .ts lines alone fill MAX_BASELINE_LINES; the .py files sort after them.
        const ts = LOCALS.map((l, i) => repoFile(`a/${l}.ts`, 500, l, i * 3));
        const py = LOCALS.map((l) => pyFile(`z/${l}.py`, 100, l));
        const result = predictNaturalness({
            changed: [
                { path: 'a/new.ts', after: 'export function sharedHandler1(input: string): number {\n    const value2 = sharedCompute(item3, 1);\n}' },
                { path: 'z/new.py', after: 'def shared_handler1(value):\n    total = shared_compute(value, 2)\n    return total + 1' },
            ],
            baseline: [...ts, ...py],
        });
        expect(result.languages.map((l) => l.status)).toEqual(['ok', 'ok']);
        const python = result.languages.find((l) => l.language === naturalnessLanguageOf('a.py'))!;
        expect(python.baseline).toMatchObject({ trainFiles: 5, heldOutFiles: 5, heldOutLines: 1500 });
    });

    it('keys models by language, not symbol family, and leaves SQL out (its -- comments are not masked)', () => {
        expect(['A.java', 'a.kt', 'a.kts', 'a.cs', 'a.swift', 'a.php', 'a.scala'].map(naturalnessLanguageOf))
            .toEqual(['java', 'kotlin', 'kotlin', 'csharp', 'swift', 'php', 'scala']);
        expect(naturalnessLanguageOf('q.sql')).toBeUndefined();
        expect(naturalnessLanguageOf('a.ts')).toBe(naturalnessLanguageOf('b.js'));
        const result = predictNaturalness({ changed: [{ path: 'db/q.sql', after: 'select a, b from t; -- weird ^^ $$ words\nselect c from u;' }], baseline: [] });
        expect(result.prediction.status).toBe('not-applicable');
    });
});

describe('trigram', () => {
    it('masks comments and strings out of the tokens', () => {
        const tokens = codeLineTokens('a.ts', 'const s = "a b c"; // note')[0]!;
        expect(tokens).not.toContain('note');
        expect(tokens).not.toContain('a');
        expect(tokens.slice(0, 3)).toEqual(['const', 's', '=']);
        expect(codeLineTokens('a.ts', '/* one\n two */\nlet x = 1;')).toEqual([[], [], ['let', 'x', '=', '1', ';']]);
    });

    it('gives seen code fewer bits than unseen code', () => {
        const model = trainTrigram([['const', 'a', '=', '1', ';'], ['const', 'b', '=', '2', ';']]);
        expect(model.surprisal(['const', 'a', '=', '1', ';'])!).toBeLessThan(model.surprisal(['%', '@', '#'])!);
        expect(model.surprisal([])).toBeUndefined();
    });

    it('sums to 1 over the V + 1 outcomes in every context', () => {
        const model = trainTrigram([['const', 'a', '=', '1', ';'], ['const', 'b', '=', 'a', ';'], ['let', 'a', '=', 'b', ';']]);
        const unseen = '\u0007never-seen';
        for (const [u, v] of [[undefined, undefined], [undefined, 'const'], ['const', 'a'], ['a', '='], ['zz', 'yy']] as const) {
            const total = model.seen.reduce((s, w) => s + model.probability(u, v, w), 0) + model.probability(u, v, unseen);
            expect(total).toBeCloseTo(1, 12);
        }
    });
});

/** heldOutLines, μ, σ, the unusual line's surprisal and z — recorded from this corpus; a change here is a model change. */
const GOLDEN: number[] = [600, 1.62, 1.07, 12.43, 10.12];
