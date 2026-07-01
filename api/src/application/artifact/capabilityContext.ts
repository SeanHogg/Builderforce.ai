/**
 * Capability context builder — turns the *slugs* produced by {@link resolveArtifacts}
 * into an injectable system-prompt block plus a telemetry summary, by fetching the
 * actual bodies (skill readmes, persona definitions) from the marketplace tables.
 *
 * This is the single place the CLOUD execution path loads assigned capabilities so
 * a cloud agent honors its assigned Skills / Personas / Content at parity with a
 * self-hosted agentHost (which loads them via the gateway `artifacts.sync` handler).
 *
 * Reads are served through the canonical read-through cache, keyed per-slug (a
 * bounded keyspace — one entry per published skill/persona), and invalidated by
 * the admin-persona and marketplace-skill mutations via {@link invalidateCapabilityCache}.
 */
import { and, eq } from 'drizzle-orm';
import { marketplaceSkills, platformPersonas, marketplacePersonas } from '../../infrastructure/database/schema';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { getBuiltinSkillBody } from './builtinSkills';
import {
  deriveLimbicSetpoints,
  neutralState,
  LIMBIC_DIM_NAMES,
  buildPsychometricBlock,
  mergeExecParams,
  type LimbicState,
  type LimbicPsychProfile,
  type AgentExecParams,
} from '@builderforce/agent-tools';

/** Per-skill readme is capped so a few large skills can't blow the context budget. */
const SKILL_BODY_MAX_CHARS = 4_000;

type SkillBody = { name: string; description: string | null; readme: string | null } | null;
type PersonaBody = {
  name: string;
  description: string | null;
  voice: string | null;
  perspective: string | null;
  decisionStyle: string | null;
  outputPrefix: string | null;
  /** JSON-serialized PsychometricProfile (Pro). Drives limbic setpoints. */
  psychometric: string | null;
} | null;

export interface CapabilityContext {
  /** Markdown block to prepend to the agent's system prompt ('' when nothing resolved). */
  promptBlock: string;
  /** Execution levers contributed by the assigned personas' psychometric profiles
   *  (thinkLevel / reasoningLevel / temperature), merged across all that carry one.
   *  Empty object when none — the second half of "execute under the persona", so a
   *  trait vector changes how a cloud agent reasons, not just its prompt text. */
  execParams: AgentExecParams;
  /** Compact summary for the Observability timeline + logs. */
  summary: {
    skills: string[];
    personas: string[];
    content: string[];
    /** Assigned slugs whose body could not be resolved AND could not be honored
     *  by name (currently personas only — skills without a body are referenced by
     *  name instead of flagged here, so an assigned skill never reads as "missing"). */
    missing: string[];
  };
}

const skillCacheKey = (slug: string) => `cap:skill:${slug}`;
const personaCacheKey = (slug: string) => `cap:persona:${slug}`;

async function loadSkillBody(env: Env, db: Db, slug: string): Promise<SkillBody> {
  return getOrSetCached<SkillBody>(env, skillCacheKey(slug), async () => {
    const [row] = await db
      .select({
        name: marketplaceSkills.name,
        description: marketplaceSkills.description,
        readme: marketplaceSkills.readme,
      })
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.slug, slug))
      .limit(1);
    // Fall back to the builtin-skill registry so skills the self-hosted runtime
    // ships locally (github, coding-agent, …) inject real instructions in cloud
    // runs instead of being referenced by name only.
    return row ?? getBuiltinSkillBody(slug);
  });
}

