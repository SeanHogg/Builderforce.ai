/**
 * rules/corsPermissive.ts — `cors-permissive` (security; C5.6): CORS open to any origin (`origin: '*'`,
 * `origin: true`, `Access-Control-Allow-Origin: *`, Hono's bare `cors()`) in a changed non-test file. A
 * warning. An ERROR when the SAME options object also allows credentials (`params.credentials: 1`); a
 * REFLECTED origin (`origin: true`) with credentials is the worst case (any site acts with the user's
 * cookies) and is marked `params.reflected: 1`. Outside code (headers files, YAML) the credentials check
 * spans the file. Patterns are the `insecureConfig['cors-permissive']` and `['cors-credentials']` rows.
 */
import { insecureConfigHits, isSurfacePath } from './support/configRule.js';
import { isCodePath, matchClose } from './support/files.js';
import { stateSides } from './support/stateRule.js';
/** The `{…}` object literal enclosing `offset` in masked code, or undefined at top level. */
function enclosingObject(bare, offset) {
    let depth = 0;
    for (let i = offset - 1; i >= 0 && offset - i < 20_000; i--) {
        const ch = bare[i];
        if (ch === '}')
            depth++;
        else if (ch === '{') {
            if (depth === 0) {
                const close = matchClose(bare, i);
                return close < 0 ? undefined : [i, close];
            }
            depth--;
        }
    }
    return undefined;
}
const REFLECTED = /:\s*true\b/;
function hitsOf(view, open, credentials) {
    if (open.length === 0 || credentials.length === 0)
        return [...open];
    return open.map((h) => {
        const span = isCodePath(view.path) ? enclosingObject(view.bare, h.offset) : [0, view.text.length];
        const withCredentials = span !== undefined && credentials.some((c) => c.offset > span[0] && c.offset < span[1]);
        if (!withCredentials)
            return h;
        return { ...h, params: { credentials: 1, ...(REFLECTED.test(h.key) ? { reflected: 1 } : {}) } };
    });
}
const escalate = (fs) => fs.map((f) => (f.params['credentials'] === 1 ? { ...f, severity: 'error' } : f));
export const corsPermissive = {
    id: 'cors-permissive',
    version: 2,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        if ((input.registries.insecureConfig['cors-permissive'] ?? []).length === 0)
            return { before: [], after: [] };
        const out = stateSides(corsPermissive, {
            files: isSurfacePath,
            hits: (view) => {
                const open = insecureConfigHits(view, input, 'cors-permissive');
                return open.length === 0 ? [] : hitsOf(view, open, insecureConfigHits(view, input, 'cors-credentials'));
            },
            severity: 'warn',
        }, input);
        return { before: escalate(out.before), after: escalate(out.after) };
    },
};
//# sourceMappingURL=corsPermissive.js.map