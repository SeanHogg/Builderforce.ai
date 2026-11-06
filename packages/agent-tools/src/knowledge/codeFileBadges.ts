/**
 * knowledge/codeFileBadges.ts — the content-derived badges of ONE code file: complexity,
 * routes and patterns (PRD 38, Option B+ Contract 1). The per-file parser calls this once
 * per file; everything here is a pure function of the path and text, and the text is masked
 * ONCE ({@link maskSource}) for all three scans. Root-level signals (coverage, churn, owner,
 * entry) and the layer rule come from `codeRootSignals` / `codeGraph`.
 */

import type { CodeSymbol } from '../symbols.js';
import { cyclomaticComplexity } from './codeComplexity.js';
import { codeLanguageOf, maskSource } from './codeMask.js';
import { basenameOf, CODE_BADGES } from './codeNodes.js';
import { importSpecifiers, patternsBadge } from './codePatterns.js';
import { routesBadge } from './codeRoutes.js';
import { externalsBadge, runtimeSpecifiers } from './externalServices.js';

/** Route registrations only exist in JS/TS-family sources. */
const ROUTE_LANGUAGES: ReadonlySet<string> = new Set(['js']);

const baseNameOf = (path: string): string => {
    const base = basenameOf(path);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
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
    const patterns = patternsBadge({
        path, base: baseNameOf(path), lines: text.split('\n').length,
        exported: symbols.filter((s) => s.exported), imports, text: code,
        maxComplexity: complexity.max,
    });
    if (patterns) badges[CODE_BADGES.patterns] = patterns;
    return badges;
}
