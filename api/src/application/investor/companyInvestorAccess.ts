/**
 * An investor is invited to a COMPANY, not to a room (IN-2).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `data_room_shares.data_room_id` is `notNull`, so every grant is per-room BY
 * CONSTRUCTION. A founder raising a round does not think in rooms: they invite
 * Ascent Partners to *the company* and expect that grant to reach the current
 * room, the next room, the monthly update and the pack — with one NDA, one
 * watermark identity, one expiry and one revocation. Room-level shares make that
 * N grants to keep in sync, and revoking access means remembering every room.
 *
 * ── THE FIX, AND WHAT IT DELIBERATELY DOES NOT ADD ──────────────────────────
 * A COMPANY-LEVEL grant that room-level shares DERIVE from. It introduces no
 * table and no column: BurnRateOS's `InvestorInvitation` / `InvestorAccess` /
 * `InvestorPortalAccess` trio is routed by `source-to-target.tsv` onto the
 * `invitation` / `membership` / `share_link` primitives the kernel already owns,
 * and a second invitation economy would give the platform two spellings of "this
 * investor has access". So one grant is three rows this schema already has:
 *
 *   `share_links`  on the company object — THE CREDENTIAL. Its `token_hash` is
 *                  what the investor holds, its `expires_at` is the one clock,
 *                  its `revoked_at` is the one revocation, and its `metadata`
 *                  carries the single NDA request id and the watermark identity.
 *                  This row, alone, is what enforcement reads.
 *   `invitations`  kind `company`, role `investor` — the NAMED PERSON and the
 *                  pending state. Same token hash: the link IS the invitation,
 *                  because issuing two credentials for one grant is two things
 *                  to revoke.
 *   `memberships`  on the company object, `member_kind: 'email'` — who is on
 *                  this company, which is the question the founder's list asks
 *                  and the one `memberships` exists to answer for every other
 *                  object on the platform.
 *
 * ── HOW A ROOM SHARE DERIVES, WITH NO POINTER COLUMN ────────────────────────
 * The derived per-room `data_room_shares` row's `token_hash` is
 * `sha256("<grant token>.<room id>")`. Two properties fall out of that and they
 * are the whole mechanism:
 *
 *   1. The derived token's PLAINTEXT is `<grant token>.<room id>` — which the
 *      holder of the grant token can form, and nobody else can. So the existing
 *      `resolveDataRoomShare` resolves it with no change at all: the NDA gate,
 *      both expiry clocks, the watermark and the access log are the ones already
 *      written in `dataRoomSharing.ts`, not a second copy of them here.
 *   2. Derivation is LAZY, at open time. A room created after the grant is
 *      reached by the same grant, which is the half of the defect that a
 *      mint-time fan-out would not have fixed.
 *
 * REVOCATION IS STILL ONE DECISION, and it is enforced in two writes that are
 * one statement each: the grant is revoked, and every share into this company's
 * rooms held by this recipient is stamped in a single UPDATE. The second is not
 * bookkeeping — a derived row that outlived its grant would keep resolving on the
 * public route, because that route reads the derived row. Sweeping by
 * (this company's rooms × this recipient) also revokes a room-level share minted
 * by hand to the same person, and that is intended: "revoke Ascent Partners"
 * means they are out of this company, not out of one room.
 *
 * ── ANALYTICS ROLL UP TO A PERSON ───────────────────────────────────────────
 * `dataRoomAnalytics` groups `activity_log` by document within ONE room. The
 * founder's question at company level is the other axis — which firm is actually
 * in diligence — so {@link companyInvestorAnalytics} groups the same log over
 * every room of the company by `recipientEmail`, which is the person, and reports
 * the rooms and documents each one reached.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  activityLog,
  companies,
  dataRoomShares,
  dataRooms,
  invitations,
  memberships,
  shareLinks,
  signatureRequests,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import { hashShareToken, mintShareToken, shareGrantState } from '../security/shareToken';
import { sendTemplatedDocument } from '../legal/templateSigning';
import { sha256Hex } from '../../domain/shared/hash';
import {
  DATA_ROOM_VERBS,
  resolveDataRoomShare,
  type DataRoomResolution,
} from './dataRoomSharing';
import { CompanyError, companyObjectId } from './companyWorkspace';

export class InvestorAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'InvestorAccessError';
  }
}

/** Verbs this module writes. Named once, for the same reason `DATA_ROOM_VERBS`
 *  is: an analytics read and its writer that drift leave a dashboard at zero. */
export const INVESTOR_ACCESS_VERBS = {
  invited: 'company.investor_invited',
  revoked: 'company.investor_revoked',
} as const;

const TARGET_TYPE = 'company';

/** `invitations.kind` for this family. The column is a 32-char varchar with a
 *  documented vocabulary; `company` joins it rather than earning a table. */
