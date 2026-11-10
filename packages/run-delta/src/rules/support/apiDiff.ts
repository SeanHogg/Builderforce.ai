/**
 * rules/support/apiDiff.ts — exported names of each changed, non-test JS/TS file compared across the
 * sides (C7 compatibility), once per rule input: `breaking` when a name vanished, its signature changed,
 * or an interface/enum lost or changed a member; `added` when a name is new.
 */

import type { RuleInput } from '../../contract.js';
import { exportsOf, type ExportDecl } from './exportDecls.js';
import { filePairs, isJsPath, isTestPath, perInput } from './files.js';

export interface ApiChange {
    path: string;
    name: string;
    change: 'removed' | 'changed' | 'added';
    before?: ExportDecl & { path: string };
    after?: ExportDecl & { path: string };
}

export function apiChanges(input: RuleInput): ApiChange[] {
    return perInput(input, 'apiChanges', () => {
        const out: ApiChange[] = [];
        for (const pair of filePairs(input)) {
            if (!isJsPath(pair.path) || isTestPath(pair.path)) continue;
            const b = pair.before ? exportsOf(pair.before) : new Map<string, ExportDecl>();
            const a = pair.after ? exportsOf(pair.after) : new Map<string, ExportDecl>();
            for (const name of [...new Set([...b.keys(), ...a.keys()])].sort()) {
                const old = b.get(name), cur = a.get(name);
                let change: ApiChange['change'] | undefined;
                if (old && !cur) change = 'removed';
                else if (!old && cur) change = 'added';
                else if (old && cur && (old.signature !== cur.signature || (old.members ?? []).some((m) => !(cur.members ?? []).includes(m)))) change = 'changed';
                if (!change) continue;
                out.push({
                    path: pair.path, name, change,
                    ...(old ? { before: { ...old, path: pair.before!.sidePath } } : {}),
                    ...(cur ? { after: { ...cur, path: pair.after!.sidePath } } : {}),
                });
            }
        }
        return out;
    });
}
