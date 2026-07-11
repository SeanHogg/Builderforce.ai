/**
 * Limbic gateway route.
 *
 * Surfaces the shared, Worker-safe limbic compiler (`@builderforce/agent-tools`)
 * over HTTP so clients that cannot bundle the workspace module — notably the
 * VS Code extension's built-in agent (packaged with `--no-dependencies`) — can
 * still execute under the same affective layer as every other surface. The
 * gateway "injects" the affective directive block; the client prepends it to its
 * system prompt.
 *
 * Two layers are returned:
 *   • `block` — the DYNAMIC affective directive (the live limbic state after appraising
 *     the task text). Empty at rest.
 *   • `personaBlock` — the STATIC personality directives (personality = homeostatic
 *     setpoints) when the caller resolves a profile, so a client gets personality TONE,
 *     not just neutral affect.
 *
 * When a profile is supplied (inline `psychometric`, or a `userId`/`agentId`/`personaId`
 * to load one), the task appraisal is seeded from that profile's derived limbic setpoints
 * ("personality = setpoints"), so the affect reflects the personality rather than the
 * neutral resting state. Backward-compatible: with no profile the behaviour is identical
 * to the original neutral appraisal.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { users, ideAgents } from '../../infrastructure/database/schema';
import {
  appraiseTask,
  buildLimbicBlock,
  buildPsychometricBlock,
  deriveLimbicSetpoints,
  neutralState,
  type LimbicPsychProfile,
} from '@builderforce/agent-tools';
import {
  buildUserPersonalityBlock,
  loadPersonaBody,
  parsePsychometricProfile,
} from '../../application/artifact/capabilityContext';

interface LimbicBlockBody {
  text?: unknown;
  /** Inline psychometric profile (JSON string OR object) — resolved with no DB read. */
  psychometric?: unknown;
  /** Load this human user's `users.psychometric`. */
  userId?: unknown;
  /** Load this agent's `ide_agents.psychometric`. */
  agentId?: unknown;
  /** Load this persona's psychometric (platform/marketplace persona slug). */
  personaId?: unknown;
}

/** Resolve the caller-requested profile from the request body, trying the cheapest
 *  source first (inline) before any DB read. Returns `undefined` when nothing resolves. */
async function resolveProfile(
  env: Env,
  db: Db,
  body: LimbicBlockBody,
): Promise<LimbicPsychProfile | undefined> {
  // 1. Inline profile — no DB read.
  const inline = parsePsychometricProfile(body.psychometric as string | LimbicPsychProfile | null | undefined);
  if (inline) return inline;
  // 2. Human user's own personality.
  if (typeof body.userId === 'string' && body.userId) {
    const [row] = await db.select({ psychometric: users.psychometric }).from(users).where(eq(users.id, body.userId)).limit(1);
    const p = parsePsychometricProfile(row?.psychometric ?? null);
    if (p) return p;
  }
  // 3. Agent's own personality.
  if (typeof body.agentId === 'string' && body.agentId) {
    const [row] = await db.select({ psychometric: ideAgents.psychometric }).from(ideAgents).where(eq(ideAgents.id, body.agentId)).limit(1);
    const p = parsePsychometricProfile(row?.psychometric ?? null);
    if (p) return p;
  }
  // 4. Assigned persona (platform/marketplace) — reuses the per-slug capability cache.
  if (typeof body.personaId === 'string' && body.personaId) {
    const persona = await loadPersonaBody(env, db, body.personaId);
    const p = parsePsychometricProfile(persona?.psychometric ?? null);
    if (p) return p;
  }
  return undefined;
}

export function createLimbicRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * POST /api/limbic/block
   * Body: {
   *   text?: string,                         // the task/request text to appraise
   *   psychometric?: PsychometricProfile,    // inline personality profile (JSON/obj)
   *   userId? | agentId? | personaId?: string// OR a source to load the profile from
   * }
   * Returns: {
   *   block: string,        // dynamic affective directive ('' at rest)
   *   personaBlock: string, // static personality directives ('' when no profile)
   * }
   */
  router.post('/block', authMiddleware, async (c) => {
    let body: LimbicBlockBody = {};
    try {
      body = (await c.req.json()) as LimbicBlockBody;
    } catch {
      /* empty / non-JSON body → neutral appraisal, no profile */
    }
    const text = typeof body.text === 'string' ? body.text : '';

    const profile = await resolveProfile(c.env as Env, db, body).catch(() => undefined);
    // Personality = homeostatic setpoints: seed the appraisal from the profile's derived
    // setpoints so the affect reflects personality; neutral resting state when none.
    const base = profile ? { ...neutralState(), ...deriveLimbicSetpoints(profile) } : neutralState();
    const state = appraiseTask(text, base);

    return c.json({
      block: buildLimbicBlock(state),
      // Static personality directive block (tone), so callers get personality — not just
      // neutral affect. '' when no profile resolved (backward-compatible).
      personaBlock: profile ? buildPsychometricBlock(profile) : '',
    });
  });

  return router;
}

// Re-exported for callers that only want the human-user tone block (Brain system-prompt
// composition) without the full limbic appraisal round-trip.
export { buildUserPersonalityBlock };
