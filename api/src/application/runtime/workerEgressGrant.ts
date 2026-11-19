/**
 * workerEgressGrant — the use case behind `POST /api/runtime/worker-policy`
 * (make.md › PRD 31 §4 W10, control 6).
 *
 * The browser runtime asks for the egress policy of one application before it starts that
 * application's process Workers on the app's own origin (`https://<originKey>-preview.builderforce.ai`).
 * The SERVER decides everything that is signed:
 * - the origin key, derived from (projectId, applicationId) with the runtime's own function
 *   ({@link ./previewOriginKey}), so a developer only ever obtains policies for origins of
 *   projects in their scope;
 * - the origins: the default allowlist ({@link ./workerCsp} `DEFAULT_CONNECT_SOURCES`, applied to
 *   every Worker whatever the policy says) plus the project's DECLARED external APIs
 *   ({@link ./workerEgressDeclarations}). Nothing in the request can add an origin.
 *
 * The project must be the caller's (tenant, and segment when the session has one) — the same gate
 * the shield ingest uses ({@link projectInCallerScope}).
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { KindIncidentContext } from '../security/findingIncidentKinds';
import { projectInCallerScope } from '../security/runtimeShieldIncidents';
import { declaredExternalApiOrigins } from './workerEgressDeclarations';
import { mintWorkerEgressPolicyId, WorkerEgressPolicyError, type MintedWorkerEgressPolicy } from './workerEgressPolicy';

export interface WorkerPolicyRequest {
  projectId: number;
  /** `app:<projectId>:<16 hex>` — validated against `projectId` by the route. */
  applicationId: string;
}

export type WorkerPolicyGrant =
  | ({ outcome: 'minted' } & MintedWorkerEgressPolicy)
  | { outcome: 'unknown_project' }
  /** The project's declaration cannot be signed (a disallowed origin, or too many). */
  | { outcome: 'invalid_declaration' };

/** Mint the signed egress policy for one application of a project the caller owns. */
export async function grantWorkerEgressPolicy(
  env: Env,
  db: Db,
  ctx: KindIncidentContext,
  request: WorkerPolicyRequest,
): Promise<WorkerPolicyGrant> {
  if (!(await projectInCallerScope(env, db, ctx, request.projectId))) return { outcome: 'unknown_project' };
  const origins = await declaredExternalApiOrigins(request.projectId);
  try {
    const minted = await mintWorkerEgressPolicyId(env.JWT_SECRET, {
      tenantId: ctx.tenantId, projectId: request.projectId, applicationId: request.applicationId, origins,
    });
    return { outcome: 'minted', ...minted };
  } catch (err) {
    if (err instanceof WorkerEgressPolicyError) return { outcome: 'invalid_declaration' };
    throw err;
  }
}
