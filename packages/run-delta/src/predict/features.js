/**
 * predict/features.ts — the {@link RunFeatures} vector, frozen at run end (PRD 41 §D1, §D5 inputs).
 *
 * Features are REGISTRY DATA: each {@link FeatureDef} computes some of the {@link RunFeatureId}s from
 * {@link RunFeatureInputs}. A missing measurement is `null`, never zero.
 *
 * POINT IN TIME, AND THE LEAKAGE GUARD. A feature may only use data available at `finalizedAt`. STRUCTURALLY, every
 * timestamped list of the inputs is filtered to `finalizedAt` before any def runs ({@link pointInTime}), so `ctx.inputs`
 * holds no future. Timestamped data a def reaches any other way (a timestamp inside a value) is declared with
 * `ctx.source(at)`; after every def ran, {@link freezeRunFeatures} throws {@link FeatureLeakageError} when any declared
 * source is later than `finalizedAt`. `ctx.asOf` remains for defs that receive lists from elsewhere.
 *
 * Pure: no I/O, no clock (`finalizedAt` is an input). The digest is sha256 of the canonical numeric vector.
 */
import { sha256Hex } from '@seanhogg/builderforce-memory/retrieval';
import { ALL_DIMENSIONS } from '../registry/dimensions.js';
import { TEST_INTEGRITY_RULES } from '../registry/defaults.js';
import { RUN_FEATURES_SCHEMA_VERSION, } from './contract.js';
export class FeatureLeakageError extends Error {
    def;
    at;
    finalizedAt;
    constructor(def, at, finalizedAt) {
        super(`feature_leakage: '${def}' read data at ${at}, after the run ended at ${finalizedAt}`);
        this.def = def;
        this.at = at;
        this.finalizedAt = finalizedAt;
        this.name = 'FeatureLeakageError';
    }
}
/** Every dimension's `delta.<dim>.*` ids follow these; the canonical order is {@link FEATURE_IDS}. */
const LINEAGE_COUNTS = ['introduced', 'resolved', 'changed'];
export const FEATURE_IDS = [
    'size.linesAdded', 'size.linesDeleted', 'size.filesTouched',
    'spread.entropy', 'spread.entropyNormalized',
    'structure.centralitySum', 'structure.centralityMax', 'structure.entryPointsReached',
    'structure.layersTouched', 'structure.crossPartitionEdgesChanged',
    'history.churn90d', 'history.pastFollowupFixes', 'history.ageDaysMean',
    ...ALL_DIMENSIONS.flatMap((d) => LINEAGE_COUNTS.map((l) => `delta.${d}.${l}`)),
    'delta.integrityFindings', 'delta.testsChanged', 'delta.diffCoverage',
    'run.autonomous', 'run.steps', 'run.toolFailures',
    'people.priorRunsInRepo', 'people.priorChangesToTouchedFiles', 'people.tenureDays',
];
const DAY_MS = 24 * 60 * 60 * 1000;
const CHURN_DAYS = 90;
/** Features are stored quantized (D0: standardized features are quantized to 1e-4 at inference). */
const FEATURE_SCALE = 10_000;
export const FEATURE_STEP = 1 / FEATURE_SCALE;
const quantize = (v) => Math.round(v * FEATURE_SCALE) / FEATURE_SCALE;
const isTestPath = (path) => /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
/**
 * A file's added and deleted lines between two texts, as a line MULTISET difference (`undefined` text = the file did not
 * exist on that side). Deterministic and order-insensitive: a moved line counts as neither, which is the size measure the
 * features want (not a minimal edit script).
 */
