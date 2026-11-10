/**
 * rules/ilities/enginesChanged.ts — `engines-changed` (ilities.compatibility, warn; C7): a changed
 * `package.json` whose `engines` ranges differ between the sides (a runtime requirement raised, lowered
 * or dropped). A manifest that does not parse on either side, or a newly created one, is skipped.
 *
 * Measured: the parsed manifest, not a text heuristic.
 */

import type { DeltaRule, RuleFinding } from '../../contract.js';
import { filePairs, redact } from '../support/files.js';
import { ruleIdentity } from '../support/identity.js';

/** `{ node: '>=20', pnpm: '9' }` → `node >=20, pnpm 9`; `''` for none. */
function enginesOf(text: string): string | undefined {
    try {
        const engines = (JSON.parse(text) as { engines?: unknown }).engines;
        if (engines === undefined) return '';
        if (typeof engines !== 'object' || engines === null) return undefined;
        return Object.keys(engines).sort().map((k) => `${k} ${String((engines as Record<string, unknown>)[k])}`).join(', ');
    } catch { return undefined; }
}

export const enginesChanged: DeltaRule = {
    id: 'engines-changed',
    version: 1,
    dimension: 'ilities.compatibility',
    reads: ['content'],
    derive(input) {
        const after: RuleFinding[] = [];
        for (const p of filePairs(input)) {
            if (!/(^|\/)package\.json$/.test(p.path) || !p.before || !p.after) continue;
            const b = enginesOf(p.before.text), a = enginesOf(p.after.text);
            if (b === undefined || a === undefined || a === b) continue;
            after.push({
                identity: ruleIdentity(enginesChanged, 'package', p.path, { members: [p.path], snippet: a }),
                severity: 'warn',
                confidence: 'measured',
                params: { file: p.path, before: redact(b), after: redact(a) },
                evidence: [{ side: 'before', path: p.before.sidePath, note: redact(b) }, { side: 'after', path: p.after.sidePath, note: redact(a) }],
            });
        }
        return { before: [], after };
    },
};
