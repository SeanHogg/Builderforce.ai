/**
 * THE prospect share — handing a live board, or one card off it, to somebody who has no
 * account.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * The product's whole differentiator is "describe your problem, watch it become real",
 * and the only two ways to show a prospect the board were a screen-share (they cannot
 * touch it) or a `creation_session_members` row (they need an account, which is the exact
 * friction a demo exists to avoid). Everything needed was already built and unwired:
 * `share_links` is the kernel's tokenised-access primitive, `GuestRoomDO` already runs
 * anonymous rooms for `/brainstorm`, and `objects` already makes `(kind, refId)` a real
 * foreign key. This module is the wiring, not an invention.
 *
 * ── WHY THIS IS *ONE* MODULE FOR BOARDS AND CARDS ────────────────────────────────
 * A seller sends two things: the whole board ("here, have a look at what we built") and
 * one artifact off it ("here is the price", "here is our security posture", "here is the
 * plan"). Those are the same act — mint a token against an object, render it to somebody
 * with no session, record what they did — and the temptation was a `boardShare` and a
 * `quoteShare` with their own routes. That is two revocation paths and two engagement
 * writers within a week. So there is one `shareTarget` with two values, and the
 * projection below branches once, at the point the two genuinely differ: what to render.
 *
 * ── WHY THE PROJECTION IS AGGRESSIVE ABOUT WHAT IT DROPS ─────────────────────────
 * Everything here is served to an unauthenticated stranger holding a URL. So the
 * projection is an ALLOW-LIST built from the canvas vocabulary's own declarations rather
 * than a deny-list of things to strip: it renders the fields a spec kind declares and
 * nothing else, and it drops every `restricted` field by construction. A deny-list is how
 * an internal note reaches a buyer the first time somebody adds a field and forgets which
 * of four places had to be told about it.
 */

import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  PROSPECT_EVENTS, boundaryAdmits, defaultConfidentialityForKind, isConfidentialityLevel,
  isProspectEvent, prospectVerb, quoteAcceptability, quoteCheckoutIntent,
  readQuoteLines, renameLegacyKind, summarizeProspectEngagement,
  type ConfidentialityLevel, type ProspectEngagement, type ProspectEvent, type ProspectSignal,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  activityLog, creationSessionObjects, creationSessions, objects, shareLinks,
} from '../../infrastructure/database/schema';
import {
  createShareLink, findObject, getObjectShares, invalidateObject, registerObject,
  resolveShareToken, revokeShareLink,
} from '../kernel/ObjectRegistry';
import { recordActivity } from '../activity/activityLog';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';

/**
 * The registry kinds a prospect share may point at.
 *
 * TWO, not one per canvas kind. `canvas_resume` (the existing precedent) is per-kind
 * because a résumé has a bespoke public renderer; a quote, a trust packet, a call recap
 * and a mutual plan share ONE renderer driven by the spec vocabulary, so they share one
 * registry kind and the canvas kind stays where it already lives — on the object row.
 */
export const PROSPECT_SHARE_KINDS = ['creation_session', 'canvas_object'] as const;
export type ProspectShareKind = typeof PROSPECT_SHARE_KINDS[number];

/**
 * The canvas kinds a seller may hand to a buyer.
 *
 * A closed list, and short on purpose. Not because the others are secret, but because
 * every entry here is an artifact that MEANS something to a person outside the company: a
 * price, a security posture, a joint plan, a recap of a call they were on, the trial they
 * asked for. A `dispatchBoard` or a `capTable` shared to a prospect would be a mistake
 * with no undo, and "the seller chose to" is not a control — the control is that the tool
 * refuses.
 */
export const SHAREABLE_CANVAS_KINDS: ReadonlySet<string> = new Set([
  'quote', 'trustPacket', 'mutualActionPlan', 'call', 'trial',
  // The three build artifacts a demo is actually about. A prospect share of a prototype
  // or a deck is the "watch it become real" claim made literal.
  'prototype', 'slides', 'website',
]);

/** How long a prospect link lives when the seller does not say. Thirty days is one buying
 *  cycle: long enough that a link does not die between two meetings, short enough that a
 *  price quoted last quarter is not still live on a URL somebody forwarded. */
export const DEFAULT_PROSPECT_SHARE_DAYS = 30;

