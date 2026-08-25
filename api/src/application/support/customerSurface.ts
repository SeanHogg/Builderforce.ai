/**
 * What a customer sees when they need help or something breaks (PRD 19 §9).
 *
 * Three tables, one audience:
 *
 *   `support_articles`                        the help centre.
 *   `customer_engagement_feedback_widgets`    the in-product ask.
 *   `uptime_monitors`                         the status page's inputs.
 *
 * They live in two schema domains and that is fine — this is an application
 * module, and the thing they share is the reader. A customer hitting a problem
 * looks for an article, is asked for feedback, and wants to know whether it is
 * just them. Splitting these across three owners is how a status page ends up
 * saying everything is fine on a page that is visibly broken.
 *
 * ── A WIDGET HAS A COOLDOWN, AND IT IS ENFORCED HERE ────────────────────────
 * `cooldown_days` exists so the same person is not asked to rate the same thing
 * every week. {@link shouldPrompt} is the ONE place that decides, and it takes
 * the person's last response time as an argument rather than reading it: the
 * responses live with the question-set owner, and reaching across for them would
 * make this a second answer to "has this person answered".
 *
 * ── THE HELP CENTRE HAS TWO AXES AND THEY ARE NOT THE SAME ──────────────────
 * `status` (draft/published/archived) is editorial; `visibility`
 * (tenant/public/internal) is audience. An article can be published and internal.
 * {@link publicArticles} requires BOTH — published AND public — inside the query,
 * so no call site can leak an internal runbook by checking only one.
 *
 * ── A MONITOR'S THRESHOLD IS WHAT MAKES A STATUS PAGE USEFUL ────────────────
 * `fail_threshold` means "this many consecutive failures before we call it down".
 * {@link evaluateProbe} applies it, so a single blip does not page anybody and a
 * genuine outage is not hidden behind an average. The consecutive-failure count
 * is passed in and returned rather than stored, because the probe runner owns
 * that state — this module owns the RULE.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  customerEngagementFeedbackWidgets,
  supportArticles,
  uptimeMonitors,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `support_articles.status` — editorial. */
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** `support_articles.visibility` — audience. Orthogonal to status. */
export const ARTICLE_VISIBILITY = ['tenant', 'public', 'internal'] as const;
export type ArticleVisibility = (typeof ARTICLE_VISIBILITY)[number];

/** `customer_engagement_feedback_widgets.kind`. */
export const WIDGET_KINDS = ['csat', 'nps', 'ces', 'freeform'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** `uptime_monitors.kind`. */
export const MONITOR_KINDS = ['http', 'tcp', 'ping', 'keyword'] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];

export const isArticleStatus = (v: unknown): v is ArticleStatus =>
  typeof v === 'string' && (ARTICLE_STATUSES as readonly string[]).includes(v);
export const isArticleVisibility = (v: unknown): v is ArticleVisibility =>
  typeof v === 'string' && (ARTICLE_VISIBILITY as readonly string[]).includes(v);
export const isWidgetKind = (v: unknown): v is WidgetKind =>
  typeof v === 'string' && (WIDGET_KINDS as readonly string[]).includes(v);
export const isMonitorKind = (v: unknown): v is MonitorKind =>
  typeof v === 'string' && (MONITOR_KINDS as readonly string[]).includes(v);

export class CustomerSurfaceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'CustomerSurfaceError';
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Help centre ─────────────────────────────────────────────────────────────

