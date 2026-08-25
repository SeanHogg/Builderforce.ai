/**
 * The marketing team's production line — brand, content, email, nurture, and the
 * two outbound surfaces (PRD 19 §9).
 *
 * ── WHY THESE SIX TABLES ARE ONE MODULE ─────────────────────────────────────
 * They are the stages of one pipeline: a brand kit defines how everything looks
 * and sounds, a content item is a thing being made, an email is a thing being
 * sent, a nurture flow is a sequence of sends, and learn videos and podcast
 * outreach are the two places content leaves the building. Four BurnRateOS
 * modules owned pieces of this (`marketing`, `marketingGrowth`, `nurtureFlows`,
 * `growth`) and none of them could answer "what are we making this quarter",
 * because the answer spanned all four.
 *
 * ── NURTURE FLOWS ARE A DEFINITION, NOT A RUNNER ────────────────────────────
 * `nurture_flows` carries `steps`, `entry_rule` and `exit_rule` — a definition.
 * This module stores and validates it and deliberately does NOT execute it,
 * because Builderforce already runs cadences: `sequenceRunner.ts` sweeps "who is
 * due" rather than holding a timer per person, and `follow_up_enrollments` is the
 * enrolment store. A second runner would give the platform two answers to "what
 * is about to be sent to this person" — the same call made for `ri_sequences`.
 *
 * ── BRAND DEFAULT IS EXCLUSIVE ──────────────────────────────────────────────
 * Everything downstream renders with "the" brand kit. Two defaults means half the
 * output is off-brand and nothing reports it, so {@link setDefaultBrandKit}
 * clears and sets in one transaction — the same shape as the ICP and scenario
 * baselines.
 *
 * ── EMAIL KEYS ARE UNIQUE PER TENANT, AND THAT IS LOAD-BEARING ──────────────
 * A transactional send addresses a template by KEY, not by id, so that a template
 * can be edited without every caller changing. That only works if the key
 * resolves to exactly one row, which {@link upsertEmail} enforces by upserting on
 * it rather than inserting.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  brandKits,
  learnVideos,
  marketingContentItems,
  marketingEmails,
  nurtureFlows,
  podcastOutreach,
} from '../../infrastructure/database/schema';
import { scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `podcast_outreach.status`. */
export const OUTREACH_STATUSES = ['researching', 'pitched', 'booked', 'recorded', 'published', 'declined'] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

/** `nurture_flows.status`. */
export const FLOW_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

export const isOutreachStatus = (v: unknown): v is OutreachStatus =>
  typeof v === 'string' && (OUTREACH_STATUSES as readonly string[]).includes(v);
export const isFlowStatus = (v: unknown): v is FlowStatus =>
  typeof v === 'string' && (FLOW_STATUSES as readonly string[]).includes(v);

export class ContentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ContentError';
  }
}

const requireText = (v: string, what: string, max = 200): string => {
  const s = v.trim();
  if (!s) throw new ContentError(`${what} is required`);
  return s.slice(0, max);
};

// ── Brand kits ──────────────────────────────────────────────────────────────

export async function listBrandKits(db: Db, tenantId: number) {
  return db
    .select()
    .from(brandKits)
    .where(scopedToTenant(brandKits, tenantId))
    .orderBy(desc(brandKits.isDefault), asc(brandKits.name));
}

export async function createBrandKit(
  db: Db,
  tenantId: number,
  input: { name: string; palette?: unknown; typography?: unknown; voice?: string | null; logoArtifactId?: string | null; logoDarkArtifactId?: string | null },
) {
  const [row] = await db
    .insert(brandKits)
    .values({
      tenantId,
      name: requireText(input.name, 'name'),
      palette: input.palette ?? null,
      typography: input.typography ?? null,
      voice: input.voice ?? null,
      logoArtifactId: input.logoArtifactId ?? null,
      logoDarkArtifactId: input.logoDarkArtifactId ?? null,
    })
    .returning();
  if (!row) throw new ContentError('could not create the brand kit');
  return row;
}

/** Exactly one default, for the reason in the module docstring. */
export async function setDefaultBrandKit(db: Db, tenantId: number, id: number) {
  const row = await db.transaction(async (tx) => {
    await tx
      .update(brandKits)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(scopedToTenant(brandKits, tenantId, eq(brandKits.isDefault, true)));
    const [updated] = await tx
      .update(brandKits)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(scopedToTenant(brandKits, tenantId, eq(brandKits.id, id)))
      .returning();
    return updated;
  });
  if (!row) throw new ContentError('brand kit not found', 404);
  return row;
}

/** The kit everything renders with, or null when nobody has chosen one — null
 *  rather than "the first one", because silently picking a kit is how output goes
 *  off-brand without anyone deciding to. */
export async function defaultBrandKit(db: Db, tenantId: number) {
  const [row] = await db
    .select()
    .from(brandKits)
    .where(scopedToTenant(brandKits, tenantId, eq(brandKits.isDefault, true)))
    .limit(1);
  return row ?? null;
}

// ── Content items ───────────────────────────────────────────────────────────