async function loadPersonaBody(env: Env, db: Db, slug: string): Promise<PersonaBody> {
  return getOrSetCached<PersonaBody>(env, personaCacheKey(slug), async () => {
    // 1. Admin-managed platform personas (builtins) — highest precedence.
    const [row] = await db
      .select({
        name: platformPersonas.name,
        description: platformPersonas.description,
        voice: platformPersonas.voice,
        perspective: platformPersonas.perspective,
        decisionStyle: platformPersonas.decisionStyle,
        outputPrefix: platformPersonas.outputPrefix,
        psychometric: platformPersonas.psychometric,
      })
      .from(platformPersonas)
      .where(eq(platformPersonas.slug, slug))
      .limit(1);
    if (row) return row;

    // 2. Fall back to a TENANT-PUBLISHED (public) marketplace persona so the
    //    personas a user creates + installs actually shape their cloud agents —
    //    previously they were never loaded, so their psychometric never applied.
    //    Public slugs are globally unique (partial unique index, mig 0203), so this
    //    is tenant-safe; the behaviour body lives nested under the `persona` column.
    const [mkt] = await db
      .select({
        name: marketplacePersonas.name,
        description: marketplacePersonas.description,
        persona: marketplacePersonas.persona,
        psychometric: marketplacePersonas.psychometric,
      })
      .from(marketplacePersonas)
      .where(and(eq(marketplacePersonas.slug, slug), eq(marketplacePersonas.visibility, 'public')))
      .limit(1);
    if (!mkt) return null;
    const body = (mkt.persona ?? {}) as Record<string, unknown>;
    const str = (k: string): string | null => (typeof body[k] === 'string' ? (body[k] as string) : null);
    return {
      name: mkt.name,
      description: mkt.description,
      voice: str('voice'),
      perspective: str('perspective'),
      decisionStyle: str('decisionStyle'),
      outputPrefix: str('outputPrefix'),
      psychometric: mkt.psychometric,
    };
  });
}

function parsePsychometric(raw: string | null): LimbicPsychProfile | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as LimbicPsychProfile;
    return p && typeof p === 'object' && p.vector ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derive the limbic homeostatic setpoints from the assigned personas' psychometric
 * profiles ("personality = setpoints"), averaged across any that carry one. Returns
 * `undefined` when no assigned persona has a profile, so the caller starts from the
 * neutral resting state. Reuses the per-slug persona cache (no extra query when the
 * persona body was already loaded for the prompt block). The cloud counterpart of
 * the on-prem `LimbicSystemService.refreshSetpoints`.
 */
export async function loadPersonaSetpoints(
  env: Env,
  db: Db,
  slugs: string[],
  agentPsychometric?: string | null,
): Promise<LimbicState | undefined> {
  const profiles: LimbicPsychProfile[] = [];
  for (const slug of slugs) {
    const body = await loadPersonaBody(env, db, slug);
    const prof = parsePsychometric(body?.psychometric ?? null);
    if (prof) profiles.push(prof);
  }
  // The agent's OWN personality (ide_agents.psychometric) contributes a setpoint too,
  // independent of any assigned persona.
  const own = parsePsychometric(agentPsychometric ?? null);
  if (own) profiles.push(own);
  if (profiles.length === 0) return undefined;
  const acc = neutralState();
  for (const name of LIMBIC_DIM_NAMES) acc[name] = 0;
  for (const prof of profiles) {
    const sp = deriveLimbicSetpoints(prof);
    for (const name of LIMBIC_DIM_NAMES) acc[name] += sp[name];
  }
  for (const name of LIMBIC_DIM_NAMES) acc[name] /= profiles.length;
  return acc;
}

/** Invalidate the cached body for one artifact. Call from every mutation that edits
 *  a platform persona or marketplace skill so the next cloud run re-reads it. */
export async function invalidateCapabilityCache(
  env: Env,
  kind: 'skill' | 'persona',
  slug: string,
): Promise<void> {
  await invalidateCached(env, kind === 'skill' ? skillCacheKey(slug) : personaCacheKey(slug));
}

function personaBlock(p: NonNullable<PersonaBody>): string {
  const lines = ['--- Agent Persona ---', `Role: ${p.name}`];
  if (p.description) lines.push(`About: ${p.description}`);
  if (p.voice) lines.push(`Voice: ${p.voice}`);
  if (p.perspective) lines.push(`Perspective: ${p.perspective}`);
  if (p.decisionStyle) lines.push(`Decision style: ${p.decisionStyle}`);
  if (p.outputPrefix) lines.push(`Prefix your summary with: ${p.outputPrefix}`);
  // Compile the psychometric trait vector into behaviour directives so a persona's
  // personality shapes the cloud agent's prompt, not just its voice/perspective.
  const psych = buildPsychometricBlock(parsePsychometric(p.psychometric));
  if (psych) lines.push(psych);
  lines.push('---');
  return lines.join('\n');
}

function skillBlock(slug: string, s: NonNullable<SkillBody>): string {
  const head = `### ${s.name} (${slug})`;
  const desc = s.description ? `\n${s.description}` : '';
  const body = s.readme ? `\n\n${s.readme.slice(0, SKILL_BODY_MAX_CHARS)}` : '';
  return `${head}${desc}${body}`.trim();
}

