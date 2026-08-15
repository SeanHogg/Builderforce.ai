/**
 * One application service per domain (PRD 20 §5 step 6, §6).
 *
 * "Not build the API — the API exists. What does not exist is the module
 * boundary: 101 application folders and 197 route files sitting on 16 schema
 * modules." This is the boundary: fifteen domains, each answering the same four
 * questions, so a surface can be built once and pointed at a seat rather than
 * fifteen surfaces being built against fifteen shapes.
 *
 *   summary   — the counters a domain's landing surface leads with
 *   items     — what this seat owns, as registry objects
 *   activity  — what happened here lately
 *   metrics   — a chart series, one shape, from `metric_facts`
 *
 * WHY THIS IS ONE FILE AND NOT FIFTEEN. The four use cases are identical across
 * domains — they differ only in which `objects.domain` value they filter on and
 * which metric keys they surface. Fifteen copies is precisely the duplication
 * §0 forbids one layer down, and the DRY rule the platform already applies to
 * components: if the same logic, gate or branching condition shows up in 2+
 * places, extract it with the logic INSIDE. The per-domain difference is
 * DATA — `DOMAIN_MANIFEST` below — which is the same open/closed answer
 * migration 0410 gave for connector vendors: adding a domain adds a manifest
 * entry, not a service.
 *
 * CACHING. Every read here goes through `getOrSetCached` on a key derived from
 * `(tenant, domain, …)`, which §6.3 says is the thing the kernel finally makes
 * possible. Writes into a domain invalidate through `invalidateDomain`.
 */
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { activityLog, metricFacts, objects } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { DOMAINS, type Domain } from './ObjectRegistry';

/**
 * The roster as data (PRD 20 §3, §7).
 *
 * The domains and the seats are the same list, and neither may drift from the
 * other — so there is one list, here, and the navigation, the permission
 * modules and the schema's `domain` column all read it.
 *
 * Adding the sixteenth seat is this one entry plus its name in `DOMAINS`: the
 * four use cases below are identical across domains and the per-domain
 * difference is DATA, which is exactly the open/closed claim this file's header
 * makes. It is worth noting that the claim held — `operations` needed no
 * service, no route and no surface, only a row.
 *
 * `rung` is the progressive-disclosure level at which a seat's scope chips are
 * earned. The seat itself is ALWAYS listed: progressive disclosure gates state,
 * never capability — a dimmed CFO is an invitation, a missing CFO is a secret.
 */
export type DomainManifest = {
  domain: Domain;
  /** The seat that owns it. */
  seat: string;
  /** Root entity, per §3.2 — what a surface leads with. */
  rootKind: string;
  /** Object kinds this seat owns, for the items list. */
  kinds: readonly string[];
  /** `metric_facts.metric` keys this surface charts, BEYOND the two every seat
   *  gets for free. */
  metrics: readonly string[];
  /** Rung at which the scope chips light up. 0 = always. */
  rung: number;
};

