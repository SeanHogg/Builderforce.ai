/**
 * The run's planned paths (PRD 41 §C8.3 `out-of-scope-change`), LOCAL-FIRST: no structured planned-files field
 * exists, so they are derived deterministically from what the run already carries — its plan texts
 * (`runPlanTexts.ts`: the task and the linked tickets' titles and descriptions) — reduced by run-delta's `extractNamedPaths` to the path-like tokens that RESOLVE in the repository. Resolution
 * stats only those few candidates under the repository root (never a full listing, never the network). Nothing
 * resolves ⇒ `undefined`: the delta then reports scope drift as not measured (`no-plan`).
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { globBase, listingOf, pathCandidates, resolveNamedPaths } from "@builderforce/run-delta";
/** The default {@link PathKinds}: one `stat` per candidate, confined to the root (candidates are relative, never `..`). */
export const statPathKinds = async (root, paths) => {
    const out = new Map();
    await Promise.all(paths.map(async (p) => {
        if (p === "" || p.startsWith("/") || p.split("/").includes(".."))
            return;
        try {
            const s = await stat(join(root, ...p.split("/")));
            if (s.isFile())
                out.set(p, "file");
            else if (s.isDirectory())
                out.set(p, "folder");
        }
        catch { /* absent */ }
    }));
    return out;
};
/**
 * The planned paths of one repository: the plan's candidates resolved against the run's changed files plus a stat of
 * the rest. `undefined` when the plan names nothing that exists there.
 */
export async function plannedPathsFor(args) {
    const candidates = pathCandidates(args.texts.join("\n"));
    if (candidates.length === 0)
        return undefined;
    const known = listingOf(args.changed);
    const ask = [...new Set(candidates.map((c) => (c.includes("*") ? globBase(c) : c.replace(/\/$/, ""))).filter((p) => p !== "" && !known.isFile(p) && !known.isFolder(p)))].sort();
    const kinds = ask.length > 0 ? await (args.pathKinds ?? statPathKinds)(args.root, ask).catch(() => new Map()) : new Map();
    const listing = {
        isFile: (p) => known.isFile(p) || kinds.get(p) === "file",
        isFolder: (p) => known.isFolder(p) || kinds.get(p) === "folder",
    };
    const resolved = resolveNamedPaths(candidates, listing);
    return resolved.length > 0 ? resolved : undefined;
}
//# sourceMappingURL=plannedPaths.js.map