const INVITATION_KIND = 'company';
/** The role both the invitation and the membership carry. */
const INVESTOR_ROLE = 'investor';
/** `share_links.metadata.kind`, so a company object's OTHER share links — a
 *  public pitch link, say — are not mistaken for investor grants. */
const GRANT_KIND = 'investor_grant';

/**
 * What a company grant stores beyond the columns `share_links` already has.
 *
 * `metadata` is documented on that table as read-only and never filtered on,
 * which is exactly what this is: the recipient's identity (what the watermark
 * stamps), the firm's `party_ref`, and the ONE `signature_requests` row the NDA
 * was sent through. None of the three is ever a predicate — the grant is found by
 * its token hash or by its object.
 */
interface GrantMetadata {
  kind: typeof GRANT_KIND;
  recipientName: string;
  recipientEmail: string;
  firmPartyRef: string | null;
  permission: 'view' | 'download';
  ndaSignatureRequestId: number | null;
}

function grantMetadata(raw: unknown): GrantMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.kind !== GRANT_KIND) return null;
  return {
    kind: GRANT_KIND,
    recipientName: typeof value.recipientName === 'string' ? value.recipientName : '',
    recipientEmail: typeof value.recipientEmail === 'string' ? value.recipientEmail : '',
    firmPartyRef: typeof value.firmPartyRef === 'string' ? value.firmPartyRef : null,
    permission: value.permission === 'download' ? 'download' : 'view',
    ndaSignatureRequestId: typeof value.ndaSignatureRequestId === 'number' ? value.ndaSignatureRequestId : null,
  };
}

/**
 * The per-room token a company grant derives.
 *
 * PLAINTEXT, deliberately: it is handed straight to `resolveDataRoomShare`, which
 * hashes it the same way every other share-bearing table's token is hashed. Only
 * the holder of `grantToken` can form it, so the derived row is unreachable
 * without the grant even though the derived row is what the public route reads.
 */
const derivedRoomToken = (grantToken: string, dataRoomId: number): string => `${grantToken}.${dataRoomId}`;

// ---------------------------------------------------------------------------
// Inviting
// ---------------------------------------------------------------------------

export interface InviteInvestorInput {
  companyId: number;
  recipientName: string;
  recipientEmail: string;
  /** The FIRM as a `party_roles.party_ref`, so "which fund read the cap table"
   *  joins to the same investor object the raise pipeline uses (FO-A1/FO-E1). */
  firmPartyRef?: string | null;
  permission?: 'view' | 'download';
  expiresAt?: string | null;
  /** Governing law for the NDA. */
  jurisdiction?: string | null;
  /** What the investor may use the material for. Narrow beats broad. */
  purpose?: string | null;
  /** Skip the NDA. Refused unless EVERY room on this company is `ndaRequired: false`
   *  — see {@link inviteInvestorToCompany}. */
  skipNda?: boolean;
  message?: string | null;
  actor: ActorIdentity;
  createdBy?: string | null;
}

export interface CreatedInvestorGrant {
  grantId: string;
  invitationId: string;
  /** The plaintext credential, exactly once — only hashes are stored. */
  token: string;
  companyId: number;
  recipientEmail: string;
  permission: 'view' | 'download';
  expiresAt: string | null;
  ndaState: 'not-required' | 'pending';
  ndaSignatureRequestId: number | null;
  /** True when `download` was asked for and refused because a room on this
   *  company watermarks. Reported rather than silently downgraded. */
  downloadRefusedByWatermark: boolean;
}

/**
 * Invite one investor to one company.
 *
 * The NDA is sent FIRST and the grant minted bound to it, the same ordering
 * `shareDataRoom` uses and for the same reason: a credential that exists before
 * the agreement gating it is a credential somebody can forward in the window
 * between the two calls.
 *
 * ── WHY THE NDA AND THE WATERMARK ARE DECIDED ACROSS ALL ROOMS ──────────────
 * A company grant opens every room this company has, present and future, so its
 * policy has to be the STRICTEST of them rather than any one room's. If any room
 * requires an NDA, the grant requires an NDA. If any room watermarks, the grant
 * cannot carry `download` — because the grant is one credential and a `download`
 * on it would be an un-watermarked copy of a watermarked room, which is exactly
 * what that column exists to prevent. Each room's own resolve enforces its own
 * settings again on the way out; this is the outer bound, not a replacement.
 *
 * A company with NO rooms yet is still invitable. That is the point of a
 * company-level grant: the founder invites the fund now, builds the room this
 * week, and the same link reaches it — so the NDA is required by default rather
 * than skipped because there was nothing to look at yet.
 */