/**
 * Resolve assigned capability slugs into an injectable prompt block + telemetry
 * summary. Returns an empty block (and empty summary arrays) when nothing is
 * assigned, so callers can inject unconditionally.
 */
export async function loadCapabilityContext(
  env: Env,
  db: Db,
  artifacts: ResolvedArtifacts | undefined,
  /** The running agent's OWN psychometric JSON (ide_agents.psychometric), if any.
   *  Compiled alongside assigned personas so a per-agent personality is honored. */
  agentPsychometric?: string | null,
): Promise<CapabilityContext> {
  const skills = artifacts?.skills ?? [];
  const personas = artifacts?.personas ?? [];
  const content = artifacts?.content ?? [];
  const ownProfile = parsePsychometric(agentPsychometric ?? null);
  const empty: CapabilityContext = {
    promptBlock: '',
    execParams: {},
    summary: { skills, personas, content, missing: [] },
  };
  if (skills.length === 0 && personas.length === 0 && content.length === 0 && !ownProfile) return empty;

  const [skillRows, personaRows] = await Promise.all([
    Promise.all(skills.map(async (slug) => ({ slug, body: await loadSkillBody(env, db, slug) }))),
    Promise.all(personas.map(async (slug) => ({ slug, body: await loadPersonaBody(env, db, slug) }))),
  ]);

  const missing: string[] = [];
  const sections: string[] = ['## Assigned Capabilities (mandatory)',
    'You have been assigned the capabilities below. Adopt the persona, follow the skills, and honor the content for this task.'];

  const resolvedPersonas = personaRows.filter((r): r is { slug: string; body: NonNullable<PersonaBody> } => {
    if (r.body) return true;
    missing.push(`persona:${r.slug}`);
    return false;
  });
  if (resolvedPersonas.length > 0) {
    sections.push('### Persona', resolvedPersonas.map((r) => personaBlock(r.body)).join('\n\n'));
  }

  // The agent's OWN personality (set on the agent itself, no persona wrapper) —
  // rendered as its own section so it composes with any assigned personas.
  const ownPsychBlock = ownProfile ? buildPsychometricBlock(ownProfile) : '';
  if (ownPsychBlock) sections.push('### Personality', ownPsychBlock);

  // Merge the execution levers (thinkLevel / reasoning / temperature) from every
  // profile in play — assigned personas + the agent's own — so personality changes
  // how the cloud agent reasons, not just its prompt text.
  const execParams = mergeExecParams([
    ...resolvedPersonas.map((r) => parsePsychometric(r.body.psychometric)).filter((p): p is LimbicPsychProfile => Boolean(p)),
    ...(ownProfile ? [ownProfile] : []),
  ]);

  // A skill assigned to the agent is a real capability even when its README body
  // isn't in the marketplace store (e.g. builtin skills like `github` /
  // `coding-agent`, which the self-hosted runtime ships locally). Those used to be
  // dropped and flagged "missing" — which read as "assigned skill is missing".
  // Instead, inject the ones we have a body for in full, and reference the rest by
  // name so the agent still honors them. (See README Consolidated Gap Register:
  // builtin skill bodies aren't available to cloud runs for full injection.)
  const resolvedSkills = skillRows.filter((r): r is { slug: string; body: NonNullable<SkillBody> } => Boolean(r.body));
  const referencedSkills = skillRows.filter((r) => !r.body).map((r) => r.slug);
  if (resolvedSkills.length > 0) {
    sections.push('### Skills', resolvedSkills.map((r) => skillBlock(r.slug, r.body)).join('\n\n'));
  }
  if (referencedSkills.length > 0) {
    sections.push('### Skills (referenced)',
      `Apply these assigned skills by name (no published body available): ${referencedSkills.join(', ')}.`);
  }

  // Content artifacts have no body store yet (see Consolidated Gap Register), so
  // surface the assigned slugs as references the agent must honor rather than
  // silently dropping them.
  if (content.length > 0) {
    sections.push('### Content',
      `Assigned content references: ${content.join(', ')}. Treat these as authoritative source material for the task.`);
  }

  const promptBlock = resolvedPersonas.length || ownPsychBlock || resolvedSkills.length || referencedSkills.length || content.length
    ? sections.join('\n\n')
    : '';

  return { promptBlock, execParams, summary: { skills, personas, content, missing } };
}
