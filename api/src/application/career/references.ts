/**
 * Professional references — the list, and the share links that expose a subset of it.
 *
 * ── THE RULE THIS MODULE ENFORCES ────────────────────────────────────────────────
 * Everything here is private until a token says otherwise, and a token only ever
 * reveals what it was issued for. The people on this list did not sign up here and
 * cannot manage their own exposure, so the product manages it for them: a share
 * names its references explicitly, decides separately whether contact details travel
 * with it, and can be revoked or expired without touching the underlying rows.
 *
 * `resolveShare` is the only read that is not scoped by user id, which is why it is
 * the only one that has to check revocation and expiry itself.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { professionalReferences, referenceShares } from '../../infrastructure/database/schema';
import { sha256Hex } from '../../infrastructure/crypto/digest';

export type ReferenceStatus = 'draft' | 'requested' | 'confirmed' | 'declined';

export interface ProfessionalReference {
  id: string;
  name: string;
  relationship: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  canSpeakTo: string | null;
  status: ReferenceStatus;
  requestedAt: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdAt: string | null;
}

export interface ReferenceShare {
  id: string;
  label: string | null;
  referenceIds: string[];
  includeContact: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string | null;
}

/** The one moment the raw token exists outside the creator's browser. */
export interface IssuedReferenceShare extends ReferenceShare {
  /** Shown once, at issue time. It is not recoverable — only its hash is stored. */
  token: string;
}

/** What a holder of a share token sees — never the owner's other references. */
export interface SharedReferenceView {
  label: string | null;
  includeContact: boolean;
  references: Array<Omit<ProfessionalReference, 'notes' | 'email' | 'phone'> & {
    email: string | null;
    phone: string | null;
  }>;
}

/** SHA-256 hex. The only form a share token is ever persisted in. */
const hashToken = sha256Hex;

const iso = (value: Date | string | null): string | null =>
  value == null ? null : (value instanceof Date ? value.toISOString() : String(value));

type ReferenceRow = typeof professionalReferences.$inferSelect;
type ShareRow = typeof referenceShares.$inferSelect;

const toReference = (row: ReferenceRow): ProfessionalReference => ({
  id: row.id,
  name: row.name,
  relationship: row.relationship,
  company: row.company,
  title: row.title,
  email: row.email,
  phone: row.phone,
  canSpeakTo: row.canSpeakTo,
  status: (row.status as ReferenceStatus) ?? 'draft',
  requestedAt: iso(row.requestedAt),
  confirmedAt: iso(row.confirmedAt),
  notes: row.notes,
  createdAt: iso(row.createdAt),
});

const toShare = (row: ShareRow): ReferenceShare => ({
  id: row.id,
  label: row.label,
  referenceIds: Array.isArray(row.referenceIds) ? row.referenceIds : [],
  includeContact: row.includeContact,
  expiresAt: iso(row.expiresAt),
  revokedAt: iso(row.revokedAt),
  viewCount: row.viewCount,
  lastViewedAt: iso(row.lastViewedAt),
  createdAt: iso(row.createdAt),
});

export interface ReferenceInput {
  name: string;
  relationship?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  canSpeakTo?: string | null;
  status?: ReferenceStatus;
  notes?: string | null;
}

export class ReferenceService {
  constructor(private readonly db: Db) {}

  async list(userId: string): Promise<ProfessionalReference[]> {
    const rows = await this.db
      .select()
      .from(professionalReferences)
      .where(eq(professionalReferences.userId, userId))
      .orderBy(desc(professionalReferences.createdAt));
    return rows.map(toReference);
  }

  async create(userId: string, input: ReferenceInput): Promise<ProfessionalReference> {
    const [row] = await this.db
      .insert(professionalReferences)
      .values({
        userId,
        name: input.name.trim(),
        relationship: input.relationship ?? null,
        company: input.company ?? null,
        title: input.title ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        canSpeakTo: input.canSpeakTo ?? null,
        status: input.status ?? 'draft',
        notes: input.notes ?? null,
        ...(input.status === 'requested' ? { requestedAt: new Date() } : {}),
        ...(input.status === 'confirmed' ? { confirmedAt: new Date() } : {}),
      })
      .returning();
    return toReference(row!);
  }

