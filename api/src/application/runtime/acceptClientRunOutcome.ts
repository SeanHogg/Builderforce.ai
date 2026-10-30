/**
 * The use case behind `POST /llm/v1/run-outcome`: accept a validated client run outcome for a tenant. The route
 * validates the body through the shared contract (`parseRunOutcomeRequest`) and calls this; it owns no query.
 *
 * A project or ticket the caller's tenant does not own is not something it can score against: the report is
 * still recorded (the run happened), but unscoped — never filed under, or folded into the routing scope of,
 * another tenant's project or work.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { taskInTenant } from '../../infrastructure/database/tenantScope';
import type { NormalizedRunOutcome } from '@builderforce/learned-routing';
import { projectInTenantCached } from '../project/projectOwnership';
import { recordClientRunOutcome } from './recordClientRunOutcome';

export async function acceptClientRunOutcome(env: Env, db: Db, tenantId: number, outcome: NormalizedRunOutcome): Promise<void> {
  const scoped = { ...outcome };
  if (scoped.projectId != null && !(await projectInTenantCached(env, db, tenantId, scoped.projectId))) delete scoped.projectId;
  // The same for a ticket: a foreign task id would file the outcome under another tenant's work.
  if (scoped.taskId != null && !(await taskInTenant(db, scoped.taskId, tenantId))) delete scoped.taskId;
  await recordClientRunOutcome(env, db, tenantId, scoped);
}
