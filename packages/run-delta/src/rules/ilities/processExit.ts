/**
 * rules/ilities/processExit.ts — `process-exit` (ilities.reliability, warn; C7): `process.exit(…)` in
 * library code — a changed non-test JS/TS file that is not a script, a `bin/` or `cli/` entry, or a
 * `cli.*` / `main.*` / `bin.*` module, or a `#!` executable. Library code that exits kills its host instead
 * of reporting.
 *
 * Heuristic: text-level; WS4 call facts replace it.
 */

import type { DeltaRule } from '../../contract.js';
import { isJsPath, isTestPath } from '../support/files.js';
import { isScriptPath } from '../support/scripts.js';
import { regexHits, stateSides } from '../support/stateRule.js';
import { glued } from '../support/statements.js';

// Literal-led; a match glued to an identifier or `.` (`myprocess.exit(`, `x.process.exit(`) is dropped after.
const EXIT = /process\s*\.\s*(?:exit|abort)\s*\(/g;

export const isEntryScriptPath = (path: string): boolean =>
    isScriptPath(path) || /(^|\/)(?:bin|cli)\//.test(path) || /(^|\/)(?:cli|main|bin)\.[cm]?[jt]s$/.test(path);

export const processExit: DeltaRule = {
    id: 'process-exit',
    version: 1,
    dimension: 'ilities.reliability',
    reads: ['content'],
    derive(input) {
        return stateSides(processExit, {
            files: (p) => isJsPath(p) && !isTestPath(p) && !isEntryScriptPath(p),
            // A `#!` file is an executable entry script, whatever its path.
            hits: (view) => (view.text.startsWith('#!') ? [] : regexHits(EXIT, view.bare)
                .filter(({ offset }) => !glued(view.bare, offset))
                .map(({ offset, match }) => ({ offset, length: match[0].length, key: 'process.exit' }))),
            severity: 'warn',
        }, input);
    },
};
