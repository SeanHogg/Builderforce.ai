/**
 * Demo-account seeder (migration 0360) — creates/refreshes the five persona demo
 * tenants from the blueprints in demoPersonas.ts. Idempotent and destructive BY
 * DESIGN inside demo tenants only: every reseed wipes visitor-made changes
 * (tasks, OKRs, knowledge, activity, usage, extra projects/agents) and restores
 * the blueprint, so the demo always looks freshly mid-sprint. Runs from the
 * deploy hook (`POST /api/demo/reseed`), the nightly cron backstop, and lazily
 * from the first `POST /api/demo/session` when a persona tenant does not exist.
 *
 * Cost guardrails: demo tenants get plan='pro' for the full feature surface but
 * a small token-day override and a zero funded-overflow cap, so a demo visitor
 * can never run up platform LLM spend.
 */
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import {
  activityLog,
  errorEvents,
  errorGroups,
  ideAgents,
  initiatives,
  keyResults,
  knowledgeAcknowledgements,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  llmUsageLog,
  objectiveLinks,
  objectives,
  portfolios,
  projects,
  segments,
  tasks,
  tenantMembers,
  tenants,
  userLegalAcceptances,
  users,
} from '../../infrastructure/database/schema';
import { provisionBuiltinAgents } from '../agent/provisionBuiltinAgents';
import { getActiveTermsVersion } from '../../presentation/middleware/termsEnforcement';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  DEMO_BLUEPRINTS,
  getBlueprint,
  demoUserEmail,
  type DemoBlueprint,
  type DemoPersonaKey,
} from './demoPersonas';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Daily token allowance for a demo tenant — enough to try the Brain, never enough to hurt. */
const DEMO_TOKEN_DAILY_LIMIT = 200_000;

/** Kill switch, mirroring guestBrainEnabled: on unless explicitly 'false'. */
export function demoAccountsEnabled(env: Env): boolean {
  return env.DEMO_ACCOUNTS_ENABLED !== 'false';
}

export const demoTenantCacheKey = (persona: DemoPersonaKey): string => `demo:target:${persona}`;

export interface DemoSessionTarget {
  persona: DemoPersonaKey;
  entryPath: string;
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  plan: string;
  userId: string;
  email: string;
  username: string;
  displayName: string;
}

export interface DemoPersonaSeedResult {
  persona: DemoPersonaKey;
  tenantId: number;
  created: boolean;
  tasks: number;
  agents: number;
}

/** Deterministic pseudo-variation so demo charts look organic but stable across reseeds. */
const vary = (seed: number, spread: number): number => (seed * 2654435761 % 1000) / 1000 * spread;

async function ensureDemoUser(db: Db, bp: DemoBlueprint): Promise<{ id: string; email: string }> {
  const email = demoUserEmail(bp.key);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let userId = existing?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email,
      username: bp.user.username,
      displayName: bp.user.displayName,
      accountType: 'standard',
      accountTypeSelectedAt: new Date(),
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      // No passwordHash: the demo user can never sign in with credentials —
      // sessions exist only via POST /api/demo/session.
    }).onConflictDoNothing();
  }
  // The demo session must clear the terms gate like any signed-in user.
  const termsVersion = await getActiveTermsVersion(db);
  if (termsVersion) {
    await db.insert(userLegalAcceptances)
      .values({ userId, documentType: 'terms', version: termsVersion })
      .onConflictDoUpdate({
        target: [userLegalAcceptances.userId, userLegalAcceptances.documentType],
        set: { version: termsVersion, updatedAt: new Date() },
      });
  }
  return { id: userId, email };
}

