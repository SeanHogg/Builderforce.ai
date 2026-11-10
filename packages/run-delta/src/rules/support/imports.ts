/**
 * rules/support/imports.ts — the module specifiers one JS/TS file imports, by text (WS4 tree-sitter
 * import facts replace this): `import … from 's'`, `export … from 's'`, `import 's'`, `import('s')`,
 * `require('s')`, over comment-masked source. Computed once per {@link TextView}.
 */

import type { TextView } from './files.js';
import { regexHits } from './stateRule.js';

/** Group 2 is the specifier. THE specifier pattern every import-reading rule uses. */
export const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

export interface ImportRef {
    offset: number;
    length: number;
    specifier: string;
    /** `import type …` / `export type …`: erased at compile time, never loaded. */
    typeOnly: boolean;
}

/** Whether the import / export statement holding `offset` is `import type …` / `export type …` (read from its keyword, so a multi-line clause counts). */
function typeOnlyAt(code: string, offset: number): boolean {
    const k = Math.max(code.lastIndexOf('import', offset), code.lastIndexOf('export', offset));
    if (k < 0 || offset - k > 4000) return false;
    return /^(?:import|export)\s+type\b/.test(code.slice(k, k + 12)) && !code.slice(k, offset).includes(';');
}

export function importsOf(view: TextView): ImportRef[] {
    return view.memo('imports', () => regexHits(SPECIFIER, view.code).map(({ offset, match }) => ({
        offset,
        length: match[0].length,
        specifier: match[2]!,
        typeOnly: typeOnlyAt(view.code, offset),
    })));
}

/** `fs`, `node:fs`, `fs/promises` → the builtin's base name (`fs`); `@scope/pkg/x` → `@scope/pkg`; `pkg/x` → `pkg`. */
export function packageOf(specifier: string): string {
    const s = specifier.replace(/^node:/, '');
    const parts = s.split('/');
    return s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}
