/**
 * Shared role↔member matching helpers — used by the recommended roster and the
 * lane requirement gate to decide whether a workforce member covers a role.
 */
export function normalizeRoleText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseSkillsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p: unknown = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The everyday words for a delivery role that its key and display name do not contain.
 * "John Coder", titled "Coder Agent", is a developer by any reading, but neither string
 * contains "developer", so he held no developer role and every code slice handed to him
 * was refused (VS Code chat #134). Whole-word matches only, so "coder" never matches
 * "decoder" and "qa" never matches inside another word.
 */
const ROLE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  developer: ['coder', 'programmer', 'software engineer', 'frontend engineer', 'backend engineer', 'full stack engineer', 'fullstack engineer'],
  'qa-tester': ['qa', 'tester', 'quality assurance'],
};

/** Does an agent's (title + name + skills) text match a role key / display name? */
export function agentMatchesRole(
  agent: { title?: string | null; name: string; skills?: string | null },
  roleKey: string,
  roleName: string,
): boolean {
  const hay = normalizeRoleText([agent.title ?? '', agent.name, ...parseSkillsJson(agent.skills)].join(' '));
  if (hay.includes(normalizeRoleText(roleKey)) || hay.includes(normalizeRoleText(roleName))) return true;
  const words = ` ${hay} `;
  return (ROLE_SYNONYMS[roleKey] ?? []).some((term) => words.includes(` ${term} `));
}