async function ensureDemoTenant(db: Db, bp: DemoBlueprint, ownerUserId: string): Promise<{ id: number; slug: string; created: boolean }> {
  const [existing] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.demoPersona, bp.key))
    .limit(1);
  if (existing) {
    await db.update(tenants).set({
      name: bp.tenantName,
      plan: 'pro',
      billingStatus: 'active',
      isDemo: true,
      tokenDailyLimitOverride: DEMO_TOKEN_DAILY_LIMIT,
      paidOverflowDailyCap: 0,
      updatedAt: new Date(),
    }).where(eq(tenants.id, existing.id));
    await ensureMembership(db, existing.id, ownerUserId);
    return { id: existing.id, slug: existing.slug, created: false };
  }

  let slug = `demo-${bp.key}`;
  for (let i = 2; ; i++) {
    const [taken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!taken) break;
    slug = `demo-${bp.key}-${i}`;
  }
  const [inserted] = await db.insert(tenants).values({
    name: bp.tenantName,
    slug,
    plan: 'pro',
    billingStatus: 'active',
    isDemo: true,
    demoPersona: bp.key,
    tokenDailyLimitOverride: DEMO_TOKEN_DAILY_LIMIT,
    paidOverflowDailyCap: 0,
  }).returning({ id: tenants.id });
  const tenantId = inserted!.id;
  // Default segment — mirrors TenantRepository.save so single-mode scoping works.
  await db.insert(segments).values({
    tenantId,
    displayName: bp.tenantName,
    slug: 'default',
    plan: 'pro',
    isDefault: true,
  }).onConflictDoNothing();
  await ensureMembership(db, tenantId, ownerUserId);
  return { id: tenantId, slug, created: true };
}

async function ensureMembership(db: Db, tenantId: number, userId: string): Promise<void> {
  const [member] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  if (!member) {
    await db.insert(tenantMembers).values({ tenantId, userId, role: 'owner', isActive: true });
  } else {
    await db.update(tenantMembers).set({ role: 'owner', isActive: true }).where(eq(tenantMembers.id, member.id));
  }
}

/** Upsert the blueprint's demo agents and return id lookups for assignment. */
async function ensureAgents(db: Db, bp: DemoBlueprint, tenantId: number): Promise<Map<string, { id: string; name: string }>> {
  await provisionBuiltinAgents(db, tenantId);
  const demoIds: string[] = [];
  for (const seed of bp.agents) {
    const id = `demo-${seed.idSlug}-t${tenantId}`;
    demoIds.push(id);
    await db.insert(ideAgents).values({
      id,
      tenantId,
      name: seed.name,
      title: seed.title,
      bio: seed.bio,
      skills: JSON.stringify(seed.skills),
      baseModel: 'builderforce-default',
      status: 'active',
      runtimeSupport: 'cloud',
      published: seed.published ?? false,
      hireCount: seed.hireCount ?? 0,
      priceCents: 0,
    }).onConflictDoUpdate({
      target: ideAgents.id,
      set: {
        name: seed.name,
        title: seed.title,
        bio: seed.bio,
        skills: JSON.stringify(seed.skills),
        status: 'active',
        published: seed.published ?? false,
        hireCount: seed.hireCount ?? 0,
      },
    });
  }
  // Drop visitor-created agents so the roster resets to the blueprint.
  await db.delete(ideAgents).where(and(
    eq(ideAgents.tenantId, tenantId),
    isNull(ideAgents.builtinKind),
    notInArray(ideAgents.id, demoIds),
  ));

  const rows = await db
    .select({ id: ideAgents.id, name: ideAgents.name, builtinKind: ideAgents.builtinKind })
    .from(ideAgents)
    .where(eq(ideAgents.tenantId, tenantId));
  const lookup = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    if (row.builtinKind) lookup.set(row.builtinKind, { id: row.id, name: row.name });
  }
  for (const seed of bp.agents) {
    lookup.set(seed.idSlug, { id: `demo-${seed.idSlug}-t${tenantId}`, name: seed.name });
  }
  return lookup;
}

