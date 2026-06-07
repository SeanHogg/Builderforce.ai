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
import { eq } from 'drizzle-orm';
import { marketplaceSkills, platformPersonas } from '../../infrastructure/database/schema';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

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
} | null;

export interface CapabilityContext {
  /** Markdown block to prepend to the agent's system prompt ('' when nothing resolved). */
  promptBlock: string;
  /** Compact summary for the Observability timeline + logs. */
  summary: {
    skills: string[];
    personas: string[];
    content: string[];
    /** Assigned slugs whose body could not be resolved (so the gap is visible, not silent). */
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
    return row ?? null;
  });
}

async function loadPersonaBody(env: Env, db: Db, slug: string): Promise<PersonaBody> {
  return getOrSetCached<PersonaBody>(env, personaCacheKey(slug), async () => {
    const [row] = await db
      .select({
        name: platformPersonas.name,
        description: platformPersonas.description,
        voice: platformPersonas.voice,
        perspective: platformPersonas.perspective,
        decisionStyle: platformPersonas.decisionStyle,
        outputPrefix: platformPersonas.outputPrefix,
      })
      .from(platformPersonas)
      .where(eq(platformPersonas.slug, slug))
      .limit(1);
    return row ?? null;
  });
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
): Promise<CapabilityContext> {
  const skills = artifacts?.skills ?? [];
  const personas = artifacts?.personas ?? [];
  const content = artifacts?.content ?? [];
  const empty: CapabilityContext = {
    promptBlock: '',
    summary: { skills, personas, content, missing: [] },
  };
  if (skills.length === 0 && personas.length === 0 && content.length === 0) return empty;

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

  const resolvedSkills = skillRows.filter((r): r is { slug: string; body: NonNullable<SkillBody> } => {
    if (r.body) return true;
    missing.push(`skill:${r.slug}`);
    return false;
  });
  if (resolvedSkills.length > 0) {
    sections.push('### Skills', resolvedSkills.map((r) => skillBlock(r.slug, r.body)).join('\n\n'));
  }

  // Content artifacts have no body store yet (see Consolidated Gap Register), so
  // surface the assigned slugs as references the agent must honor rather than
  // silently dropping them.
  if (content.length > 0) {
    sections.push('### Content',
      `Assigned content references: ${content.join(', ')}. Treat these as authoritative source material for the task.`);
  }

  const promptBlock = resolvedPersonas.length || resolvedSkills.length || content.length
    ? sections.join('\n\n')
    : '';

  return { promptBlock, summary: { skills, personas, content, missing } };
}
