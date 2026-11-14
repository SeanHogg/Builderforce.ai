/**
 * rules/support/apiDiff.ts — exported names of each changed, non-test JS/TS file compared across the
 * sides (C7 compatibility), once per rule input: `breaking` when a name vanished, its signature changed,
 * or an interface/enum lost or changed a member; `added` when a name is new.
 */
import { exportsOf } from './exportDecls.js';
import { filePairs, isJsPath, isTestPath, perInput } from './files.js';
export function apiChanges(input) {
    return perInput(input, 'apiChanges', () => {
        const out = [];
        for (const pair of filePairs(input)) {
            if (!isJsPath(pair.path) || isTestPath(pair.path))
                continue;
            const b = pair.before ? exportsOf(pair.before) : new Map();
            const a = pair.after ? exportsOf(pair.after) : new Map();
            for (const name of [...new Set([...b.keys(), ...a.keys()])].sort()) {
                const old = b.get(name), cur = a.get(name);
                let change;
                if (old && !cur)
                    change = 'removed';
                else if (!old && cur)
                    change = 'added';
                else if (old && cur && (old.signature !== cur.signature || (old.members ?? []).some((m) => !(cur.members ?? []).includes(m))))
                    change = 'changed';
                if (!change)
                    continue;
                out.push({
                    path: pair.path, name, change,
                    ...(old ? { before: { ...old, path: pair.before.sidePath } } : {}),
                    ...(cur ? { after: { ...cur, path: pair.after.sidePath } } : {}),
                });
            }
        }
        return out;
    });
}
//# sourceMappingURL=apiDiff.js.map