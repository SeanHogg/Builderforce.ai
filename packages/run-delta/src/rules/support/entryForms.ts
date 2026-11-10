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

export type EntryForm = 'call' | 'call-any' | 'method' | 'assign' | 'member' | 'specifier';
export type Receivers = 'any' | 'unqualified';

const MEMBER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

export interface ParsedEntry {
    form: EntryForm;
    /** The lookbehind CLASS the entry needs (shared by many entries, emitted once per class). */
    lookbehind?: string;
    /** The entry's regex body after its lookbehind; absent for a specifier. */
    body?: string;
}

const LB_METHOD = '(?<!\\bJSON\\s*)';
const LB_UNQUALIFIED = '(?<![\\w$.])';
const LB_IDENT = '(?<![\\w$])';

const bodyOf = (name: string): string => escapeRegex(name.trim()).replace(/\s+/g, '\\s+');

function lookbehind(name: string, receivers: Receivers): string {
    if (name.startsWith('.')) return LB_METHOD;
    return receivers === 'unqualified' && !name.includes('.') ? LB_UNQUALIFIED : LB_IDENT;
}

export function parseEntry(entry: string, receivers: Receivers): ParsedEntry {
    if (entry.endsWith('(*') || entry.endsWith('(')) {
        const any = entry.endsWith('(*');
        const name = entry.slice(0, any ? -2 : -1).trim();
        if (name.length === 0) return { form: 'specifier' };
        return { form: any ? 'call-any' : name.startsWith('.') ? 'method' : 'call', lookbehind: lookbehind(name, receivers), body: `${bodyOf(name)}\\s*\\(` };
    }
    if (entry.endsWith('=') && entry.length > 1) {
        const name = entry.slice(0, -1).trim();
        return { form: 'assign', lookbehind: lookbehind(name, receivers), body: `${bodyOf(name)}\\s*\\+?=(?![=>])` };
    }
    if (MEMBER.test(entry)) return { form: 'member', lookbehind: lookbehind(entry, receivers), body: `${escapeRegex(entry)}(?![\\w$])` };
    return { form: 'specifier' };
}

export interface EntryHit {
    offset: number;
    length: number;
    /** The registry group the entry belongs to (a capability, a sink kind, a source kind). */
    key: string;
    entry: string;
    form: EntryForm;
}

export interface EntryScanner {
    /** Every non-specifier entry, in capture-group order. */
    readonly entries: ReadonlyArray<{ key: string; entry: string; form: EntryForm }>;
    /** Every specifier entry (left to the caller). */
    readonly specifiers: ReadonlyArray<{ key: string; entry: string }>;
    /** ONE pass of ONE alternation over `text`; the leftmost entry wins at each offset. */
    scan(text: string): EntryHit[];
    /**
     * Only the EARLIEST hit of each key, in offset order: once a key is found its entries leave the
     * alternation and the scan resumes, stopping when no entry is left (a file calling `fetch` 37k times
     * costs one match, not 37k).
     */
    firstPerKey(text: string): EntryHit[];
    /** Whether any entry matches `text` at all (one pass that stops at the first match). */
    mayMatch(text: string): boolean;
}

interface Compiled { key: string; entry: string; form: EntryForm; body: string; lookbehind: string }

/**
 * Compiles a `{ group: entries[] }` registry (keys sorted) into one scanner: one alternation, each
 * lookbehind class emitted ONCE in front of its entries (`(?<![\w$])(?:(a)|(b))|…`).
 */
export function compileEntries(groups: Readonly<Record<string, readonly string[]>>, receivers: Receivers): EntryScanner {
    const all: Compiled[] = [];
    const specifiers: Array<{ key: string; entry: string }> = [];
    for (const key of Object.keys(groups).sort()) {
        for (const entry of groups[key]!) {
            const parsed = parseEntry(entry, receivers);
            if (!parsed.body || parsed.lookbehind === undefined) { specifiers.push({ key, entry }); continue; }
            all.push({ key, entry, form: parsed.form, body: parsed.body, lookbehind: parsed.lookbehind });
        }
    }
    const cache = new Map<string, { re: RegExp; entries: Compiled[] }>();
    const compiled = (list: readonly Compiled[]) => {
        const sig = list.map((e) => all.indexOf(e)).join(',');
        return cache.get(sig) ?? cache.set(sig, alternation(list)).get(sig)!;
    };
    const hitOf = (m: RegExpExecArray, entries: readonly Compiled[]): EntryHit | undefined => {
        const e = entries[m.findIndex((g, k) => k > 0 && g !== undefined) - 1];
        return e ? { offset: m.index, length: m[0].length, key: e.key, entry: e.entry, form: e.form } : undefined;
    };
    return {
        entries: all.map((e) => ({ key: e.key, entry: e.entry, form: e.form })),
        specifiers,
        mayMatch(text) {
            if (all.length === 0) return false;
            const { re } = compiled(all);
            re.lastIndex = 0;
            return re.test(text);
        },
        firstPerKey(text) {
            let left: Compiled[] = all;
            const out: EntryHit[] = [];
            let from = 0;
            while (left.length > 0) {
                const { re, entries } = compiled(left);
                re.lastIndex = from;
                const m = re.exec(text);
                const hit = m ? hitOf(m, entries) : undefined;
                if (!m || !hit) break;
                out.push(hit);
                left = left.filter((x) => x.key !== hit.key);
                from = m.index + Math.max(1, m[0].length);
            }
            return out;
        },
        scan(text) {
            if (all.length === 0) return [];
            const { re, entries } = compiled(all);
            const out: EntryHit[] = [];
            re.lastIndex = 0;
            for (let m = re.exec(text); m; m = re.exec(text)) {
                const hit = hitOf(m, entries);
                if (hit) out.push(hit);
                if (m[0].length === 0) re.lastIndex++;
            }
            return out;
        },
    };
}

/** One alternation, each lookbehind class emitted once in front of its entries; entries in capture order. */
function alternation(list: readonly Compiled[]): { re: RegExp; entries: Compiled[] } {
    const byClass = new Map<string, Compiled[]>();
    for (const e of list) (byClass.get(e.lookbehind) ?? byClass.set(e.lookbehind, []).get(e.lookbehind)!).push(e);
    const entries: Compiled[] = [];
    const classes: string[] = [];
    for (const [lb, group] of byClass) {
        classes.push(`${lb}(?:${group.map((e) => `(${e.body})`).join('|')})`);
        entries.push(...group);
    }
    return { re: new RegExp(classes.join('|'), 'g'), entries };
}
