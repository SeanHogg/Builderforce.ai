/**
 * rules/support/entryForms.ts — THE parser for registry ENTRY FORMS (literal text, never a regex, so a
 * repo's `.builderforce/delta.json` cannot ReDoS a run) and ONE scanner over a set of them. Used by
 * `capability-added` (C5.3), the taint-lite rules (C5.2) and `cookie-insecure`:
 *
 *  - `name(`   a call (`new Function(`: inner spaces match any whitespace);
 *  - `name(*`  a call where ANY argument counts (taint sinks; a plain `name(` reads its first argument);
 *  - `.name(`  a method on any receiver except `JSON` (`.parse(` is zod's, not `JSON.parse`);
 *  - `x=`      an assignment (`.innerHTML=`, `location.href=`), `+=` included;
 *  - `a.b`     a member access (`process.env`, `req.body`): it also matches `req.body.x`;
 *  - anything else is a module SPECIFIER, left to the caller (`child_process`, `*.node`).
 *
 * Receivers: `any` lets a bare `name(` also match `x.name(` (capabilities: `fs.writeFile(`); `unqualified`
 * makes a dot-free bare name match only an unqualified call (taint sinks: `exec(` is not `re.exec(`).
 * A dotted entry never matches inside a longer identifier.
 */
import { escapeRegex } from './files.js';
const MEMBER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const LB_METHOD = '(?<!\\bJSON\\s*)';
const LB_UNQUALIFIED = '(?<![\\w$.])';
const LB_IDENT = '(?<![\\w$])';
const bodyOf = (name) => escapeRegex(name.trim()).replace(/\s+/g, '\\s+');
function lookbehind(name, receivers) {
    if (name.startsWith('.'))
        return LB_METHOD;
    return receivers === 'unqualified' && !name.includes('.') ? LB_UNQUALIFIED : LB_IDENT;
}
export function parseEntry(entry, receivers) {
    if (entry.endsWith('(*') || entry.endsWith('(')) {
        const any = entry.endsWith('(*');
        const name = entry.slice(0, any ? -2 : -1).trim();
        if (name.length === 0)
            return { form: 'specifier' };
        return { form: any ? 'call-any' : name.startsWith('.') ? 'method' : 'call', lookbehind: lookbehind(name, receivers), body: `${bodyOf(name)}\\s*\\(` };
    }
    if (entry.endsWith('=') && entry.length > 1) {
        const name = entry.slice(0, -1).trim();
        return { form: 'assign', lookbehind: lookbehind(name, receivers), body: `${bodyOf(name)}\\s*\\+?=(?![=>])` };
    }
    if (MEMBER.test(entry))
        return { form: 'member', lookbehind: lookbehind(entry, receivers), body: `${escapeRegex(entry)}(?![\\w$])` };
    return { form: 'specifier' };
}
/**
 * Compiles a `{ group: entries[] }` registry (keys sorted) into one scanner: one alternation, each
 * lookbehind class emitted ONCE in front of its entries (`(?<![\w$])(?:(a)|(b))|…`).
 */
export function compileEntries(groups, receivers) {
    const all = [];
    const specifiers = [];
    for (const key of Object.keys(groups).sort()) {
        for (const entry of groups[key]) {
            const parsed = parseEntry(entry, receivers);
            if (!parsed.body || parsed.lookbehind === undefined) {
                specifiers.push({ key, entry });
                continue;
            }
            all.push({ key, entry, form: parsed.form, body: parsed.body, lookbehind: parsed.lookbehind });
        }
    }
    const cache = new Map();
    const compiled = (list) => {
        const sig = list.map((e) => all.indexOf(e)).join(',');
        return cache.get(sig) ?? cache.set(sig, alternation(list)).get(sig);
    };
    const hitOf = (m, entries) => {
        const e = entries[m.findIndex((g, k) => k > 0 && g !== undefined) - 1];
        return e ? { offset: m.index, length: m[0].length, key: e.key, entry: e.entry, form: e.form } : undefined;
    };
    return {
        entries: all.map((e) => ({ key: e.key, entry: e.entry, form: e.form })),
        specifiers,
        mayMatch(text) {
            if (all.length === 0)
                return false;
            const { re } = compiled(all);
            re.lastIndex = 0;
            return re.test(text);
        },
        firstPerKey(text) {
            let left = all;
            const out = [];
            let from = 0;
            while (left.length > 0) {
                const { re, entries } = compiled(left);
                re.lastIndex = from;
                const m = re.exec(text);
                const hit = m ? hitOf(m, entries) : undefined;
                if (!m || !hit)
                    break;
                out.push(hit);
                left = left.filter((x) => x.key !== hit.key);
                from = m.index + Math.max(1, m[0].length);
            }
            return out;
        },
        scan(text) {
            if (all.length === 0)
                return [];
            const { re, entries } = compiled(all);
            const out = [];
            re.lastIndex = 0;
            for (let m = re.exec(text); m; m = re.exec(text)) {
                const hit = hitOf(m, entries);
                if (hit)
                    out.push(hit);
                if (m[0].length === 0)
                    re.lastIndex++;
            }
            return out;
        },
    };
}
/** One alternation, each lookbehind class emitted once in front of its entries; entries in capture order. */
function alternation(list) {
    const byClass = new Map();
    for (const e of list)
        (byClass.get(e.lookbehind) ?? byClass.set(e.lookbehind, []).get(e.lookbehind)).push(e);
    const entries = [];
    const classes = [];
    for (const [lb, group] of byClass) {
        classes.push(`${lb}(?:${group.map((e) => `(${e.body})`).join('|')})`);
        entries.push(...group);
    }
    return { re: new RegExp(classes.join('|'), 'g'), entries };
}
//# sourceMappingURL=entryForms.js.map