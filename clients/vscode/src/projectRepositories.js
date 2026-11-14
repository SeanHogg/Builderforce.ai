/**
 * A project's repositories, read for the run's default checkout (PRD 35 E3). Split from
 * `bfApi.ts` (already the whole gateway client): one read, one consumer
 * (`runSetupPorts.ts` → `runDefaultRepo.ts`).
 */
import { authed } from "./bfApi";
/**
 * A project's repositories — what a run's default checkout is matched against when the
 * open folder holds several checkouts. Undefined (signed out) ⇒ none.
 */
export async function listProjectRepositories(secrets, projectId) {
    const r = await authed(secrets, `/api/repos/projects/${projectId}/repositories`);
    return r?.repositories ?? [];
}
//# sourceMappingURL=projectRepositories.js.map