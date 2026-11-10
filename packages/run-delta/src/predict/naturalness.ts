/**
 * predict/naturalness.ts — unusual new code (PRD 41 §D6; Hindle et al., ICSE 2012; Ray et al., "On the Naturalness of Buggy
 * Code", ICSE 2016). Advisory only (§D0): a place to look, never a finding of a defect, never a verdict input.
 *
 *   surprisal(line) = −(1/|T|) Σ_{t∈T} log₂ p(t | context)        z = (surprisal − μ_repo) / σ_repo
 *
 * - The v1 scorer is the project-local token trigram (`ngram.ts`). The prefetch logprob seam scores single-token LABELS only,
 *   so it cannot score a line; a model-backed scorer needs a token-logprob port and ships under a new `modelVersion`.
 * - Only code files take part ({@link naturalnessLanguageOf}: agent-tools `isCodeLanguage(codeLanguageOf(path))`, so Markdown is
 *   out; SQL too, whose `--` comments are not masked), and each LANGUAGE has its own model, μ/σ and gates. The `oo` family is
 *   split by extension (Java, Kotlin, C#, Swift, PHP, Scala).
 * - The baseline is split BY FILE: per language, even-indexed files (in the order given: path order) train the model and
 *   odd-indexed files are held out for μ/σ. Held-out lines and the run's lines are both scored on files the model never saw,
 *   so a file-local identifier is equally unseen on both sides.
 * - Only CHANGED after-side lines (run-delta `changedLines`) with at least {@link MIN_LINE_TOKENS} code tokens are scored; above
 *   {@link MAX_SCORED_LINES} an even stride across them (agent-tools `strideSample`) is kept, never the first ones.
 * - `z > 3` is "unusual" (info). z is computed from the unquantized μ/σ; surprisal, μ, σ and z are then quantized to 0.01.
 * - Gates (each renders as nothing): the kill switch → `model-disabled`; no scorable changed line → `not-applicable`; per
 *   language, fewer than {@link MIN_BASELINE_LINES} held-out lines or σ = 0 → `insufficient-data`. The prediction is `ok` when
 *   any language is; else `insufficient-data` when any language had lines to score; else `not-applicable`.
 * - A count from a deterministic pass carries no interval, and §D0 defines no band thresholds for it: neither is set.
 *
 * The work is incremental ({@link naturalnessCollector}): a host plans the baseline files, then feeds them one at a time,
 * yielding between them. {@link MAX_BASELINE_LINES} is shared equally by the changed languages that have baseline files, and a
 * language's share equally by its files, each taking an even stride of its own lines — so no language, and no part of a
 * language, is starved by path order. Pure and deterministic: no randomness, no clock.
 */

import { strideSample } from '@builderforce/agent-tools/sampling';
import { codeLanguageOf, isCodeLanguage } from '@builderforce/agent-tools/code-mask';
import { sha256Hex } from '@seanhogg/builderforce-memory/retrieval';
import { meanAndSd } from '@seanhogg/builderforce-memory/stats';
import { changedLines } from '../dynamic/changedLines.js';
import { codeLineTokens, trainTrigram } from './ngram.js';
import type { Prediction, PredictionStatus } from './prediction.js';

export const NATURALNESS_PREDICTION_ID = 'naturalness.unusual-lines';
export const NATURALNESS_MODEL_ID = 'naturalness.trigram';
export const NATURALNESS_MODEL_VERSION = '1.2.0';
/** Bumped when tokenization, the line filter, the split or the sampling changes. */
export const NATURALNESS_SCHEMA_VERSION = 3;
/** §D6: changed lines scored per run, at most. */
export const MAX_SCORED_LINES = 2000;
/** §D6: baseline lines (both halves, all languages) held, at most. */
export const MAX_BASELINE_LINES = 20_000;
/** Held-out baseline lines (per language) below which the model has too little data. */
export const MIN_BASELINE_LINES = 200;
/** A line needs this many code tokens to be scored. */
export const MIN_LINE_TOKENS = 2;
/** §D6: `z > 3` is unusual. */
export const UNUSUAL_Z = 3;
/** §D6: values are quantized to 0.01 bits. */
export const SURPRISAL_STEP = 0.01;
/** The unusual lines named in a prediction's explanation. */
export const EXPLAINED_LINES = 3;