export async function inviteInvestorToCompany(
  db: Db,
  env: Env,
  tenantId: number,
  input: InviteInvestorInput,
): Promise<CreatedInvestorGrant> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, input.companyId)))
    .limit(1);
  if (!company) throw new InvestorAccessError('No company with that id in this workspace.', 404);

  const recipientName = input.recipientName?.trim();
  const recipientEmail = input.recipientEmail?.trim().toLowerCase();
  if (!recipientName || !recipientEmail?.includes('@')) {
    throw new InvestorAccessError(
      'An investor grant needs a named recipient and a real address — this is who the NDA, the watermark and the access log are about.',
      400,
    );
  }

  const objectId = await companyObjectId(db, env, tenantId, company.id);

  // One live grant per (company, recipient). A second would be a second NDA, a
  // second expiry and a second thing to revoke — the defect this closes, reissued.
  const existing = await activeGrantFor(db, tenantId, objectId, recipientEmail);
  if (existing) {
    throw new InvestorAccessError(
      'This investor already holds a live grant to this company. Revoke it before issuing another, or extend the one they have.',
      409,
    );
  }

  const rooms = await companyRooms(db, tenantId, company.id);
  const anyNdaRequired = rooms.some((room) => room.ndaRequired);
  const anyWatermark = rooms.some((room) => room.watermark);
  // No rooms yet is not "no policy" — see the doc comment. The default is the
  // careful one, so building the first room later cannot retroactively widen a
  // grant that was issued before it existed.
  const ndaRequired = rooms.length === 0 ? !input.skipNda : anyNdaRequired || !input.skipNda;
  const requestedDownload = input.permission === 'download';
  const permission: 'view' | 'download' = requestedDownload && !anyWatermark && rooms.length > 0 ? 'download' : 'view';

  const requested = input.expiresAt ? new Date(input.expiresAt) : null;
  if (requested && Number.isNaN(requested.getTime())) throw new InvestorAccessError('expiresAt is not a date.', 400);
  // The tightest room clock is the outer bound, so shortening a room still
  // shortens what this grant reaches — the room's own resolve tests it again.
  const roomFloor = rooms.reduce<Date | null>(
    (soonest, room) => (room.expiresAt && (!soonest || room.expiresAt < soonest) ? room.expiresAt : soonest),
    null,
  );
  const expiresAt = roomFloor && (!requested || roomFloor < requested) ? roomFloor : requested;

  let ndaSignatureRequestId: number | null = null;
  if (ndaRequired) {
    const sent = await sendTemplatedDocument(db, env, tenantId, {
      // The ONE template registry (`documentTemplates.ts`). A second NDA body
      // written here would be the duplicate that rule forbids.
      templateKey: 'mutual-nda',
      values: {
        companyName: company.name,
        counterparty: recipientName,
        ...(input.purpose ? { purpose: input.purpose } : {}),
        jurisdiction: input.jurisdiction?.trim() || 'the jurisdiction stated in the parties’ correspondence',
      },
      parties: [{ name: recipientName, email: recipientEmail, partyRef: input.firmPartyRef ?? null }],
      subject: `NDA — ${company.name}`,
      objectId,
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      createdBy: input.createdBy ?? null,
    });
    ndaSignatureRequestId = sent.requestId;
  }

  const { token, tokenHash } = await mintShareToken();
  const metadata: GrantMetadata = {
    kind: GRANT_KIND,
    recipientName,
    recipientEmail,
    firmPartyRef: input.firmPartyRef?.trim() || null,
    permission,
    ndaSignatureRequestId,
  };

  const [grant] = await db
    .insert(shareLinks)
    .values({
      tenantId,
      objectId,
      tokenHash,
      scope: 'view',
      expiresAt,
      createdBy: input.createdBy ?? null,
      // What the MINTER calls this row in the list they have to be able to revoke.
      label: `${recipientName} · ${company.name}`,
      metadata,
    })
    .returning({ id: shareLinks.id });
  if (!grant) throw new InvestorAccessError('The investor grant could not be created.', 500);

  // The SAME hash: the link IS the invitation. Two credentials for one grant
  // would be two things to revoke, which is the defect this closes wearing a
  // different hat.
  const [invitation] = await db
    .insert(invitations)
    .values({
      tenantId,
      objectId,
      kind: INVITATION_KIND,
      email: recipientEmail,
      role: INVESTOR_ROLE,
      tokenHash,
      state: 'pending',
      message: input.message?.trim() || null,
      invitedBy: input.createdBy ?? null,
      expiresAt,
    })
    .returning({ id: invitations.id });
  if (!invitation) throw new InvestorAccessError('The invitation could not be created.', 500);

  // `member_kind: 'email'` because an invited investor has no user row and never
  // needs one — the token is the credential. `state: 'invited'` until they open
  // it; never deleted, because who WAS on a thing is what an audit asks.
  await db
    .insert(memberships)
    .values({
      tenantId,
      objectId,
      memberKind: 'email',
      memberRef: recipientEmail,
      role: INVESTOR_ROLE,
      state: 'invited',
      metadata: { grantId: grant.id, recipientName, firmPartyRef: metadata.firmPartyRef },
    })
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.objectId, memberships.memberKind, memberships.memberRef],
      // Re-inviting somebody who left is the same person rejoining, not a second
      // row — the unique index says so and this honours it.
      set: { role: INVESTOR_ROLE, state: 'invited', metadata: { grantId: grant.id, recipientName, firmPartyRef: metadata.firmPartyRef }, updatedAt: new Date() },
    });

  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: INVESTOR_ACCESS_VERBS.invited,
    targetType: TARGET_TYPE,
    targetId: String(company.id),
    targetLabel: company.name,
    objectId,
    metadata: {
      grantId: grant.id,
      recipientEmail,
      firmPartyRef: metadata.firmPartyRef,
      permission,
      ndaRequired,
      rooms: rooms.length,
    },
  });

  return {
    grantId: grant.id,
    invitationId: invitation.id,
    token,
    companyId: company.id,
    recipientEmail,
    permission,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    ndaState: ndaRequired ? 'pending' : 'not-required',
    ndaSignatureRequestId,
    downloadRefusedByWatermark: requestedDownload && permission === 'view',
  };
}

