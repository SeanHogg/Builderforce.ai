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

/** Does an agent's (title + name + skills) text match a role key / display name? */
export function agentMatchesRole(
  agent: { title?: string | null; name: string; skills?: string | null },
  roleKey: string,
  roleName: string,
): boolean {
  const hay = normalizeRoleText([agent.title ?? '', agent.name, ...parseSkillsJson(agent.skills)].join(' '));
  return hay.includes(normalizeRoleText(roleKey)) || hay.includes(normalizeRoleText(roleName));
}
