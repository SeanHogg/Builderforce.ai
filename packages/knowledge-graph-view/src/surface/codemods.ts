/**
 * The finding kinds a deterministic fix is OFFERED for, as DATA: one row per kind, with the
 * catalog key naming the Apply card. Adding a codemod is a row here (and the host's
 * `applyFixKinds` / `applyFix` handling it), never a branch in a component.
 *
 * `builtin` rows are the ones every host with `applyFix` is assumed to run (the knip codemods);
 * any other row is offered only when the source lists its kind in `applyFixKinds`.
 */

import type { KnowledgeGraphSource } from '../types';

export interface CodemodRow {
    kind: string;
    /** The key of `labels.surface.fix.codemod` that names the action ("Remove unused exports"). */
    labelKey: 'unusedExport' | 'unusedFile' | 'unusedDependency' | 'splitByCommand' | 'extractClone';
    builtin: boolean;
}

export const CODEMODS: readonly CodemodRow[] = [
    { kind: 'unused-export', labelKey: 'unusedExport', builtin: true },
    { kind: 'unused-file', labelKey: 'unusedFile', builtin: true },
    { kind: 'unused-dependency', labelKey: 'unusedDependency', builtin: false },
    { kind: 'god-module', labelKey: 'splitByCommand', builtin: false },
    { kind: 'clone-group', labelKey: 'extractClone', builtin: false },
];

const BY_KIND: ReadonlyMap<string, CodemodRow> = new Map(CODEMODS.map((r) => [r.kind, r]));


/** The row for a kind, when the kind has a deterministic fix. */
export const codemodOf = (kind: string): CodemodRow | undefined => BY_KIND.get(kind);

/** Can THIS source apply a fix for `kind`? It needs `applyFix`, a row, and (for a non-builtin row) the host's say-so. */
export function canApplyKind(source: Pick<KnowledgeGraphSource, 'applyFix' | 'applyFixKinds'> | undefined, kind: string): boolean {
    const row = BY_KIND.get(kind);
    if (!source?.applyFix || !row) return false;
    return source.applyFixKinds ? source.applyFixKinds.includes(kind) : row.builtin;
}