async function companyRooms(db: Db, tenantId: number, companyId: number) {
  return db
    .select({
      id: dataRooms.id,
      name: dataRooms.name,
      status: dataRooms.status,
      purpose: dataRooms.purpose,
      ndaRequired: dataRooms.ndaRequired,
      watermark: dataRooms.watermark,
      expiresAt: dataRooms.expiresAt,
    })
    .from(dataRooms)
    .where(scopedToTenant(dataRooms, tenantId, eq(dataRooms.companyId, companyId)))
    .orderBy(desc(dataRooms.updatedAt))
    .limit(50);
}

/** The live grant this recipient holds on this company object, if any. */
async function activeGrantFor(db: Db, tenantId: number, objectId: string, recipientEmail: string) {
  const rows = await db
    .select({
      id: shareLinks.id,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      metadata: shareLinks.metadata,
    })
    .from(shareLinks)
    .where(scopedToTenant(shareLinks, tenantId, eq(shareLinks.objectId, objectId)))
    .limit(200);
  return rows.find((row) => {
    const meta = grantMetadata(row.metadata);
    return meta?.recipientEmail === recipientEmail && shareGrantState(row) === 'active';
  }) ?? null;
}

// ---------------------------------------------------------------------------
// The founder's list
// ---------------------------------------------------------------------------

export type NdaState = 'not-required' | 'pending' | 'signed' | 'declined' | 'expired';

/** Derived from the request's own status rather than stored — the reason a grant
 *  cannot report "signed" for an NDA that was declined. Same rule as
 *  `dataRoomSharing.ndaStateFrom`; stated once per module because exporting it
 *  would make one module's internal the other's contract. */
function ndaStateFrom(requestId: number | null, status: string | null): NdaState {
  if (!requestId) return 'not-required';
  if (status === 'completed') return 'signed';
  if (status === 'declined') return 'declined';
  if (status === 'expired' || status === 'cancelled') return 'expired';
  return 'pending';
}

export interface InvestorGrantSummary {
  grantId: string;
  recipientName: string;
  recipientEmail: string;
  firmPartyRef: string | null;
  permission: string;
  state: 'active' | 'revoked' | 'expired';
  ndaState: NdaState;
  /** The `memberships` state — `invited` until they open it, then `active`. */
  membershipState: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** How many of this company's rooms this grant has actually reached. */
  roomsOpened: number;
  documentViews: number;
  lastSeen: string | null;
}

/**
 * Every investor with a grant on this company, and what each has actually done.
 *
 * FOUR queries whatever the grant count is: the grants, their NDAs, their
 * memberships, and one grouped pass over the access log for every room this
 * company owns. The log is grouped by `recipientEmail` because that is the axis
 * IN-2 asks for — a person, not a file.
 */