export async function createArticle(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: { slug: string; title: string; summary?: string | null; body?: string | null; kind?: string; category?: string | null; tags?: unknown; visibility?: ArticleVisibility; ownerRef?: string | null },
) {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG.test(slug) || slug.length > 200) {
    throw new CustomerSurfaceError('slug must be lowercase alphanumeric words separated by single hyphens');
  }
  const visibility = input.visibility ?? 'tenant';
  if (!isArticleVisibility(visibility)) {
    throw new CustomerSurfaceError(`visibility must be one of: ${ARTICLE_VISIBILITY.join(', ')}`);
  }

  const [existing] = await db
    .select({ id: supportArticles.id })
    .from(supportArticles)
    .where(scopedToTenant(supportArticles, tenantId, eq(supportArticles.slug, slug)))
    .limit(1);
  if (existing) throw new CustomerSurfaceError(`an article already uses /${slug}`, 409);

  const title = input.title.trim().slice(0, 300);
  const [inserted] = await db
    .insert(supportArticles)
    .values({
      tenantId,
      slug,
      title,
      summary: input.summary ?? null,
      body: input.body ?? null,
      kind: input.kind ?? 'article',
      category: input.category ?? null,
      tags: input.tags ?? null,
      status: 'draft',
      visibility,
      ownerRef: input.ownerRef ?? null,
    })
    .returning();
  if (!inserted) throw new CustomerSurfaceError('could not create the article');

  const registered = await registerObject(db, env, {
    tenantId, kind: 'support_article', refId: inserted.id, domain: 'support', title,
  });
  const [row] = await db
    .update(supportArticles)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(supportArticles, tenantId, eq(supportArticles.id, inserted.id)))
    .returning();
  if (!row) throw new CustomerSurfaceError('could not create the article');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'support_article.created',
    targetType: 'support_article', targetId: String(row.id), objectId: registered.id,
    metadata: { slug, title, visibility },
  });
  return row;
}

/** Move an article between editorial states. Visibility is NOT touched here —
 *  publishing something is a different decision from deciding who may see it,
 *  and one endpoint that did both would eventually make an internal runbook
 *  public by accident. */
export async function setArticleStatus(
  db: Db,
  tenantId: number,
  id: number,
  status: ArticleStatus,
) {
  if (!isArticleStatus(status)) {
    throw new CustomerSurfaceError(`status must be one of: ${ARTICLE_STATUSES.join(', ')}`);
  }
  const [row] = await db
    .update(supportArticles)
    .set({ status, updatedAt: new Date() })
    .where(scopedToTenant(supportArticles, tenantId, eq(supportArticles.id, id)))
    .returning();
  if (!row) throw new CustomerSurfaceError('article not found', 404);
  return row;
}

/** Change who may see an article. Separate from status, deliberately. */
export async function setArticleVisibility(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  visibility: ArticleVisibility,
) {
  if (!isArticleVisibility(visibility)) {
    throw new CustomerSurfaceError(`visibility must be one of: ${ARTICLE_VISIBILITY.join(', ')}`);
  }
  const [row] = await db
    .update(supportArticles)
    .set({ visibility, updatedAt: new Date() })
    .where(scopedToTenant(supportArticles, tenantId, eq(supportArticles.id, id)))
    .returning();
  if (!row) throw new CustomerSurfaceError('article not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'support_article.visibility_changed',
    targetType: 'support_article', targetId: String(id),
    metadata: { slug: row.slug, visibility },
  });
  return row;
}

export async function listArticles(db: Db, tenantId: number, filter: { status?: ArticleStatus; category?: string } = {}) {
  return db
    .select()
    .from(supportArticles)
    .where(scopedToTenant(supportArticles, tenantId, and(
      ...(filter.status ? [eq(supportArticles.status, filter.status)] : []),
      ...(filter.category ? [eq(supportArticles.category, filter.category)] : []),
    )))
    .orderBy(asc(supportArticles.category), asc(supportArticles.title));
}

/**
 * Articles a stranger may read.
 *
 * BOTH conditions inside the query — see the module docstring. There is no
 * argument that relaxes either, so no call site can publish an internal runbook
 * by checking one and forgetting the other.
 */
export async function publicArticles(db: Db, tenantId: number, category?: string) {
  return db
    .select({
      slug: supportArticles.slug,
      title: supportArticles.title,
      summary: supportArticles.summary,
      body: supportArticles.body,
      category: supportArticles.category,
      tags: supportArticles.tags,
      updatedAt: supportArticles.updatedAt,
    })
    .from(supportArticles)
    .where(scopedToTenant(supportArticles, tenantId, and(
      eq(supportArticles.status, 'published'),
      eq(supportArticles.visibility, 'public'),
      ...(category ? [eq(supportArticles.category, category)] : []),
    )))
    .orderBy(asc(supportArticles.title));
}