/** Delete all reseedable content for the tenant (leads and auth data survive). */
async function wipeTenantContent(db: Db, tenantId: number, keepProjectKeys: string[]): Promise<void> {
  await db.delete(llmUsageLog).where(eq(llmUsageLog.tenantId, tenantId));
  await db.delete(activityLog).where(eq(activityLog.tenantId, tenantId));
  await db.delete(errorEvents).where(eq(errorEvents.tenantId, tenantId));
  await db.delete(errorGroups).where(eq(errorGroups.tenantId, tenantId));
  await db.delete(keyResults).where(eq(keyResults.tenantId, tenantId));
  await db.delete(objectiveLinks).where(eq(objectiveLinks.tenantId, tenantId));
  await db.delete(objectives).where(eq(objectives.tenantId, tenantId));
  await db.delete(initiatives).where(eq(initiatives.tenantId, tenantId));
  await db.delete(portfolios).where(eq(portfolios.tenantId, tenantId));
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.tenantId, tenantId)); // versions/tags/acks cascade
  // Visitor-created projects go entirely; blueprint projects survive but their tasks reset.
  await db.delete(projects).where(and(eq(projects.tenantId, tenantId), notInArray(projects.key, keepProjectKeys)));
  const remaining = await db.select({ id: projects.id }).from(projects).where(eq(projects.tenantId, tenantId));
  const ids = remaining.map((p) => p.id);
  if (ids.length > 0) await db.delete(tasks).where(inArray(tasks.projectId, ids));
}