export async function listContent(db: Db, tenantId: number, filter: { format?: string; channel?: string; ownerRef?: string } = {}) {
  const where = [];
  if (filter.format) where.push(eq(marketingContentItems.format, filter.format));
  if (filter.channel) where.push(eq(marketingContentItems.channel, filter.channel));
  if (filter.ownerRef) where.push(eq(marketingContentItems.ownerRef, filter.ownerRef));
  return db
    .select()
    .from(marketingContentItems)
    .where(scopedToTenant(marketingContentItems, tenantId, where.length ? and(...where) : undefined))
    .orderBy(desc(marketingContentItems.updatedAt));
}

export async function createContentItem(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: { title: string; format: string; channel?: string | null; brief?: string | null; ownerRef?: string | null; artifactId?: string | null },
) {
  const title = requireText(input.title, 'title', 300);
  const format = requireText(input.format, 'format', 32);

  const [inserted] = await db
    .insert(marketingContentItems)
    .values({
      tenantId,
      title,
      format,
      channel: input.channel ?? null,
      brief: input.brief ?? null,
      ownerRef: input.ownerRef ?? null,
      artifactId: input.artifactId ?? null,
    })
    .returning();
  if (!inserted) throw new ContentError('could not create the content item');

  const registered = await registerObject(db, env, {
    tenantId, kind: 'content_item', refId: inserted.id, domain: 'growth', title,
  });
  const [row] = await db
    .update(marketingContentItems)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(marketingContentItems, tenantId, eq(marketingContentItems.id, inserted.id)))
    .returning();
  if (!row) throw new ContentError('could not create the content item');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'content_item.created',
    targetType: 'content_item', targetId: String(row.id), objectId: registered.id,
    metadata: { title, format, channel: input.channel ?? null },
  });
  return row;
}

/** What is being made, by format and channel — the quarterly plan BurnRateOS
 *  could not produce because the answer spanned four modules. */
export async function contentPipeline(db: Db, tenantId: number) {
  return db
    .select({
      format: marketingContentItems.format,
      channel: marketingContentItems.channel,
      items: sql<number>`count(*)::int`,
      withArtifact: sql<number>`count(*) filter (where ${marketingContentItems.artifactId} is not null)::int`,
    })
    .from(marketingContentItems)
    .where(scopedToTenant(marketingContentItems, tenantId))
    .groupBy(marketingContentItems.format, marketingContentItems.channel)
    .orderBy(desc(sql`count(*)`));
}

// ── Email templates ─────────────────────────────────────────────────────────

/**
 * Create or replace a template, addressed by KEY.
 *
 * Upsert rather than insert, because a transactional send names the key and the
 * whole point of a key is that it resolves to one row. Editing copy must not
 * require every caller to learn a new id.
 */
export async function upsertEmail(
  db: Db,
  tenantId: number,
  input: { key: string; name: string; subject?: string | null; bodyHtml?: string | null; bodyText?: string | null; variables?: unknown; isTemplate?: boolean },
) {
  const key = requireText(input.key, 'key', 96).toLowerCase();
  const values = {
    tenantId,
    key,
    name: requireText(input.name, 'name'),
    subject: input.subject ?? null,
    bodyHtml: input.bodyHtml ?? null,
    bodyText: input.bodyText ?? null,
    variables: input.variables ?? null,
    isTemplate: input.isTemplate ?? true,
  };

  const [existing] = await db
    .select({ id: marketingEmails.id })
    .from(marketingEmails)
    .where(scopedToTenant(marketingEmails, tenantId, eq(marketingEmails.key, key)))
    .limit(1);

  const [row] = existing
    ? await db.update(marketingEmails).set({ ...values, updatedAt: new Date() })
      .where(scopedToTenant(marketingEmails, tenantId, eq(marketingEmails.id, existing.id))).returning()
    : await db.insert(marketingEmails).values(values).returning();
  if (!row) throw new ContentError('could not save the email');
  return row;
}

export async function listEmails(db: Db, tenantId: number) {
  return db
    .select()
    .from(marketingEmails)
    .where(scopedToTenant(marketingEmails, tenantId))
    .orderBy(asc(marketingEmails.key));
}

/** Resolve a template by key — the read a send performs. Returns null rather than
 *  throwing, because a missing template is a routine branch for a caller
 *  deciding between a template and a literal body. */
export async function emailByKey(db: Db, tenantId: number, key: string) {
  const [row] = await db
    .select()
    .from(marketingEmails)
    .where(scopedToTenant(marketingEmails, tenantId, eq(marketingEmails.key, key.trim().toLowerCase())))
    .limit(1);
  return row ?? null;
}

// ── Nurture flows ───────────────────────────────────────────────────────────

/**
 * Store a flow DEFINITION.
 *
 * Validated here and executed elsewhere — see the module docstring. The one rule
 * enforced is that an active flow has steps and an entry rule: a flow that is
 * `active` with neither enrols everybody into nothing, and it does it silently.
 */
