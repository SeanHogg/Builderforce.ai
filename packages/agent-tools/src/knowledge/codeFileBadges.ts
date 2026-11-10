/**
 * knowledge/codeFileBadges.ts — the content-derived badges of ONE code file: complexity,
 * routes and patterns (PRD 38, Option B+ Contract 1). The per-file parser calls this once
 * per file; everything here is a pure function of the path and text, and the text is masked
 * ONCE ({@link maskSource}) for all three scans. Root-level signals (coverage, churn, owner,
 * entry) and the layer rule come from `codeRootSignals` / `codeGraph`.
 */

import { extractSymbols, MAX_SYMBOLS_PER_FILE, type CodeSymbol } from '../symbols.js';
import { cyclomaticComplexity } from './codeComplexity.js';
import { concurrencyBadge } from './codeConcurrency.js';
import { codeLanguageOf, maskSource } from './codeMask.js';
import { CODE_BADGES } from './codeNodes.js';
import { baseOf } from './systemPaths.js';
import { importSpecifiers, patternsBadge } from './codePatterns.js';
import { routesBadge } from './codeRoutes.js';
import { externalsBadge, runtimeSpecifiers } from './externalServices.js';

/** Route registrations only exist in JS/TS-family sources. */
const ROUTE_LANGUAGES: ReadonlySet<string> = new Set(['js']);

const baseNameOf = (path: string): string => {
    const base = baseOf(path);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
};

/** Lines in a file: a trailing newline ends the last line, it does not start another. */
export const lineCountOf = (text: string): number => {
    if (text === '') return 0;
    const n = text.split('\n').length;
    return text.endsWith('\n') ? n - 1 : n;
};

export function contentBadges(path: string, text: string, symbols: readonly CodeSymbol[]): Record<string, number | string> {
    const language = codeLanguageOf(path);
    const badges: Record<string, number | string> = {};
    const { code, bare } = maskSource(text, language);
    const complexity = cyclomaticComplexity(path, text, bare);
    if (complexity.functions > 0) {
        badges[CODE_BADGES.complexity] = complexity.total;
        badges[CODE_BADGES.maxComplexity] = complexity.max;
    }
    if (language && ROUTE_LANGUAGES.has(language)) {
        const routes = routesBadge(text, path, code);
        if (routes) badges[CODE_BADGES.routes] = routes;
    }
    const imports = importSpecifiers(code);
    const externals = externalsBadge(runtimeSpecifiers(code));
    if (externals) badges[CODE_BADGES.externals] = externals;
    // Strings blanked too: `"new Worker("` in a message is no thread.
    const concurrency = concurrencyBadge(bare, imports);
    if (concurrency) badges[CODE_BADGES.concurrency] = concurrency;
    // The detector's own counts, stored so the god-module finding can show what tripped it.
    const lines = lineCountOf(text);
    // The symbol index is capped per file, but the detector needs the TRUE number of exports: rescan uncapped only for a file that hit the cap.
    const all = symbols.length >= MAX_SYMBOLS_PER_FILE ? extractSymbols(path, text, Number.POSITIVE_INFINITY) : symbols;
    const exported = all.filter((s) => s.exported);
    badges[CODE_BADGES.lines] = lines;
    badges[CODE_BADGES.exports] = exported.length;
    const patterns = patternsBadge({
        path, base: baseNameOf(path), lines, exported, imports, text: code, maxComplexity: complexity.max,
    });
    if (patterns) badges[CODE_BADGES.patterns] = patterns;
    return badges;
}
