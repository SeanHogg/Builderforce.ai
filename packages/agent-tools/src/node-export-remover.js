/**
 * The Node half of the per-export remover (`exportRemoval.ts`): parses the file with the
 * tree-sitter JS/TS grammar (`node-tree-sitter.ts`, the same wasm the symbol index loads) and
 * removes ONE named export. Re-exported from `./node-symbols`.
 */
import { ExportRemovalRefusal, removeExport } from "./exportRemoval.js";
import { parseJsTs } from "./node-tree-sitter.js";
/**
 * `content` (the file at `relPath`) with the export `name` removed. Rejects with an
 * {@link ExportRemovalRefusal}: `unparsed` when the file is not JS/TS or its grammar cannot load,
 * otherwise whatever {@link removeExport} refused.
 */
export async function removeExportFromSource(relPath, content, name, opts = {}) {
    const result = await parseJsTs(relPath, content, (root) => removeExport(content, root, name), opts);
    if (!result)
        throw new ExportRemovalRefusal("unparsed", name, `${relPath} could not be parsed as JavaScript or TypeScript, so "${name}" was not removed.`);
    return result;
}
//# sourceMappingURL=node-export-remover.js.map