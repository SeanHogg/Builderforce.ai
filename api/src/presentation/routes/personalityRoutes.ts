/**
 * Personality LEARNING + TRACKING routes — /api/personality/*
 *
 * Surfaces the two things that were missing today (Gaps 6 & 7):
 *
 *   • GET  /agents/:agentId/events          — WHICH personality was applied to this
 *                                             agent's recent runs, and WHEN. Reads the
 *                                             durable `personality_events` spine AND,
 *                                             so the panel is LIVE even before any
 *                                             producer writes to it, DERIVES entries
 *                                             read-through from real terminal runs
 *                                             (`run_model_outcomes`) joined with the
 *                                             agent's compiled psychometric directives.
 *
 *   • GET  /agents/:agentId/reinforcements  — the SUGGESTED trait reinforcements,
 *                                             computed LIVE from the agent's real run
 *                                             outcomes via the pure proposeTraitReinf-
 *                                             orcement() core, plus recent history.
 *
 *   • POST /agents/:agentId/reinforcements/apply    — commit an approved proposal to
 *                                             ide_agents.psychometric (Pro-gated),
 *                                             writing a reversible provenance row.
 *   • POST /agents/:agentId/reinforcements/dismiss  — reject a proposal (audited).
 *
 *   • POST /events                          — the durable producer seam: any run
 *                                             finalizer (cloud engine / on-prem
 *                                             reporter) can record a personality
 *                                             application. Not required for the panel
 *                                             to be LIVE (the GET derives), but it
 *                                             upgrades a derived entry to a first-class
 *                                             recorded one.
 *
 * LIVE-path choice (documented per the task): the trait-reinforcement PRODUCER is
 * READ-THROUGH from `run_model_outcomes` in the suggestion endpoint — one row per
 * terminal run already exists there (scoreRunOutcome / recordClientRunOutcome), keyed
 * by cloud_agent_ref == ide_agents.id — so a real suggestion appears from real run
 * data without touching cloudAgentEngine or any file another agent owns.
 *
 * Reads serve through the canonical read-through cache (getOrSetCached) folded on a
 * per-agent version token that every write bumps, so there is no N+1 and no staleness.
 */
import { Hono } from 'hono';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { compilePsychometricProfile, type LimbicPsychProfile } from '@builderforce/agent-tools';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantHasFeature } from '../middleware/featureGate';
import {
  getOrSetCached,
  getCacheVersion,
  bumpCacheVersion,
  invalidateCached,
} from '../../infrastructure/cache/readThroughCache';
import { PUBLIC_LIST_CACHE_KEY } from './workforceRoutes';
import { runtimeHiredAgentsCacheKey } from './runtimeRoutes';
import { assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';
import {
  sanitizePsychometricProfile,
  sanitizeVector,
  VALID_DIMENSION_IDS,
} from '../../application/persona/psychometricCatalog';
import {
  proposeTraitReinforcement,
  applyDeltas,
  summarizeDeltas,
  MAX_DELTA_PER_DIM,
  MAX_PERIOD_ABS,
  type RunOutcomeSignal,
  type TraitReinforcementProposal,
} from '../../application/persona/traitReinforcement';
import {
  ideAgents,
  personalityEvents,
  traitReinforcements,
  runModelOutcomes,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const clamp01 = (n: number): number => clamp(Number.isFinite(n) ? n : 0, 0, 1);

/** Per-agent cache version token — bumped by every write so folded keys age out. */
function personalityVersionKey(tenantId: number, agentRef: string): string {
  return `personality-version:t:${tenantId}:a:${agentRef}`;
}

/** Parse a stored psychometric JSON string into a compiler-ready profile (or null). */
function parseProfile(raw: string | null | undefined): LimbicPsychProfile | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const vector = sanitizeVector(o.vector);
    const profile: LimbicPsychProfile = { vector };
    if (typeof o.enneagramType === 'number') profile.enneagramType = o.enneagramType;
    return profile;
  } catch {
    return null;
  }
}