async function seedPersona(db: Db, bp: DemoBlueprint): Promise<DemoPersonaSeedResult> {
  const user = await ensureDemoUser(db, bp);
  const tenant = await ensureDemoTenant(db, bp, user.id);
  const tenantId = tenant.id;
  const agents = await ensureAgents(db, bp, tenantId);
  await wipeTenantContent(db, tenantId, bp.projects.map((p) => p.key));

  const now = Date.now();
  const projectIds = new Map<string, number>();
  for (const p of bp.projects) {
    const [existing] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.key, p.key))).limit(1);
    if (existing) {
      await db.update(projects).set({ name: p.name, description: p.description, updatedAt: new Date() })
        .where(eq(projects.id, existing.id));
      projectIds.set(p.key, existing.id);
    } else {
      const [row] = await db.insert(projects).values({
        tenantId,
        key: p.key,
        name: p.name,
        description: p.description,
      }).returning({ id: projects.id });
      projectIds.set(p.key, row!.id);
    }
  }

  // Tasks — blueprint order guarantees parents (epics) precede children.
  const taskIds = new Map<string, number>();
  let taskCount = 0;
  for (const p of bp.projects) {
    const projectId = projectIds.get(p.key)!;
    for (const t of p.tasks) {
      const assignedAgent = t.assignee && t.assignee !== 'user' ? agents.get(t.assignee) : undefined;
      const completedAt = t.status === 'done'
        ? new Date(now - (t.completedDaysAgo ?? 1) * DAY_MS)
        : null;
      const [row] = await db.insert(tasks).values({
        projectId,
        key: `DEMO-${t.key}`,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        priority: t.priority ?? 'medium',
        taskType: t.epic ? 'epic' : 'task',
        parentTaskId: t.parentKey ? taskIds.get(t.parentKey) ?? null : null,
        assignedUserId: t.assignee === 'user' ? user.id : null,
        assignedAgentRef: assignedAgent?.id ?? null,
        storyPoints: t.points ?? null,
        completedAt,
        lastWorkedAt: completedAt,
      }).returning({ id: tasks.id });
      taskIds.set(t.key, row!.id);
      taskCount++;
    }

    for (const [gi, g] of (p.errorGroups ?? []).entries()) {
      const firstSeen = new Date(now - 14 * DAY_MS);
      const lastSeen = new Date(now - Math.round(vary(gi + 1, 3) * DAY_MS));
      const [group] = await db.insert(errorGroups).values({
        tenantId,
        projectId,
        fingerprint: g.fingerprint,
        title: g.title,
        type: g.type,
        level: g.level,
        status: g.status,
        eventCount: g.eventCount,
        userCount: g.userCount,
        firstSeen,
        lastSeen,
        environment: 'production',
      }).returning({ id: errorGroups.id });
      // A few sample raw events so volume charts have a stream to read.
      for (let e = 0; e < 3; e++) {
        await db.insert(errorEvents).values({
          groupId: group!.id,
          tenantId,
          ts: new Date(now - Math.round(vary(gi * 7 + e + 1, 13) * DAY_MS)),
          environment: 'production',
          source: 'native',
        });
      }
    }
  }

  // Portfolio → initiatives (PMO spine).
  const initiativeIds: string[] = [];
  if (bp.portfolio) {
    const [pf] = await db.insert(portfolios).values({
      tenantId,
      name: bp.portfolio.name,
      description: bp.portfolio.description,
      ownerUserId: user.id,
    }).returning({ id: portfolios.id });
    for (const init of bp.portfolio.initiatives) {
      const [row] = await db.insert(initiatives).values({
        tenantId,
        portfolioId: pf!.id,
        name: init.name,
        description: init.description,
        status: init.status,
        ownerUserId: user.id,
        startDate: new Date(now - init.startDaysAgo * DAY_MS),
        targetDate: new Date(now + init.targetDaysAhead * DAY_MS),
      }).returning({ id: initiatives.id });
      initiativeIds.push(row!.id);
    }
  }

  // Objectives + key results + task links.
  for (const [oi, obj] of (bp.objectives ?? []).entries()) {
    const [row] = await db.insert(objectives).values({
      tenantId,
      title: obj.title,
      description: obj.description,
      ownerUserId: user.id,
      initiativeId: initiativeIds[oi] ?? null,
      startDate: new Date(now - 45 * DAY_MS),
      endDate: new Date(now + 60 * DAY_MS),
    }).returning({ id: objectives.id });
    for (const kr of obj.keyResults) {
      await db.insert(keyResults).values({
        tenantId,
        objectiveId: row!.id,
        title: kr.title,
        metricType: kr.metricType,
        startValue: kr.start,
        targetValue: kr.target,
        currentValue: kr.current,
        unit: kr.unit ?? null,
        status: kr.status,
      });
    }
    for (const key of obj.linkTaskKeys ?? []) {
      const taskId = taskIds.get(key);
      if (taskId) {
        await db.insert(objectiveLinks).values({ tenantId, objectiveId: row!.id, linkKind: 'task', taskId });
      }
    }
  }

  // Knowledge docs (published, versioned; ack'd by the demo user where required).
  for (const doc of bp.knowledge ?? []) {
    const [row] = await db.insert(knowledgeDocuments).values({
      tenantId,
      docType: doc.docType,
      title: doc.title,
      summary: doc.summary,
      content: doc.content,
      status: 'published',
      versionNumber: 1,
      requiresAck: doc.requiresAck ?? false,
      createdBy: user.id,
      updatedBy: user.id,
      publishedAt: new Date(now - 7 * DAY_MS),
    }).returning({ id: knowledgeDocuments.id });
    await db.insert(knowledgeDocumentVersions).values({
      tenantId,
      documentId: row!.id,
      versionNumber: 1,
      title: doc.title,
      content: doc.content,
      publishedBy: user.id,
    });
    if (doc.requiresAck) {
      await db.insert(knowledgeAcknowledgements).values({
        tenantId,
        documentId: row!.id,
        userId: user.id,
        versionNumber: 1,
      }).onConflictDoNothing();
    }
  }

  // Activity trail.
  const defaultProjectId = projectIds.values().next().value as number | undefined;
  for (const a of bp.activity ?? []) {
    const agent = a.actor ? agents.get(a.actor) : undefined;
    await db.insert(activityLog).values({
      tenantId,
      projectId: defaultProjectId ?? null,
      actorType: a.actorType,
      actorRef: a.actorType === 'cloud_agent' ? agent?.id ?? null : a.actorType === 'human' ? user.id : null,
      actorName: a.actorType === 'cloud_agent' ? agent?.name ?? 'Agent' : a.actorType === 'human' ? bp.user.displayName : 'System',
      verb: a.verb,
      summary: a.summary,
      occurredAt: new Date(now - a.daysAgo * DAY_MS),
    });
  }

  // LLM usage spread over the trailing 14 days — stable pseudo-variation, real
  // millicent costs so the FinOps/AI-impact lenses have honest-looking data.
  const models = ['claude-sonnet-5', 'deepseek-v3.1', 'qwen3-coder', 'gpt-4.1-mini'];
  const coder = bp.agents[0] ? agents.get(bp.agents[0].idSlug) : undefined;
  const usageRows: (typeof llmUsageLog.$inferInsert)[] = [];
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < (bp.usagePerDay ?? 0); i++) {
      const seed = d * 17 + i * 7 + 1;
      const promptTokens = 4_000 + Math.round(vary(seed, 22_000));
      const completionTokens = 800 + Math.round(vary(seed + 3, 6_000));
      const totalTokens = promptTokens + completionTokens;
      usageRows.push({
        tenantId,
        userId: user.id,
        model: models[seed % models.length],
        promptTokens,
        completionTokens,
        totalTokens,
        costUsdMillicents: Math.round(totalTokens * 0.35),
        cloudAgentRef: i % 2 === 0 ? coder?.id ?? null : null,
        projectId: defaultProjectId ?? null,
        useCase: i % 2 === 0 ? 'cloud-agent-run' : 'brain-chat',
        createdAt: new Date(now - d * DAY_MS - Math.round(vary(seed + 9, DAY_MS * 0.6))),
      } as typeof llmUsageLog.$inferInsert);
    }
  }
  if (usageRows.length > 0) await db.insert(llmUsageLog).values(usageRows);

  return { persona: bp.key, tenantId, created: tenant.created, tasks: taskCount, agents: bp.agents.length };
}

