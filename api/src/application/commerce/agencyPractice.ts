/**
 * Running a practice — agency branding, client retainers, consultations and the
 * knowledge a consultant sells (PRD 19 §9).
 *
 * ── WHY THESE FOUR TABLES ARE ONE MODULE ────────────────────────────────────
 * They describe one business: an agency has a brand it puts in front of clients,
 * clients it holds on retainer, consultations it delivers to them, and knowledge
 * documents it sells or shares. BurnRateOS split them across `agency` and
 * `consultant`, and the split is why neither could answer the question a practice
 * actually asks — "is this client profitable" — which needs the retainer from one
 * side and the delivered hours from the other. {@link clientEconomics} is that
 * question.
 *
 * ── RETAINER VS DELIVERED IS THE WHOLE POINT ────────────────────────────────
 * `agency_clients.retainer_cents` is what is billed; `consultant_consultations`
 * carries `duration_min` and `rate_cents`, which is what was delivered. A
 * practice that only tracks one of them discovers its worst client at renewal.
 * The comparison is deliberately reported as BOTH numbers plus a ratio rather
 * than as a single "margin", because the two are measured differently — one is
 * contractual and one is observed — and collapsing them hides which is which.
 *
 * ── BRANDING IS PER AGENCY, NOT PER TENANT ──────────────────────────────────
 * `agency_ref` exists because one workspace can run more than one practice — a
 * holding company, or a studio with two labels. So the key on every read here is
 * (tenant, agency_ref), and a tenant-only read would silently blend two brands.
 *
 * ── A CONSULTATION IS NOT A BOOKING ─────────────────────────────────────────
 * `consultant_consultations.reservation_id` points at a `booking_reservations`
 * row when the session was scheduled through the booking product, and is null
 * when it was not — a call that happened on somebody's own calendar is still
 * billable. Making the pointer required would have forced every practice onto the
 * scheduling product to record work it had already done.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  agencyBrandings,
  agencyClients,
  cardDecks,
  consultantConsultations,
  consultantKnowledgeDocs,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `agency_clients.status`. */
export const CLIENT_STATUSES = ['active', 'paused', 'ended', 'prospect'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

/** `consultant_consultations.status`. */
export const CONSULTATION_STATUSES = ['scheduled', 'delivered', 'cancelled', 'no_show'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

/** `card_decks.visibility`. */
export const DECK_VISIBILITY = ['private', 'unlisted', 'public'] as const;
export type DeckVisibility = (typeof DECK_VISIBILITY)[number];

export const isClientStatus = (v: unknown): v is ClientStatus =>
  typeof v === 'string' && (CLIENT_STATUSES as readonly string[]).includes(v);
export const isConsultationStatus = (v: unknown): v is ConsultationStatus =>
  typeof v === 'string' && (CONSULTATION_STATUSES as readonly string[]).includes(v);
export const isDeckVisibility = (v: unknown): v is DeckVisibility =>
  typeof v === 'string' && (DECK_VISIBILITY as readonly string[]).includes(v);

export class PracticeError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'PracticeError';
  }
}

const requireRef = (v: string, what: string): string => {
  const s = v.trim();
  if (!s || s.length > 64) throw new PracticeError(`${what} is required and must be 64 characters or fewer`);
  return s;
};

// ── Branding ────────────────────────────────────────────────────────────────

/** Create or replace one practice's brand. Keyed on (tenant, agency_ref), so a
 *  workspace running two labels keeps them apart. */
export async function setBranding(
  db: Db,
  tenantId: number,
  input: { agencyRef: string; name: string; logoArtifactId?: string | null; theme?: unknown; tagline?: string | null; website?: string | null },
) {
  const agencyRef = requireRef(input.agencyRef, 'agencyRef');
  const values = {
    tenantId,
    agencyRef,
    name: input.name.trim().slice(0, 200),
    logoArtifactId: input.logoArtifactId ?? null,
    theme: input.theme ?? null,
    tagline: input.tagline ?? null,
    website: input.website ?? null,
  };

  const [existing] = await db
    .select({ id: agencyBrandings.id })
    .from(agencyBrandings)
    .where(scopedToTenant(agencyBrandings, tenantId, eq(agencyBrandings.agencyRef, agencyRef)))
    .limit(1);

  const [row] = existing
    ? await db.update(agencyBrandings).set({ ...values, updatedAt: new Date() })
      .where(scopedToTenant(agencyBrandings, tenantId, eq(agencyBrandings.id, existing.id))).returning()
    : await db.insert(agencyBrandings).values(values).returning();
  if (!row) throw new PracticeError('could not save the branding');
  return row;
}

export async function branding(db: Db, tenantId: number, agencyRef: string) {
  const [row] = await db
    .select()
    .from(agencyBrandings)
    .where(scopedToTenant(agencyBrandings, tenantId, eq(agencyBrandings.agencyRef, requireRef(agencyRef, 'agencyRef'))))
    .limit(1);
  return row ?? null;
}

