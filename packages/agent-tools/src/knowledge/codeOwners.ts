/**
 * knowledge/codeOwners.ts — CODEOWNERS as the `owner` badge (PRD 38, Option B+ Contract 1).
 *
 * The file is read from `.github/`, the root or `docs/` (first present wins, GitHub's
 * order). Patterns are gitignore-style; the LAST matching pattern wins, and the badge is
 * that pattern's first owner. A pattern with no owners un-owns the path. A pattern whose
 * last segment is a wildcard (`docs/*`) owns only what that segment matches directly — not
 * files nested below it, as GitHub's CODEOWNERS says. Pure.
 */

import { matchGlob } from '@seanhogg/builderforce-memory/knowledge';

/** Where CODEOWNERS lives, in precedence order (root-relative). */
export const CODEOWNERS_LOCATIONS: readonly string[] = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

export interface OwnerRule {
    globs: string[];
    owners: string[];
}

/** A CODEOWNERS pattern as the memory glob dialect (`**`, `*`, `?`). */
function globsOf(pattern: string): string[] {
    const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
    const body = pattern.replace(/^\/+/, '');
    const dir = body.endsWith('/');
    const base = dir ? body.slice(0, -1) : body;
    const prefix = anchored ? '' : '**/';
    if (dir) return [`${prefix}${base}/**`];
    // A name that is a wildcard (`*.ts`, `docs/*`) matches what it matches; a plain name may be a folder, which owns its contents.
    const wildcardTail = /[*?]/.test(base.slice(base.lastIndexOf('/') + 1));
    return wildcardTail ? [`${prefix}${base}`] : [`${prefix}${base}`, `${prefix}${base}/**`];
}

export function parseCodeOwners(text: string): OwnerRule[] {
    const rules: OwnerRule[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/(^|\s)#.*$/, '').trim();
        if (!line) continue;
        const [pattern, ...owners] = line.split(/\s+/);
        if (!pattern) continue;
        rules.push({ globs: globsOf(pattern), owners });
    }
    return rules;
}

/** The first owner of `path` under `rules` (last matching rule wins), or undefined. */
export function ownerOf(path: string, rules: readonly OwnerRule[]): string | undefined {
    for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i]!;
        if (rule.globs.some((g) => matchGlob(path, g))) return rule.owners[0];
    }
    return undefined;
}

/** `owner` badge values for `paths`; paths with no owner are absent. */
export function ownersFor(paths: readonly string[], rules: readonly OwnerRule[]): Map<string, string> {
    const out = new Map<string, string>();
    if (rules.length === 0) return out;
    for (const path of paths) {
        const owner = ownerOf(path, rules);
        if (owner) out.set(path, owner);
    }
    return out;
}