/** A short, human-readable summary of an agent's compiled personality directives. */
function directivesSummaryFor(profile: LimbicPsychProfile | null): { summary: string; count: number; params: { thinkLevel?: string; reasoningLevel?: string; temperature?: number } } {
  if (!profile) return { summary: '', count: 0, params: {} };
  const { directives, params } = compilePsychometricProfile(profile);
  // Take the leading phrase of the top few directives (before the colon) for a compact readout.
  const heads = directives.slice(0, 3).map((d) => d.split(':')[0]?.trim()).filter(Boolean);
  const summary = heads.join(' · ') + (directives.length > 3 ? ` +${directives.length - 3} more` : '');
  return {
    summary,
    count: directives.length,
    params: {
      thinkLevel: params.thinkLevel,
      reasoningLevel: params.reasoningLevel === 'on' ? 'on' : undefined,
      temperature: typeof params.temperature === 'number' ? params.temperature : undefined,
    },
  };
}

/** Map one run_model_outcomes row to the reinforcement signal vocabulary. Heuristic
 *  but grounded in the real fields the scorer already persists. */
function outcomeToSignal(row: {
  terminalStatus: string;
  merged: boolean;
  ciGreen: boolean;
  degraded: boolean;
  steps: number;
  hallucinationRate: number | null;
}): RunOutcomeSignal {
  const succeeded = row.terminalStatus === 'completed';
  // Tool-error proxy: a degraded run (model floored after tool trouble) reads as
  // high tool error; else fall back to the deliverable's hallucination rate.
  const toolErrorRate = row.degraded ? 0.6 : clamp01(row.hallucinationRate ?? 0);
  return {
    succeeded,
    toolErrorRate,
    humanAccepted: row.merged, // a merged PR = a human accepted the work
    humanRejected: row.terminalStatus === 'cancelled', // a human cancelled the run
    retries: Math.max(0, Math.floor(row.steps ?? 0)),
  };
}

