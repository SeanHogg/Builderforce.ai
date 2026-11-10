/**
 * rules/syncIo.ts — `sync-io` (performance, warn; C6.1 `sync-io-on-hot-path`, without the reachability
 * filter yet): a blocking `*Sync(` fs or child_process call in a changed, non-test JS/TS file, over
 * masked source.
 *
 * Heuristic: text-level, not yet limited to code reachable from an entry point; WS4 tree-sitter call
 * facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { isJsPath, isTestPath } from './support/files.js';
import { regexHits, stateSides } from './support/stateRule.js';

/** The blocking fs / child_process calls (rule data). */
export const SYNC_IO_CALLS: readonly string[] = [
    'accessSync', 'appendFileSync', 'chmodSync', 'copyFileSync', 'cpSync', 'execFileSync', 'execSync', 'existsSync',
    'lstatSync', 'mkdirSync', 'mkdtempSync', 'openSync', 'readFileSync', 'readSync', 'readdirSync', 'readlinkSync',
    'realpathSync', 'renameSync', 'rmSync', 'rmdirSync', 'spawnSync', 'statSync', 'symlinkSync', 'truncateSync',
    'unlinkSync', 'writeFileSync', 'writeSync',
];

const CALL = new RegExp(`(?<![\\w$])(${SYNC_IO_CALLS.join('|')})\\s*\\(`, 'g');

export const syncIo: DeltaRule = {
    id: 'sync-io',
    version: 1,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        return stateSides(syncIo, {
            files: (p) => isJsPath(p) && !isTestPath(p),
            hits: (view) => regexHits(CALL, view.bare).map(({ offset, match }) => ({ offset, length: match[0].length, key: match[1]! })),
            severity: 'warn',
        }, input);
    },
};