/** The language whose model scores `path` (`codeLanguageOf` when `isCodeLanguage`); undefined ⇒ not a code file, left out. */
export function naturalnessLanguageOf(path: string): string | undefined {
    const language = codeLanguageOf(path);
    if (!isCodeLanguage(language) || NOT_SCORED.has(language)) return undefined;
    if (language !== 'oo') return language;
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return OO_GROUPS[ext] ?? language;
}

/**
 * Code languages naturalness leaves out: SQL's `--` comments are not masked by `maskSource` (its comment families are `c` and
 * `hash`), so comment words would be scored as code. A naturalness rule only; SQL stays code for every other caller.
 */
const NOT_SCORED: ReadonlySet<string> = new Set(['sql']);

/** `codeLanguageOf`'s one `oo` family split by extension: each of these languages has its own idiom, so its own model. */
const OO_GROUPS: Readonly<Record<string, string>> = {
    java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', swift: 'swift', php: 'php', scala: 'scala',
};

/** Quantized to {@link SURPRISAL_STEP}, as an exact two-decimal number. */
const q = (v: number): number => Math.round(v / SURPRISAL_STEP) / Math.round(1 / SURPRISAL_STEP);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A file the run changed: `before` absent ⇒ the run created it (every line is new). */
export interface NaturalnessChangedFile {
    /** Root-relative POSIX path. */
    path: string;
    before?: string;
    after: string;
}

/** A file the run did not touch, as it was at the baseline: the repository's own code. */
export interface NaturalnessBaselineFile {
    path: string;
    text: string;
}

export interface NaturalnessInput {
    changed: readonly NaturalnessChangedFile[];
    baseline: readonly NaturalnessBaselineFile[];
    /** The kill switch (`builderforce.runDelta.predict.naturalness` off): `model-disabled`. */
    disabled?: boolean;
}

/** One unusual changed line: a place to look. */
export interface UnusualLine {
    path: string;
    /** 1-based after-side line. */
    line: number;
    language: string;
    /** Bits per token, quantized. */
    surprisal: number;
    z: number;
}

/** One language's model: its gate, its held-out baseline (n, μ_repo, σ_repo in bits per token, quantized) and what it scored. */
export interface NaturalnessLanguage {
    language: string;
    status: PredictionStatus;
    /** Model id and version plus the digest of this language's training AND held-out lines. */
    fingerprint: string;
    baseline: { trainFiles: number; heldOutFiles: number; heldOutLines: number; mean: number; sd: number };
    scoredLines: number;
    unusual: number;
}

/** The naturalness of one run in one repository: the prediction and the lines behind its count. */
export interface NaturalnessResult {
    /** `value` = the count of unusual lines across languages; `explanation` names them as `line#<k>` (an index into `unusual`). */
    prediction: Prediction;
    /** Sorted by z descending, then path and line. */
    unusual: UnusualLine[];
    /** Changed lines scored (≤ {@link MAX_SCORED_LINES}). */
    scoredLines: number;
    /** More changed lines were scorable than the cap. */
    capped: boolean;
    /** Sorted by language. */
    languages: NaturalnessLanguage[];
    /** Over every language's training and held-out lines. */
    fingerprint: string;
    trainingDigest: string;
    heldOutDigest: string;
}

interface ScorableLine {
    path: string;
    line: number;
    language: string;
    tokens: string[];
}

interface BaselineOf {
    files: number;
    train: string[][];
    heldOut: string[][];
    trainFiles: number;
    heldOutFiles: number;
}

