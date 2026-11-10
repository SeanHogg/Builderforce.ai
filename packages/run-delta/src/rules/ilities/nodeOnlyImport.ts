/**
 * rules/ilities/nodeOnlyImport.ts — `node-only-import` (ilities.flexibility, warn; C7 portability): a
 * browser module imports any Node builtin, or a Worker module imports a builtin the Workers runtime
 * does not provide even with `nodejs_compat` ({@link WORKER_UNSUPPORTED}). Layers come from
 * {@link layerOf}; type-only imports are erased and never count. One finding per (file, module).
 *
 * Heuristic: path/text layer detection; WS4 import facts by layer replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isTestPath, type TextView } from '../support/files.js';
import { importsOf, packageOf } from '../support/imports.js';
import { layerOf } from '../support/layers.js';
import { stateSides, type Hit } from '../support/stateRule.js';

/** Node builtins (rule data). */
export const NODE_BUILTINS: readonly string[] = [
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'events',
    'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring',
    'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];
/** Builtins Cloudflare Workers lack even under `nodejs_compat`. */
export const WORKER_UNSUPPORTED: readonly string[] = [
    'child_process', 'cluster', 'dgram', 'fs', 'http2', 'inspector', 'module', 'os', 'readline', 'repl', 'tty', 'v8', 'vm', 'worker_threads',
];
const BUILTINS: ReadonlySet<string> = new Set(NODE_BUILTINS);
const WORKER: ReadonlySet<string> = new Set(WORKER_UNSUPPORTED);

function hitsOf(view: TextView): Hit[] {
    const layer = layerOf(view);
    if (!layer) return [];
    const hits: Hit[] = [];
    for (const i of importsOf(view)) {
        if (i.typeOnly) continue;
        const name = packageOf(i.specifier);
        const builtin = i.specifier.startsWith('node:') || BUILTINS.has(name);
        if (!builtin || (layer === 'worker' && !WORKER.has(name))) continue;
        hits.push({ offset: i.offset, length: i.length, key: `${layer}:${name}`, params: { module: name } });
    }
    return hits;
}

export const nodeOnlyImport: DeltaRule = {
    id: 'node-only-import',
    version: 1,
    dimension: 'ilities.flexibility',
    reads: ['content'],
    derive(input) {
        return stateSides(nodeOnlyImport, { files: (p) => !isTestPath(p), hits: hitsOf, severity: 'warn', granularity: 'file' }, input);
    },
};
