/**
 * The run's default checkout in a folder that CONTAINS checkouts (PRD 35 E3) — gathered
 * here, decided by the shared pure `resolveDefaultRepo` (agent-tools).
 *
 * Cheapest evidence first: a root that is itself a repository needs no default; one
 * checkout, or a path in the request naming one, decides without the network. Only then
 * are the project's repositories fetched and matched to each checkout's `origin`. The
 * whole lookup is bounded and never throws — a run is never held up or failed by it.
 *
 * No `vscode` import: the git and platform reads arrive as ports, so it is unit-tested.
 */
import * as path from "path";
import { pathsInText, resolveDefaultRepo } from "@builderforce/agent-tools";
const DEFAULT_TIMEOUT_MS = 3_000;
async function resolve(ports, input) {
    const { root } = ports;
    if (!root || (await ports.isCheckout(root)))
        return undefined;
    const names = await ports.listCheckouts(root);
    if (names.length <= 1)
        return names[0];
    const paths = pathsInText(input.request);
    const fromPath = resolveDefaultRepo({ candidates: names, paths });
    if (fromPath || input.projectId == null || !ports.projectRepos)
        return fromPath;
    const [repos, checkouts] = await Promise.all([
        ports.projectRepos(input.projectId).catch(() => []),
        Promise.all(names.map(async (name) => {
            const url = await ports.originUrl(path.join(root, name)).catch(() => undefined);
            const origin = url ? ports.parseRemote(url) : null;
            return origin ? { name, origin: { owner: origin.owner, repo: origin.repo } } : { name };
        })),
    ]);
    return resolveDefaultRepo({ candidates: checkouts, paths, projectRepos: repos });
}
/** Resolve the run's default checkout; undefined on none, a failure, or the time bound. */
export async function resolveRunDefaultRepo(ports, input) {
    let timer;
    const bound = new Promise((r) => { timer = setTimeout(() => r(undefined), ports.timeoutMs ?? DEFAULT_TIMEOUT_MS); });
    try {
        return await Promise.race([resolve(ports, input).catch(() => undefined), bound]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=runDefaultRepo.js.map