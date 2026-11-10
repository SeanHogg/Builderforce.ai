/**
 * rules/capabilityAdded.ts — `capability-added` (security, warn; C5.3): a changed file uses a
 * capability (process execution, filesystem writes, network servers/clients, dynamic code, native
 * addons, environment reads) it did not use before. One finding per (file, capability); lineage makes
 * a capability the before side lacked `introduced`.
 *
 * Registry entry forms: `name(` a call, `a.b` a member access, `*suffix` a module-specifier suffix,
 * anything else an exact module specifier (`import … from`, `import()`, `require()`).
 *
 * Heuristic: text-level; WS4 tree-sitter `capabilityImports` facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { compileEntries, type EntryScanner } from './support/entryForms.js';
import { isCodePath, isTestPath, type TextView } from './support/files.js';
import { importsOf } from './support/imports.js';
import { stateSides, type Hit } from './support/stateRule.js';
import { strideCoverageOf, strideRows, type StrideCoverage } from './support/strideRows.js';

function hitsOf(view: TextView, c: EntryScanner): Hit[] {
    const hits: Hit[] = [];
    // One finding per (file, capability): only each capability's first use is needed.
    for (const h of c.firstPerKey(view.bare)) hits.push({ offset: h.offset, length: h.length, key: h.key, params: { via: h.entry } });
    // A module specifier needs an `import` or a `require`: a file with neither skips the import scan.
    if (c.specifiers.length > 0 && (view.code.includes('import') || view.code.includes('require'))) {
        // The shared, memoized import scan (one pass per view for every import-reading rule).
        for (const { offset, length, specifier: spec } of importsOf(view)) {
            for (const e of c.specifiers) {
                if (e.entry.startsWith('*') ? spec.endsWith(e.entry.slice(1)) : spec === e.entry) hits.push({ offset, length, key: e.key, params: { via: e.entry } });
            }
        }
    }
    return hits;
}

/** C5.7: the file's STRIDE checklist, from the coverage names it uses (a capability has no route chain). */
const strideParams = (coverage: StrideCoverage) => (view: TextView): Record<string, string> => strideRows(coverage.namesIn(view), coverage);

export const capabilityAdded: DeltaRule = {
    id: 'capability-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const compiled = compileEntries(input.registries.capabilities, 'any');
        const coverage = strideCoverageOf(input);
        return stateSides(capabilityAdded, {
            files: (p) => isCodePath(p) && !isTestPath(p),
            hits: (view) => hitsOf(view, compiled),
            fileParams: strideParams(coverage),
            severity: 'warn',
            granularity: 'file',
        }, input);
    },
};