/** Feeds a run's files one at a time: changed files FIRST (they choose the languages), then baseline files in path order. */
export interface NaturalnessCollector {
    addChanged(file: NaturalnessChangedFile): void;
    /** Changed lines that can be scored so far (0 ⇒ `not-applicable`: skip the baseline walk). */
    readonly scorableLines: number;
    /** The languages of the scorable changed lines: only these take baseline files. */
    readonly languages: ReadonlySet<string>;
    /**
     * Plans the baseline before any file is fed: the paths that will be fed. Each changed language gets an equal share of
     * {@link MAX_BASELINE_LINES}, and each of its planned files an equal share of that.
     */
    planBaseline(paths: readonly string[]): void;
    /** Adds one planned baseline file: at most its share of lines, an even stride across its eligible lines. */
    addBaseline(file: NaturalnessBaselineFile): void;
    finish(options?: { disabled?: boolean }): NaturalnessResult;
}

const linesDigest = (byLanguage: ReadonlyMap<string, readonly string[][]>): string =>
    sha256Hex([...byLanguage].sort(([a], [b]) => cmp(a, b)).map(([l, lines]) => `${l}\n${lines.map((t) => t.join(' ')).join('\n')}`).join('\u0001'));

const fingerprintOf = (digest: string): string => `${NATURALNESS_MODEL_ID}@${NATURALNESS_MODEL_VERSION}:${digest.slice(0, 16)}`;

/** μ and σ of the held-out surprisals; undefined when they cannot standardize (fewer than 2 finite values, or σ = 0). */
function spread(values: readonly number[]): { mean: number; sd: number } | undefined {
    const { n, mean, sd } = meanAndSd(values);
    return n >= 2 && sd > 0 ? { mean, sd } : undefined;
}