export async function saveNurtureFlow(
  db: Db,
  tenantId: number,
  input: { id?: number; name: string; goal?: string | null; steps: unknown[]; entryRule?: unknown; exitRule?: unknown; status?: FlowStatus; ownerRef?: string | null },
) {
  const status = input.status ?? 'draft';
  if (!isFlowStatus(status)) throw new ContentError(`status must be one of: ${FLOW_STATUSES.join(', ')}`);
  if (status === 'active' && (input.steps.length === 0 || !input.entryRule)) {
    throw new ContentError('an active flow needs steps and an entry rule, or it enrols everybody into nothing');
  }

  const values = {
    tenantId,
    name: requireText(input.name, 'name'),
    goal: input.goal ?? null,
    steps: input.steps,
    entryRule: input.entryRule ?? null,
    exitRule: input.exitRule ?? null,
    status,
    ownerRef: input.ownerRef ?? null,
  };

  const [row] = input.id
    ? await db.update(nurtureFlows).set({ ...values, updatedAt: new Date() })
      .where(scopedToTenant(nurtureFlows, tenantId, eq(nurtureFlows.id, input.id))).returning()
    : await db.insert(nurtureFlows).values(values).returning();
  if (!row) throw new ContentError('nurture flow not found', 404);
  return row;
}

export async function listNurtureFlows(db: Db, tenantId: number, status?: FlowStatus) {
  return db
    .select()
    .from(nurtureFlows)
    .where(scopedToTenant(nurtureFlows, tenantId, status ? eq(nurtureFlows.status, status) : undefined))
    .orderBy(desc(nurtureFlows.updatedAt));
}

// ── Learn videos ────────────────────────────────────────────────────────────

/**
 * Attach a video to a surface.
 *
 * `tenant_id` is NULLABLE here on purpose: the platform's own onboarding videos
 * belong to no tenant, and a tenant's belong to them. So this uses the
 * nullable-tenant helper — passing a tenant never reaches platform rows and
 * passing null never reaches a tenant's.
 */
export async function attachLearnVideo(
  db: Db,
  tenantId: number | null,
  input: { videoId: number; surface: string; title: string; featureKey?: string | null; position?: number },
) {
  const [row] = await db
    .insert(learnVideos)
    .values({
      tenantId,
      videoId: input.videoId,
      surface: requireText(input.surface, 'surface', 32),
      featureKey: input.featureKey ?? null,
      title: requireText(input.title, 'title', 300),
      position: input.position ?? 0,
    })
    .returning();
  if (!row) throw new ContentError('could not attach the video');
  return row;
}

/** Active videos for a surface, in position order. */
export async function videosForSurface(db: Db, tenantId: number | null, surface: string) {
  return db
    .select()
    .from(learnVideos)
    .where(scopedToNullableTenant(learnVideos, tenantId, and(
      eq(learnVideos.surface, surface),
      eq(learnVideos.isActive, true),
    )))
    .orderBy(asc(learnVideos.position));
}

// ── Podcast outreach ────────────────────────────────────────────────────────

export async function recordOutreach(
  db: Db,
  tenantId: number,
  input: { showName: string; hostName?: string | null; contactEmail?: string | null; audienceSize?: number | null; topicPitch?: string | null },
) {
  const [row] = await db
    .insert(podcastOutreach)
    .values({
      tenantId,
      showName: requireText(input.showName, 'showName', 255),
      hostName: input.hostName ?? null,
      contactEmail: input.contactEmail ?? null,
      audienceSize: input.audienceSize ?? null,
      topicPitch: input.topicPitch ?? null,
      status: 'researching',
    })
    .returning();
  if (!row) throw new ContentError('could not record the outreach');
  return row;
}

export async function advanceOutreach(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  status: OutreachStatus,
) {
  if (!isOutreachStatus(status)) {
    throw new ContentError(`status must be one of: ${OUTREACH_STATUSES.join(', ')}`);
  }
  const [row] = await db
    .update(podcastOutreach)
    .set({
      status,
      // Stamped by the transition rather than supplied, so "recorded" and "when"
      // cannot disagree.
      ...(status === 'recorded' ? { recordedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(podcastOutreach, tenantId, eq(podcastOutreach.id, id)))
    .returning();
  if (!row) throw new ContentError('outreach not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'podcast_outreach.advanced',
    targetType: 'podcast_outreach', targetId: String(id),
    metadata: { status, showName: row.showName },
  });
  return row;
}

/** The outreach pipeline, and the audience it actually reached. Reach is summed
 *  only over shows that PUBLISHED — a pitch to a big show is not reach. */
export async function outreachPipeline(db: Db, tenantId: number) {
  return db
    .select({
      status: podcastOutreach.status,
      shows: sql<number>`count(*)::int`,
      reachedAudience: sql<number>`coalesce(sum(${podcastOutreach.audienceSize}) filter (
        where ${podcastOutreach.status} = 'published'
      ), 0)::int`,
    })
    .from(podcastOutreach)
    .where(scopedToTenant(podcastOutreach, tenantId))
    .groupBy(podcastOutreach.status);
}