/** Reseed every persona tenant (deploy hook / cron / admin). */
export async function reseedDemoTenants(env: Env): Promise<{ personas: DemoPersonaSeedResult[] }> {
  const db = buildDatabase(env);
  const personas: DemoPersonaSeedResult[] = [];
  for (const bp of DEMO_BLUEPRINTS) {
    personas.push(await seedPersona(db, bp));
    await invalidateCached(env, demoTenantCacheKey(bp.key));
  }
  return { personas };
}

/**
 * Resolve (and cache) the session target for a persona — the demo tenant + demo
 * user a visitor session signs into. Self-healing: if the persona tenant does
 * not exist yet (fresh environment), it is seeded on first request.
 */
export async function getDemoSessionTarget(env: Env, persona: DemoPersonaKey): Promise<DemoSessionTarget> {
  return getOrSetCached(env, demoTenantCacheKey(persona), async () => {
    const db = buildDatabase(env);
    const bp = getBlueprint(persona);
    const lookup = async (): Promise<DemoSessionTarget | null> => {
      const [tenant] = await db
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.demoPersona, persona))
        .limit(1);
      if (!tenant) return null;
      const [user] = await db
        .select({ id: users.id, email: users.email, username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.email, demoUserEmail(persona)))
        .limit(1);
      if (!user) return null;
      return {
        persona,
        entryPath: bp.entryPath,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        plan: tenant.plan,
        userId: user.id,
        email: user.email,
        username: user.username ?? bp.user.username,
        displayName: user.displayName ?? bp.user.displayName,
      };
    };
    const found = await lookup();
    if (found) return found;
    await seedPersona(db, bp);
    const seeded = await lookup();
    if (!seeded) throw new Error(`Demo persona '${persona}' could not be provisioned`);
    return seeded;
  }, { kvTtlSeconds: 3600 });
}