export const DOMAIN_MANIFEST: Readonly<Record<Domain, DomainManifest>> = {
  growth:       { domain: 'growth',       seat: 'CMO',        rootKind: 'campaign',         kinds: ['campaign', 'landing_page', 'blog_post', 'lead', 'experiment'], metrics: ['growth.leads', 'growth.conversions', 'growth.spend'], rung: 1 },
  delivery:     { domain: 'delivery',     seat: 'Manager',    rootKind: 'work_item',        kinds: ['work_item', 'project', 'release', 'sprint'],                  metrics: ['delivery.throughput', 'delivery.cycle_time_hours', 'delivery.wip'], rung: 0 },
  agents:       { domain: 'agents',       seat: 'Platform',   rootKind: 'agent',            kinds: ['agent', 'run', 'workflow'],                                   metrics: ['agents.runs', 'agents.tokens', 'agents.cost_cents'], rung: 0 },
  hiring:       { domain: 'hiring',       seat: 'Recruiter',  rootKind: 'job_posting',      kinds: ['job_posting', 'application', 'interview', 'placement'],       metrics: ['hiring.applications', 'hiring.time_to_hire_days', 'hiring.offer_rate'], rung: 2 },
  finance:      { domain: 'finance',      seat: 'CFO',        rootKind: 'ledger_entry',     kinds: ['invoice', 'expense', 'scenario', 'plan'],                     metrics: ['finance.mrr', 'finance.burn', 'finance.runway_months'], rung: 2 },
  revenue:      { domain: 'revenue',      seat: 'CRO',        rootKind: 'deal',             kinds: ['deal', 'contact', 'list', 'sequence'],                        metrics: ['revenue.pipeline', 'revenue.won', 'revenue.win_rate'], rung: 2 },
  commerce:     { domain: 'commerce',     seat: 'Platform',   rootKind: 'listing',          kinds: ['listing', 'order', 'gig', 'booking'],                         metrics: ['commerce.orders', 'commerce.gmv', 'commerce.refunds'], rung: 1 },
  identity:     { domain: 'identity',     seat: 'Platform',   rootKind: 'party',            kinds: ['user', 'team', 'workspace'],                                  metrics: ['identity.active_users', 'identity.signups'], rung: 0 },
  people:       { domain: 'people',       seat: 'HR',         rootKind: 'employment',       kinds: ['employee', 'course', 'cohort'],                               metrics: ['people.headcount', 'people.attrition', 'people.engagement'], rung: 3 },
  platform:     { domain: 'platform',     seat: 'Platform',   rootKind: 'signal',           kinds: ['monitor', 'dashboard', 'report'],                             metrics: ['platform.uptime', 'platform.error_rate', 'platform.p95_ms'], rung: 0 },
  governance:   { domain: 'governance',   seat: 'Security',   rootKind: 'control',          kinds: ['control', 'finding', 'policy'],                               metrics: ['governance.controls_passing', 'governance.open_findings'], rung: 3 },
  investor:     { domain: 'investor',     seat: 'CEO',        rootKind: 'company',          kinds: ['company', 'product', 'data_room', 'opportunity'],             metrics: ['investor.portfolio_value', 'investor.opportunities'], rung: 3 },
  support:      { domain: 'support',      seat: 'Support',    rootKind: 'ticket',           kinds: ['ticket', 'article'],                                          metrics: ['support.open_tickets', 'support.first_response_min', 'support.csat'], rung: 1 },
  canvas:       { domain: 'canvas',       seat: 'Brain',      rootKind: 'creation_session', kinds: ['creation_session', 'artifact', 'thread'],                     metrics: ['canvas.sessions', 'canvas.artifacts', 'canvas.shipped'], rung: 0 },
  integrations: { domain: 'integrations', seat: 'Platform',   rootKind: 'connection',       kinds: ['connection'],                                                 metrics: ['integrations.connected', 'integrations.sync_errors'], rung: 1 },
  /**
   * The sixteenth seat, and the only one that holds what a company SELLS rather
   * than how it runs itself — see the note on `DOMAINS`. Its kinds are the four
   * a person navigates to directly; the satellites (visits, estimates,
   * inspections, parts, shipments) are reached through them, which is the same
   * split `hiring` draws between an application and its scorecards.
   *
   * `rung: 1` rather than 3: a field business's very first session is a job and
   * an asset, not a mature-company concern like governance or headcount.
   */
  operations:   { domain: 'operations',   seat: 'Operations', rootKind: 'work_order',       kinds: ['work_order', 'service_asset', 'service_agreement', 'incident'], metrics: ['operations.open_work_orders', 'operations.first_time_fix', 'operations.sla_breaches'], rung: 1 },
  /**
   * The seventeenth seat, and the one the roster was missing at the START of a
   * company rather than at scale. `governance` is Security's and means SOC 2;
   * incorporation, registered agent, jurisdiction registration, IP assignment and
   * trademark are none of those and had no owner at all. See `schema/legal.ts`.
   *
   * `rung: 1` and not 3: the first thing a founder does is form the company, so
   * gating counsel behind maturity would hide it from precisely the session that
   * needs it. A seat is always listed — progressive disclosure gates state, never
   * capability.
   */
  legal:        { domain: 'legal',        seat: 'Counsel',    rootKind: 'legal_entity',     kinds: ['legal_entity', 'ip_asset', 'matter'],                          metrics: ['legal.open_matters', 'legal.renewals_due'], rung: 1 },
};

/**
 * The two metrics EVERY seat charts, written by `registryProjection.ts` from the
 * registry itself.
 *
 * Without them a surface renders fifteen empty panels until fifteen bespoke
 * rollups are written, which is how "insights everywhere" becomes a slogan. With
 * them, `<domain>.items` and `<domain>.events` are real on the first sweep tick
 * and the domain-specific keys above fill in as their features land.
 */
export const UNIVERSAL_METRICS = ['items', 'events'] as const;