export async function listPractices(db: Db, tenantId: number) {
  return db
    .select()
    .from(agencyBrandings)
    .where(scopedToTenant(agencyBrandings, tenantId))
    .orderBy(asc(agencyBrandings.name));
}

// ── Clients ─────────────────────────────────────────────────────────────────

export async function listClients(db: Db, tenantId: number, agencyRef: string, status?: ClientStatus) {
  if (status !== undefined && !isClientStatus(status)) {
    throw new PracticeError(`status must be one of: ${CLIENT_STATUSES.join(', ')}`);
  }
  return db
    .select()
    .from(agencyClients)
    .where(scopedToTenant(agencyClients, tenantId, and(
      eq(agencyClients.agencyRef, requireRef(agencyRef, 'agencyRef')),
      ...(status ? [eq(agencyClients.status, status)] : []),
    )))
    .orderBy(desc(agencyClients.retainerCents), asc(agencyClients.clientName));
}

export async function addClient(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: { agencyRef: string; clientName: string; companyRef?: string | null; retainerCents?: number | null; currency?: string; startedAt?: Date | null },
) {
  const [row] = await db
    .insert(agencyClients)
    .values({
      tenantId,
      agencyRef: requireRef(input.agencyRef, 'agencyRef'),
      clientName: input.clientName.trim().slice(0, 255),
      companyRef: input.companyRef ?? null,
      retainerCents: input.retainerCents ?? null,
      currency: input.currency ?? 'USD',
      status: 'active',
      startedAt: input.startedAt ?? new Date(),
    })
    .returning();
  if (!row) throw new PracticeError('could not add the client');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'agency_client.added',
    targetType: 'agency_client', targetId: String(row.id),
    metadata: { clientName: row.clientName, retainerCents: row.retainerCents },
  });
  return row;
}

/** End or pause a client. `ended_at` is stamped by the transition rather than
 *  supplied, so a client cannot be `ended` with no end date. */