export function lineDelta(before, after) {
    const count = (text) => {
        const m = new Map();
        if (text === undefined || text === '')
            return m;
        for (const line of text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'))
            m.set(line, (m.get(line) ?? 0) + 1);
        return m;
    };
    const b = count(before);
    const a = count(after);
    let added = 0;
    let deleted = 0;
    for (const [line, n] of a)
        added += Math.max(0, n - (b.get(line) ?? 0));
    for (const [line, n] of b)
        deleted += Math.max(0, n - (a.get(line) ?? 0));
    return { added, deleted };
}
/**
 * The inputs as they were at `finalizedAt`: every timestamped list filtered to items at or before it, BEFORE any def runs,
 * so a def cannot read the future even through `ctx.inputs` (the structural half of the leakage guard).
 */
export function pointInTime(inputs) {
    const end = Date.parse(inputs.finalizedAt);
    const keep = (items) => items === undefined ? undefined : items.filter((item) => Date.parse(item.at) <= end);
    const x = inputs.experience;
    return {
        ...inputs,
        ...(inputs.fileLines ? { fileLines: keep(inputs.fileLines) } : {}),
        ...(inputs.fileCommits ? { fileCommits: keep(inputs.fileCommits) } : {}),
        ...(inputs.fileBirths ? { fileBirths: keep(inputs.fileBirths) } : {}),
        ...(inputs.pastLabels ? { pastLabels: keep(inputs.pastLabels) } : {}),
        ...(x ? {
            experience: {
                ...(x.priorRuns ? { priorRuns: keep(x.priorRuns) } : {}),
                ...(x.priorChanges ? { priorChanges: keep(x.priorChanges) } : {}),
                ...(x.firstSeen && Date.parse(x.firstSeen.at) <= end ? { firstSeen: x.firstSeen } : {}),
            },
        } : {}),
    };
}
/** D2.1 change entropy (Hassan 2009) over the run's changed lines per file: H and H / log₂ n (0 when n ≤ 1). */
export function changeEntropy(linesPerFile) {
    const lines = linesPerFile.filter((n) => n > 0);
    const total = lines.reduce((a, b) => a + b, 0);
    if (lines.length === 0 || total === 0)
        return { entropy: 0, normalized: 0 };
    const entropy = lines.reduce((h, n) => h - (n / total) * Math.log2(n / total), 0);
    return { entropy, normalized: lines.length > 1 ? entropy / Math.log2(lines.length) : 0 };
}
const touchedPaths = (inputs) => inputs.fileLines?.map((f) => f.path) ?? inputs.delta?.impact.changedFiles ?? [];
/** The built-in defs of schema v1. */
export const FEATURE_DEFS = [
    {
        id: 'size-spread',
        compute({ inputs }) {
            if (!inputs.fileLines)
                return {};
            const added = inputs.fileLines.reduce((n, f) => n + f.added, 0);
            const deleted = inputs.fileLines.reduce((n, f) => n + f.deleted, 0);
            const { entropy, normalized } = changeEntropy(inputs.fileLines.map((f) => f.added + f.deleted));
            return {
                'size.linesAdded': added, 'size.linesDeleted': deleted, 'size.filesTouched': inputs.fileLines.length,
                'spread.entropy': entropy, 'spread.entropyNormalized': normalized,
            };
        },
    },
    {
        id: 'structure',
        compute({ inputs }) {
            const s = inputs.structure;
            const out = {};
            if (inputs.delta)
                out['structure.entryPointsReached'] = inputs.delta.impact.entryPoints.length;
            if (s?.centrality) {
                const scores = touchedPaths(inputs).map((p) => s.centrality[p] ?? 0);
                out['structure.centralitySum'] = scores.reduce((a, b) => a + b, 0);
                out['structure.centralityMax'] = scores.length > 0 ? Math.max(...scores) : 0;
            }
            if (s?.layersTouched !== undefined)
                out['structure.layersTouched'] = s.layersTouched;
            if (s?.crossPartitionEdgesChanged !== undefined)
                out['structure.crossPartitionEdgesChanged'] = s.crossPartitionEdgesChanged;
            return out;
        },
    },
    {
        id: 'history',
        compute(ctx) {
            const { inputs } = ctx;
            const touched = new Set(touchedPaths(inputs));
            const end = Date.parse(ctx.finalizedAt);
            const out = {};
            if (inputs.fileCommits) {
                out['history.churn90d'] = ctx.asOf(inputs.fileCommits)
                    .filter((c) => touched.has(c.path) && end - Date.parse(c.at) <= CHURN_DAYS * DAY_MS)
                    .reduce((n, c) => n + c.linesChanged, 0);
            }
            if (inputs.pastLabels) {
                out['history.pastFollowupFixes'] = ctx.asOf(inputs.pastLabels)
                    .filter((l) => l.label.kind === 'followup-fix' && l.label.value === true
                    && l.label.eventAt !== undefined && Date.parse(l.label.eventAt) <= end)
                    .filter((l) => l.paths.some((p) => touched.has(p))).length;
            }
            if (inputs.fileBirths) {
                const ages = ctx.asOf(inputs.fileBirths).filter((b) => touched.has(b.path)).map((b) => (end - Date.parse(b.at)) / DAY_MS);
                out['history.ageDaysMean'] = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
            }
            return out;
        },
    },
    {
        id: 'delta',
        compute({ inputs }) {
            const out = {};
            if (inputs.delta) {
                // Every C8.2 rule's fresh finding, warn-level included (suppression, timeout, snapshot and — since
                // WS9 — `catch-all-added`), not only the blocking errors: the feature measures how much the run
                // touched test integrity, and a model trained before WS9 sees catch-all warns raise it.
                const integrity = new Set(TEST_INTEGRITY_RULES);
                let integrityFindings = 0;
                for (const d of inputs.delta.dimensions) {
                    for (const lineage of LINEAGE_COUNTS) {
                        out[`delta.${d.id}.${lineage}`] = d.findings.filter((f) => f.lineage === lineage).length;
                    }
                    integrityFindings += d.findings.filter((f) => integrity.has(f.ruleId) && (f.lineage === 'introduced' || f.lineage === 'changed')).length;
                }
                out['delta.integrityFindings'] = integrityFindings;
            }
            const paths = touchedPaths(inputs);
            if (inputs.fileLines || inputs.delta)
                out['delta.testsChanged'] = paths.filter(isTestPath).length;
            if (inputs.diffCoverage !== undefined)
                out['delta.diffCoverage'] = inputs.diffCoverage;
            return out;
        },
    },
    {
        id: 'run',
        compute({ inputs }) {
            return {
                'run.autonomous': inputs.mode === 'autonomous' ? 1 : 0,
                ...(inputs.run?.steps !== undefined ? { 'run.steps': inputs.run.steps } : {}),
                ...(inputs.run?.toolFailures !== undefined ? { 'run.toolFailures': inputs.run.toolFailures } : {}),
            };
        },
    },
    {
        id: 'experience',
        compute(ctx) {
            const x = ctx.inputs.experience;
            if (!x)
                return {};
            const touched = new Set(touchedPaths(ctx.inputs));
            const out = {};
            if (x.priorRuns)
                out['people.priorRunsInRepo'] = ctx.asOf(x.priorRuns).length;
            if (x.priorChanges)
                out['people.priorChangesToTouchedFiles'] = ctx.asOf(x.priorChanges).filter((c) => touched.has(c.path)).length;
            if (x.firstSeen) {
                const [first] = ctx.asOf([x.firstSeen]);
                out['people.tenureDays'] = first ? (Date.parse(ctx.finalizedAt) - Date.parse(first.at)) / DAY_MS : null;
            }
            return out;
        },
    },
];
/**
 * Every feature schema version a reader still ACCEPTS, with its canonical id list: the current one plus each earlier one
 * kept listed. A record is stored under its own version, and a fit never mixes two versions. Removing a version here
 * makes its records permanently unsupported; a version above {@link RUN_FEATURES_SCHEMA_VERSION} is from a newer client.
 */
export const FEATURE_IDS_BY_SCHEMA = {
    [RUN_FEATURES_SCHEMA_VERSION]: FEATURE_IDS,
};
/** The canonical numeric vector, in `ids` order (default: the current schema's), as text (`null` kept). */
export const canonicalFeatures = (values, ids = FEATURE_IDS) => JSON.stringify(ids.map((id) => [id, values[id] ?? null]));
export const featureDigest = (values, ids = FEATURE_IDS) => sha256Hex(canonicalFeatures(values, ids));
/**
 * Freezes the run's features: runs every def, refuses any that read past `finalizedAt` ({@link FeatureLeakageError}),
 * quantizes, and digests. `defs` defaults to {@link FEATURE_DEFS}; tests pass fixtures.
 */
export function freezeRunFeatures(raw, defs = FEATURE_DEFS) {
    const finalizedAt = raw.finalizedAt;
    const end = Date.parse(finalizedAt);
    if (!Number.isFinite(end))
        throw new Error(`feature_finalized_at_invalid: ${finalizedAt}`);
    const inputs = pointInTime(raw);
    const values = Object.fromEntries(FEATURE_IDS.map((id) => [id, null]));
    for (const def of defs) {
        const sources = [];
        const ctx = {
            inputs, finalizedAt,
            asOf: (items) => (items ?? []).filter((item) => {
                const ok = Date.parse(item.at) <= end;
                if (ok)
                    sources.push(item.at);
                return ok;
            }),
            source: (at) => { sources.push(at); },
        };
        const out = def.compute(ctx);
        const late = sources.find((at) => !(Date.parse(at) <= end));
        if (late !== undefined)
            throw new FeatureLeakageError(def.id, late, finalizedAt);
        for (const [id, v] of Object.entries(out)) {
            if (!(id in values))
                throw new Error(`feature_unknown: '${def.id}' wrote '${id}'`);
            values[id] = v === null || !Number.isFinite(v) ? null : quantize(v);
        }
    }
    return {
        schemaVersion: RUN_FEATURES_SCHEMA_VERSION,
        runId: inputs.runId,
        repository: inputs.repository,
        finalizedAt,
        values,
        run: { entryPoint: inputs.entryPoint, mode: inputs.mode, modelTier: inputs.modelTier ?? null },
        people: { ...(inputs.people ?? {}) },
        digest: featureDigest(values),
    };
}
//# sourceMappingURL=features.js.map