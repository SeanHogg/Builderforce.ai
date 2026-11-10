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

import type { MetricDelta, RuleFinding } from '../contract.js';
import { normalizePath } from '../engine/text.js';
import { Ordinals, ruleIdentity } from '../rules/support/identity.js';
import type { DynamicMeasurement } from './contract.js';

/** The surviving-mutant findings' rule (its metric rule is `mutant-survived.metrics`); `mutation` is the CHECK's id. */
export const MUTATION_RULE = { id: 'mutant-survived', version: 1 } as const;
export const MUTATION_STEP = 0.0001;
export const MUTATION_THRESHOLD: MetricDelta['threshold'] = { warn: 0.02, error: 0.05, kind: 'abs' };

export type MutantStatus = 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'CompileError' | 'RuntimeError' | 'Ignored' | 'Pending';

export interface Mutant {
    /** Root-relative POSIX path. */
    path: string;
    mutator: string;
    replacement: string;
    line: number;
    status: MutantStatus;
    /** The mutated line's text, trimmed (absent when the report has no source). */
    lineText?: string;
}

export interface MutationReport {
    /** StrykerJS version (`framework.version`), `''` when absent. */
    version: string;
    mutants: Mutant[];
}

const STATUSES: ReadonlySet<string> = new Set(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'CompileError', 'RuntimeError', 'Ignored', 'Pending']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A report path as root-relative POSIX: `root` (absolute, the tree Stryker ran in) is stripped when it prefixes it. */
function relPath(file: string, root: string | undefined): string {
    let p = normalizePath(file);
    if (root) {
        const r = normalizePath(root).replace(/\/+$/, '');
        const fold = /^[A-Za-z]:/.test(r) ? (s: string) => s.toLowerCase() : (s: string) => s;
        if (fold(p).startsWith(`${fold(r)}/`)) p = p.slice(r.length + 1);
    }
    return p.replace(/^\.\//, '');
}

/** Parses a `mutation.json`. Undefined when it is not one (the run then counts as failed: `no-report`). */
export function parseMutationReport(json: unknown, root?: string): MutationReport | undefined {
    if (!isRecord(json) || !isRecord(json.files)) return undefined;
    const mutants: Mutant[] = [];
    for (const [file, raw] of Object.entries(json.files)) {
        if (!isRecord(raw) || !Array.isArray(raw.mutants)) return undefined;
        const lines = typeof raw.source === 'string' ? raw.source.split(/\r?\n/) : undefined;
        const path = relPath(file, root);
        for (const m of raw.mutants) {
            if (!isRecord(m) || typeof m.status !== 'string' || !STATUSES.has(m.status)) continue;
            const start = isRecord(m.location) && isRecord(m.location.start) ? m.location.start.line : undefined;
            const line = typeof start === 'number' && start > 0 ? start : 0;
            const text = lines?.[line - 1]?.trim();
            mutants.push({
                path,
                mutator: typeof m.mutatorName === 'string' ? m.mutatorName : '?',
                replacement: typeof m.replacement === 'string' ? m.replacement : '',
                line,
                status: m.status as MutantStatus,
                ...(text ? { lineText: text } : {}),
            });
        }
    }
    const fw = isRecord(json.framework) ? json.framework : undefined;
    return { version: typeof fw?.version === 'string' ? fw.version : '', mutants };
}

const counted = (m: Mutant): boolean => m.status === 'Killed' || m.status === 'Timeout' || m.status === 'Survived' || m.status === 'NoCoverage';
const killed = (m: Mutant): boolean => m.status === 'Killed' || m.status === 'Timeout';
const survived = (m: Mutant): boolean => m.status === 'Survived' || m.status === 'NoCoverage';

function score(report: MutationReport | undefined, files: ReadonlySet<string>): number | null {
    if (!report) return null;
    const ms = report.mutants.filter((m) => files.has(m.path) && counted(m));
    return ms.length === 0 ? null : Math.round(ms.filter(killed).length / ms.length / MUTATION_STEP);
}

function survivors(report: MutationReport | undefined, files: ReadonlySet<string>): RuleFinding[] {
    if (!report) return [];
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
export function mutationMeasurement(after: MutationReport, before: MutationReport | undefined, changedFiles: readonly string[]): DynamicMeasurement {
    const files = new Set(changedFiles.map(normalizePath));
    const beforeFindings = survivors(before, files).map((f) => ({ ...f, evidence: f.evidence.map((e) => ({ ...e, side: 'before' as const })) }));
    return {
        ruleId: MUTATION_RULE.id, ruleVersion: MUTATION_RULE.version, dimension: 'quality',
        findings: { before: beforeFindings, after: survivors(after, files) },
        metrics: [{
            metricId: 'mutation.score', before: score(before, files), after: score(after, files), step: MUTATION_STEP,
            unit: 'ratio', betterWhen: 'higher', threshold: MUTATION_THRESHOLD,
        }],
    };
}
