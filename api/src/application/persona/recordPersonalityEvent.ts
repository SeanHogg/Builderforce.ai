/**
 * Shared FIRST-CLASS personality-event recorder (Residual 1).
 *
 * `personality_events` is the durable spine the /api/personality panel reads to show
 * WHICH personality was applied to a run and WHEN. Two producers write to it and they
 * must agree byte-for-byte on the insert, so the insert lives here ONCE:
 *
 *   • the durable `POST /api/personality/events` seam (an external run finalizer), and
 *   • the cloud engine itself (`prepareCloudRun`), which records IN-PROCESS — a direct
 *     db write, NOT an HTTP self-call — the moment it actually applies a personality to
 *     a run. Before this, the panel could only DERIVE entries read-through from
 *     `run_model_outcomes`; now a real recorded row exists and the GET derives only to
 *     backfill gaps.
 *
 * `recordPersonalityEvent` performs the insert AND bumps the per-agent cache version
 * token (so the panel's read-through cache ages out) — the same token the routes'
 * `personalityVersionKey` folds every read on. It deliberately does NOT bust the
 * cross-surface profile caches (public listing / assignee hovercard / hired-agents):
 * recording that a personality was USED changes no vector, so those stay warm. Only a
 * vector MUTATION (reinforcement apply/dismiss) busts them.
 *
 * `compilePersonalityApplication` is the ONE place a run's applied personality is
 * distilled into the event's shape (source, persona ids, directive summary + count,
 * exec levers). It compiles the agent's own psychometric ONCE (pure, in-memory) and
 * returns null when nothing meaningful applied — so a V2 / neutral-profile run records
 * nothing and stays byte-identical.
 */
import { compilePsychometricProfile, type LimbicPsychProfile, type AgentExecParams } from '@builderforce/agent-tools';
import { sanitizeVector } from './psychometricCatalog';
import { personalityEvents } from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Per-agent cache version token — bumped by every personality write (event record OR
 *  vector mutation) so the routes' folded read-through keys age out. The ONE definition
 *  (personalityRoutes imports it from here). */
export function personalityVersionKey(tenantId: number, agentRef: string): string {
  return `personality-version:t:${tenantId}:a:${agentRef}`;
}

/** The durable row an applied personality records. Run keys are all optional so any
 *  surface records what it has (cloud → executionId; embedded runner → runId/sessionKey). */
export interface PersonalityEventInput {
  agentRef: string;
  executionId?: number | null;
  runId?: string | null;
  sessionKey?: string | null;
  profileSource?: string;
  personaIds?: string[];
  directivesSummary?: string | null;
  directiveCount?: number;
  thinkLevel?: string | null;
  reasoningLevel?: string | null;
  temperature?: number | null;
}

/**
 * Parse a stored psychometric JSON string into a compiler-ready profile (or null).
 * Shared with personalityRoutes so the panel's read-through derivation and the cloud
 * engine's first-class recording compile from IDENTICAL input.
 */
export function parsePersonalityProfile(raw: string | null | undefined): LimbicPsychProfile | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const profile: LimbicPsychProfile = { vector: sanitizeVector(o.vector) };
    if (typeof o.enneagramType === 'number') profile.enneagramType = o.enneagramType;
    return profile;
  } catch {
    return null;
  }
}

/** A compact, human-readable head of a compiled directive list (top phrases + count). */
export function summarizeDirectives(directives: string[]): { summary: string; count: number } {
  const heads = directives.slice(0, 3).map((d) => d.split(':')[0]?.trim()).filter(Boolean);
  const summary = heads.join(' · ') + (directives.length > 3 ? ` +${directives.length - 3} more` : '');
  return { summary, count: directives.length };
}

/** The distilled event shape (everything except the run keys), or null when no
 *  personality actually applied. */
export interface PersonalityApplication {
  profileSource: string;
  personaIds: string[];
  directivesSummary: string;
  directiveCount: number;
  thinkLevel: string | null;
  reasoningLevel: string | null;
  temperature: number | null;
}

/**
 * Distill a run's applied personality into a recordable event, compiling the agent's
 * OWN psychometric exactly ONCE. Returns null when that profile yields no directives —
 * the same condition under which the GET derives nothing — so a neutral / V2 run
 * records nothing (byte-identical). The exec levers come from the already-merged
 * {@link AgentExecParams} (personas + own) the run actually applied, so the recorded
 * think/reasoning/temperature match what reached the vendor.
 */
export function compilePersonalityApplication(args: {
  /** The agent's own psychometric JSON (ide_agents.psychometric). */
  agentPsychometric: string | null | undefined;
  /** The merged exec levers the run applied (persona blend + own). */
  execParams?: AgentExecParams;
  /** The persona slugs assigned to the run (for a multi-persona blend readout). */
  personaIds?: string[];
}): PersonalityApplication | null {
  const profile = parsePersonalityProfile(args.agentPsychometric);
  if (!profile) return null;
  const { directives } = compilePsychometricProfile(profile);
  if (directives.length === 0) return null;
  const { summary, count } = summarizeDirectives(directives);
  const personaIds = args.personaIds ?? [];
  const ep = args.execParams ?? {};
  return {
    // 'blended' when personas ride alongside the agent's own personality, else 'agent'.
    profileSource: personaIds.length ? 'blended' : 'agent',
    personaIds,
    directivesSummary: summary,
    directiveCount: count,
    thinkLevel: ep.thinkLevel ?? null,
    reasoningLevel: ep.reasoningLevel ?? null,
    temperature: typeof ep.temperature === 'number' ? ep.temperature : null,
  };
}

/**
 * Insert ONE durable personality-application row and bump the per-agent cache token.
 * The single insert both producers share. Returns the new row id (or null when the
 * agentRef is empty). Callers that must never fail a run wrap this in `.catch()` — it
 * is telemetry, not a run gate.
 */
export async function recordPersonalityEvent(
  env: Env,
  db: Db,
  tenantId: number,
  input: PersonalityEventInput,
): Promise<number | null> {
  const agentRef = input.agentRef?.trim();
  if (!agentRef) return null;
  const [inserted] = await db
    .insert(personalityEvents)
    .values({
      tenantId,
      agentRef,
      executionId: input.executionId ?? null,
      runId: input.runId ?? null,
      sessionKey: input.sessionKey ?? null,
      profileSource: (input.profileSource ?? 'agent').slice(0, 24),
      personaIds: Array.isArray(input.personaIds) && input.personaIds.length ? JSON.stringify(input.personaIds.slice(0, 20)) : null,
      directivesSummary: input.directivesSummary?.slice(0, 2000) ?? null,
      directiveCount: Math.max(0, Math.floor(input.directiveCount ?? 0)),
      thinkLevel: input.thinkLevel ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
      temperature: typeof input.temperature === 'number' ? input.temperature : null,
    })
    .returning({ id: personalityEvents.id });

  // Age out the per-agent read-through cache so the panel reflects the new row. A used
  // personality changes no vector, so the cross-surface profile caches stay warm.
  await bumpCacheVersion(env, personalityVersionKey(tenantId, agentRef)).catch(() => {});
  return inserted?.id ?? null;
}
