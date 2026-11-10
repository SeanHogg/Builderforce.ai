/**
 * rules/support/testedModules.ts — THE test ↔ implementation pairing of the run delta: which modules the run's
 * changed tests touch. A test touches a module when
 *
 *  - it imports it: a relative specifier resolving to it, a path ALIAS (`@/…`, `~/…`, `#…`) ending in its name, or
 *    an edge of the after side's import facts; or
 *  - it is its companion by name: `x.test.ts` / `x.spec.ts` beside it or under `__tests__/`, and the
 *    `__snapshots__/x.test.ts.snap` of such a test.
 *
 * Shared by `untested-change` (a changed module no changed test touches) and `out-of-scope-change` (a planned
 * module's own tests are in scope). Module names drop the extension and a trailing `/index`; computed once per
 * rule input.
 */

import type { RuleInput } from '../../contract.js';
import { filePairs, isSnapshotPath, isTestPath, perInput, type FilePair } from './files.js';
import { importsOf } from './imports.js';

/** A path-alias specifier (`@/x`, `~/x`, `#x`), as opposed to an npm package. */
const ALIAS = /^(?:@\/|~\/|#)/;

export const stripExt = (p: string): string => p.replace(/\.[cm]?[jt]sx?$/, '');
/** `src/a/index.ts` → `src/a`; `src/b.tsx` → `src/b`. */
export const moduleName = (p: string): string => stripExt(p).replace(/\/index$/, '');
/** The last segment of {@link moduleName}. */
export const baseName = (p: string): string => { const m = moduleName(p); return m.slice(m.lastIndexOf('/') + 1); };

/** `a/b/x.test.ts` + `../c` → `a/c`. */
export function resolveRelative(from: string, spec: string): string {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') parts.pop();
        else parts.push(seg);
    }
    return parts.join('/');
}

/**
 * The module a test or snapshot file is the companion of, by name: `src/a.test.ts`, `src/__tests__/a.test.ts`
 * and `src/__snapshots__/a.test.ts.snap` → `src/a`. Undefined for any other file.
 */
export function companionSubject(path: string): string | undefined {
    if (!isTestPath(path) && !isSnapshotPath(path)) return undefined;
    const dir = path.slice(0, path.lastIndexOf('/') + 1).replace(/(?:__tests__|__snapshots__)\/$/, '');
    const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.snap$/, '');
    const stem = file.replace(/\.(?:test|spec)(?=\.[cm]?[jt]sx?$)/, '');
    return moduleName(`${dir}${stem}`);
}

export interface TestedModules {
    /** Module names (see {@link moduleName}) the changed tests touch by import or by companion name. */
    modules: ReadonlySet<string>;
    /** Base names reached through a path alias (`@/lib/a` → `a`): matched by last segment only. */
    aliasBases: ReadonlySet<string>;
}

/** What ONE test or snapshot file (its after side) touches; empty for any other file. */
export function touchedBy(input: RuleInput, pair: FilePair): TestedModules {
    const modules = new Set<string>(), aliasBases = new Set<string>();
    const subject = companionSubject(pair.path);
    if (subject !== undefined) modules.add(subject);
    if (pair.after && isTestPath(pair.path)) {
        for (const dep of input.afterFacts.imports.get(pair.path) ?? []) modules.add(moduleName(dep));
        for (const imp of importsOf(pair.after)) {
            if (imp.specifier.startsWith('.')) modules.add(moduleName(resolveRelative(pair.path, stripExt(imp.specifier))));
            // Only a path ALIAS names a repo module; `react` or `@scope/pkg` never does.
            else if (ALIAS.test(imp.specifier)) aliasBases.add(baseName(imp.specifier));
        }
    }
    return { modules, aliasBases };
}

/** What the run's added or changed tests touch, together (once per rule input). */
export function testedModules(input: RuleInput): TestedModules {
    return perInput(input, 'testedModules', () => {
        const modules = new Set<string>(), aliasBases = new Set<string>();
        for (const t of filePairs(input)) {
            if (!t.after || t.after.text === t.before?.text) continue;
            const one = touchedBy(input, t);
            for (const m of one.modules) modules.add(m);
            for (const b of one.aliasBases) aliasBases.add(b);
        }
        return { modules, aliasBases };
    });
}

/** Whether a module NAME (see {@link moduleName}) is touched. */
export const touchesModule = (tested: TestedModules, module: string): boolean =>
    tested.modules.has(module) || tested.aliasBases.has(module.slice(module.lastIndexOf('/') + 1));

/** Whether the module at `path` is touched by the run's changed tests. */
export const isTested = (tested: TestedModules, path: string): boolean => touchesModule(tested, moduleName(path));
