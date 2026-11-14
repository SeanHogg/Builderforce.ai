/**
 * Which root's path aliases resolve a run's side FileFacts (PRD 41 §B3): the side facts are keyed in REPO space, so their
 * imports resolve with the REPOSITORY's own aliases (its tsconfig/jsconfig `paths`, read by `rootModules` at the repo
 * root) — not the knowledge folder's. When the repository IS the knowledge folder the folder's aliases already are repo
 * space; a repository nested in the folder (or above it) has its own.
 */
/** The `rootModules` root of the repository's own aliases, or undefined when the knowledge folder's serve (same root). */
export function repoModulesRoot(placement, repoRoot, knowledgeRoot) {
    if (!placement.add && !placement.strip)
        return undefined;
    const rootPath = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    return { rootId: `${knowledgeRoot.rootId}::repo:${rootPath}`, rootPath, title: knowledgeRoot.title };
}
//# sourceMappingURL=repoModules.js.map