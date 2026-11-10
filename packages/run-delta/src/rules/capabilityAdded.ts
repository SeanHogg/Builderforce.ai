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
import { isCodePath, isTestPath, masked } from './support/files.js';
import { regexOffsets, stateSides, type Hit } from './support/stateRule.js';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
const MEMBER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hitsOf(text: string, path: string, capabilities: Readonly<Record<string, readonly string[]>>): Hit[] {
    const { code, bare } = masked(text, path);
    const specifiers = regexOffsets(SPECIFIER, code).map(({ offset, match }) => ({ offset, spec: match[2]! }));
    const hits: Hit[] = [];
    for (const cap of Object.keys(capabilities).sort()) {
        for (const entry of capabilities[cap]!) {
            if (entry.endsWith('(')) {
                const name = escapeRe(entry.slice(0, -1).trim()).replace(/\s+/g, '\\s+');
                for (const { offset } of regexOffsets(`(?<![\\w$])${name}\\s*\\(`, bare)) hits.push({ offset, key: cap, params: { via: entry } });
            } else if (entry.startsWith('*')) {
                for (const s of specifiers) if (s.spec.endsWith(entry.slice(1))) hits.push({ offset: s.offset, key: cap, params: { via: entry } });
            } else if (MEMBER.test(entry)) {
                for (const { offset } of regexOffsets(`(?<![\\w$])${escapeRe(entry)}(?![\\w$])`, bare)) hits.push({ offset, key: cap, params: { via: entry } });
            } else {
                for (const s of specifiers) if (s.spec === entry) hits.push({ offset: s.offset, key: cap, params: { via: entry } });
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
        return stateSides(capabilityAdded, {
            files: (p) => isCodePath(p) && !isTestPath(p),
            hits: (text, path) => hitsOf(text, path, input.registries.capabilities),
            severity: 'warn',
            granularity: 'file',
        }, input);
    },
};
