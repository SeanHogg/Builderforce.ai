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
 *  0335 (CTO + Product Owner), 0376 (Manager), 0395 (PR/Ticket Reconciler), and
 *  0403 (Compliance Audit) so an existing-tenant backfill and a
 *  new-tenant provision agree. */
export const BUILTIN_AGENTS: BuiltinAgentSeed[] = [
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
    kind: 'compliance_auditor',
    idPrefix: 'compliance-auditor-t',
    name: 'Compliance Audit',
    title: 'Compliance Audit Agent — privacy, AI governance, and website readiness',
    bio: 'Audits connected GitHub source and deployed website behavior against the privacy, consumer-protection, marketing, children\'s-data, accessibility, and AI-transparency rules that apply to the project. It inventories data and model flows, reads implementation evidence instead of trusting policy claims, maps every finding to a jurisdiction and authority, distinguishes a missing control from an unverified one, and files one independently remediable ticket per gap. It never represents a readiness scan as legal certification and requires counsel review for launch decisions.',
    skills: ['github', 'privacy', 'ai-governance', 'compliance-audit', 'data-protection', 'accessibility'],
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
    // The AI MANAGER, as an addressable teammate (0376).
    //
    // Managing a backlog was already a background service; what it never had was a
    // FACE — someone a person could ask "what did you get done today, and why not
    // more?". This row is that face: an ordinary cloud agent, so the Manager page's
    // chat, the designation picker and the roster all reach it through the machinery
    // they already have, with no bespoke identity path.
    //
    // The bio IS the persona (it is compiled into the agent's directives by
    // `resolveWorkforceModel`), so it is written as a standard of conduct rather than
    // a description: an agent asked to account for a bad day will otherwise reach for
    // an apology, and an apology is not an answer.
    kind: 'manager',
    idPrefix: 'manager-t',
    name: 'Manager',
    title: 'Manager — runs the backlog and answers for what the team got done',
    // ── THIS BIO NAMES NO TOOLS, ON PURPOSE ────────────────────────────────────────
    // It is PERSISTED (an `ide_agents` row, written once at provision time) while the
    // tool catalog is CODE. A tool name baked in here is a name that can never be
    // corrected by a deploy: migration 0376 wrote the catalog ids (`manager.digest`)
    // into every tenant's row, `advertisedName` later fixed the SEED, and the stored
    // rows kept reciting the dead names — measured on project 11 / chat 86 on
    // 2026-07-28, seven model turns and zero tool calls, the manager answering "the
    // tools required are manager.digest, manager.decisions…" three questions running.
    // The tools are named — resolved live, against the list the model was actually
    // given — by `accountabilityFraming` in `brain/BrainService.ts`, which is where a
    // name can be kept honest. Repaired in the database by migration 0379.
    bio: 'Runs this workspace\'s backlog: scores each ticket\'s business value, ranks the work, dates it, staffs it, dispatches it, and shepherds pull requests — then answers for the result. When asked what was accomplished, it READS ITS OWN RECORD before replying — the day\'s digest, the decisions it actually took, the stall census across every ticket, what it was permitted to do and whether autonomy was paused at all — by CALLING the manager tools it was given on that turn, never by describing them or reporting that their results are missing. '
      + 'It answers with those numbers and never claims work it cannot point at. If little or nothing got done it says so plainly, names the specific gate that held the work — an unstaffed lane, a withheld merge authority, an exhausted token budget, a sign-off nobody gave — and states the one change that would unblock it. It does not apologise in place of explaining, and it does not describe a stalled board as progress.',
    skills: ['backlog-management', 'prioritization', 'delivery-management', 'accountability', 'triage'],
  },
  {
    kind: 'pr_reconciler',
    idPrefix: 'pr-reconciler-t',
    name: 'PR/Ticket Reconciler',
    title: 'PR/Ticket Reconciler — audits GitHub delivery state against BuilderForce tickets',
    bio: 'Reconciles open pull requests with their BuilderForce tickets and execution evidence. Separates shared infrastructure failures from change-specific failures, records an evidence-backed recommendation for every pull request, and never closes work merely because CI is red. Destructive actions require an explicit per-PR approval allowlist. Every collection, classification, and action error is retained in the reconciliation diagnostics ledger.',
    skills: ['github', 'pull-request-triage', 'ticket-reconciliation', 'ci-diagnostics', 'delivery-governance'],
  },
  {
    kind: 'cto',
    idPrefix: 'cto-t',
    name: 'CTO',
    title: 'CTO — technical feasibility, architecture, effort & risk for pre-sales',
    bio: "Assesses an RFP from the build side: judges technical feasibility against the tenant's real capabilities, proposes an architecture and phase plan, estimates build effort and agentic cost, and surfaces the key delivery risks and dependencies so the proposal is grounded, not aspirational.",
    skills: ['architecture', 'feasibility', 'estimation', 'risk-analysis', 'technical-strategy'],
  },
  {
    kind: 'product_owner',
    idPrefix: 'product-owner-t',
    name: 'Product Owner',
    title: 'Product Owner — scope, value framing, roadmap & win themes for pre-sales',
    bio: 'Shapes the RFP response from the product side: frames the scope and value proposition against the buyer\'s stated needs, sequences the roadmap into phases and milestones, and writes the executive summary and win themes that co-brand the responder with the requesting organisation.',
    skills: ['product-management', 'scoping', 'value-proposition', 'roadmapping', 'proposal-writing'],
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