/** Every metric key a seat's surface asks for: its own, plus the universal two. */
export function metricsFor(domain: Domain): string[] {
  return [
    ...UNIVERSAL_METRICS.map((suffix) => `${domain}.${suffix}`),
    ...DOMAIN_MANIFEST[domain].metrics,
  ];
}

/** The roster, in the order the navigation lists it. */
export const ROSTER: readonly DomainManifest[] = DOMAINS.map((d) => DOMAIN_MANIFEST[d]);

export type DomainSummary = {
  domain: Domain;
  seat: string;
  rootKind: string;
  rung: number;
  /** Live objects this seat owns. */
  itemCount: number;
  /** Events in the last 7 days — the "is anything happening here" signal the
   *  roster renders as a dot. */
  recentEventCount: number;
  lastActivityAt: string | null;
};

const summaryKey = (t: number, d: string) => `kernel:domain:${t}:${d}:summary`;
const itemsKey = (t: number, d: string, limit: number) => `kernel:domain:${t}:${d}:items:${limit}`;
const activityKey = (t: number, d: string, limit: number) => `kernel:domain:${t}:${d}:activity:${limit}`;
const metricsKey = (t: number, d: string, days: number) => `kernel:domain:${t}:${d}:metrics:${days}`;
const rosterKey = (t: number) => `kernel:domain:${t}:roster`;

const MAX_LIMIT = 200;
const clamp = (n: number | undefined, def: number) =>
  !n || n < 1 ? def : Math.min(Math.floor(n), MAX_LIMIT);

/** Drop every cached read for a domain. Called after any write into it. */
export async function invalidateDomain(env: Env, tenantId: number, domain: Domain): Promise<void> {
  await Promise.all([
    invalidateCached(env, summaryKey(tenantId, domain)),
    invalidateCached(env, rosterKey(tenantId)),
  ]);
}

/**
 * The whole roster's summary in ONE query.
 *
 * Deliberately not fifteen calls to `getDomainSummary`: the team panel renders
 * every seat at once, and fifteen round trips per navigation render is the
 * fan-out anti-pattern the platform rejects. Two grouped aggregates cover it.
 */
export async function getRosterSummary(db: Db, env: Env, tenantId: number): Promise<DomainSummary[]> {
  return getOrSetCached(
    env,
    rosterKey(tenantId),
    async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [counts, events] = await Promise.all([
        db
          .select({ domain: objects.domain, n: count() })
          .from(objects)
          .where(and(eq(objects.tenantId, tenantId), isNull(objects.archivedAt)))
          .groupBy(objects.domain),
        db
          .select({
            domain: objects.domain,
            n: count(),
            last: sql<string | null>`MAX(${activityLog.occurredAt})`,
          })
          .from(activityLog)
          .innerJoin(objects, eq(activityLog.objectId, objects.id))
          .where(and(eq(activityLog.tenantId, tenantId), gte(activityLog.occurredAt, since)))
          .groupBy(objects.domain),
      ]);

      const byDomain = new Map(counts.map((r) => [r.domain, r.n]));
      const byEvents = new Map(events.map((r) => [r.domain, r]));

      return ROSTER.map((m) => ({
        domain: m.domain,
        seat: m.seat,
        rootKind: m.rootKind,
        rung: m.rung,
        itemCount: byDomain.get(m.domain) ?? 0,
        recentEventCount: byEvents.get(m.domain)?.n ?? 0,
        lastActivityAt: byEvents.get(m.domain)?.last ?? null,
      }));
    },
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}

/** One seat's summary. Served from the roster read so the two can never
 *  disagree about a count the user is looking at on both screens. */
export async function getDomainSummary(
  db: Db,
  env: Env,
  tenantId: number,
  domain: Domain,
): Promise<DomainSummary> {
  const roster = await getRosterSummary(db, env, tenantId);
  const found = roster.find((r) => r.domain === domain);
  if (found) return found;
  const m = DOMAIN_MANIFEST[domain];
  return {
    domain, seat: m.seat, rootKind: m.rootKind, rung: m.rung,
    itemCount: 0, recentEventCount: 0, lastActivityAt: null,
  };
}

