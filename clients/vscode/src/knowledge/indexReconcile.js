/**
 * The background indexer's reconciling plan (PRD 41 B2 steps 1–5, B6 L0) — pure.
 *
 * There is ONE plan: the review's (`reviewPortsFor` `plan` → `planKnowledgeReviewDetail` → memory `planDetail`), over the
 * root's directory source, whose walk carries the stat manifest (a file whose `(size, mtimeNs, fileId)` is unchanged and
 * not racy is never read), git's clean blob ids and the directory Merkle tree. The indexer never walks or hashes on a
 * path of its own; {@link planIndex} only times that plan and reads it the way the indexer needs.
 *
 * L1 for the whole tree then runs as a map-only pass of the review itself on this plan (no model call; the review
 * refreshes the plan against the manifest, so nothing is walked twice).
 *
 * {@link listingFilter} answers "would the plan list this file?" for a file the manifest does not know, from what the last
 * plan saw (its ignore files, the folders its walk skipped), so a file the plan would drop never costs a whole-tree walk.
 */
import { ignoreMatcher, ignoreSourcesOf } from "@seanhogg/builderforce-memory/knowledge";
/** The reconciling plan of a root (the review's plan, handed in), timed. */
export async function planIndex(plan, now = Date.now) {
    const started = now();
    const detail = await plan();
    return {
        files: detail.plan.files,
        changed: detail.plan.changed,
        removed: detail.plan.removed,
        reviewed: detail.prior.size > 0,
        ms: Math.max(0, now() - started),
        detail,
    };
}
/** Every path the plan's walk saw: the files it planned and the ones it skipped (ignored, too large, no pack…). */
export const listedPaths = (detail) => [...detail.files.map((f) => f.path), ...detail.plan.skipped.map((s) => s.path)];
/**
 * Whether the plan would list a root-relative path, by the rules the last plan read. An ignore file itself always passes:
 * a change to one changes what the plan lists.
 */
export function listingFilter(rules) {
    const ignored = ignoreMatcher(rules.ignoreTexts);
    const isIgnoreFile = (path) => ignoreSourcesOf([path]).length > 0;
    return (path) => {
        if (isIgnoreFile(path))
            return true;
        if (rules.skippedFolders.some((folder) => folder !== "" && path.startsWith(`${folder}/`)))
            return false;
        return !ignored(path);
    };
}
//# sourceMappingURL=indexReconcile.js.map