/** Presentation settings the buyer-facing page reads. Stored in `share_links.metadata`. */
export interface ProspectShareSettings {
  /** Who the buyer sees this from — the seller's own name and company, never the
   *  platform's. A demo that reads "Builderforce" to a prospect is a demo of the wrong
   *  product. */
  sellerName: string;
  sellerCompany: string;
  /** Accent colour for the buyer page, from the tenant's brand. */
  accentColor: string;
  /** May the holder ASK to drive? Watch-only is the default: a prospect who can edit the
   *  board mid-demo is a demo that goes wrong in front of a buyer. Requesting control
   *  raises a signal to the seller, who grants it live — the escalation the roadmap
   *  entry names ("watch-only → request-control"). */
  allowControlRequest: boolean;
  /** A line the buyer reads above the artifact. The seller's framing, not a system string. */
  message: string;
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Read the settings off a stored share row, with every field defaulted. A share minted
 *  before a setting existed must render, not blank the page. */
export function readShareSettings(raw: unknown): ProspectShareSettings {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const accent = text(row.accentColor, 32);
  return {
    sellerName: text(row.sellerName, 120),
    sellerCompany: text(row.sellerCompany, 160),
    // Validated, not merely bounded: this value reaches a `style` attribute on a page
    // served to a stranger, so anything that is not a colour is dropped rather than
    // rendered. The page falls back to its own token when this is empty.
    accentColor: /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : '',
    allowControlRequest: row.allowControlRequest === true,
    message: text(row.message, 600),
  };
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

export interface MintProspectShareInput {
  tenantId: number;
  /** The canvas session. Always required — a card share still names its board, because
   *  the engagement rollup and the seller's "who has my links" list are per-session. */
  sessionId: string;
  sessionTitle: string;
  /** Null for a whole-board share; a `creation_session_objects.id` for one card. */
  objectId: string | null;
  objectKind: string | null;
  objectTitle: string | null;
  /** The card's authored confidentiality. Omitted falls to the kind default, which is
   *  `restricted` for the kinds where not thinking about it IS the disclosure. */
  objectConfidentiality?: ConfidentialityLevel | null;
  label: string;
  settings: ProspectShareSettings;
  expiresAt: Date | null;
  createdBy: string;
}

export interface MintedProspectShare {
  id: string;
  token: string;
  /** The path on the web app. Built here so the tool, the card and the email all quote
   *  one URL shape — three spellings of a share path is how a link works in the product
   *  and 404s in an email. */
  viewPath: string;
  expiresAt: string | null;
}

/** The buyer-facing path for a token. ONE definition, used by the API and the client. */
export const prospectSharePath = (token: string): string => `/deal/${token}`;

/**
 * Mint a prospect link against a board or one card on it.
 *
 * Registers the target in the kernel FIRST (idempotently), because `share_links.object_id`
 * is a real foreign key into `objects` — saying so here is better than a foreign-key error
 * the caller has to decode, which is the same reasoning `interviewScheduling.ts` records.
 */
export async function mintProspectShare(
  db: Db,
  env: Env,
  input: MintProspectShareInput,
): Promise<MintedProspectShare | { error: string }> {
  const parent = await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: 'creation_session',
    refId: input.sessionId,
    domain: 'canvas',
    title: input.sessionTitle,
  });

  let target = parent;
  if (input.objectId) {
    const kind = renameLegacyKind(String(input.objectKind ?? ''));
    if (!SHAREABLE_CANVAS_KINDS.has(kind)) {
      return { error: `A ${kind || 'card'} cannot be shared with a prospect. Shareable kinds: ${[...SHAREABLE_CANVAS_KINDS].join(', ')}.` };
    }
    // Refused at MINT, not only at render. A link that exists and resolves to an empty
    // page is a link a seller believes they sent — they quote it in an email, the buyer
    // opens nothing, and nobody learns why until the deal is cold.
    if (!boundaryAdmits(input.objectConfidentiality ?? defaultConfidentialityForKind(kind), 'share')) {
      return { error: `That ${kind} is marked restricted, so it cannot be put outside the workspace. Change its confidentiality on the card first.` };
    }
    target = await registerObject(db, env, {
      tenantId: input.tenantId,
      kind: 'canvas_object',
      refId: input.objectId,
      domain: 'canvas',
      title: input.objectTitle ?? kind,
      parentId: parent.id,
    });
  }

  const expiresAt = input.expiresAt
    ?? new Date(Date.now() + DEFAULT_PROSPECT_SHARE_DAYS * 86_400_000);