/** One public article by slug, or null. Same double condition. */
export async function publicArticle(db: Db, tenantId: number, slug: string) {
  const [row] = await db
    .select()
    .from(supportArticles)
    .where(scopedToTenant(supportArticles, tenantId, and(
      eq(supportArticles.slug, slug.trim().toLowerCase()),
      eq(supportArticles.status, 'published'),
      eq(supportArticles.visibility, 'public'),
    )))
    .limit(1);
  return row ?? null;
}

// ── Feedback widgets ────────────────────────────────────────────────────────

export async function upsertWidget(
  db: Db,
  tenantId: number,
  input: { key: string; name: string; kind?: WidgetKind; questionSetId?: string | null; placement?: unknown; audience?: unknown; theme?: unknown; cooldownDays?: number; enabled?: boolean },
) {
  const key = input.key.trim().toLowerCase();
  if (!key) throw new CustomerSurfaceError('key is required');
  const kind = input.kind ?? 'csat';
  if (!isWidgetKind(kind)) throw new CustomerSurfaceError(`kind must be one of: ${WIDGET_KINDS.join(', ')}`);
  if ((input.cooldownDays ?? 30) < 0) throw new CustomerSurfaceError('cooldownDays must not be negative');

  const [existing] = await db
    .select({ id: customerEngagementFeedbackWidgets.id })
    .from(customerEngagementFeedbackWidgets)
    .where(scopedToTenant(customerEngagementFeedbackWidgets, tenantId, eq(customerEngagementFeedbackWidgets.key, key)))
    .limit(1);

  const values = {
    tenantId,
    key: key.slice(0, 64),
    name: input.name.trim().slice(0, 200),
    kind,
    questionSetId: input.questionSetId ?? null,
    placement: input.placement ?? null,
    audience: input.audience ?? null,
    theme: input.theme ?? null,
    cooldownDays: input.cooldownDays ?? 30,
    enabled: input.enabled ?? true,
  };

  const [row] = existing
    ? await db.update(customerEngagementFeedbackWidgets).set(values)
      .where(scopedToTenant(customerEngagementFeedbackWidgets, tenantId, eq(customerEngagementFeedbackWidgets.id, existing.id))).returning()
    : await db.insert(customerEngagementFeedbackWidgets).values(values).returning();
  if (!row) throw new CustomerSurfaceError('could not save the widget');
  return row;
}

export async function listWidgets(db: Db, tenantId: number) {
  return db
    .select()
    .from(customerEngagementFeedbackWidgets)
    .where(scopedToTenant(customerEngagementFeedbackWidgets, tenantId))
    .orderBy(asc(customerEngagementFeedbackWidgets.key));
}

/**
 * Should this person be asked?
 *
 * The ONE place the cooldown is decided. `lastRespondedAt` is an argument, not a
 * read — the responses belong to the question-set owner, and reaching for them
 * here would make this a second answer to "has this person answered".
 *
 * A disabled widget never prompts, and a widget with no question set never
 * prompts either: showing somebody an empty survey is worse than not asking.
 */
export async function shouldPrompt(
  db: Db,
  tenantId: number,
  key: string,
  lastRespondedAt: Date | null,
  now: Date = new Date(),
): Promise<{ prompt: boolean; reason: string; widget: { key: string; kind: string; cooldownDays: number } | null }> {
  const [widget] = await db
    .select()
    .from(customerEngagementFeedbackWidgets)
    .where(scopedToTenant(customerEngagementFeedbackWidgets, tenantId, eq(customerEngagementFeedbackWidgets.key, key.trim().toLowerCase())))
    .limit(1);

  if (!widget) return { prompt: false, reason: 'no such widget', widget: null };
  const summary = { key: widget.key, kind: widget.kind, cooldownDays: widget.cooldownDays };
  if (!widget.enabled) return { prompt: false, reason: 'widget is disabled', widget: summary };
  if (!widget.questionSetId) return { prompt: false, reason: 'widget has no question set', widget: summary };
  if (lastRespondedAt === null) return { prompt: true, reason: 'never asked', widget: summary };

  const elapsedDays = (now.getTime() - lastRespondedAt.getTime()) / 86_400_000;
  return elapsedDays >= widget.cooldownDays
    ? { prompt: true, reason: 'cooldown elapsed', widget: summary }
    : { prompt: false, reason: `asked ${Math.floor(elapsedDays)}d ago, cooldown is ${widget.cooldownDays}d`, widget: summary };
}

