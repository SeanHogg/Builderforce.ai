/**
 * The review's symbol lookup over a warm index (split out of `reviewRunner.ts`): a HIT uses the index's
 * definitions, a MISS the regex extractor.
 */

import { extractSymbols, type CodeSymbol } from '../symbols.js';
import type { SymbolSource } from './codePack.js';

/**
 * A SYNC symbol lookup over a warm index's files (`WorkspaceSymbolIndex.filesUnder()`),
 * falling back to the regex extractor for a file the index has not seen. `prefix` maps a
 * reviewed sub-folder's paths onto the index's workspace-relative ones.
 */
export function indexedSymbolSource(files: ReadonlyArray<{ path: string; symbols: readonly CodeSymbol[] }>, prefix = ''): SymbolSource {
    const lookup = indexedSymbolLookup(files, prefix);
    return (path, content) => lookup(path) ?? extractSymbols(path, content);
}

/**
 * The index's definitions of one reviewed file (a HIT), or undefined (a MISS). The ONE rule both extraction
 * paths share: a hit uses these symbols, a miss uses the regex extractor. `indexedSymbolSource` is this plus that
 * fallback; a host that extracts off-thread hands the hit to the worker as plain data in the job.
 */
export type SymbolLookup = (path: string) => readonly CodeSymbol[] | undefined;
export function indexedSymbolLookup(files: ReadonlyArray<{ path: string; symbols: readonly CodeSymbol[] }>, prefix = ''): SymbolLookup {
    const byPath = new Map(files.map((f) => [f.path.replace(/\\/g, '/'), f.symbols] as const));
    const base = prefix.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    return (path) => byPath.get(base ? `${base}/${path}` : path);
}
