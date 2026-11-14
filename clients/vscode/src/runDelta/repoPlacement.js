/**
 * Where a repository's run-delta data lives relative to the open workspace folders (PRD 41 §C14, VSIX row). Pure: paths in,
 * placement out. ONE rule for capture, read and release, so a pre-image is always found where it was written.
 *
 *   - The repository inside a workspace folder (the folder itself, or a repo nested in it): that folder's knowledge file, and
 *     the folder's knowledge root sees a repo path `p` as `<repo-in-folder>/p`.
 *   - The workspace folder inside the repository (a monorepo subfolder opened on its own): that folder's knowledge file, and
 *     only repo paths under `<folder-in-repo>/` have knowledge paths (`p` minus that prefix).
 *   - Neither: no knowledge file (nothing is written outside the workspace).
 */
import * as path from "node:path";
const slash = (p) => path.resolve(p).split(path.sep).join("/").replace(/\/+$/, "");
const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child, parent) => same(child, parent) || (process.platform === "win32"
    ? child.toLowerCase().startsWith(`${parent.toLowerCase()}/`) : child.startsWith(`${parent}/`));
export function placeRepo(repoRoot, folders) {
    const repo = slash(repoRoot);
    const resolved = folders.map(slash);
    // The innermost folder holding the repository.
    const holder = resolved.filter((f) => inside(repo, f)).sort((a, b) => b.length - a.length)[0];
    if (holder !== undefined) {
        const rel = repo.slice(holder.length).replace(/^\//, "");
        return { folder: holder, add: rel ? `${rel}/` : "", strip: "" };
    }
    // The outermost folder inside the repository.
    const inner = resolved.filter((f) => inside(f, repo)).sort((a, b) => a.length - b.length)[0];
    if (inner !== undefined)
        return { folder: inner, add: "", strip: `${inner.slice(repo.length).replace(/^\//, "")}/` };
    return undefined;
}
/** A repo-relative path's knowledge path, or undefined when it lies outside the placement's folder. */
export function toKnowledgePath(p, repoPath) {
    if (p.strip && !repoPath.startsWith(p.strip))
        return undefined;
    return `${p.add}${repoPath.slice(p.strip.length)}`;
}
/** A knowledge path's repo-relative path, or undefined when it lies outside the repository. */
export function toRepoPath(p, knowledgePath) {
    if (!knowledgePath.startsWith(p.add))
        return undefined;
    return `${p.strip}${knowledgePath.slice(p.add.length)}`;
}
//# sourceMappingURL=repoPlacement.js.map