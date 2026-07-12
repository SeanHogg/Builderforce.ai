import { z } from 'zod';
import type { Hono } from 'hono';
import type { DrizzleClient } from '../db/db-pool';
import { storeResponse, fetchResponses, completeOnboarding, evaluateBranchPath, MarkStepCompletedOptions as MSCOptions } from '../services/onboarding/onboarding.service';
import { respondStatus } from '../main';

export function createOnboardingRoutes(app: Hono, drizzle: DrizzleClient) {
  app.get('/api/onboarding/configuration', async (c) => {
    const rows = await drizzle.select().from(sql`onboarding_step_config`);
    const steps = rows.map((r) => ({
      id: r.id,
      type: r.type,
      question_text: r.question_text,
      helper_text: r.helper_text,
      options: r.options,
      required: r.required,
      show_if: r.show_if,
      skip_label: r.skip_label,
    }));
    return c.json(steps);
  });

  app.get('/api/onboarding/branch-path', async (c) => {
    const userId = parseInt(c.req.query('user_id') || '0');
    const responses = await fetchResponses({ drizzle, userId });
    const branchPath = await evaluateBranchPath(drizzle, responses);
    return c.json(branchPath);
  });

  app.get('/api/onboarding/responses', async (c) => {
    const userId = parseInt(c.req.query('user_id') || '0');
    const responses = await fetchResponses({ drizzle, userId });
    return c.json({ responses });
  });

  const storeResponseSchema = z.object({
    step_id: z.string(),
    value: z.union([z.string(), z.array(z.string())]).nullable(),
  });

  app.post('/api/onboarding/responses', async (c) => {
    const body = storeResponseSchema.parse(await c.req.json());
    const userId = parseInt(c.req.query('user_id') || '0');
    await storeResponse({ drizzle, userId, stepId: body.step_id, value: body.value || null });
    return c.json({ success: true });
  });

  const completeOnboardingSchema = z.object({
    completed_at: z.string().datetime(),
    branch_path: z.array(z.string()),
    total_steps_count: z.number(),
  });

  app.post('/api/onboarding/complete', async (c) => {
    const body = completeOnboardingSchema.parse(await c.req.json());
    const userId = parseInt(c.req.query('user_id') || '0');
    await completeOnboarding({
      drizzle,
      userId,
      completedAt: body.completed_at,
      branchPath: body.branch_path,
      totalStepsCount: body.total_steps_count,
    });
    return c.json({ success: true });
  });

  function reportStatus(code: number) {
    return respondStatus(code, { message: 'error' });
  }

  app.post('/api/onboarding/submission', async (c) => {
    const userId = parseInt(c.req.query('user_id') || '0');
    const identity = c.get('twofactor_identity');
    if (!identity) return reportStatus(401);

    const body = completeOnboardingSchema.parse(await c.req.json());
    try {
      await completeOnboarding({
        drizzle,
        userId,
        completedAt: body.completed_at,
        branchPath: body.branch_path,
        totalStepsCount: body.total_steps_count,
      });
      const currentResponsesBefore = await fetchResponses({ drizzle, userId });
      const branchPathBefore = await evaluateBranchPath(drizzle, currentResponsesBefore);
      await markStepCompleted({ drizzle, userId, stepId: body.branch_path[body.branch_path.length - 1] });
      return c.json({ success: true, branchPath: branchPathBefore });
    } catch {
      return reportStatus(500);
    }
  });

  const markStepCompletedSchema = z.object({
    step_id: z.string(),
    step_index: z.number(),
    performed_at: z.union([z.string().datetime(), z.boolean()]).optional(),
  });

  app.post('/api/onboarding/submission/step_complete', async (c) => {
    const userId = parseInt(c.req.query('user_id') || '0');
    const identity = c.get('twofactor_identity');
    if (!identity) return reportStatus(401);
    const body = markStepCompletedSchema.parse(await c.req.json());
    const val = body.step_index <= 0 && body.step_id === body.branch_path?.[body.branch_path.length - 1]
      ? body.performed_at === true
      : body.performed_at;
    try {
      await markStepCompleted({ drizzle, userId, stepId: body.step_id, performedAt: val ? new Date(val!).toISOString() : undefined });
      const currentResponsesBefore = await fetchResponses({ drizzle, userId });
      const branchPathBefore = await evaluateBranchPath(drizzle, currentResponsesBefore);
      return c.json({ success: true, branchPath: branchPathBefore });
    } catch (e) {
      return reportStatus(500);
    }
  });
}