/** Count a response. Counter-only, for the same reason exposures are: this is
 *  high-volume and the answers live with the question-set owner. */
export async function countWidgetResponse(db: Db, tenantId: number, key: string) {
  await db
    .update(customerEngagementFeedbackWidgets)
    .set({ responseCount: sql`${customerEngagementFeedbackWidgets.responseCount} + 1` })
    .where(scopedToTenant(customerEngagementFeedbackWidgets, tenantId, eq(customerEngagementFeedbackWidgets.key, key.trim().toLowerCase())));
}

// ── Uptime ──────────────────────────────────────────────────────────────────

export async function upsertMonitor(
  db: Db,
  tenantId: number,
  input: { id?: number; name: string; kind?: MonitorKind; target: string; method?: string; expectStatus?: number; expectBody?: string | null; intervalSec?: number; timeoutMs?: number; failThreshold?: number; regions?: unknown; enabled?: boolean },
) {
  const kind = input.kind ?? 'http';
  if (!isMonitorKind(kind)) throw new CustomerSurfaceError(`kind must be one of: ${MONITOR_KINDS.join(', ')}`);
  if (!input.target.trim()) throw new CustomerSurfaceError('target is required');
  if ((input.failThreshold ?? 2) < 1) {
    throw new CustomerSurfaceError('failThreshold must be at least 1 — a threshold of 0 pages on every blip');
  }
  if ((input.intervalSec ?? 300) < 30) {
    throw new CustomerSurfaceError('intervalSec must be at least 30 — probing faster costs more than it detects');
  }

  const values = {
    tenantId,
    name: input.name.trim().slice(0, 200),
    kind,
    target: input.target.trim(),
    method: input.method ?? 'GET',
    expectStatus: input.expectStatus ?? 200,
    expectBody: input.expectBody ?? null,
    intervalSec: input.intervalSec ?? 300,
    timeoutMs: input.timeoutMs ?? 10_000,
    failThreshold: input.failThreshold ?? 2,
    regions: input.regions ?? null,
    enabled: input.enabled ?? true,
  };

  const [row] = input.id
    ? await db.update(uptimeMonitors).set(values)
      .where(scopedToTenant(uptimeMonitors, tenantId, eq(uptimeMonitors.id, input.id))).returning()
    : await db.insert(uptimeMonitors).values(values).returning();
  if (!row) throw new CustomerSurfaceError('monitor not found', 404);
  return row;
}

export async function listMonitors(db: Db, tenantId: number) {
  return db
    .select()
    .from(uptimeMonitors)
    .where(scopedToTenant(uptimeMonitors, tenantId))
    .orderBy(desc(uptimeMonitors.enabled), asc(uptimeMonitors.name));
}

/**
 * Apply a monitor's threshold to a probe result.
 *
 * The RULE lives here; the consecutive-failure count is owned by the probe runner
 * and passed in. That split is deliberate: this module must be callable from a
 * sweep, a webhook or a test without any of them needing to agree on where the
 * counter is stored — and the rule stays in one place, so a status page and an
 * alert cannot disagree about what "down" means.
 */
export async function evaluateProbe(
  db: Db,
  tenantId: number,
  monitorId: number,
  probe: { ok: boolean; consecutiveFailures: number },
): Promise<{ state: 'up' | 'degraded' | 'down'; consecutiveFailures: number; threshold: number }> {
  const [monitor] = await db
    .select({ failThreshold: uptimeMonitors.failThreshold })
    .from(uptimeMonitors)
    .where(scopedToTenant(uptimeMonitors, tenantId, eq(uptimeMonitors.id, monitorId)))
    .limit(1);
  if (!monitor) throw new CustomerSurfaceError('monitor not found', 404);

  const failures = probe.ok ? 0 : probe.consecutiveFailures + 1;
  const state = probe.ok
    ? ('up' as const)
    // Below the threshold a failure is `degraded`, not `down`: something is
    // wrong and nobody should be paged yet, which is exactly what a threshold
    // is for.
    : failures >= monitor.failThreshold ? ('down' as const) : ('degraded' as const);

  return { state, consecutiveFailures: failures, threshold: monitor.failThreshold };
}
