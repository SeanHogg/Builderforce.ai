/**
 * knowledge/facts/importResolver.ts — THE import resolution of the FileFacts extractors (PRD 41 §B3): a specifier →
 * the root-relative FILE it names, given which files exist. JS/TS goes through the code pack's ONE module resolution
 * (`resolveImportPath`: relative, then the root's path aliases; then `moduleFileCandidates`: the TS source of a `.js`
 * import, a source extension, an `index` file). Python imports resolve to `<module>.py` or `<module>/__init__.py`,
 * relative ones from the importing file's package, absolute ones from the root. A package (or nothing in the listing) is
 * undefined. `exists` is the LISTING (never a disk probe), so resolution is a function of the listing alone.
 */

import { moduleFileCandidates } from '../codeRollup.js';
import { NO_MODULE_ALIASES, resolveImportPath, type ModuleAliases } from '../moduleAliases.js';
import type { ImportResolver } from './factsAst.js';

/**
 * The files a Python import may name, in the order tried: a relative one (`.models`, `..pkg.mod`) from the importing
 * file's package; an absolute one (`app.models`) from the root (an intra-repo module, when the listing holds it).
 */
export function pythonModuleCandidates(fromPath: string, specifier: string): string[] {
    const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;
    if (dots === 0) {
        const base = specifier.split('.').filter(Boolean).join('/');
        return base ? [`${base}.py`, `${base}/__init__.py`] : [];
    }
    const dir = fromPath.split('/').slice(0, -1);
    const up = dir.slice(0, Math.max(0, dir.length - (dots - 1)));
    if (dots - 1 > dir.length) return [];
    const rest = specifier.slice(dots).split('.').filter(Boolean);
    const base = [...up, ...rest].join('/');
    return rest.length === 0 ? [`${base ? `${base}/` : ''}__init__.py`] : [`${base}.py`, `${base}/__init__.py`];
}

/** A resolver over `exists(rootRelativeFile)` and the root's aliases. */
export function importResolver(exists: (file: string) => boolean, aliases: ModuleAliases = NO_MODULE_ALIASES): ImportResolver {
    return (fromPath, specifier) => {
        if (fromPath.endsWith('.py')) return pythonModuleCandidates(fromPath, specifier).find(exists);
        const modulePath = resolveImportPath(fromPath, specifier, aliases, (m) => moduleFileCandidates(m).some(exists));
        return modulePath === undefined ? undefined : moduleFileCandidates(modulePath).find(exists);
    };
}