  /** Patch one reference. Scoped by user id in the WHERE, so another account's row
   *  cannot be reached by guessing an id. */
  async update(userId: string, id: string, input: Partial<ReferenceInput>): Promise<ProfessionalReference | null> {
    const patch: Partial<ReferenceRow> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.relationship !== undefined) patch.relationship = input.relationship;
    if (input.company !== undefined) patch.company = input.company;
    if (input.title !== undefined) patch.title = input.title;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.canSpeakTo !== undefined) patch.canSpeakTo = input.canSpeakTo;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined) {
      patch.status = input.status;
      // The timestamps are derived from the transition, not sent by the client —
      // a "confirmed" with no date is the state this prevents.
      if (input.status === 'requested') patch.requestedAt = new Date();
      if (input.status === 'confirmed') patch.confirmedAt = new Date();
    }
    const [row] = await this.db
      .update(professionalReferences)
      .set(patch)
      .where(and(eq(professionalReferences.id, id), eq(professionalReferences.userId, userId)))
      .returning();
    return row ? toReference(row) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(professionalReferences)
      .where(and(eq(professionalReferences.id, id), eq(professionalReferences.userId, userId)))
      .returning({ id: professionalReferences.id });
    return rows.length > 0;
  }

  async listShares(userId: string): Promise<ReferenceShare[]> {
    const rows = await this.db
      .select()
      .from(referenceShares)
      .where(eq(referenceShares.userId, userId))
      .orderBy(desc(referenceShares.createdAt));
    return rows.map(toShare);
  }

  /**
   * Issue a share. The selection is validated against the owner's OWN references,
   * so a request naming somebody else's id produces a share that does not include
   * it rather than one that leaks it.
   */
  async createShare(userId: string, input: {
    referenceIds: string[];
    label?: string | null;
    includeContact?: boolean;
    expiresInDays?: number | null;
  }): Promise<IssuedReferenceShare> {
    const owned = new Set((await this.list(userId)).map((r) => r.id));
    const referenceIds = input.referenceIds.filter((id) => owned.has(id));
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + Math.min(365, Math.max(1, input.expiresInDays)) * 86_400_000)
      : null;
    const token = crypto.randomUUID().replace(/-/g, '');
    const [row] = await this.db
      .insert(referenceShares)
      .values({
        userId,
        tokenHash: await hashToken(token),
        label: input.label ?? null,
        referenceIds,
        includeContact: input.includeContact === true,
        expiresAt,
      })
      .returning();
    return { ...toShare(row!), token };
  }

  async revokeShare(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(referenceShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(referenceShares.id, id), eq(referenceShares.userId, userId)))
      .returning({ id: referenceShares.id });
    return rows.length > 0;
  }

  /**
   * Resolve a share token to what its holder may see.
   *
   * The ONE read here not scoped by user id, so it does its own checking: revoked
   * and expired both return null, and contact details are stripped unless the share
   * was issued with them. Deliberately uncached — a revocation has to take effect
   * on the next request, which a TTL would delay.
   */
  async resolveShare(token: string): Promise<SharedReferenceView | null> {
    const [share] = await this.db
      .select()
      .from(referenceShares)
      .where(eq(referenceShares.tokenHash, await hashToken(token)))
      .limit(1);
    if (!share || share.revokedAt) return null;
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) return null;

    const ids = new Set(Array.isArray(share.referenceIds) ? share.referenceIds : []);
    if (ids.size === 0) return { label: share.label, includeContact: share.includeContact, references: [] };

    const rows = await this.db
      .select()
      .from(professionalReferences)
      .where(eq(professionalReferences.userId, share.userId));

    // View counting is best-effort: a failure here must not deny the employer the
    // page they were sent.
    void this.db
      .update(referenceShares)
      .set({ viewCount: sql`${referenceShares.viewCount} + 1`, lastViewedAt: new Date() })
      .where(eq(referenceShares.id, share.id))
      .catch(() => undefined);

    return {
      label: share.label,
      includeContact: share.includeContact,
      references: rows
        .filter((row) => ids.has(row.id))
        .map((row) => {
          const reference = toReference(row);
          return {
            ...reference,
            // Private notes NEVER travel; contact details only when the share says so.
            notes: undefined as never,
            email: share.includeContact ? reference.email : null,
            phone: share.includeContact ? reference.phone : null,
          };
        }),
    };
  }
}