export function naturalnessCollector(): NaturalnessCollector {
    const scorable: ScorableLine[] = [];
    const languages = new Set<string>();
    const baseline = new Map<string, BaselineOf>();
    /** Planned baseline files per changed language ({@link NaturalnessCollector.planBaseline}). */
    const planned = new Map<string, number>();

    const scoreLanguage = (language: string, lines: readonly ScorableLine[]): { lang: NaturalnessLanguage; unusual: UnusualLine[] } => {
        const b = baseline.get(language) ?? { files: 0, train: [], heldOut: [], trainFiles: 0, heldOutFiles: 0 };
        const fingerprint = fingerprintOf(sha256Hex(`${b.train.map((t) => t.join(' ')).join('\n')}\u0001${b.heldOut.map((t) => t.join(' ')).join('\n')}`));
        const base = { trainFiles: b.trainFiles, heldOutFiles: b.heldOutFiles, heldOutLines: b.heldOut.length, mean: 0, sd: 0 };
        const none = (status: PredictionStatus) => ({ lang: { language, status, fingerprint, baseline: base, scoredLines: 0, unusual: 0 }, unusual: [] });
        if (b.heldOut.length < MIN_BASELINE_LINES || b.train.length === 0) return none('insufficient-data');
        const model = trainTrigram(b.train);
        const s = spread(b.heldOut.map((t) => model.surprisal(t)!));
        if (!s) return none('insufficient-data');
        const unusual = lines.flatMap((l) => {
            const raw = model.surprisal(l.tokens)!;
            const z = (raw - s.mean) / s.sd;
            return z > UNUSUAL_Z ? [{ path: l.path, line: l.line, language, surprisal: q(raw), z: q(z) }] : [];
        });
        return {
            lang: { language, status: 'ok', fingerprint, baseline: { ...base, mean: q(s.mean), sd: q(s.sd) }, scoredLines: lines.length, unusual: unusual.length },
            unusual,
        };
    };

    return {
        addChanged(file) {
            const language = naturalnessLanguageOf(file.path);
            if (language === undefined) return;
            const tokens = codeLineTokens(file.path, file.after);
            for (const line of changedLines(file.before, file.after)) {
                const t = tokens[line - 1] ?? [];
                if (t.length < MIN_LINE_TOKENS) continue;
                scorable.push({ path: file.path, line, language, tokens: t });
                languages.add(language);
            }
        },
        get scorableLines() { return scorable.length; },
        get languages() { return languages; },
        planBaseline(paths) {
            planned.clear();
            for (const p of paths) {
                const language = naturalnessLanguageOf(p);
                if (language !== undefined && languages.has(language)) planned.set(language, (planned.get(language) ?? 0) + 1);
            }
        },
        addBaseline(file) {
            const language = naturalnessLanguageOf(file.path);
            const files = language === undefined ? 0 : planned.get(language) ?? 0;
            if (language === undefined || files === 0) return; // not a changed language, or not planned
            const perFile = Math.max(1, Math.floor(Math.floor(MAX_BASELINE_LINES / planned.size) / files));
            const lines = strideSample(codeLineTokens(file.path, file.text).filter((t) => t.length >= MIN_LINE_TOKENS), perFile);
            if (lines.length === 0) return;
            let b = baseline.get(language);
            if (!b) baseline.set(language, (b = { files: 0, train: [], heldOut: [], trainFiles: 0, heldOutFiles: 0 }));
            if (b.files % 2 === 0) { b.train.push(...lines); b.trainFiles++; } else { b.heldOut.push(...lines); b.heldOutFiles++; }
            b.files++;
        },
        finish(options = {}) {
            const all = [...scorable].sort((a, b) => cmp(a.path, b.path) || a.line - b.line);
            const scored = strideSample(all, MAX_SCORED_LINES);
            const capped = all.length > scored.length;
            const trainingDigest = linesDigest(new Map([...baseline].map(([l, b]) => [l, b.train])));
            const heldOutDigest = linesDigest(new Map([...baseline].map(([l, b]) => [l, b.heldOut])));
            const inputDigest = sha256Hex(JSON.stringify({
                modelVersion: NATURALNESS_MODEL_VERSION, featureSchemaVersion: NATURALNESS_SCHEMA_VERSION, trainingDigest, heldOutDigest,
                scored: scored.map((l) => [l.path, l.line, l.tokens.join(' ')]),
            }));
            const per = options.disabled || scored.length === 0
                ? []
                : [...new Set(scored.map((l) => l.language))].sort(cmp).map((language) => scoreLanguage(language, scored.filter((l) => l.language === language)));
            const unusual = per.flatMap((p) => p.unusual).sort((a, b) => b.z - a.z || cmp(a.path, b.path) || a.line - b.line);
            const status: PredictionStatus = options.disabled ? 'model-disabled'
                : per.some((p) => p.lang.status === 'ok') ? 'ok'
                : per.length > 0 ? 'insufficient-data'
                : 'not-applicable';
            const ok = status === 'ok';
            return {
                prediction: {
                    id: NATURALNESS_PREDICTION_ID,
                    modelId: NATURALNESS_MODEL_ID,
                    modelVersion: NATURALNESS_MODEL_VERSION,
                    featureSchemaVersion: NATURALNESS_SCHEMA_VERSION,
                    value: ok ? unusual.length : 0,
                    explanation: ok ? unusual.slice(0, EXPLAINED_LINES).map((u, k) => ({ feature: `line#${k}`, contribution: u.z })) : [],
                    status,
                    inputDigest,
                },
                unusual: ok ? unusual : [],
                scoredLines: per.reduce((n, p) => n + p.lang.scoredLines, 0),
                capped,
                languages: per.map((p) => p.lang),
                fingerprint: fingerprintOf(sha256Hex(`${trainingDigest}${heldOutDigest}`)),
                trainingDigest,
                heldOutDigest,
            };
        },
    };
}

/**
 * The whole pass at once (tests, small inputs): the kill switch and `not-applicable` are decided before any baseline work,
 * then the baseline in path order.
 */
export function predictNaturalness(input: NaturalnessInput): NaturalnessResult {
    const c = naturalnessCollector();
    if (input.disabled) return c.finish({ disabled: true });
    for (const f of input.changed) c.addChanged(f);
    if (c.scorableLines === 0) return c.finish();
    const baseline = [...input.baseline].sort((a, b) => cmp(a.path, b.path));
    c.planBaseline(baseline.map((f) => f.path));
    for (const f of baseline) c.addBaseline(f);
    return c.finish();
}
