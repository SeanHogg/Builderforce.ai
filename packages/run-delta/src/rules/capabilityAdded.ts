/**
 * rules/capabilityAdded.ts — `capability-added` (security, warn; C5.3): a changed file uses a
 * capability (process execution, filesystem writes, network servers/clients, dynamic code, native
 * addons, environment reads) it did not use before. One finding per (file, capability); lineage makes
 * a capability the before side lacked `introduced`.
 *
 * Registry entry forms: `name(` a call, `a.b` a member access, `*suffix` a module-specifier suffix,
 * anything else an exact module specifier (`import … from`, `import()`, `require()`).
 *
 * Heuristic: text-level; WS4 tree-sitter `capabilityImports` facts replace it.
 */

import type { DeltaRule } from '../contract.js';
import { escapeRegex, isCodePath, isTestPath, type TextView } from './support/files.js';
import { regexHits, stateSides, type Hit } from './support/stateRule.js';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
const MEMBER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

interface Compiled {
    /** ONE alternation over every call and member entry (one scan of the masked text), entry by group index. */
    scan?: RegExp;
    scanEntries: Array<{ cap: string; entry: string }>;
    specifiers: Array<{ cap: string; entry: string }>;
}

function compile(capabilities: Readonly<Record<string, readonly string[]>>): Compiled {
    const scanEntries: Compiled['scanEntries'] = [], specifiers: Compiled['specifiers'] = [], parts: string[] = [];
    for (const cap of Object.keys(capabilities).sort()) {
        for (const entry of capabilities[cap]!) {
            if (entry.endsWith('(')) {
                parts.push(`(${escapeRegex(entry.slice(0, -1).trim()).replace(/\s+/g, '\\s+')}\\s*\\()`);
                scanEntries.push({ cap, entry });
            } else if (MEMBER.test(entry)) {
                parts.push(`(${escapeRegex(entry)}(?![\\w$]))`);
                scanEntries.push({ cap, entry });
            } else specifiers.push({ cap, entry });
        }
    }
    return { ...(parts.length > 0 ? { scan: new RegExp(`(?<![\\w$])(?:${parts.join('|')})`, 'g') } : {}), scanEntries, specifiers };
}

function hitsOf(view: TextView, c: Compiled): Hit[] {
    const hits: Hit[] = [];
    if (c.scan) {
        for (const { offset, match } of regexHits(c.scan, view.bare)) {
            const i = match.findIndex((g, k) => k > 0 && g !== undefined) - 1;
            const e = c.scanEntries[i];
            if (e) hits.push({ offset, length: match[0].length, key: e.cap, params: { via: e.entry } });
        }
    }
    if (c.specifiers.length > 0) {
        for (const { offset, match } of regexHits(SPECIFIER, view.code)) {
            const spec = match[2]!;
            for (const e of c.specifiers) {
                if (e.entry.startsWith('*') ? spec.endsWith(e.entry.slice(1)) : spec === e.entry) hits.push({ offset, length: match[0].length, key: e.cap, params: { via: e.entry } });
            }
        }
    }
    return hits;
}

export const capabilityAdded: DeltaRule = {
    id: 'capability-added',
    version: 1,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const compiled = compile(input.registries.capabilities);
        return stateSides(capabilityAdded, {
            files: (p) => isCodePath(p) && !isTestPath(p),
            hits: (view) => hitsOf(view, compiled),
            severity: 'warn',
            granularity: 'file',
        }, input);
    },
};
