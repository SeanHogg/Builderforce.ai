/**
 * Approval rule routes – /api/approval-rules
 *
 * Configurable auto-approval rules.  When a new approval request arrives at
 * POST /api/approvals, each enabled rule for the tenant is evaluated in order.
 * If any rule matches, the approval is auto-approved without human review.
 *
 * Matching criteria (all non-null fields must match):
 *   • actionType         — exact string match (null = any action type)
 *   • maxEstimatedCost   — metadata.estimatedCost ≤ value  (null = ignored)
 *   • maxFilesChanged    — metadata.filesChanged  ≤ value  (null = ignored)
 *
 * POST   /api/approval-rules          Create a rule         (MANAGER+)
 * GET    /api/approval-rules          List rules for tenant (MANAGER+)
 * PATCH  /api/approval-rules/:id      Update a rule         (MANAGER+)
 * DELETE /api/approval-rules/:id      Delete a rule         (MANAGER+)
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { approvalRules } from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createApprovalRuleRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // POST /api/approval-rules
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      name: string;
      actionType?: string | null;
      maxEstimatedCost?: number | null;
      maxFilesChanged?: number | null;
      isEnabled?: boolean;
    }>();

    if (!body.name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    const [rule] = await db
      .insert(approvalRules)
      .values({
        tenantId,
        name:             body.name.trim(),
        actionType:       body.actionType ?? null,
        maxEstimatedCost: body.maxEstimatedCost ?? null,
        maxFilesChanged:  body.maxFilesChanged ?? null,
        isEnabled:        body.isEnabled ?? true,
      })
      .returning();

    return c.json(rule, 201);
  });

  // GET /api/approval-rules
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rules = await db
      .select()
      .from(approvalRules)
      .where(eq(approvalRules.tenantId, tenantId));
    return c.json({ rules });
  });

  // PATCH /api/approval-rules/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(approvalRules)
      .where(and(eq(approvalRules.id, id), eq(approvalRules.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Rule not found' }, 404);

    const body = await c.req.json<{
      name?: string;
      actionType?: string | null;
      maxEstimatedCost?: number | null;
      maxFilesChanged?: number | null;
      isEnabled?: boolean;
    }>();

    const [updated] = await db
      .update(approvalRules)
      .set({
        name:             body.name?.trim() ?? existing.name,
        actionType:       'actionType' in body ? (body.actionType ?? null) : existing.actionType,
        maxEstimatedCost: 'maxEstimatedCost' in body ? (body.maxEstimatedCost ?? null) : existing.maxEstimatedCost,
        maxFilesChanged:  'maxFilesChanged' in body ? (body.maxFilesChanged ?? null) : existing.maxFilesChanged,
        isEnabled:        body.isEnabled ?? existing.isEnabled,
        updatedAt:        new Date(),
      })
      .where(and(eq(approvalRules.id, id), eq(approvalRules.tenantId, tenantId)))
      .returning();

    return c.json(updated);
  });

  // DELETE /api/approval-rules/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: approvalRules.id })
      .from(approvalRules)
      .where(and(eq(approvalRules.id, id), eq(approvalRules.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Rule not found' }, 404);

    await db
      .delete(approvalRules)
      .where(and(eq(approvalRules.id, id), eq(approvalRules.tenantId, tenantId)));

    return c.json({ deleted: true });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Shared helper — evaluate rules against an incoming approval request.
// Returns true if any enabled rule matches (meaning: auto-approve).
// ---------------------------------------------------------------------------

export async function checkAutoApprovalRules(
  db: Db,
  tenantId: number,
  actionType: string,
  metadata: Record<string, unknown> | null,
): Promise<boolean> {
  const rules = await db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.tenantId, tenantId), eq(approvalRules.isEnabled, true)));

  for (const rule of rules) {
    // action type check
    if (rule.actionType !== null && rule.actionType !== actionType) continue;

    // cost check
    if (rule.maxEstimatedCost !== null) {
      const estimatedCost = Number(metadata?.estimatedCost ?? 0);
      if (estimatedCost > rule.maxEstimatedCost) continue;
    }

    // files changed check
    if (rule.maxFilesChanged !== null) {
      const filesChanged = Number(metadata?.filesChanged ?? 0);
      if (filesChanged > rule.maxFilesChanged) continue;
    }

    return true; // rule matched
  }

  return false;
}
