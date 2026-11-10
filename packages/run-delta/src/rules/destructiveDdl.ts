/**
 * rules/destructiveDdl.ts — `destructive-ddl` (ilities.safety, error; C7, the expand/contract rule):
 * `DROP TABLE`, `DROP COLUMN` or `TRUNCATE` in a changed `*.sql` file or any file under a `migrations`
 * directory. SQL `--` comment lines are skipped.
 *
 * Heuristic: text-level; WS4 migration facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { lineTextAt } from '../engine/text.js';
import { regexOffsets, stateSides } from './support/stateRule.js';

const DDL = /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/gi;

export const isMigrationPath = (path: string): boolean => /\.sql$/i.test(path) || /(^|\/)migrations?\//i.test(path);

export const destructiveDdl: DeltaRule = {
    id: 'destructive-ddl',
    version: 1,
    dimension: 'ilities.safety',
    reads: ['content'],
    derive(input) {
        return stateSides(destructiveDdl, {
            files: isMigrationPath,
            hits: (text) => regexOffsets(DDL, text)
                .filter(({ offset }) => !/^\s*--/.test(lineTextAt(text, offset)))
                .map(({ offset, match }) => ({ offset, key: match[1]!.toUpperCase().replace(/\s+/g, ' ') })),
            severity: 'error',
        }, input);
    },
};
