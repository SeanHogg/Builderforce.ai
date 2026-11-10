/**
 * rules/support/envVars.ts — the environment variables and bindings the run's changed files read, per
 * side (C7 compatibility: config/env contract): `process.env.X`, `process.env['X']`,
 * `import.meta.env.X`, and Worker bindings `env.X` / `c.env.X` (upper-case names). Test files excluded.
 * Union over every changed file of the side, so a read MOVED between files is neither added nor removed.
 *
 * {@link envVarRule} is THE rule shape both `env-var-added` and `env-var-removed` are rows of.
 */

import type { DeltaRule, DimensionId, RuleInput, Severity } from '../../contract.js';
import { filePairs, isJsPath, isTestPath, perInput, redact, type TextView } from './files.js';
import { heuristicFinding, ruleIdentity } from './identity.js';

// Literal-led: every form ends in `env.NAME` / `env['NAME']`; an identifier char glued before `env` (`myenv`) is dropped after.
const DOTTED = /env\s*\.\s*([A-Z][A-Z0-9_]*)(?![\w$])/g;
const INDEXED = /process\s*\.\s*env\s*\[\s*(['"])([A-Z][A-Z0-9_]*)\1\s*\]/g;
const gluedIdent = (s: string, i: number): boolean => i > 0 && /[\w$]/.test(s[i - 1]!);

export interface EnvRead { name: string; path: string; offset: number; view: TextView }

function readsOf(view: TextView): EnvRead[] {
    return view.memo('envReads', () => [
        ...[...view.bare.matchAll(DOTTED)].filter((m) => !gluedIdent(view.bare, m.index)).map((m) => ({ name: m[1]!, path: view.path, offset: m.index, view })),
        ...[...view.code.matchAll(INDEXED)]
            .filter((m) => view.bare[m.index] === view.code[m.index] && !gluedIdent(view.code, m.index))
            .map((m) => ({ name: m[2]!, path: view.path, offset: m.index, view })),
    ]);
}

/** Name → its first read on each side (in path, then offset order). */
export function envReads(input: RuleInput): { before: Map<string, EnvRead>; after: Map<string, EnvRead> } {
    return perInput(input, 'envReads', () => {
        const out = { before: new Map<string, EnvRead>(), after: new Map<string, EnvRead>() };
        for (const pair of filePairs(input)) {
            if (!isJsPath(pair.path) || isTestPath(pair.path)) continue;
            for (const side of ['before', 'after'] as const) {
                const view = pair[side];
                if (!view) continue;
                for (const r of readsOf(view).sort((a, b) => a.offset - b.offset)) if (!out[side].has(r.name)) out[side].set(r.name, r);
            }
        }
        return out;
    });
}

/**
 * A rule over the env-read sets: `present` is the side whose names count, `absent` the side that must lack
 * them (added = after − before, removed = before − after). Always reported on the AFTER side (it reads as
 * introduced); the evidence points at the side where the read is.
 */
export function envVarRule(spec: { id: string; version: number; dimension: DimensionId; severity: Severity; present: 'before' | 'after' }): DeltaRule {
    const absent = spec.present === 'after' ? 'before' : 'after';
    const rule: DeltaRule = {
        id: spec.id,
        version: spec.version,
        dimension: spec.dimension,
        reads: ['content'],
        derive(input) {
            const sides = envReads(input);
            const out = [...sides[spec.present].values()].filter((r) => !sides[absent].has(r.name)).sort((a, b) => (a.name < b.name ? -1 : 1)).map((r) => heuristicFinding(
                ruleIdentity(rule, 'symbol', `env:${r.name}`, { members: [r.path] }),
                spec.severity,
                { name: r.name, file: r.path },
                [{ side: spec.present, path: r.view.sidePath, line: r.view.lineAt(r.offset), snippet: redact(r.view.lineText(r.offset).trim()).slice(0, 200), note: r.name }],
            ));
            return { before: [], after: out };
        },
    };
    return rule;
}
