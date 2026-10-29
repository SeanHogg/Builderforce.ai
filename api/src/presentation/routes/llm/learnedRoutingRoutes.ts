/**
 * Learned Model Routing (PRD 13) surfaces on the gateway.
 *
 * GET  /v1/model-analytics?scope=project:<id>|tenant|global — the per-action ranking
 * GET  /v1/recall-seed?limit=50                             — local SSM recall seed
 * POST /v1/run-outcome                                      — non-cloud run write-back
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { parseOptionalBody } from '../requestBody';
import { RunOutcomeBody } from '../llmRoutes.schemas';
import { limitParam } from '../queryParams';
import { requestDb } from '../../../application/shared/dbHandle';
import { getRoutingTable, parseScopeToken, scopeToken } from '../../../application/llm/routingTable';
import { getRecallSeed } from '../../../application/llm/recallSeed';
import { recordClientRunOutcome } from '../../../application/runtime/scoreRunOutcome';
import { projectInTenant, projectInTenantCached } from '../../../application/project/projectOwnership';
import { taskInTenant } from '../../../infrastructure/database/tenantScope';
import {
  actionTypeLabel,
  OWN_TENANT_SCOPE_TOKEN,
  parseRunOutcomeRequest,
  type ActionType,
} from '@builderforce/learned-routing';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountLearnedRoutingRoutes(router: Hono<HonoEnv>): void {
  // The per-action-type model ranking the learned router seeds from (PRD 13 §6.5).
  // Reads the SAME cached `routing:<scope>` KV blob the router reads (one source) — so
  // it's O(1) and DB-free on a warm cache; a cold scope reconciles once from the
  // durable outcomes table. Tenant-scoped.
  router.get('/v1/model-analytics', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const rawScope = c.req.query('scope') ?? OWN_TENANT_SCOPE_TOKEN;
    // `tenant` resolves to the caller's own tenant id (a client cannot know it, so the
    // shared contract spells that token once); `global` and `project:<id>` pass
    // through. Anything malformed → 400.
    const scope = rawScope === OWN_TENANT_SCOPE_TOKEN
      ? ({ kind: 'tenant', id: access.tenantId } as const)
      : parseScopeToken(rawScope);
    if (!scope) return c.json({ error: `invalid scope '${rawScope}' (use project:<id> | tenant | global)` }, 400);

    const db = requestDb(c);
    // Ownership guard: a project scope must belong to the caller's tenant (the blob
    // is low-sensitivity aggregate model stats, but routing data still stays tenant-scoped).
    if (scope.kind === 'project' && !(await projectInTenant(db, access.tenantId, scope.id))) {
      return c.json({ error: 'project not found in this tenant' }, 404);
    }

    const table = await getRoutingTable(c.env, db, scope);
    // Shape the blob into a stable, labelled ranking for the panel.
    const byAction = (Object.entries(table.byAction) as [ActionType, typeof table.byAction[ActionType]][])
      .filter(([, models]) => models && models.length > 0)
      .map(([actionType, models]) => ({
        actionType,
        label: actionTypeLabel(actionType),
        // The row carries EVERY field `rankModelsForAction` consumes, not just the
        // display ones: this endpoint is also the on-prem/IDE host's read of the
        // learned table, and a client that cannot see the thumbs or the 429 share
        // would rank the same evidence differently from the cloud router.
        models: (models ?? []).map((m) => ({
          model: m.model,
          samples: m.n,
          avgScore: Math.round(m.avgScore * 1000) / 1000,
          mergeRate: Math.round(m.mergeRate * 1000) / 1000,
          avgCostMillicents: Math.round(m.avgCostMc),
          // Runs behind that mean that reported a cost: 0 means it is unknown (not free), and the host's
          // tie-break must read it so. Absent on a blob built before cost could be unknown.
          ...(m.costN != null ? { costN: m.costN } : {}),
          ratedUp: m.ratedUp ?? 0,
          ratedDown: m.ratedDown ?? 0,
          rateLimitRate: Math.round((m.rateLimitRate ?? 0) * 1000) / 1000,
          // Recency decay (cost PRD D3): the decayed run count and the epoch ms the
          // stat was last folded at, so a host's Thompson exploration samples the SAME
          // evidence the cloud router does. Absent on a blob built without decay.
          ...(m.effectiveN != null ? { effectiveN: Math.round(m.effectiveN * 1000) / 1000 } : {}),
          ...(m.at != null ? { at: m.at } : {}),
        })),
      }));
    return c.json({ scope: scopeToken(scope), updatedAt: table.updatedAt, byAction });
  });

  // Warm a browser's LOCAL SSM recall memory from the tenant's recently-scored outcomes
  // (PRD 13 §6.6) — see `application/llm/recallSeed`.
  router.get('/v1/recall-seed', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const limit = limitParam(c.req.query('limit'), 50, 200);
    const seed = await getRecallSeed(c.env, requestDb(c), access.tenantId, limit);
    return c.json({ memories: seed });
  });

  // Write-back for NON-cloud runs. IDE-native, on-prem, and external-SDK runs go through
  // the gateway but never create a cloud `executions` row, so their
  // (action_type, model)→success signal never reached the learner. This lets such a
  // client report its terminal outcome so the same routing table that cloud runs teach
  // also learns from them. Idempotent on `clientRunId`; best-effort.
  router.post('/v1/run-outcome', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const body = await parseOptionalBody(c, RunOutcomeBody);

    // Validation + normalization is the SHARED contract (`@builderforce/learned-routing`),
    // the same module the on-prem host builds its body from — so the door and the only
    // client that knocks on it can never disagree about a field name, and a signal the
    // client CAN report (`rateLimited`) cannot be silently dropped here.
    const parsed = parseRunOutcomeRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const db = requestDb(c);
    // A project the caller's tenant does not own is not something it can score against: the
    // report is still recorded (the run happened), but unscoped — never filed under, or
    // folded into the routing scope of, another tenant's project.
    const outcome = { ...parsed.outcome };
    if (outcome.projectId != null && !(await projectInTenantCached(c.env, db, access.tenantId, outcome.projectId))) delete outcome.projectId;
    // The same for a ticket: a foreign task id would file the outcome under another tenant's work.
    if (outcome.taskId != null && !(await taskInTenant(db, outcome.taskId, access.tenantId))) delete outcome.taskId;
    await recordClientRunOutcome(c.env, db, access.tenantId, outcome);
    return c.json({ ok: true });
  });
}