export async function listCompanyInvestors(
  db: Db,
  env: Env,
  tenantId: number,
  companyId: number,
): Promise<InvestorGrantSummary[]> {
  const objectId = await companyObjectId(db, env, tenantId, companyId);
  const rows = await db
    .select({
      id: shareLinks.id,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      createdAt: shareLinks.createdAt,
      metadata: shareLinks.metadata,
    })
    .from(shareLinks)
    .where(scopedToTenant(shareLinks, tenantId, eq(shareLinks.objectId, objectId)))
    .orderBy(desc(shareLinks.createdAt))
    .limit(200);

  const grants = rows
    .map((row) => ({ row, meta: grantMetadata(row.metadata) }))
    .filter((entry): entry is { row: (typeof rows)[number]; meta: GrantMetadata } => entry.meta != null);
  if (!grants.length) return [];

  const ndaIds = grants.map((g) => g.meta.ndaSignatureRequestId).filter((id): id is number => id != null);
  const rooms = await companyRooms(db, tenantId, companyId);

  const [ndaRows, memberRows, accessRows] = await Promise.all([
    ndaIds.length
      ? db
          .select({ id: signatureRequests.id, status: signatureRequests.status })
          .from(signatureRequests)
          .where(scopedToTenant(signatureRequests, tenantId, inArray(signatureRequests.id, ndaIds)))
      : Promise.resolve([] as Array<{ id: number; status: string }>),
    db
      .select({ memberRef: memberships.memberRef, state: memberships.state, lastSeenAt: memberships.lastSeenAt })
      .from(memberships)
      .where(scopedToTenant(
        memberships,
        tenantId,
        eq(memberships.objectId, objectId),
        eq(memberships.memberKind, 'email'),
      ))
      .limit(400),
    rooms.length
      ? db
          .select({
            recipient: sql<string>`coalesce(${activityLog.metadata} ->> 'recipientEmail', 'unknown')`,
            verb: activityLog.verb,
            count: sql<number>`count(*)::int`,
            lastSeen: sql<string | null>`max(${activityLog.occurredAt})`,
          })
          .from(activityLog)
          .where(scopedToTenant(
            activityLog,
            tenantId,
            eq(activityLog.targetType, 'data_room'),
            inArray(activityLog.targetId, rooms.map((room) => String(room.id))),
            inArray(activityLog.verb, [DATA_ROOM_VERBS.opened, DATA_ROOM_VERBS.document]),
          ))
          .groupBy(sql`coalesce(${activityLog.metadata} ->> 'recipientEmail', 'unknown')`, activityLog.verb)
      : Promise.resolve([] as Array<{ recipient: string; verb: string; count: number; lastSeen: string | null }>),
  ]);

  const ndaById = new Map(ndaRows.map((row) => [row.id, row.status]));
  const memberByRef = new Map(memberRows.map((row) => [row.memberRef, row]));

  return grants.map(({ row, meta }) => {
    const mine = accessRows.filter((entry) => entry.recipient === meta.recipientEmail);
    const of = (verb: string) => mine.find((entry) => entry.verb === verb)?.count ?? 0;
    const lastSeen = mine.reduce<string | null>((latest, entry) => {
      const seen = entry.lastSeen ? new Date(entry.lastSeen).toISOString() : null;
      return seen && (!latest || seen > latest) ? seen : latest;
    }, null);
    return {
      grantId: row.id,
      recipientName: meta.recipientName,
      recipientEmail: meta.recipientEmail,
      firmPartyRef: meta.firmPartyRef,
      permission: meta.permission,
      state: shareGrantState(row),
      ndaState: ndaStateFrom(meta.ndaSignatureRequestId, ndaById.get(meta.ndaSignatureRequestId ?? -1) ?? null),
      membershipState: memberByRef.get(meta.recipientEmail)?.state ?? null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      roomsOpened: of(DATA_ROOM_VERBS.opened),
      documentViews: of(DATA_ROOM_VERBS.document),
      lastSeen,
    };
  });
}

// ---------------------------------------------------------------------------
// Revoking — one decision
// ---------------------------------------------------------------------------

/**
 * Revoke an investor's access to a company, everywhere.
 *
 * Two statements, one decision. The FIRST is the enforcement point — the grant is
 * the only row `openCompanyRoom` reads to decide whether access still stands, so
 * with it revoked no further room can be derived or opened. The SECOND stamps the
 * per-room rows already derived: the public data-room route reads the DERIVED row
 * directly, and a derived row that outlived its grant would keep answering.
 *
 * The sweep is by (this company's rooms × this recipient) rather than by a
 * pointer column, and that is a deliberate widening rather than an approximation:
 * "revoke Ascent Partners" means they are out of this company, so a room-level
 * share minted to the same address by hand goes with it.
 */