export async function setClientStatus(
  db: Db,
  tenantId: number,
  id: number,
  status: ClientStatus,
) {
  if (!isClientStatus(status)) throw new PracticeError(`status must be one of: ${CLIENT_STATUSES.join(', ')}`);
  const [row] = await db
    .update(agencyClients)
    .set({
      status,
      ...(status === 'ended' ? { endedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(agencyClients, tenantId, eq(agencyClients.id, id)))
    .returning();
  if (!row) throw new PracticeError('client not found', 404);
  return row;
}

// ── Consultations ───────────────────────────────────────────────────────────

export async function recordConsultation(
  db: Db,
  tenantId: number,
  input: {
    consultantRef: string;
    clientRef?: string | null;
    reservationId?: number | null;
    topic?: string | null;
    durationMin?: number | null;
    rateCents?: number | null;
    currency?: string;
  },
) {
  const [row] = await db
    .insert(consultantConsultations)
    .values({
      tenantId,
      consultantRef: requireRef(input.consultantRef, 'consultantRef'),
      clientRef: input.clientRef ?? null,
      // Null when the session happened outside the booking product — see the
      // module docstring.
      reservationId: input.reservationId ?? null,
      topic: input.topic ?? null,
      durationMin: input.durationMin ?? null,
      rateCents: input.rateCents ?? null,
      currency: input.currency ?? 'USD',
      status: 'scheduled',
    })
    .returning();
  if (!row) throw new PracticeError('could not record the consultation');
  return row;
}

export async function setConsultationStatus(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  status: ConsultationStatus,
  recordingArtifactId?: string | null,
) {
  if (!isConsultationStatus(status)) {
    throw new PracticeError(`status must be one of: ${CONSULTATION_STATUSES.join(', ')}`);
  }
  const [row] = await db
    .update(consultantConsultations)
    .set({
      status,
      ...(recordingArtifactId !== undefined ? { recordingArtifactId } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(consultantConsultations, tenantId, eq(consultantConsultations.id, id)))
    .returning();
  if (!row) throw new PracticeError('consultation not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: `consultation.${status}`,
    targetType: 'consultation', targetId: String(id),
    metadata: { consultantRef: row.consultantRef, durationMin: row.durationMin },
  });
  return row;
}

export async function consultationsFor(db: Db, tenantId: number, consultantRef: string) {
  return db
    .select()
    .from(consultantConsultations)
    .where(scopedToTenant(consultantConsultations, tenantId, eq(consultantConsultations.consultantRef, requireRef(consultantRef, 'consultantRef'))))
    .orderBy(desc(consultantConsultations.createdAt));
}

/**
 * Is this client worth it?
 *
 * Reports the contractual retainer and the DELIVERED value side by side rather
 * than as one margin, because they are measured differently: the retainer is
 * agreed, the delivered figure is observed from consultations that actually
 * happened. Only `delivered` consultations count — billing for a no-show is a
 * decision a practice makes deliberately, not a default a rollup should assume.
 */
export async function clientEconomics(db: Db, tenantId: number, agencyRef: string) {
  const clients = await db
    .select()
    .from(agencyClients)
    .where(scopedToTenant(agencyClients, tenantId, eq(agencyClients.agencyRef, requireRef(agencyRef, 'agencyRef'))));

  const delivered = await db
    .select({
      clientRef: consultantConsultations.clientRef,
      sessions: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${consultantConsultations.durationMin}), 0)::int`,
      deliveredCents: sql<number>`coalesce(sum(
        ${consultantConsultations.rateCents} * ${consultantConsultations.durationMin} / 60.0
      ), 0)::int`,
    })
    .from(consultantConsultations)
    .where(scopedToTenant(consultantConsultations, tenantId, eq(consultantConsultations.status, 'delivered')))
    .groupBy(consultantConsultations.clientRef);

  const byClient = new Map(delivered.map((d) => [d.clientRef, d]));

  return clients.map((c) => {
    const work = c.companyRef ? byClient.get(c.companyRef) : undefined;
    const deliveredCents = work?.deliveredCents ?? 0;
    return {
      id: c.id,
      clientName: c.clientName,
      status: c.status,
      currency: c.currency,
      retainerCents: c.retainerCents,
      deliveredCents,
      sessions: work?.sessions ?? 0,
      minutes: work?.minutes ?? 0,
      // Null rather than a number when there is no retainer to compare against —
      // a client with no retainer is not infinitely profitable.
      utilisation: c.retainerCents ? deliveredCents / c.retainerCents : null,
    };
  });
}

// ── Knowledge and decks ─────────────────────────────────────────────────────

/** A document a consultant publishes. Registered into the kernel so it is
 *  addressable, shareable and discussable like every other object. */
export async function publishKnowledgeDoc(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: { consultantRef: string; title: string; summary?: string | null; artifactId?: string | null },
) {
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new PracticeError('title is required');

  const [row] = await db
    .insert(consultantKnowledgeDocs)
    .values({
      tenantId,
      consultantRef: requireRef(input.consultantRef, 'consultantRef'),
      title,
      summary: input.summary ?? null,
      artifactId: input.artifactId ?? null,
    })
    .returning();
  if (!row) throw new PracticeError('could not publish the document');

  await registerObject(db, env, {
    tenantId, kind: 'knowledge_doc', refId: row.id, domain: 'commerce', title,
  });
  return row;
}

export async function knowledgeDocsFor(db: Db, tenantId: number, consultantRef: string) {
  return db
    .select()
    .from(consultantKnowledgeDocs)
    .where(scopedToTenant(consultantKnowledgeDocs, tenantId, eq(consultantKnowledgeDocs.consultantRef, requireRef(consultantRef, 'consultantRef'))))
    .orderBy(desc(consultantKnowledgeDocs.createdAt));
}

/**
 * A sellable deck of cards.
 *
 * In `commerce` and carrying `price_cents`, so this is a marketplace PRODUCT —
 * not planning-poker estimation cards, which are `poker_sessions` in canvas and
 * belong to Builderforce under §2 row 8. The two share a word and nothing else.
 *
 * `card_count` is derived from `cards` on write rather than trusted from the
 * caller: a count that disagrees with the array is a listing that lies about what
 * a buyer gets.
 */
export async function saveDeck(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: { id?: number; slug: string; name: string; description?: string | null; cards: unknown[]; priceCents?: number; currency?: string; visibility?: DeckVisibility },
) {
  const visibility = input.visibility ?? 'private';
  if (!isDeckVisibility(visibility)) {
    throw new PracticeError(`visibility must be one of: ${DECK_VISIBILITY.join(', ')}`);
  }
  if ((input.priceCents ?? 0) > 0 && visibility === 'private') {
    throw new PracticeError('a priced deck must be unlisted or public, or nobody can buy it');
  }

  const values = {
    tenantId,
    slug: input.slug.trim().toLowerCase().slice(0, 160),
    name: input.name.trim().slice(0, 200),
    description: input.description ?? null,
    cards: input.cards,
    cardCount: input.cards.length,
    priceCents: input.priceCents ?? 0,
    currency: input.currency ?? 'USD',
    visibility,
  };

  const [row] = input.id
    ? await db.update(cardDecks).set({ ...values, updatedAt: new Date() })
      .where(scopedToTenant(cardDecks, tenantId, eq(cardDecks.id, input.id))).returning()
    : await db.insert(cardDecks).values(values).returning();
  if (!row) throw new PracticeError('deck not found', 404);

  if (!input.id) {
    await registerObject(db, env, {
      tenantId, kind: 'card_deck', refId: row.id, domain: 'commerce', title: values.name,
    });
    await recordActivity(env, db, {
      tenantId, actor, verb: 'card_deck.created',
      targetType: 'card_deck', targetId: String(row.id),
      metadata: { name: values.name, cardCount: values.cardCount, priceCents: values.priceCents },
    });
  }
  return row;
}

export async function listDecks(db: Db, tenantId: number, visibility?: DeckVisibility) {
  return db
    .select()
    .from(cardDecks)
    .where(scopedToTenant(cardDecks, tenantId, visibility ? eq(cardDecks.visibility, visibility) : undefined))
    .orderBy(asc(cardDecks.name));
}
