/**
 * Provision a tenant's built-in agents (Validator + Security + Product Manager +
 * Designer) at tenant-creation time — the ONE helper every tenant-creation path calls
 * so a new workspace gets its seeded agents, not just the ones backfilled by
 * migrations 0271 / 0291 / 0293.
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

/** The seeded built-in workforce — kept in sync with migrations 0271 (Validator),
 *  0291 (Security), 0293 (Product Manager + Designer), 0326 (Incident Manager),
 *  0393 (Cloud Security), and 0394 (Generalist Coder) so an existing-tenant
 *  backfill and a new-tenant provision agree.
 */
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
  {
    kind: 'product_manager',
    idPrefix: 'product-manager-t',
    name: 'Product Manager',
    title: 'Product Manager — turns an idea into a shippable, biddable brief',
    bio: 'Brainstorms and shapes an idea into a product brief with scope, user stories, acceptance criteria and diagrams, then publishes it to the Marketplace as a project-bid gig so freelancers can estimate, bid, and be hired.',
    skills: ['product-management', 'discovery', 'requirements', 'roadmapping'],
  },
  {
    kind: 'designer',
    idPrefix: 'designer-t',
    name: 'Designer',
    title: 'Designer — UI/UX design and design review',
    bio: "Shapes UI/UX work — new product design or a review of an existing system's UX — into a design gig published to the Marketplace, and reviews delivered designs against the brief.",
    skills: ['ui-design', 'ux', 'design-review', 'prototyping'],
  },
  {
    kind: 'incident_manager',
    idPrefix: 'incident-manager-t',
    name: 'Incident Manager',
    title: 'Incident Manager — help-desk triage, on-call paging & escalation',
    bio: 'Runs the help desk and the first minutes of incident response. Reads inbound support tickets (Freshdesk / Freshservice), works out which system the issue pertains to, and for anything that reads as an incident opens a first-class incident — a tracked board ticket bridged to the incident record with a severity. It then pages the right on-call list, opens an on-call war-room chat, posts status updates (in-app + MS Teams), and escalates to the next on-call tier and business contacts on a timer until someone acknowledges.',
    skills: ['incident-response', 'triage', 'on-call', 'itsm', 'escalation', 'help-desk'],
  },
  {
    kind: 'cloud_security',
    idPrefix: 'cloud-security-t',
    name: 'Cloud Security',
    title: 'Cloud Security — GAP-G1/G2/G3 P0 security/isolation + cloud-Worker validation',
    bio: 'Specialist for critical cloud security gaps (GAP-G1/G2/G3) and cloud-Worker isolation validation. Proactively identifies and resolves P0 security/isolation issues that block General Availability. Validates isolation boundaries for all cloud Worker workstreams, preventing cross-tenant and unauthorized access risks.',
    skills: ['cloud-security', 'isolation-validation', 'ga-blockers', 'worker-isolation', 'security-isolation'],
  },
  {
    kind: 'generalist_coder',
    idPrefix: 'generalist-coder-t',
    name: 'Generalist Coder',
    title: 'Generalist Coder — Parallel gap coding executor',
    bio: 'High-capacity coder agent specialized for parallel execution of the 50-gap coding workstreams (GAP-D*/W*/E*). Accelerates gap resolution by processing multiple tasks concurrently, significantly reducing the estimated 64–78 day timeline to 38–48 days. Offloads coding workload to relieve Bob Developer (85% utilization risk) and unblock the cloud-agent GA security gate.',
    skills: ['gap-coding', 'parallel-execution', 'generalist', 'task-concurrency', 'code-generation'],
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