export async function revokeCompanyInvestor(
  db: Db,
  env: Env,
  tenantId: number,
  companyId: number,
  grantId: string,
  actor: ActorIdentity,
): Promise<{ roomSharesRevoked: number }> {
  const objectId = await companyObjectId(db, env, tenantId, companyId);
  const now = new Date();

  const [grant] = await db
    .update(shareLinks)
    .set({ revokedAt: now, updatedAt: now })
    .where(scopedToTenant(
      shareLinks,
      tenantId,
      eq(shareLinks.id, grantId),
      eq(shareLinks.objectId, objectId),
      sql`${shareLinks.revokedAt} IS NULL`,
    ))
    .returning({ id: shareLinks.id, metadata: shareLinks.metadata });
  if (!grant) throw new InvestorAccessError('No live grant with that id on this company.', 404);

  const meta = grantMetadata(grant.metadata);
  const recipientEmail = meta?.recipientEmail ?? null;

  const rooms = await companyRooms(db, tenantId, companyId);
  let roomSharesRevoked = 0;
  if (recipientEmail && rooms.length) {
    const stamped = await db
      .update(dataRoomShares)
      .set({ revokedAt: now })
      .where(scopedToTenant(
        dataRoomShares,
        tenantId,
        inArray(dataRoomShares.dataRoomId, rooms.map((room) => room.id)),
        eq(dataRoomShares.recipientEmail, recipientEmail),
        sql`${dataRoomShares.revokedAt} IS NULL`,
      ))
      .returning({ id: dataRoomShares.id });
    roomSharesRevoked = stamped.length;
  }

  // The invitation and the membership follow the decision. Neither is read by
  // enforcement — they are the DIRECTORY, which is what makes "who has access"
  // answerable after the credential is gone.
  if (recipientEmail) {
    await Promise.all([
      db
        .update(invitations)
        .set({ state: 'revoked', revokedAt: now, updatedAt: now })
        .where(scopedToTenant(
          invitations,
          tenantId,
          eq(invitations.objectId, objectId),
          eq(invitations.email, recipientEmail),
          eq(invitations.state, 'pending'),
        )),
      db
        .update(memberships)
        .set({ state: 'removed', updatedAt: now })
        .where(scopedToTenant(
          memberships,
          tenantId,
          eq(memberships.objectId, objectId),
          eq(memberships.memberKind, 'email'),
          eq(memberships.memberRef, recipientEmail),
        )),
    ]);
  }

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: INVESTOR_ACCESS_VERBS.revoked,
    targetType: TARGET_TYPE,
    targetId: String(companyId),
    objectId,
    metadata: { grantId, recipientEmail, roomSharesRevoked },
  });

  return { roomSharesRevoked };
}

// ---------------------------------------------------------------------------
// The investor's side — no session, the token is the credential
// ---------------------------------------------------------------------------

export interface ResolvedInvestorGrant {
  tenantId: number;
  companyId: number;
  companyName: string;
  recipientName: string;
  recipientEmail: string;
  permission: 'view' | 'download';
  ndaState: NdaState;
  expiresAt: string | null;
  /** Every room this grant reaches — including rooms created after it was
   *  minted, which is half the point of a company-level grant. */
  rooms: Array<{ id: number; name: string; purpose: string | null; ndaRequired: boolean; watermark: boolean }>;
}

export type InvestorGrantResolution =
  | { outcome: 'ok'; grant: ResolvedInvestorGrant }
  | { outcome: 'invalid' }
  | { outcome: 'nda-pending'; companyName: string; ndaState: NdaState };

