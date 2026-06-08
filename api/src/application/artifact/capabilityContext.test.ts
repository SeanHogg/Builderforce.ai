import { describe, expect, it } from 'vitest';
import { loadCapabilityContext } from './capabilityContext';
import { marketplaceSkills, platformPersonas } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

type SkillRow = { name: string; description: string | null; readme: string | null };
type PersonaRow = {
  name: string;
  description: string | null;
  voice: string | null;
  perspective: string | null;
  decisionStyle: string | null;
  outputPrefix: string | null;
};

/** db mock that returns the configured body keyed by which table is queried. */
function makeDb(skillRow: SkillRow | null, personaRow: PersonaRow | null) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === marketplaceSkills) return skillRow ? [skillRow] : [];
            if (table === platformPersonas) return personaRow ? [personaRow] : [];
            return [];
          },
        }),
      }),
    }),
  } as never;
}

// No AUTH_CACHE_KV → getOrSetCached falls straight through to the loader.
const env = {} as Env;

describe('loadCapabilityContext', () => {
  it('returns an empty block when nothing is assigned', async () => {
    const res = await loadCapabilityContext(env, makeDb(null, null), {
      skills: [],
      personas: [],
      content: [],
    });
    expect(res.promptBlock).toBe('');
    expect(res.summary.missing).toEqual([]);
  });

  it('injects persona + skill bodies and content references', async () => {
    const db = makeDb(
      { name: 'Code Review', description: 'Reviews code', readme: 'Do the review carefully.' },
      {
        name: 'Reviewer',
        description: 'A reviewer',
        voice: 'terse',
        perspective: 'security-first',
        decisionStyle: 'evidence-based',
        outputPrefix: '🔒',
      },
    );
    const res = await loadCapabilityContext(env, db, {
      skills: ['cap-skill-a'],
      personas: ['cap-persona-a'],
      content: ['cap-doc-a'],
    });
    expect(res.promptBlock).toContain('## Assigned Capabilities (mandatory)');
    expect(res.promptBlock).toContain('--- Agent Persona ---');
    expect(res.promptBlock).toContain('Voice: terse');
    expect(res.promptBlock).toContain('Code Review (cap-skill-a)');
    expect(res.promptBlock).toContain('Do the review carefully.');
    expect(res.promptBlock).toContain('Assigned content references: cap-doc-a');
    expect(res.summary.missing).toEqual([]);
  });

  it('references assigned skills with no body by name (not flagged "missing"); personas with no body stay in missing', async () => {
    const res = await loadCapabilityContext(env, makeDb(null, null), {
      skills: ['cap-ghost-skill'],
      personas: ['cap-ghost-persona'],
      content: [],
    });
    // A skill assigned to the agent is a real capability even without a published
    // body — it must NOT read as "missing"; instead it's referenced by name so
    // the agent still honors it.
    expect(res.summary.missing).not.toContain('skill:cap-ghost-skill');
    expect(res.promptBlock).toContain('Skills (referenced)');
    expect(res.promptBlock).toContain('cap-ghost-skill');
    // Personas without a body can't form a persona block, so they remain flagged.
    expect(res.summary.missing).toContain('persona:cap-ghost-persona');
  });
});