/** What this seat owns, most recently touched first. */
export async function getDomainItems(
  db: Db,
  env: Env,
  tenantId: number,
  domain: Domain,
  opts: { kind?: string; limit?: number } = {},
) {
  const limit = clamp(opts.limit, 50);
  const key = `${itemsKey(tenantId, domain, limit)}:${opts.kind ?? 'all'}`;
  return getOrSetCached(env, key, async () => {
    const where = [
      eq(objects.tenantId, tenantId),
      eq(objects.domain, domain),
      isNull(objects.archivedAt),
    ];
    if (opts.kind) where.push(eq(objects.kind, opts.kind));
    else where.push(inArray(objects.kind, [...DOMAIN_MANIFEST[domain].kinds]));

    return db
      .select()
      .from(objects)
      .where(and(...where))
      .orderBy(desc(objects.updatedAt))
      .limit(limit);
  });
}

/** One timeline component, fed one shape, for every seat (§7.1). */
export async function getDomainActivity(
  db: Db,
  env: Env,
  tenantId: number,
  domain: Domain,
  limit?: number,
) {
  const take = clamp(limit, 50);
  return getOrSetCached(
    env,
    activityKey(tenantId, domain, take),
    async () => {
      return db
        .select({
          id: activityLog.id,
          verb: activityLog.verb,
          actorType: activityLog.actorType,
          actorName: activityLog.actorName,
          targetLabel: activityLog.targetLabel,
          summary: activityLog.summary,
          occurredAt: activityLog.occurredAt,
          objectId: activityLog.objectId,
          objectKind: objects.kind,
          objectTitle: objects.title,
        })
        .from(activityLog)
        .innerJoin(objects, eq(activityLog.objectId, objects.id))
        .where(and(eq(activityLog.tenantId, tenantId), eq(objects.domain, domain)))
        .orderBy(desc(activityLog.occurredAt))
        .limit(take);
    },
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}

export type MetricSeries = { metric: string; unit: string | null; points: { at: string; value: number }[] };

/**
 * One chart primitive fed by one shape (§7.1).
 *
 * This is what makes "insights everywhere" affordable: a surface asks its seat
 * for its metrics and gets back series in a single shape, rather than each
 * feature shipping a bespoke aggregate and a bespoke chart to render it.
 */
export async function getDomainMetrics(
  db: Db,
  env: Env,
  tenantId: number,
  domain: Domain,
  days = 30,
): Promise<MetricSeries[]> {
  const window = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
  return getOrSetCached(
    env,
    metricsKey(tenantId, domain, window),
    async () => {
      const keys = metricsFor(domain);
      if (keys.length === 0) return [];
      const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          metric: metricFacts.metric,
          unit: metricFacts.unit,
          bucketAt: metricFacts.bucketAt,
          value: metricFacts.value,
        })
        .from(metricFacts)
        .where(and(
          eq(metricFacts.tenantId, tenantId),
          inArray(metricFacts.metric, keys),
          eq(metricFacts.bucket, 'day'),
          gte(metricFacts.bucketAt, since),
        ))
        .orderBy(metricFacts.metric, metricFacts.bucketAt)
        // One point per metric per day over the longest window this accepts.
        .limit(keys.length * 365);

      const byMetric = new Map<string, MetricSeries>();
      for (const key of keys) byMetric.set(key, { metric: key, unit: null, points: [] });
      for (const r of rows) {
        const series = byMetric.get(r.metric);
        if (!series) continue;
        series.unit ??= r.unit;
        series.points.push({ at: r.bucketAt.toISOString(), value: Number(r.value) });
      }
      return [...byMetric.values()];
    },
    { kvTtlSeconds: 300, l1TtlMs: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/** Bind the connection once; the route group depends on this, not on a database.
 *  Same reasoning as `createObjectRegistry` — see its note on §5 step 6. */
export function createDomainService(db: Db, env: Env) {
  return {
    roster: (tenantId: number) => getRosterSummary(db, env, tenantId),
    manifest: () => ROSTER,
    summary: (tenantId: number, domain: Domain) => getDomainSummary(db, env, tenantId, domain),
    items: (tenantId: number, domain: Domain, opts?: { kind?: string; limit?: number }) =>
      getDomainItems(db, env, tenantId, domain, opts),
    activity: (tenantId: number, domain: Domain, limit?: number) =>
      getDomainActivity(db, env, tenantId, domain, limit),
    metrics: (tenantId: number, domain: Domain, days?: number) =>
      getDomainMetrics(db, env, tenantId, domain, days),
    invalidate: (tenantId: number, domain: Domain) => invalidateDomain(env, tenantId, domain),
  };
}

export type DomainService = ReturnType<typeof createDomainService>;