/** Internal: the grant row a presented token resolves to, before any policy. */
async function grantByToken(db: Db, token: string) {
  const clean = token.trim();
  if (!clean || clean.length > 128) return null;
  const tokenHash = await hashShareToken(clean);
  const [row] = await db
    .select({
      id: shareLinks.id,
      tenantId: shareLinks.tenantId,
      objectId: shareLinks.objectId,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      metadata: shareLinks.metadata,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(shareLinks)
    // The company the grant is ON. `share_links.object_id` is the registry uuid,
    // and `companies.object_id` is the same uuid — so this join is the reason a
    // grant cannot be minted against a company that was never registered.
    //
    // Joined on the TENANT as well, even though `objects.id` is globally unique and
    // the resolved tenant comes off the grant row: this read is a declared
    // cross-tenant lookup, so the one predicate that keeps a grant and its company
    // in the same workspace should be stated rather than inferred from a uuid.
    .innerJoin(companies, and(eq(companies.objectId, shareLinks.objectId), eq(companies.tenantId, shareLinks.tenantId)))
    .where(acrossTenants(shareLinks, 'share_token', eq(shareLinks.tokenHash, tokenHash)))
    .limit(1);
  if (!row) return null;
  const meta = grantMetadata(row.metadata);
  if (!meta) return null;
  return { ...row, meta };
}

/**
 * Resolve a company grant into the company and every room it reaches.
 *
 * A DECLARED cross-tenant read for the `share_token` reason, same as
 * `resolveDataRoomShare` and `resolveLegalDocumentShare`: the token is the
 * credential and carries no session, so the row it resolves to reports the tenant
 * rather than the caller asserting one.
 *
 * `invalid` collapses "no such token", "revoked" and "expired" into one answer,
 * for the same reason the room's resolve does — telling an unauthenticated caller
 * that a token EXISTED and has lapsed is more than they need to try again. The
 * NDA gate is the exception: it is not a refusal, it is one thing left to do, so
 * it is reported as itself.
 */
export async function resolveInvestorGrant(db: Db, env: Env, token: string): Promise<InvestorGrantResolution> {
  const row = await grantByToken(db, token);
  if (!row) return { outcome: 'invalid' };
  if (shareGrantState(row) !== 'active') return { outcome: 'invalid' };

  let ndaStatus: string | null = null;
  if (row.meta.ndaSignatureRequestId != null) {
    const [nda] = await db
      .select({ status: signatureRequests.status })
      .from(signatureRequests)
      .where(scopedToTenant(signatureRequests, row.tenantId, eq(signatureRequests.id, row.meta.ndaSignatureRequestId)))
      .limit(1);
    ndaStatus = nda?.status ?? null;
  }
  const ndaState = ndaStateFrom(row.meta.ndaSignatureRequestId, ndaStatus);
  if (ndaState !== 'not-required' && ndaState !== 'signed') {
    return { outcome: 'nda-pending', companyName: row.companyName, ndaState };
  }

  const rooms = (await companyRooms(db, row.tenantId, row.companyId)).filter((room) => room.status !== 'closed');

  // The membership stops being 'invited' the first time the grant is actually
  // opened — the state transition `memberships` documents, written where it
  // becomes true rather than assumed at mint time.
  await db
    .update(memberships)
    .set({ state: 'active', joinedAt: sql`coalesce(${memberships.joinedAt}, now())`, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(
      memberships,
      row.tenantId,
      eq(memberships.objectId, row.objectId),
      eq(memberships.memberKind, 'email'),
      eq(memberships.memberRef, row.meta.recipientEmail),
    ));

  // The invitation is accepted by the same act, for the same reason.
  await db
    .update(invitations)
    .set({ state: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(
      invitations,
      row.tenantId,
      eq(invitations.objectId, row.objectId),
      eq(invitations.email, row.meta.recipientEmail),
      eq(invitations.state, 'pending'),
    ));

  await recordActivity(env, db, {
    tenantId: row.tenantId,
    actor: SYSTEM_ACTOR,
    verb: 'company.investor_opened',
    targetType: TARGET_TYPE,
    targetId: String(row.companyId),
    targetLabel: row.companyName,
    objectId: row.objectId,
    metadata: { grantId: row.id, recipientEmail: row.meta.recipientEmail },
  });

  return {
    outcome: 'ok',
    grant: {
      tenantId: row.tenantId,
      companyId: row.companyId,
      companyName: row.companyName,
      recipientName: row.meta.recipientName,
      recipientEmail: row.meta.recipientEmail,
      permission: row.meta.permission,
      ndaState,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        purpose: room.purpose ?? null,
        ndaRequired: room.ndaRequired,
        watermark: room.watermark,
      })),
    },
  };
}

/**
 * Open one of the company's rooms through the company grant.
 *
 * This is where derivation happens, and it happens LAZILY so a room built after
 * the grant was issued is reached by it. Four steps, in this order:
 *
 *   1. Resolve the GRANT and test it. One revoked row upstream ends every room.
 *   2. Check the room belongs to this grant's company. A room id from elsewhere
 *      is a 404, not a read.
 *   3. Ensure the derived `data_room_shares` row exists, carrying the grant's ONE
 *      NDA request, ONE recipient identity (the watermark) and ONE expiry.
 *   4. Hand the DERIVED plaintext token to `resolveDataRoomShare` — which applies
 *      the NDA gate, both expiry clocks, the watermark rule and the access log
 *      that already exist, rather than a second copy of them written here.
 */
export async function openCompanyRoom(
  db: Db,
  env: Env,
  token: string,
  dataRoomId: number,
): Promise<DataRoomResolution> {
  const row = await grantByToken(db, token);
  if (!row) return { outcome: 'invalid' };
  if (shareGrantState(row) !== 'active') return { outcome: 'invalid' };

  const [room] = await db
    .select({ id: dataRooms.id, expiresAt: dataRooms.expiresAt })
    .from(dataRooms)
    .where(scopedToTenant(
      dataRooms,
      row.tenantId,
      eq(dataRooms.id, dataRoomId),
      eq(dataRooms.companyId, row.companyId),
    ))
    .limit(1);
  if (!room) return { outcome: 'invalid' };

  const derivedToken = derivedRoomToken(token.trim(), room.id);
  const derivedHash = await sha256Hex(derivedToken);
  // The share's own lapse can be earlier than the room's and never later, the
  // same bound `shareDataRoom` applies — the room's clock is tested again on
  // resolve either way.
  const expiresAt = row.expiresAt && (!room.expiresAt || row.expiresAt < room.expiresAt) ? row.expiresAt : room.expiresAt;

  // Idempotent on the token hash: opening the same room twice is one row, and a
  // grant whose expiry or NDA moved since the last open re-syncs on this write
  // rather than leaving a stale copy behind.
  await db
    .insert(dataRoomShares)
    .values({
      tenantId: row.tenantId,
      dataRoomId: room.id,
      tokenHash: derivedHash,
      recipientName: row.meta.recipientName,
      recipientEmail: row.meta.recipientEmail,
      firmPartyRef: row.meta.firmPartyRef,
      permission: row.meta.permission,
      ndaSignatureRequestId: row.meta.ndaSignatureRequestId,
      expiresAt,
      // Whose act derived this. The grant's own creator, so the room's share list
      // attributes it to the person who invited the investor.
      createdBy: null,
    })
    .onConflictDoUpdate({
      target: dataRoomShares.tokenHash,
      set: {
        ndaSignatureRequestId: row.meta.ndaSignatureRequestId,
        permission: row.meta.permission,
        expiresAt,
        recipientName: row.meta.recipientName,
        recipientEmail: row.meta.recipientEmail,
      },
    });

  return resolveDataRoomShare(db, env, derivedToken);
}

/** The plaintext token for one document read through a company grant. The public
 *  document route already streams bytes for a data-room token; a grant holder's
 *  read is the same call with the derived token, so no second byte path exists. */
export function derivedTokenFor(grantToken: string, dataRoomId: number): string {
  return derivedRoomToken(grantToken.trim(), dataRoomId);
}

// ---------------------------------------------------------------------------
// Company-level analytics — one row per PERSON, across every room
// ---------------------------------------------------------------------------

export interface CompanyInvestorAnalytics {
  companyId: number;
  opens: number;
  documentViews: number;
  /** One row per investor, most-engaged first — "which firm is actually in
   *  diligence", which a per-room read cannot answer. */
  investors: Array<{
    recipientEmail: string;
    opens: number;
    documentViews: number;
    roomsReached: number;
    lastSeen: string | null;
  }>;
  /** One row per document, across every room. `documentId` is the room-prefixed
   *  form (`dd:12` / `legal:<uuid>`) the room's own analytics use. */
  documents: Array<{ documentId: string; label: string; views: number; lastViewedAt: string | null }>;
}

export async function companyInvestorAnalytics(
  db: Db,
  tenantId: number,
  companyId: number,
): Promise<CompanyInvestorAnalytics> {
  const rooms = await companyRooms(db, tenantId, companyId);
  if (!rooms.length) return { companyId, opens: 0, documentViews: 0, investors: [], documents: [] };

  const scope = [scopedToTenant(
    activityLog,
    tenantId,
    eq(activityLog.targetType, 'data_room'),
    inArray(activityLog.targetId, rooms.map((room) => String(room.id))),
    inArray(activityLog.verb, [DATA_ROOM_VERBS.opened, DATA_ROOM_VERBS.document]),
  )];

  const [totals, byInvestor, byDocument] = await Promise.all([
    db
      .select({ verb: activityLog.verb, count: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(and(...scope))
      .groupBy(activityLog.verb),
    db
      .select({
        recipient: sql<string>`coalesce(${activityLog.metadata} ->> 'recipientEmail', 'unknown')`,
        verb: activityLog.verb,
        count: sql<number>`count(*)::int`,
        rooms: sql<number>`count(distinct ${activityLog.targetId})::int`,
        lastSeen: sql<string | null>`max(${activityLog.occurredAt})`,
      })
      .from(activityLog)
      .where(and(...scope))
      .groupBy(sql`coalesce(${activityLog.metadata} ->> 'recipientEmail', 'unknown')`, activityLog.verb),
    db
      .select({
        documentId: sql<string>`${activityLog.metadata} ->> 'documentId'`,
        label: sql<string>`max(${activityLog.metadata} ->> 'label')`,
        views: sql<number>`count(*)::int`,
        lastViewedAt: sql<string | null>`max(${activityLog.occurredAt})`,
      })
      .from(activityLog)
      .where(and(...scope, eq(activityLog.verb, DATA_ROOM_VERBS.document)))
      .groupBy(sql`${activityLog.metadata} ->> 'documentId'`)
      .orderBy(sql`count(*) desc`)
      .limit(100),
  ]);

  const investors = new Map<string, CompanyInvestorAnalytics['investors'][number]>();
  for (const row of byInvestor) {
    const entry = investors.get(row.recipient)
      ?? { recipientEmail: row.recipient, opens: 0, documentViews: 0, roomsReached: 0, lastSeen: null };
    if (row.verb === DATA_ROOM_VERBS.opened) entry.opens += row.count;
    else entry.documentViews += row.count;
    entry.roomsReached = Math.max(entry.roomsReached, row.rooms);
    const seen = row.lastSeen ? new Date(row.lastSeen).toISOString() : null;
    if (seen && (!entry.lastSeen || seen > entry.lastSeen)) entry.lastSeen = seen;
    investors.set(row.recipient, entry);
  }

  const total = (verb: string) => totals.find((row) => row.verb === verb)?.count ?? 0;

  return {
    companyId,
    opens: total(DATA_ROOM_VERBS.opened),
    documentViews: total(DATA_ROOM_VERBS.document),
    investors: [...investors.values()].sort((a, b) => b.documentViews - a.documentViews),
    documents: byDocument
      .filter((row) => row.documentId)
      .map((row) => ({
        documentId: row.documentId,
        label: row.label ?? '',
        views: row.views,
        lastViewedAt: row.lastViewedAt ? new Date(row.lastViewedAt).toISOString() : null,
      })),
  };
}

/** Re-exported so a route can translate either failure with one `instanceof`
 *  ladder rather than importing two modules to catch two shapes of the same
 *  "that company is not here". */
export { CompanyError };