  const share = await createShareLink(db, env, {
    tenantId: input.tenantId,
    objectId: target.id,
    // Always 'view'. Control is not a scope on the token: it is granted LIVE, per session,
    // by a seller who is watching — a token that carries edit rights is one that keeps
    // carrying them after the meeting ends.
    scope: 'view',
    expiresAt,
    createdBy: input.createdBy,
  });

  // `label` and `metadata` are columns on the kernel primitive (migration 0923) rather
  // than a table beside it; `createShareLink` does not take them because they are not part
  // of the GRANT, so they are stamped here in the same request.
  await db.update(shareLinks)
    .set({ label: input.label.slice(0, 160), metadata: input.settings as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(scopedToTenant(shareLinks, input.tenantId, eq(shareLinks.id, share.id)));
  await invalidateObject(env, input.tenantId, target.id);

  return {
    id: share.id,
    token: share.token,
    viewPath: prospectSharePath(share.token),
    expiresAt: expiresAt.toISOString(),
  };
}

/** Every live prospect link on one session, plus the cards they point at. */
export async function listProspectShares(db: Db, env: Env, tenantId: number, sessionId: string) {
  const parent = await findObject(db, tenantId, 'creation_session', sessionId);
  if (!parent) return [];
  // The session's own shares, and the shares of every card registered UNDER it. One query
  // over `objects.parent_id` rather than N point reads — a board with a dozen shared cards
  // is otherwise a dozen round trips to draw one list.
  const rows = await db.select({
    id: shareLinks.id,
    label: shareLinks.label,
    metadata: shareLinks.metadata,
    scope: shareLinks.scope,
    expiresAt: shareLinks.expiresAt,
    useCount: shareLinks.useCount,
    lastUsedAt: shareLinks.lastUsedAt,
    createdAt: shareLinks.createdAt,
    objectId: objects.id,
    objectKind: objects.kind,
    objectRefId: objects.refId,
    objectTitle: objects.title,
  }).from(shareLinks)
    .innerJoin(objects, eq(objects.id, shareLinks.objectId))
    .where(scopedToTenant(
      shareLinks, tenantId,
      isNull(shareLinks.revokedAt),
      sql`(${objects.id} = ${parent.id} OR ${objects.parentId} = ${parent.id})`,
    ))
    .orderBy(desc(shareLinks.createdAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    label: row.label ?? '',
    settings: readShareSettings(row.metadata),
    target: row.objectKind === 'creation_session' ? 'board' as const : 'card' as const,
    canvasObjectId: row.objectKind === 'canvas_object' ? row.objectRefId : null,
    title: row.objectTitle ?? '',
    expiresAt: row.expiresAt?.toISOString() ?? null,
    opens: row.useCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** THE revocation path, delegated to the kernel's. Not a second one. */
export async function revokeProspectShare(
  db: Db,
  env: Env,
  tenantId: number,
  shareId: string,
): Promise<boolean> {
  const [row] = await db.select({ objectId: shareLinks.objectId })
    .from(shareLinks)
    .where(scopedToTenant(shareLinks, tenantId, eq(shareLinks.id, shareId)))
    .limit(1);
  if (!row) return false;
  await revokeShareLink(db, env, tenantId, row.objectId, shareId);
  return true;
}

// ---------------------------------------------------------------------------
// The buyer's read
// ---------------------------------------------------------------------------

export interface ProspectCard {
  /** The canvas object id — the anchor every engagement event is written against. */
  id: string;
  kind: string;
  title: string;
  status: string;
  /** The spec-declared fields, already filtered. Rendered generically by the buyer page. */
  data: Record<string, unknown>;
}

export interface ProspectPacket {
  shareId: string;
  target: 'board' | 'card';
  sessionId: string;
  title: string;
  settings: ProspectShareSettings;
  cards: ProspectCard[];
  /** Present only when the packet's single card is an acceptable quote — so the page
   *  never draws an accept button the route would refuse. See `quoteAcceptability`. */
  acceptable: { quoteObjectId: string; totalCents: number; currency: string } | null;
  /** The board's live revision, so a watching buyer can poll for changes without being
   *  handed the session's whole event stream. */
  revision: number;
}

/** Fields never sent outside the tenant, whatever a card carries. Kept short because the
 *  projection is an allow-list — this is the belt on top of the braces, covering the two
 *  bookkeeping keys the canvas writes onto every shared card and a buyer has no use for. */
const NEVER_SHARED: ReadonlySet<string> = new Set([
  'shareUrl', 'engagementHotspots', 'shareOpens', 'shareLastSeenAt',
  'provenance', 'approvalMode', 'canonicalPrdPending',
]);

/**
 * Reduce one stored canvas row to what a stranger may see.
 *
 * Reads `content`, NOT `canvas_data`: the authored fields of a card live in `content`
 * (`{kind, title, status, …the spec's fields}`) and `canvas_data` is GEOMETRY — x, y,
 * width, height. Projecting the geometry would send a buyer a card with a position and
 * no price.
 */
function projectCard(row: { id: string; kind: string; content: unknown }): ProspectCard | null {
  const kind = renameLegacyKind(row.kind);
  if (!SHAREABLE_CANVAS_KINDS.has(kind)) return null;
  const raw = row.content && typeof row.content === 'object' && !Array.isArray(row.content)
    ? row.content as Record<string, unknown>
    : {};
  // The kind allow-list answers "is this the sort of thing a buyer sees". The
  // confidentiality label answers "did the person who authored THIS one say otherwise",
  // and only the second survives a `quote` that happens to carry an unreleased price or a
  // `trustPacket` marked restricted while it is being revised. Both are asked, because a
  // shareable KIND is not a shareable OBJECT.
  const declared = raw.confidentiality;
  const level = isConfidentialityLevel(declared) ? declared : defaultConfidentialityForKind(kind);
  if (!boundaryAdmits(level, 'share')) return null;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (NEVER_SHARED.has(key)) continue;
    if (key === 'kind' || key === 'title' || key === 'status') continue;
    // Anything not JSON-shaped is dropped rather than coerced: a stray function or symbol
    // on a card is a bug, and rendering "[object Object]" to a buyer is worse than a gap.
    if (value === null || ['string', 'number', 'boolean', 'object'].includes(typeof value)) data[key] = value;
  }
  return {
    id: row.id,
    kind,
    title: text((raw as Record<string, unknown>).title, 200),
    status: text((raw as Record<string, unknown>).status, 80),
    data,
  };
}

/**
 * Resolve a raw prospect token to everything the buyer page renders.
 *
 * Deliberately NOT cached — the same refusal `resolveShareToken` documents: a revoked link
 * has to stop working on the next request, and a cache is how a revoked link keeps working
 * for a TTL. The board read underneath it is bounded (a shared board is capped at the
 * cards below) so the uncached path is a small, indexed query rather than a scan.
 */
export async function resolveProspectPacket(db: Db, token: string): Promise<ProspectPacket | null> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return null;
  const grant = await resolveShareToken(db, token);
  if (!grant || grant.scope !== 'view') return null;

  const [target] = await db.select({
    id: objects.id, kind: objects.kind, refId: objects.refId, title: objects.title, parentId: objects.parentId,
  }).from(objects)
    .where(scopedToTenant(objects, grant.tenantId, eq(objects.id, grant.objectId)))
    .limit(1);
  if (!target) return null;
  if (target.kind !== 'creation_session' && target.kind !== 'canvas_object') return null;

  const [shareRow] = await db.select({ id: shareLinks.id, metadata: shareLinks.metadata })
    .from(shareLinks)
    .where(scopedToTenant(
      shareLinks, grant.tenantId,
      eq(shareLinks.objectId, grant.objectId),
      isNull(shareLinks.revokedAt),
    ))
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);

  const settings = readShareSettings(shareRow?.metadata);

  if (target.kind === 'canvas_object') {
    const [row] = await db.select({
      id: creationSessionObjects.id,
      kind: creationSessionObjects.kind,
      content: creationSessionObjects.content,
      sessionId: creationSessionObjects.sessionId,
      revision: creationSessions.canvasRevision,
      sessionTitle: creationSessions.title,
    }).from(creationSessionObjects)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
      .where(eq(creationSessionObjects.id, target.refId))
      .limit(1);
    if (!row) return null;
    const card = projectCard(row);
    if (!card) return null;
    return {
      shareId: shareRow?.id ?? '',
      target: 'card',
      sessionId: row.sessionId,
      title: card.title || row.sessionTitle,
      settings,
      cards: [card],
      acceptable: acceptableQuote(card),
      revision: row.revision,
    };
  }

  const [session] = await db.select({
    id: creationSessions.id, title: creationSessions.title, revision: creationSessions.canvasRevision,
  }).from(creationSessions)
    .where(scopedToTenant(creationSessions, grant.tenantId, eq(creationSessions.id, target.refId)))
    .limit(1);
  if (!session) return null;

  // A shared BOARD shows the shareable cards on it and nothing else. That is the whole
  // safety story for a board share: a seller who shares a demo board is not also sharing
  // the cap table they happened to leave on it, and they do not have to remember to.
  const rows = await db.select({
    id: creationSessionObjects.id,
    kind: creationSessionObjects.kind,
    content: creationSessionObjects.content,
  }).from(creationSessionObjects)
    .where(eq(creationSessionObjects.sessionId, session.id))
    .orderBy(creationSessionObjects.createdAt)
    .limit(MAX_SHARED_CARDS);

  const cards = rows.map(projectCard).filter((card): card is ProspectCard => card != null);
  return {
    shareId: shareRow?.id ?? '',
    target: 'board',
    sessionId: session.id,
    title: session.title,
    settings,
    cards,
    acceptable: cards.length === 1 ? acceptableQuote(cards[0]!) : null,
    revision: session.revision,
  };
}

/** A shared board past this size is a document dump, not a demo — and an unbounded read
 *  on an unauthenticated route is the performance anti-pattern the platform rejects. */
const MAX_SHARED_CARDS = 120;

/** The accept affordance, or null. Reads the CONTRACT's rule so the button and the route
 *  cannot disagree about whether an offer is still live. */
function acceptableQuote(card: ProspectCard): ProspectPacket['acceptable'] {
  if (card.kind !== 'quote') return null;
  const verdict = quoteAcceptability(
    { state: card.data.quoteState, expiresAt: card.data.expiresAt },
    new Date(),
  );
  if (!verdict.acceptable) return null;
  const intent = quoteCheckoutIntent(
    readQuoteLines(card.data.lines),
    Number(card.data.termMonths ?? 12),
  );
  if (!intent) return null;
  const currency = text(card.data.currency, 8).toUpperCase();
  return {
    quoteObjectId: card.id,
    totalCents: intent.totalCents,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
  };
}

// ---------------------------------------------------------------------------
// Engagement — what they did with what we sent
// ---------------------------------------------------------------------------

/**
 * The prospect actor.
 *
 * A NEW `actor_type` value, not `human` and not `system`. `human` means a tenant member —
 * classifying a link-holder as one would put an anonymous stranger into every "who is on
 * this workspace" read that filters on it. `system` would lose the distinction that makes
 * the signal worth anything: the whole point is that a PERSON OUTSIDE THE COMPANY did
 * this. `actor_type` is a varchar, so this costs no DDL; see migration 0923.
 */
const PROSPECT_ACTOR = { type: 'prospect' as never, ref: null, name: 'Prospect' };

/** Beyond this many events from one link in one window, we are being crawled rather than
 *  read. Recorded up to the cap and then dropped — an unbounded write path on an
 *  unauthenticated route is the one place a rate limit is not optional. */
export const MAX_EVENTS_PER_SHARE_PER_HOUR = 240;

export interface RecordProspectEventInput {
  token: string;
  event: ProspectEvent;
  /** The canvas object the event is about, when it names one. */
  canvasObjectId?: string | null;
  objectLabel?: string | null;
  /** Dwell seconds. Bounded: a tab left open overnight is not eight hours of attention. */
  seconds?: number | null;
}

/** Nobody dwells on one card for longer than this in one report. A page that says
 *  otherwise has a timer that kept running in a background tab. */
const MAX_DWELL_SECONDS = 1_800;

/**
 * Record one prospect signal.
 *
 * Resolves the token itself rather than trusting a caller-supplied tenant: the row the
 * token resolves to REPORTS its tenant, which is the cross-tenant rule every public route
 * in this codebase follows. Returns false for a token that no longer grants anything, so
 * the route answers 404 rather than silently accepting events for a revoked link.
 */
export async function recordProspectEvent(
  db: Db,
  env: Env,
  input: RecordProspectEventInput,
): Promise<boolean> {
  if (!isProspectEvent(input.event)) return false;
  const grant = await resolveShareToken(db, input.token);
  if (!grant) return false;

  const since = new Date(Date.now() - 3_600_000);
  const [recent] = await db.select({ count: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(scopedToTenant(
      activityLog, grant.tenantId,
      eq(activityLog.objectId, grant.objectId),
      eq(activityLog.actorType, 'prospect'),
      gte(activityLog.occurredAt, since),
    ));
  if ((recent?.count ?? 0) >= MAX_EVENTS_PER_SHARE_PER_HOUR) return true;

  const seconds = input.event === 'dwell'
    ? Math.min(MAX_DWELL_SECONDS, Math.max(0, Math.round(Number(input.seconds ?? 0))))
    : 0;

  await recordActivity(env, db, {
    tenantId: grant.tenantId,
    actor: PROSPECT_ACTOR,
    verb: prospectVerb(input.event),
    targetType: 'canvas_object',
    targetId: text(input.canvasObjectId, 64) || null,
    targetLabel: text(input.objectLabel, 300) || null,
    summary: null,
    metadata: { shareObjectId: grant.objectId, seconds },
  });

  // The share's own counters. `use_count` is what a seller's list of links shows as
  // "opens", and it is incremented HERE rather than by the resolver, because resolving a
  // token happens on every poll for board changes and an "opens" figure that counts polls
  // is one nobody can act on.
  if (input.event === 'opened') {
    await db.update(shareLinks)
      .set({ useCount: sql`${shareLinks.useCount} + 1`, lastUsedAt: new Date() })
      .where(scopedToTenant(
        shareLinks, grant.tenantId,
        eq(shareLinks.objectId, grant.objectId),
        isNull(shareLinks.revokedAt),
      ));
    await invalidateObject(env, grant.tenantId, grant.objectId);
  }
  return true;
}

/**
 * The engagement rollup for one shared object.
 *
 * Reads the activity store and hands the rows to the CONTRACT's summarizer, so the card,
 * the pipeline and the buyer-facing page all read one definition of "attention" rather
 * than three sums of the same rows.
 */
export async function readProspectEngagement(
  db: Db,
  tenantId: number,
  shareObjectId: string,
): Promise<ProspectEngagement> {
  const rows = await db.select({
    verb: activityLog.verb,
    occurredAt: activityLog.occurredAt,
    targetId: activityLog.targetId,
    targetLabel: activityLog.targetLabel,
    metadata: activityLog.metadata,
  }).from(activityLog)
    .where(scopedToTenant(
      activityLog, tenantId,
      eq(activityLog.objectId, shareObjectId),
      eq(activityLog.actorType, 'prospect'),
    ))
    .orderBy(desc(activityLog.occurredAt))
    .limit(MAX_ENGAGEMENT_ROWS);

  const signals: ProspectSignal[] = rows.flatMap((row) => {
    const event = row.verb.replace(/^prospect\./, '');
    if (!isProspectEvent(event)) return [];
    const metadata = row.metadata as Record<string, unknown> | null;
    return [{
      event,
      occurredAtISO: row.occurredAt.toISOString(),
      objectId: row.targetId ?? '',
      objectLabel: row.targetLabel ?? '',
      seconds: Number(metadata?.seconds ?? 0) || 0,
    }];
  });
  return summarizeProspectEngagement(signals);
}

/** A deal with more engagement rows than this has been read enough that the tail changes
 *  nothing — and the rollup must stay a bounded read. */
const MAX_ENGAGEMENT_ROWS = 1_000;

/** The engagement patch a shared card takes. ONE builder, so the canvas tool and the
 *  sweep write the same four fields and a fifth never appears on only one path. */
export function engagementPatch(engagement: ProspectEngagement, shareUrl: string) {
  return {
    shareUrl,
    shareOpens: engagement.opens,
    shareLastSeenAt: engagement.lastSeenAtISO,
    engagementHotspots: engagement.hotspots.map((spot) => ({
      objectLabel: spot.objectLabel,
      seconds: spot.seconds,
      views: spot.views,
    })),
  };
}

/** Exported for the route's validation, so the wire vocabulary and the contract's are one
 *  list rather than two that drift. */
export const PROSPECT_EVENT_NAMES: readonly string[] = PROSPECT_EVENTS;

/** Every live share on one canvas object, for the tool that refreshes a card's figures. */
export async function findCardShare(db: Db, env: Env, tenantId: number, canvasObjectId: string) {
  const registered = await findObject(db, tenantId, 'canvas_object', canvasObjectId);
  if (!registered) return null;
  const shares = await getObjectShares(db, env, tenantId, registered.id);
  return shares.length > 0 ? { objectId: registered.id, share: shares[0]! } : { objectId: registered.id, share: null };
}
