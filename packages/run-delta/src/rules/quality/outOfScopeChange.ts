/**
 * rules/quality/outOfScopeChange.ts — `out-of-scope-change` (quality, warn; C8.3 scope drift): an in-run
 * changed file outside every area the run's plan named ({@link RuleInput.plannedPaths}: an exact file, a
 * folder ending in `/`, or a glob — matched by agent-tools `matchGlob`, the one glob matcher). One finding per
 * file, on the after side (a deleted file is reported against its before side).
 *
 * In scope without being named, because a change to them belongs to any plan:
 *  - the tests and snapshots of a planned file (the delta's one pairing, `support/testedModules.ts`: by import
 *    or by companion name);
 *  - package manifests and lockfiles;
 *  - any file under a planned folder.
 *
 * Heuristic: the plan is text a person wrote, read for paths. With no plan the rule does not apply — scope drift
 * is then `not measured` (`no-plan`), never "no drift".
 */

import { matchGlob } from '@builderforce/agent-tools/glob';
import type { DeltaRule, RuleFinding } from '../../contract.js';
import { filePairs } from '../support/files.js';
import { heuristicFinding, ruleIdentity } from '../support/identity.js';
import { moduleName, touchedBy, touchesModule } from '../support/testedModules.js';

/** Package manifests and lockfiles (any ecosystem): a dependency change rides along with any plan. */
const MANIFEST = /(^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|pyproject\.toml|poetry\.lock|uv\.lock|requirements[\w.-]*\.txt|Gemfile(?:\.lock)?|composer\.(?:json|lock))$/;

/** One plan entry → its matcher: a folder by prefix, a glob by `matchGlob`, a file exactly (or as a folder). */
function matcherOf(entry: string): (path: string) => boolean {
    const e = entry.replace(/^\.\//, '');
    if (e.endsWith('/')) return (p) => p.startsWith(e);
    if (e.includes('*') || e.includes('?')) return (p) => matchGlob(p, e);
    return (p) => p === e || p.startsWith(`${e}/`);
}

export const outOfScopeChange: DeltaRule = {
    id: 'out-of-scope-change',
    version: 2,
    dimension: 'quality',
    reads: ['content'],
    applies: (input) => input.plannedPaths !== undefined,
    skipReason: 'no-plan',
    derive(input) {
        const planned = (input.plannedPaths ?? []).map(matcherOf);
        const inPlan = (p: string): boolean => planned.some((m) => m(p));
        const plannedModules = new Set(input.changed.map((f) => f.path).filter(inPlan).map(moduleName));
        for (const e of input.plannedPaths ?? []) if (!e.endsWith('/') && !/[*?]/.test(e)) plannedModules.add(moduleName(e));
        const after: RuleFinding[] = [];
        for (const pair of filePairs(input)) {
            const p = pair.path;
            if (inPlan(p) || MANIFEST.test(p)) continue;
            const touched = touchedBy(input, pair);
            if ([...plannedModules].some((m) => touchesModule(touched, m))) continue; // a planned file's own test or snapshot
            const side = pair.after ? 'after' : 'before';
            after.push(heuristicFinding(
                ruleIdentity(outOfScopeChange, 'file', p, { members: [p] }),
                'warn',
                { file: p },
                [{ side, path: pair[side]?.sidePath ?? p }],
            ));
        }
        return { before: [], after };
    },
};
