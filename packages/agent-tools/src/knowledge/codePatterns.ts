/**
 * knowledge/codePatterns.ts — heuristic design-pattern detectors (PRD 38, Option B+
 * Contract 1: the `patterns` badge, provenance `heuristic`).
 *
 * Each detector is a row in {@link PATTERN_DETECTORS}, a registry: it reads only the
 * file's name, its exported symbols, its imports, its size and its worst complexity —
 * never a model. The badge is the matching ids, sorted, comma-separated. `god-module` is
 * the one anti-pattern. Pure.
 */

import { compareStr, GOD_MODULE_LIMITS } from '@seanhogg/builderforce-memory/knowledge';
import type { CodeSymbol } from '../symbols.js';

export interface PatternFacts {
    path: string;
    /** File name without extension. */
    base: string;
    lines: number;
    exported: ReadonlyArray<Pick<CodeSymbol, 'name' | 'kind'>>;
    imports: readonly string[];
    /** Source with comments blanked (strings intact). */
    text: string;
    maxComplexity: number;
}

export interface PatternDetector {
    id: string;
    test(f: PatternFacts): boolean;
}

const named = (f: PatternFacts, re: RegExp): boolean => f.exported.some((s) => re.test(s.name));
const baseIs = (f: PatternFacts, re: RegExp): boolean => re.test(f.base);
const importsFrom = (f: PatternFacts, re: RegExp): boolean => f.imports.some((i) => re.test(i));

export const PATTERN_DETECTORS: readonly PatternDetector[] = [
    { id: 'repository', test: (f) => baseIs(f, /repositor(?:y|ies)$/i) || named(f, /Repository$/) },
    { id: 'adapter', test: (f) => baseIs(f, /adapter/i) || named(f, /Adapter$/) },
    {
        id: 'factory',
        test: (f) => named(f, /Factory$/) || baseIs(f, /factory/i)
            || (baseIs(f, /^(?:create|make)[A-Z]/) && named(f, /^(?:create|make)[A-Z]/)),
    },
    { id: 'facade', test: (f) => baseIs(f, /facade/i) || named(f, /Facade$/) },
    { id: 'strategy', test: (f) => baseIs(f, /strateg(?:y|ies)/i) || named(f, /Strateg(?:y|ies)$/) },
    {
        id: 'observer',
        test: (f) => named(f, /(?:Observer|Listener|Subscriber|Emitter)$/) || baseIs(f, /(?:observer|subscriber|emitter)/i)
            || importsFrom(f, /^(?:node:)?events$/),
    },
    { id: 'registry', test: (f) => baseIs(f, /registry/i) || named(f, /Registry$/) },
    {
        id: 'use-case',
        test: (f) => /(?:^|\/)use-?cases?\//i.test(f.path) || baseIs(f, /use-?case$/i) || named(f, /UseCase$/),
    },
    { id: 'read-through-cache', test: (f) => /\bgetOrSetCached\b/.test(f.text) || importsFrom(f, /read-through-cache/) },
    {
        id: 'middleware-chain',
        test: (f) => baseIs(f, /middleware/i) || named(f, /Middleware$/)
            || (/\(\s*\w+\s*,\s*next\s*\)/.test(f.text) && /\bawait\s+next\s*\(\s*\)|\bnext\s*\(\s*\)/.test(f.text)),
    },
    {
        id: 'typed-client',
        test: (f) => (baseIs(f, /client$/i) || named(f, /Client$/)) && /\bfetch\s*\(|\baxios\b|\brequest\s*[<(]/.test(f.text),
    },
    { id: 'port', test: (f) => f.exported.some((s) => s.kind === 'interface' && /Port$/.test(s.name)) },
    {
        id: 'god-module',
        test: (f) => f.lines > GOD_MODULE_LIMITS.lines || f.exported.length > GOD_MODULE_LIMITS.exports
            || f.maxComplexity > GOD_MODULE_LIMITS.complexity,
    },
];

/** Pattern ids a file matches, sorted. */
export function detectPatterns(facts: PatternFacts): string[] {
    return PATTERN_DETECTORS.filter((d) => d.test(facts)).map((d) => d.id).sort(compareStr);
}

/** The `patterns` badge value (comma-separated ids), or undefined when none match. */
export function patternsBadge(facts: PatternFacts): string | undefined {
    const ids = detectPatterns(facts);
    return ids.length > 0 ? ids.join(',') : undefined;
}

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

/** Module specifiers a JS/TS-style source imports (static, dynamic and `require`). */
export function importSpecifiers(maskedComments: string): string[] {
    return [...new Set([...maskedComments.matchAll(IMPORT_SPECIFIER)].map((m) => m[2]!))];
}
