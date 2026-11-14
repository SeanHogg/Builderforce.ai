/**
 * dynamic/mutation.ts — C8.4 incremental mutation testing, from StrykerJS's JSON report (the
 * mutation-testing-report-schema `mutation.json`) of each side, restricted to the run's changed files:
 *
 *  - `mutation.score` (metric, higher is better): (killed + timeout) / (killed + timeout + survived +
 *    no-coverage) over the changed files; compile/runtime errors, ignored and pending mutants do not count;
 *  - `mutant-survived` (info, measured), one per surviving or uncovered mutant, anchored by file, mutator,
 *    replacement and the mutated line's text (never its line number), so lineage tells new survivors from
 *    old ones. Info: the SCORE moves the verdict; the survivors are the evidence.
 */
import { normalizePath } from '../engine/text.js';
import { Ordinals, ruleIdentity } from '../rules/support/identity.js';
/** The surviving-mutant findings' rule (its metric rule is `mutant-survived.metrics`); `mutation` is the CHECK's id. */
export const MUTATION_RULE = { id: 'mutant-survived', version: 1 };
export const MUTATION_STEP = 0.0001;
export const MUTATION_THRESHOLD = { warn: 0.02, error: 0.05, kind: 'abs' };
const STATUSES = new Set(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'CompileError', 'RuntimeError', 'Ignored', 'Pending']);
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A report path as root-relative POSIX: `root` (absolute, the tree Stryker ran in) is stripped when it prefixes it. */
function relPath(file, root) {
    let p = normalizePath(file);
    if (root) {
        const r = normalizePath(root).replace(/\/+$/, '');
        const fold = /^[A-Za-z]:/.test(r) ? (s) => s.toLowerCase() : (s) => s;
        if (fold(p).startsWith(`${fold(r)}/`))
            p = p.slice(r.length + 1);
    }
    return p.replace(/^\.\//, '');
}
/** Parses a `mutation.json`. Undefined when it is not one (the run then counts as failed: `no-report`). */
export function parseMutationReport(json, root) {
    if (!isRecord(json) || !isRecord(json.files))
        return undefined;
    const mutants = [];
    for (const [file, raw] of Object.entries(json.files)) {
        if (!isRecord(raw) || !Array.isArray(raw.mutants))
            return undefined;
        const lines = typeof raw.source === 'string' ? raw.source.split(/\r?\n/) : undefined;
        const path = relPath(file, root);
        for (const m of raw.mutants) {
            if (!isRecord(m) || typeof m.status !== 'string' || !STATUSES.has(m.status))
                continue;
            const start = isRecord(m.location) && isRecord(m.location.start) ? m.location.start.line : undefined;
            const line = typeof start === 'number' && start > 0 ? start : 0;
            const text = lines?.[line - 1]?.trim();
            mutants.push({
                path,
                mutator: typeof m.mutatorName === 'string' ? m.mutatorName : '?',
                replacement: typeof m.replacement === 'string' ? m.replacement : '',
                line,
                status: m.status,
                ...(text ? { lineText: text } : {}),
            });
        }
    }
    const fw = isRecord(json.framework) ? json.framework : undefined;
    return { version: typeof fw?.version === 'string' ? fw.version : '', mutants };
}
const counted = (m) => m.status === 'Killed' || m.status === 'Timeout' || m.status === 'Survived' || m.status === 'NoCoverage';
const killed = (m) => m.status === 'Killed' || m.status === 'Timeout';
const survived = (m) => m.status === 'Survived' || m.status === 'NoCoverage';
function score(report, files) {
    if (!report)
        return null;
    const ms = report.mutants.filter((m) => files.has(m.path) && counted(m));
    return ms.length === 0 ? null : Math.round(ms.filter(killed).length / ms.length / MUTATION_STEP);
}
function survivors(report, files) {
    if (!report)
        return [];
    const ordinals = new Ordinals();
    const ms = report.mutants.filter((m) => files.has(m.path) && survived(m))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.mutator < b.mutator ? -1 : a.mutator > b.mutator ? 1 : 0)));
    return ms.map((m) => {
        const primary = `${m.path}:${m.mutator}:${m.replacement}`;
        const ordinal = ordinals.next(`${primary}~${m.lineText ?? ''}`);
        return {
            identity: ruleIdentity(MUTATION_RULE, 'file', primary, { members: [m.path], ...(m.lineText ? { snippet: m.lineText } : {}), ordinal }),
            severity: 'info',
            confidence: 'measured',
            params: { mutator: m.mutator, status: m.status },
            evidence: [{ side: 'after', path: m.path, ...(m.line ? { line: m.line } : {}), note: m.replacement }],
        };
    });
}
/**
 * The mutation measurement over `changedFiles` (root-relative). `before` absent: the before side was not
 * run, so the score's before is `null` and the survivors have no before side to match.
 */
export function mutationMeasurement(after, before, changedFiles) {
    const files = new Set(changedFiles.map(normalizePath));
    const beforeFindings = survivors(before, files).map((f) => ({ ...f, evidence: f.evidence.map((e) => ({ ...e, side: 'before' })) }));
    return {
        ruleId: MUTATION_RULE.id, ruleVersion: MUTATION_RULE.version, dimension: 'quality',
        findings: { before: beforeFindings, after: survivors(after, files) },
        metrics: [{
                metricId: 'mutation.score', before: score(before, files), after: score(after, files), step: MUTATION_STEP,
                unit: 'ratio', betterWhen: 'higher', threshold: MUTATION_THRESHOLD,
            }],
    };
}
//# sourceMappingURL=mutation.js.map