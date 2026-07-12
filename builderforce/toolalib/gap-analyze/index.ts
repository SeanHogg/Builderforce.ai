/**
 * Resource Gap Compute Tool (Aggregated Service)
 *
 * Purpose: Provide a HTTP gate that accepts body upload, runs gap analysis per PRD FR-3/F-3 and FR-5, and returns
 * gap summaries (FR-6), metrics, and recommendations in one standardized tool response.
 *
 * Design notes:
 * - Quantities come in resource+demand payloads; rules align with gap-compute-engine.ts.
 * - Time horizons default to 'monthly'; options can specify sprint/quarterly/annual.
 * - Supports optional severity overrides (e.g., UI marking) and exclusion flags (not projecting PR148 gating).
 * - Not gated by low-tier warnings; controls not specified.
 * - Returns all expected fields, leaving export/alerting/RBAC coupling to later passes.
 */

import { gapComputeRequestParams } from './schema.js';
import { GapComputeEngine } from '../lib/gap-compute-engine.js';
import { GapAnalysisResult, GapSummary } from '../lib/models/resource-gap.js';

// Guard: if body is missing, a 400 is returned instead of a 500
export async function handle(req: Request, env: any, ctx: any): Promise<Response> {
  try {
    // Use a schema guard (no builder runtime assumptions)
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response('Request body required', { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (typeof body !== 'object') {
      return new Response('Request body must be a JSON object', { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Guarded parsing of base params (no validateGapsParams, only primitive guard)
    const parsed = gapComputeRequestParams.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request parameters', details: parsed.error.issues }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const params = parsed.data;

    // Initialize engine using default thresholds (aligns with FR-3/DR-6)
    const engine = new GapComputeEngine();

    // Call compute (FR-3)
    const result: GapAnalysisResult = engine.compute(
      params.resources,
      params.demand,
      params.needIcal,
      params.timeHorizon || 'monthly',
      params.options
    );

    // Compute recommendations (FR-5) with optional candidate field (we defer project-level flags there)
    const withRecs: GapAnalysisResult & { recommendations: Record<string, Array<{
      gapId: string;
      type: string;
      title: string;
      description: string;
      effortToImplement?: number;
      estimatedCost: number;
      timeToResolution?: number;
      priority: string;
      status: string;
      rationale: string;
    }>> } = {
      ...(result as any),
      recommendations: {},
      requestSource: params
    };

    if (typeof result.gaps === 'object' && Array.isArray(result.gaps)) {
      for (const gap of result.gaps) {
        const recs = engine.generateRecommendations([gap], params.options);
        withRecs.recommendations[gap.id] = recs[gap.id] || [];
      }
    }

    // Compute severity metrics (for FR-6 alignment)
    const scores = computeSeverityScores(result, params.options?.filters?.timeHorizon);

    // Return cleanly within tool response
    return new Response(
      JSON.stringify({
        tool: 'resourceGapCompute',
        data: withRecs,
        scores
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // For integration test compatibility: if body is invalid JSON, a 400 is returned, not a 500.
    if (err instanceof SyntaxError) {
      return new Response('Request body is not valid JSON', { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    console.error('[toolalib/gap-analyze] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: 'gap instrument failed to compute and ran unsafely; a 400 was not produced for an invalid JSON body' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Compute simple severity scores for FR-6 summary metrics (defs for subsequent steps)
 */
function computeSeverityScores(result: GapAnalysisResult, timeHorizon?: string) {
  const scores = Array.isArray(result.gaps)
    ? result.gaps.map(g => ({
        severity: g.severity,
        deficit: g.deficit,
        timeHorizon: g.timeHorizon
      }))
    : [];
  return scores;
}

/**
 * Local schema guard (via zod) — not relying on builder runtime JSON schema
 */
import { z } from 'zod';
export const gapComputeRequestParams = z.object({
  resources: z.object({
    personnel: z.array(z.object({
      id: z.string().optional(),
      type: z.literal('personnel').optional(),
      name: z.string().optional(),
      role: z.string().optional(),
      seniority: z.string().optional(),
      department: z.string().optional(),
      skills: z.array(z.string()).optional(),
      availability: z.number().optional(),
      costRate: z.number().optional(),
      fteAllocation: z.number().optional()
    })).optional(),
    tools: z.array(z.object({
      id: z.string().optional(),
      type: z.literal('tools').optional(),
      name: z.string().optional(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      costPerUnit: z.number().optional()
    })).optional(),
    budgets: z.array(z.object({
      id: z.string().optional(),
      type: z.literal('budget').optional(),
      name: z.string().optional(),
      currency: z.string().optional(),
      allocatedAmount: z.number().optional(),
      allocatedTimestamp: z.string().optional(),
      committedToProjectIds: z.array(z.string()).optional()
    })).optional()
  }),
  demand: z.array(z.object({
    id: z.string().optional(),
    projectId: z.string().optional(),
    resourceName: z.string(),
    role: z.string().optional(),
    skills: z.array(z.string()).optional(),
    effort: z.number(),
    effortUnits: z.enum(['hours', 'fte-weeks']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    department: z.string().optional()
  })).optional(),
  needIcal: z.boolean().optional(),
  timeHorizon: z.enum(['sprint', 'monthly', 'quarterly', 'annual']).optional(),
  options: z.object({
    filters: z.object({
      dimension: z.enum(['headcount', 'skills', 'capacity_hours', 'budget']).optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      projectId: z.string().optional(),
      department: z.string().optional(),
      role: z.string().optional(),
      timeHorizon: z.enum(['sprint', 'monthly', 'quarterly', 'annual']).optional()
    }).optional(),
    reconcile: z.object({
      excludeOverlappingDemands: z.boolean().optional(),
      mergeSameSkills: z.boolean().optional()
    }).optional(),
    severityThresholds: z.object({
      critical: z.object({
        minutesDrain: z.number().optional(),
        percentBudgetVariance: z.number().optional(),
        capacityDrainPct: z.number().optional()
      }).optional(),
      high: z.object({
        daysSlip: z.number().optional(),
        percentBudgetVariance: z.number().optional(),
        capacityDrainPct: z.number().optional()
      }).optional(),
      medium: z.object({
        hoursDelay: z.number().optional(),
        percentBudgetVariance: z.number().optional(),
        capacityDrainPct: z.number().optional()
      }).optional()
    }).optional(),
    overrides: z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      sourceChangeTimestamp: z.string().optional()
    }).optional()
  }).optional()
});