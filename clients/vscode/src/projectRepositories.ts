/**
 * A project's repositories, read for the run's default checkout (PRD 35 E3). Split from
 * `bfApi.ts` (already the whole gateway client): one read, one consumer
 * (`runSetupPorts.ts` → `runDefaultRepo.ts`).
 */

import type * as vscode from "vscode";
import { authed } from "./bfApi";

/** One repository associated with a project (`project_repositories`). */
export interface BfProjectRepository {
  owner: string;
  repo: string;
  isDefault?: boolean;
  provider?: string;
  host?: string | null;
}

/**
 * A project's repositories — what a run's default checkout is matched against when the
 * open folder holds several checkouts. Undefined (signed out) ⇒ none.
 */
export async function listProjectRepositories(secrets: vscode.SecretStorage, projectId: number): Promise<BfProjectRepository[]> {
  const r = await authed<{ repositories: BfProjectRepository[] }>(secrets, `/api/repos/projects/${projectId}/repositories`);
  return r?.repositories ?? [];
}
