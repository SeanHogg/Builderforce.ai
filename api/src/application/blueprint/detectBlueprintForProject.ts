/**
 * W2/W5: Detect a project's blueprint — the ONE use case every caller goes through
 * (the push webhook and the `app_blueprint.detect` tool).
 *
 * project → its default repo → that repo's credential → the commit (given, or the
 * head of the default branch) → the source files the detectors read → detection →
 * stored row. Every step that can miss returns a reason instead of throwing, so a
 * repo with no linked credential is an expected `{ ok: false }`, not an exception
 * in a `waitUntil`.
 */

import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { resolveRepoRefSha } from '../repos/commitFileToRepo';
import { resolveDefaultRepoForProject } from '../repos/resolveDefaultRepo';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { detectBlueprint, storeBlueprint } from './blueprintDetection';
import { readBlueprintSources } from './blueprintSources';

export interface DetectBlueprintForProjectInput {
  tenantId: number;
  projectId: number;
  /** Commit to detect at; defaults to the head of the repo's default branch. */
  commitSha?: string | null;
}

export type DetectBlueprintForProjectResult =
  | { ok: true; blueprint: AppBlueprint }
  | { ok: false; reason: string };

/** The collaborators, injectable so the wiring is testable without a database. */
export interface DetectBlueprintDeps {
  resolveDefaultRepoForProject: typeof resolveDefaultRepoForProject;
  resolveRepoCredential: typeof resolveRepoCredential;
  resolveRepoRefSha: typeof resolveRepoRefSha;
  readBlueprintSources: typeof readBlueprintSources;
  storeBlueprint: typeof storeBlueprint;
}

const DEFAULT_DEPS: DetectBlueprintDeps = {
  resolveDefaultRepoForProject,
  resolveRepoCredential,
  resolveRepoRefSha,
  readBlueprintSources,
  storeBlueprint,
};

/** Detect and store the blueprint for `input.projectId`. Never throws. */
export async function detectBlueprintForProject(
  db: Db,
  env: Env,
  input: DetectBlueprintForProjectInput,
  deps: DetectBlueprintDeps = DEFAULT_DEPS,
): Promise<DetectBlueprintForProjectResult> {
  const { tenantId, projectId } = input;
  try {
    const repoRef = await deps.resolveDefaultRepoForProject(db, tenantId, projectId);
    if (!repoRef) return { ok: false, reason: 'the project has no linked repository' };

    const cred = await deps.resolveRepoCredential(db, integrationCredentialSecret(env), tenantId, repoRef.repoId);
    if (isResolveError(cred)) return { ok: false, reason: cred.error };

    const { provider, host, owner, repo } = cred.repo;
    const coords = { provider, host, owner, repo, token: cred.token };
    const branch = cred.repo.defaultBranch ?? 'main';
    const sha = input.commitSha || (await deps.resolveRepoRefSha(coords, branch));
    if (!sha) return { ok: false, reason: `could not resolve the head commit of ${branch}` };

    const files = await deps.readBlueprintSources({ ...coords, ref: sha });
    const blueprint = detectBlueprint(files, projectId, sha);
    await deps.storeBlueprint(db, projectId, sha, blueprint);
    return { ok: true, blueprint };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/blueprint/detectBlueprintForProject.ts',
      operation: 'detectBlueprintForProject',
      context: { tenantId, projectId },
    });
    return { ok: false, reason: error instanceof Error ? error.message : 'blueprint detection failed' };
  }
}
