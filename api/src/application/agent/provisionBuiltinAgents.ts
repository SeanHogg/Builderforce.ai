/**
 * Provision a tenant's built-in agents (Validator + Security) at tenant-creation
 * time — the ONE helper every tenant-creation path calls so a new workspace gets its
 * seeded agents, not just the ones backfilled by migrations 0271 / 0291.
 *
 * Built-in agents are ordinary, assignable cloud agents (ide_agents rows) identified
 * by a stable `builtin_kind` marker (migration 0289) so dispatch keeps finding them
 * after a rename. Idempotent: a NOT-EXISTS check per kind, so re-running (or racing a
 * migration backfill) is a no-op.
 */
import { and, eq } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

interface BuiltinAgentSeed {
  kind: string;
  idPrefix: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
}

/** The seeded built-in workforce — kept in sync with migrations 0271 (Validator) and
 *  0291 (Security) so an existing-tenant backfill and a new-tenant provision agree. */
const BUILTIN_AGENTS: BuiltinAgentSeed[] = [
  {
    kind: 'validator',
    idPrefix: 'validator-t',
    name: 'Validator',
    title: 'Validator — Team Lead (acceptance review: QA + BA)',
    bio: 'Reviews Done work against the codebase like a senior team lead. Verifies the delivered code fully satisfies the ticket end-to-end — requirements coverage, wiring, edge cases, tests, and docs. Flags each item reviewed and files a GAP task for anything missing, so nothing ships half-done.',
    skills: ['code-review', 'business-analysis', 'acceptance-testing', 'validation'],
  },
  {
    kind: 'security',
    idPrefix: 'security-t',
    name: 'Security',
    title: 'Security — SOC 2 Auditor (all Trust Service Criteria)',
    bio: 'Audits the codebase against SOC 2 across all five Trust Service Criteria — Security (Common Criteria), Availability, Processing Integrity, Confidentiality, and Privacy. Reads the real code, dependencies, config, and data flows; for every issue it files an access-restricted SECURITY ticket carrying the severity, the criterion it maps to, and a concrete recommendation, plus an audit-summary result. Its findings are visible only to the people you allow.',
    skills: ['security-audit', 'soc2', 'appsec', 'compliance'],
  },
];

/** Insert any missing built-in agents for a tenant. Best-effort, idempotent. */
export async function provisionBuiltinAgents(db: Db, tenantId: number): Promise<void> {
  for (const seed of BUILTIN_AGENTS) {
    const [existing] = await db
      .select({ id: ideAgents.id })
      .from(ideAgents)
      .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.builtinKind, seed.kind)))
      .limit(1);
    if (existing) continue;
    await db.insert(ideAgents).values({
      id: `${seed.idPrefix}${tenantId}`,
      tenantId,
      name: seed.name,
      title: seed.title,
      bio: seed.bio,
      skills: JSON.stringify(seed.skills),
      baseModel: 'builderforce-default',
      status: 'active',
      runtimeSupport: 'cloud',
      published: false,
      priceCents: 0,
      builtinKind: seed.kind,
    }).onConflictDoNothing();
  }
}
