/**
 * The review's symbol lookup over a warm index (split out of `reviewRunner.ts`): a HIT uses the index's
 * definitions, a MISS the regex extractor.
 */
import { extractSymbols } from '../symbols.js';
/**
 * A SYNC symbol lookup over a warm index's files (`WorkspaceSymbolIndex.filesUnder()`),
 * falling back to the regex extractor for a file the index has not seen. `prefix` maps a
 * reviewed sub-folder's paths onto the index's workspace-relative ones.
 */
export function indexedSymbolSource(files, prefix = '') {
    const lookup = indexedSymbolLookup(files, prefix);
    return (path, content) => lookup(path) ?? extractSymbols(path, content);
}
export function indexedSymbolLookup(files, prefix = '') {
    const byPath = new Map(files.map((f) => [f.path.replace(/\\/g, '/'), f.symbols]));
    const base = prefix.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    return (path) => byPath.get(base ? `${base}/${path}` : path);
}
//# sourceMappingURL=indexedSymbols.js.map