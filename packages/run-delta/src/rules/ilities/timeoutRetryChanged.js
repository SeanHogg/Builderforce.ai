/**
 * rules/ilities/timeoutRetryChanged.ts — `timeout-retry-changed` (ilities.reliability; C7 "timeouts and
 * retries removed or added"): the distinct timeout / retry / backoff names a changed non-test JS/TS file
 * uses (`timeoutMs`, `AbortSignal.timeout`, `maxRetries`, `withRetry`, `backoff`, …; `setTimeout` /
 * `clearTimeout` are scheduling, not resilience, and do not count) compared across the sides. A name
 * that disappeared is `removed` (warn); a new one is `added` (info). Reported on the after side, one
 * finding per (file, name).
 *
 * Heuristic: identifier names, not semantics; WS4 call facts replace it.
 */
import { filePairs, isJsPath, isTestPath } from '../support/files.js';
import { heuristicFinding, ruleIdentity } from '../support/identity.js';
const WORD = /[Tt]imeout|[Rr]etr(?:y|ies)|[Bb]ackoff|[Dd]eadline/g;
const SCHEDULING = new Set(['setTimeout', 'clearTimeout']);
const isIdent = (c) => c !== undefined && /[\w$]/.test(c);
/** Each identifier holding a resilience word, expanded outward from the word (linear in hits). */
function namesOf(view) {
    const { bare } = view;
    const out = new Map();
    let next = 0;
    for (const m of bare.matchAll(WORD)) {
        if (m.index < next)
            continue;
        let a = m.index, b = m.index + m[0].length;
        while (isIdent(bare[a - 1]))
            a--;
        while (isIdent(bare[b]))
            b++;
        next = b;
        const name = bare.slice(a, b);
        if (/^\d/.test(name) || SCHEDULING.has(name) || out.has(name))
            continue;
        out.set(name, a);
    }
    return out;
}
export const timeoutRetryChanged = {
    id: 'timeout-retry-changed',
    version: 1,
    dimension: 'ilities.reliability',
    reads: ['content'],
    derive(input) {
        const after = [];
        for (const p of filePairs(input)) {
            if (!p.before || !p.after || !isJsPath(p.path) || isTestPath(p.path))
                continue;
            const b = namesOf(p.before), a = namesOf(p.after);
            const changes = [
                ...[...b].filter(([n]) => !a.has(n)).map(([name, offset]) => ({ name, change: 'removed', side: 'before', offset })),
                ...[...a].filter(([n]) => !b.has(n)).map(([name, offset]) => ({ name, change: 'added', side: 'after', offset })),
            ];
            for (const c of changes.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))) {
                const view = p[c.side];
                after.push(heuristicFinding(ruleIdentity(timeoutRetryChanged, 'file', `${p.path}#${c.change}:${c.name}`, { members: [p.path] }), c.change === 'removed' ? 'warn' : 'info', { file: p.path, name: c.name, change: c.change }, [{ side: c.side, path: view.sidePath, line: view.lineAt(c.offset), note: c.name }]));
            }
        }
        return { before: [], after };
    },
};
//# sourceMappingURL=timeoutRetryChanged.js.map