export function createPersonalityRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Resolve + authorize: the agent must belong to the caller's tenant. Returns the
   *  agent's current psychometric JSON string, or null if not owned/not found. */
  async function ownedAgentProfile(tenantId: number, agentRef: string): Promise<{ psychometric: string | null } | null> {
    const [row] = await db
      .select({ psychometric: ideAgents.psychometric })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, agentRef), eq(ideAgents.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }

  // ── GET recent personality-usage events (durable + read-through derived) ────────
  router.get('/agents/:agentId/events', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentRef = c.req.param('agentId');
    const limit = clamp(Number(c.req.query('limit')) || 20, 1, 100);
    const agent = await ownedAgentProfile(tenantId, agentRef);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const ver = await getCacheVersion(c.env as Env, personalityVersionKey(tenantId, agentRef));
    const key = `personality:events:t:${tenantId}:a:${agentRef}:l:${limit}:v:${ver}`;
    const payload = await getOrSetCached(c.env as Env, key, async () => {
      const profile = parseProfile(agent.psychometric);
      const compiled = directivesSummaryFor(profile);

      // 1. Durable recorded events.
      const recorded = await db
        .select()
        .from(personalityEvents)
        .where(and(eq(personalityEvents.tenantId, tenantId), eq(personalityEvents.agentRef, agentRef)))
        .orderBy(desc(personalityEvents.createdAt))
        .limit(limit);
      const recordedExecIds = new Set(recorded.map((r) => r.executionId).filter((x): x is number => x != null));

      interface UsageEvent {
        id: string;
        recorded: boolean;
        executionId: number | null;
        runId: string | null;
        profileSource: string;
        personaIds: string[];
        directivesSummary: string;
        directiveCount: number;
        thinkLevel: string | null;
        reasoningLevel: string | null;
        temperature: number | null;
        at: Date | null;
      }

      const events: UsageEvent[] = recorded.map((r) => ({
        id: `rec:${r.id}`,
        recorded: true,
        executionId: r.executionId,
        runId: r.runId,
        profileSource: r.profileSource,
        personaIds: r.personaIds ? (safeJson<string[]>(r.personaIds, [])) : [],
        directivesSummary: r.directivesSummary ?? '',
        directiveCount: r.directiveCount,
        thinkLevel: r.thinkLevel,
        reasoningLevel: r.reasoningLevel,
        temperature: r.temperature,
        at: r.createdAt,
      }));

      // 2. Read-through derived entries from real terminal runs not already recorded —
      //    so the panel shows live "personality used, when" from run_model_outcomes.
      const derivedNeeded = Math.max(0, limit - events.length);
      if (derivedNeeded > 0 && compiled.count > 0) {
        const runs = await db
          .select({ executionId: runModelOutcomes.executionId, createdAt: runModelOutcomes.createdAt })
          .from(runModelOutcomes)
          .where(and(eq(runModelOutcomes.tenantId, tenantId), eq(runModelOutcomes.cloudAgentRef, agentRef)))
          .orderBy(desc(runModelOutcomes.createdAt))
          .limit(limit);
        for (const run of runs) {
          if (run.executionId != null && recordedExecIds.has(run.executionId)) continue;
          events.push({
            id: `run:${run.executionId ?? run.createdAt?.valueOf()}`,
            recorded: false,
            executionId: run.executionId,
            runId: null,
            profileSource: 'agent',
            personaIds: [],
            directivesSummary: compiled.summary,
            directiveCount: compiled.count,
            thinkLevel: compiled.params.thinkLevel ?? null,
            reasoningLevel: compiled.params.reasoningLevel ?? null,
            temperature: compiled.params.temperature ?? null,
            at: run.createdAt,
          });
          if (events.length >= limit) break;
        }
      }

      events.sort((a, b) => (b.at?.valueOf() ?? 0) - (a.at?.valueOf() ?? 0));
      return {
        agentRef,
        activeSummary: compiled.summary,
        activeDirectiveCount: compiled.count,
        events: events.slice(0, limit),
      };
    }, SHORT_TTL);
    return c.json(payload);
  });

  // ── GET suggested trait reinforcements (LIVE from run_model_outcomes) ────────────
  router.get('/agents/:agentId/reinforcements', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentRef = c.req.param('agentId');
    const windowDays = clamp(Number(c.req.query('days')) || 14, 1, 90);
    const agent = await ownedAgentProfile(tenantId, agentRef);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const ver = await getCacheVersion(c.env as Env, personalityVersionKey(tenantId, agentRef));
    const key = `personality:reinf:t:${tenantId}:a:${agentRef}:d:${windowDays}:v:${ver}`;
    const payload = await getOrSetCached(c.env as Env, key, async () => {
      const profile = parseProfile(agent.psychometric);
      const vector = profile?.vector ?? {};
      const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      // Real terminal runs for this agent in the window → outcome signals.
      const runs = await db
        .select({
          terminalStatus: runModelOutcomes.terminalStatus,
          merged: runModelOutcomes.merged,
          ciGreen: runModelOutcomes.ciGreen,
          degraded: runModelOutcomes.degraded,
          steps: runModelOutcomes.steps,
          hallucinationRate: runModelOutcomes.hallucinationRate,
        })
        .from(runModelOutcomes)
        .where(and(
          eq(runModelOutcomes.tenantId, tenantId),
          eq(runModelOutcomes.cloudAgentRef, agentRef),
          gte(runModelOutcomes.createdAt, windowStart),
        ))
        .limit(500);
      const signals = runs.map(outcomeToSignal);

      // Weekly cap accounting: sum of applied deltas in the last 7 days.
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const appliedThisWeek = await db
        .select({ deltas: traitReinforcements.deltas })
        .from(traitReinforcements)
        .where(and(
          eq(traitReinforcements.tenantId, tenantId),
          eq(traitReinforcements.agentRef, agentRef),
          eq(traitReinforcements.status, 'applied'),
          gte(traitReinforcements.proposedAt, weekStart),
        ));
      const priorAppliedThisPeriod: Record<string, number> = {};
      for (const r of appliedThisWeek) {
        try {
          const d = JSON.parse(r.deltas) as Record<string, number>;
          for (const [dim, v] of Object.entries(d)) priorAppliedThisPeriod[dim] = (priorAppliedThisPeriod[dim] ?? 0) + (Number(v) || 0);
        } catch { /* skip malformed */ }
      }

      const proposal: TraitReinforcementProposal = proposeTraitReinforcement(vector, signals, { priorAppliedThisPeriod });

      // Recent decisions for the history strip.
      const history = await db
        .select({
          id: traitReinforcements.id,
          status: traitReinforcements.status,
          deltas: traitReinforcements.deltas,
          rationale: traitReinforcements.rationale,
          basedOnRuns: traitReinforcements.basedOnRuns,
          autoApplied: traitReinforcements.autoApplied,
          proposedAt: traitReinforcements.proposedAt,
          decidedAt: traitReinforcements.decidedAt,
        })
        .from(traitReinforcements)
        .where(and(eq(traitReinforcements.tenantId, tenantId), eq(traitReinforcements.agentRef, agentRef)))
        .orderBy(desc(traitReinforcements.proposedAt))
        .limit(10);

      const hasProposal = Object.keys(proposal.deltas).length > 0;
      return {
        agentRef,
        windowDays,
        basedOnRuns: signals.length,
        proposal: hasProposal
          ? {
              deltas: proposal.deltas,
              rationale: proposal.rationale,
              summary: summarizeDeltas(proposal.deltas),
              previewVector: applyDeltas(vector, proposal.deltas),
            }
          : null,
        rationale: proposal.rationale,
        caps: { perDimension: MAX_DELTA_PER_DIM, perPeriod: MAX_PERIOD_ABS },
        history: history.map((h) => ({
          id: h.id,
          status: h.status,
          deltas: safeJson<Record<string, number>>(h.deltas, {}),
          rationale: safeJson<string[]>(h.rationale, []),
          basedOnRuns: h.basedOnRuns,
          autoApplied: h.autoApplied,
          proposedAt: h.proposedAt,
          decidedAt: h.decidedAt,
        })),
      };
    }, SHORT_TTL);
    return c.json(payload);
  });

  // ── POST apply an approved reinforcement (Pro-gated; writes the new vector) ──────
  router.post('/agents/:agentId/reinforcements/apply', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const agentRef = c.req.param('agentId');
    const agent = await ownedAgentProfile(tenantId, agentRef);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    // Reinforcement writes to the psychometric vector — gate on the same Pro feature
    // as the Workforce personality editor.
    if (!(await tenantHasFeature(c.env as Env, tenantId, userId, 'psychometricPersona'))) {
      return c.json({ error: 'psychometricPersona feature required', feature: 'psychometricPersona' }, 402);
    }

    const body = await c.req.json<{
      deltas?: Record<string, number>;
      rationale?: string[];
      basedOnRuns?: number;
      windowDays?: number;
      autoApply?: boolean;
    }>();

    // NEVER trust client deltas — re-validate: known dims only, per-dim cap, and the
    // weekly cumulative cap using what has already been applied this period.
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const appliedThisWeek = await db
      .select({ deltas: traitReinforcements.deltas })
      .from(traitReinforcements)
      .where(and(
        eq(traitReinforcements.tenantId, tenantId),
        eq(traitReinforcements.agentRef, agentRef),
        eq(traitReinforcements.status, 'applied'),
        gte(traitReinforcements.proposedAt, weekStart),
      ));
    const prior: Record<string, number> = {};
    for (const r of appliedThisWeek) {
      const d = safeJson<Record<string, number>>(r.deltas, {});
      for (const [dim, v] of Object.entries(d)) prior[dim] = (prior[dim] ?? 0) + (Number(v) || 0);
    }

    const cleanDeltas: Record<string, number> = {};
    for (const [dim, rawV] of Object.entries(body.deltas ?? {})) {
      if (!VALID_DIMENSION_IDS.has(dim)) continue;
      let v = clamp(Math.round(Number(rawV) || 0), -MAX_DELTA_PER_DIM, MAX_DELTA_PER_DIM);
      const priorApplied = prior[dim] ?? 0;
      const room = MAX_PERIOD_ABS - Math.abs(priorApplied);
      if (room <= 0) continue;
      if (v > 0) v = Math.min(v, room);
      else if (v < 0) v = Math.max(v, -room);
      if (v !== 0) cleanDeltas[dim] = v;
    }
    if (Object.keys(cleanDeltas).length === 0) {
      return c.json({ error: 'No applicable reinforcement (capped or empty)' }, 400);
    }

    const profile = parseProfile(agent.psychometric);
    const vectorBefore = profile?.vector ?? {};
    const vectorAfter = applyDeltas(vectorBefore, cleanDeltas);

    // Rebuild the full profile with the new vector and persist via the ONE sanitizer.
    const nextProfileRaw = sanitizePsychometricProfile({
      ...(agent.psychometric ? safeJson<Record<string, unknown>>(agent.psychometric, {}) : {}),
      vector: vectorAfter,
      source: 'sliders',
    });
    if (!nextProfileRaw) return c.json({ error: 'Reinforcement produced an empty profile' }, 400);

    await db.update(ideAgents).set({ psychometric: nextProfileRaw, updatedAt: new Date() }).where(and(eq(ideAgents.id, agentRef), eq(ideAgents.tenantId, tenantId)));

    const [inserted] = await db
      .insert(traitReinforcements)
      .values({
        tenantId,
        agentRef,
        status: 'applied',
        deltas: JSON.stringify(cleanDeltas),
        rationale: JSON.stringify(Array.isArray(body.rationale) ? body.rationale.slice(0, 20) : []),
        basedOnRuns: Math.max(0, Math.floor(body.basedOnRuns ?? 0)),
        windowDays: Math.max(0, Math.floor(body.windowDays ?? 0)),
        vectorBefore: JSON.stringify(vectorBefore),
        vectorAfter: JSON.stringify(vectorAfter),
        autoApplied: body.autoApply === true,
        decidedAt: new Date(),
        decidedBy: userId ?? null,
      })
      .returning({ id: traitReinforcements.id });

    await invalidateAfterWrite(c.env as Env, tenantId, agentRef);
    return c.json({ id: inserted?.id, applied: cleanDeltas, vector: vectorAfter, summary: summarizeDeltas(cleanDeltas) });
  });

  // ── POST dismiss a proposal (audited; no vector change) ─────────────────────────
  router.post('/agents/:agentId/reinforcements/dismiss', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const agentRef = c.req.param('agentId');
    const agent = await ownedAgentProfile(tenantId, agentRef);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const body = await c.req.json<{ deltas?: Record<string, number>; rationale?: string[] }>();
    const cleanDeltas: Record<string, number> = {};
    for (const [dim, v] of Object.entries(body.deltas ?? {})) {
      if (VALID_DIMENSION_IDS.has(dim)) cleanDeltas[dim] = clamp(Math.round(Number(v) || 0), -MAX_DELTA_PER_DIM, MAX_DELTA_PER_DIM);
    }

    const [inserted] = await db
      .insert(traitReinforcements)
      .values({
        tenantId,
        agentRef,
        status: 'dismissed',
        deltas: JSON.stringify(cleanDeltas),
        rationale: JSON.stringify(Array.isArray(body.rationale) ? body.rationale.slice(0, 20) : []),
        decidedAt: new Date(),
        decidedBy: userId ?? null,
      })
      .returning({ id: traitReinforcements.id });

    await invalidateAfterWrite(c.env as Env, tenantId, agentRef);
    return c.json({ id: inserted?.id, dismissed: true });
  });

  // ── POST record a personality application (durable producer seam) ────────────────
  router.post('/events', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      agentRef?: string;
      executionId?: number | null;
      runId?: string | null;
      sessionKey?: string | null;
      profileSource?: string;
      personaIds?: string[];
      directivesSummary?: string;
      directiveCount?: number;
      thinkLevel?: string | null;
      reasoningLevel?: string | null;
      temperature?: number | null;
    }>();
    const agentRef = body.agentRef?.trim();
    if (!agentRef) return c.json({ error: 'agentRef required' }, 400);
    const agent = await ownedAgentProfile(tenantId, agentRef);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const [inserted] = await db
      .insert(personalityEvents)
      .values({
        tenantId,
        agentRef,
        executionId: body.executionId ?? null,
        runId: body.runId ?? null,
        sessionKey: body.sessionKey ?? null,
        profileSource: (body.profileSource ?? 'agent').slice(0, 24),
        personaIds: Array.isArray(body.personaIds) ? JSON.stringify(body.personaIds.slice(0, 20)) : null,
        directivesSummary: body.directivesSummary?.slice(0, 2000) ?? null,
        directiveCount: Math.max(0, Math.floor(body.directiveCount ?? 0)),
        thinkLevel: body.thinkLevel ?? null,
        reasoningLevel: body.reasoningLevel ?? null,
        temperature: typeof body.temperature === 'number' ? body.temperature : null,
      })
      .returning({ id: personalityEvents.id });

    await invalidateAfterWrite(c.env as Env, tenantId, agentRef);
    return c.json({ id: inserted?.id });
  });

  return router;
}

/** Bump the per-agent cache token and the cross-surface caches a vector change touches. */
async function invalidateAfterWrite(env: Env, tenantId: number, agentRef: string): Promise<void> {
  await bumpCacheVersion(env, personalityVersionKey(tenantId, agentRef)).catch(() => {});
  // A personality change alters the public listing, the assignee hovercard, and what
  // the runtime reads for this tenant's hired agents.
  await Promise.all([
    invalidateCached(env, PUBLIC_LIST_CACHE_KEY).catch(() => {}),
    invalidateCached(env, assigneeProfilesCacheKey(tenantId)).catch(() => {}),
    invalidateCached(env, runtimeHiredAgentsCacheKey(tenantId)).catch(() => {}),
  ]);
}

/** Parse JSON, returning `fallback` on any error. */
function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
