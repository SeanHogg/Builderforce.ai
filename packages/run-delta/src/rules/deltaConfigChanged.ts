/**
 * rules/deltaConfigChanged.ts — `delta-config-changed` (security, error; §12.5): the run created,
 * edited or deleted `.builderforce/delta.json`, the repo's own delta policy (guards, blocking rules,
 * I/O patterns). A run must not weaken its own gate: the host merges the BEFORE side's file
 * (`DimensionRegistry`), and this change itself blocks an autonomous run.
 *
 * Measured: a byte-level change of a named path, no heuristic involved.
 */

import type { DeltaRule, Evidence, RuleFinding } from '../contract.js';
import { DELTA_CONFIG_RULE } from '../registry/defaults.js';
import { filePairs } from './support/files.js';
import { ruleIdentity } from './support/identity.js';

export const DELTA_CONFIG_PATH = '.builderforce/delta.json';

export const deltaConfigChanged: DeltaRule = {
    id: DELTA_CONFIG_RULE,
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const p of filePairs(input)) {
            if (!(p.path === DELTA_CONFIG_PATH || p.path.endsWith(`/${DELTA_CONFIG_PATH}`))) continue;
            if (p.before?.text === p.after?.text) continue;
            const change = !p.before ? 'added' : !p.after ? 'deleted' : 'edited';
            const evidence: Evidence[] = [];
            if (p.before) evidence.push({ side: 'before', path: p.before.sidePath, note: change });
            if (p.after) evidence.push({ side: 'after', path: p.after.sidePath, note: change });
            after.push({
                identity: ruleIdentity(deltaConfigChanged, 'file', p.path, { members: [p.path] }),
                severity: 'error', confidence: 'measured', params: { file: p.path, change }, evidence,
            });
        }
        return { before: [], after };
    },
};
