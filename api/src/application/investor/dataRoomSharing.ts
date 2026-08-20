/**
 * The data room, actually sent — and the three columns that stop being decoration.
 *
 * ── WHAT THIS CLOSES (FO-E2) ─────────────────────────────────────────────────
 * `data_rooms` has carried `nda_required`, `watermark` and `expires_at` since
 * migration 0422 and NOTHING read any of the three. There was no share flow, no
 * access log and no view analytics, so the properties that make a data room safe
 * to send were words in a schema. `dataRoom.share` was a GATED canvas act — a
 * human could approve it — with nothing behind the gate.
 *
 * Each column now has exactly one enforcement point, and they are all in
 * {@link resolveDataRoomShare}, because a policy evaluated in two places is a
 * policy with two answers:
 *
 *   `expires_at`   — the SHARE's own lapse and the ROOM's are both tested, so
 *                    shortening the room shortens every link into it. Shared with
 *                    every other share-bearing table through `shareGrantState`.
 *   `nda_required` — the link resolves to "NDA pending" rather than to documents
 *                    until the `signature_requests` row it is bound to reports
 *                    `completed`. The NDA itself is the `mutual-nda` entry in the
 *                    ONE template registry (`documentTemplates.ts`) — a second NDA
 *                    body written here would be the duplicate that rule forbids.
 *   `watermark`    — a watermarked room cannot mint a `download` share, and its
 *                    text documents are stamped with the recipient and the instant
 *                    on the way out. A binary (a PDF, a spreadsheet) cannot be
 *                    stamped in a Worker, so it is served INLINE only and the
 *                    honest limit is stated to the recipient rather than implied
 *                    by a column nobody enforces.
 *
 * ── WHY THE ACCESS LOG IS `activity_log` AND NOT A TABLE HERE ────────────────
 * `activity_log` is THE audit store (migration 0295) and is already indexed on
 * (tenant_id, target_type, target_id) — exactly the access path "every event for
 * this room" needs. A private access table would be a second audit stream that
 * `/api/objects/:id/activity` could not see, which is the drift the consolidation
 * exists to prevent. {@link dataRoomAnalytics} is a grouped read over it.
 *
 * ── WHAT A ROOM CONTAINS ─────────────────────────────────────────────────────
 * The documents are the `due_diligence_documents` hanging off the room's own
 * checklists — the OBLIGATION and, where one has been provided, the `artifacts`
 * row behind it. That is deliberate: a data room that listed only the files that
 * exist would hide the gap it was built to close, which is the same argument the
 * canvas card's `documents` hint already makes for its "missing" rows.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  activityLog,
  artifacts,
  dataRoomShares,
  dataRooms,
  dueDiligenceChecklists,
  dueDiligenceDocuments,
  legalDocumentFiles,
  signatureRequests,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import { hashShareToken, mintShareToken, shareGrantState } from '../security/shareToken';
import { WatermarkError, canWatermark, watermarkDocument } from '../security/documentWatermark';
import { loadAndDecryptArtifact } from '../artifacts/artifactStore';
import { sendTemplatedDocument } from '../legal/templateSigning';

export class DataRoomError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DataRoomError';
  }
}

/** Verbs this module writes. Named once so the analytics read and the writes
 *  cannot drift apart — the failure that leaves a dashboard reading zero while
 *  the log fills up. */
export const DATA_ROOM_VERBS = {
  shared: 'data_room.shared',
  revoked: 'data_room.share_revoked',
  opened: 'data_room.share_viewed',
  document: 'data_room.document_viewed',
} as const;

const TARGET_TYPE = 'data_room';

/**
 * A document's address INSIDE a room, and what kind of row it is.
 *
 * A room now holds two shapes: a diligence OBLIGATION (`due_diligence_documents`,
 * an integer id) and a legal FILE (`legal_document_files`, a uuid). One namespace
 * over both rather than two endpoints, because a recipient opening a data room
 * does not care which table a document came from — and a prefixed id is what lets
 * the analytics group over one column instead of two.
 */
export type DataRoomDocumentRef = { source: 'diligence'; id: number } | { source: 'legal'; id: string };

export const dataRoomDocumentId = (ref: DataRoomDocumentRef): string =>
  ref.source === 'legal' ? `legal:${ref.id}` : `dd:${ref.id}`;

/** Parse one back. Null for anything that is not one of the two shapes, so a
 *  hand-typed id is a 404 rather than a query with a NaN in it. */
export function parseDataRoomDocumentId(raw: string): DataRoomDocumentRef | null {
  const value = raw.trim();
  if (value.startsWith('legal:')) {
    const id = value.slice(6);
    return /^[0-9a-f-]{36}$/i.test(id) ? { source: 'legal', id } : null;
  }
  const numeric = value.startsWith('dd:') ? value.slice(3) : value;
  const id = Number(numeric);
  return Number.isInteger(id) && id > 0 ? { source: 'diligence', id } : null;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface ShareDataRoomInput {
  dataRoomId: number;
  recipientName: string;
  recipientEmail: string;
  /** The FIRM as a `party_roles.party_ref`, so a view joins to the same investor
   *  object the raise pipeline uses (FO-A1/FO-E1). */
  firmPartyRef?: string | null;
  permission?: 'view' | 'download';
  expiresAt?: string | null;
  /** Governing law for the NDA, when the room requires one. */
  jurisdiction?: string | null;
  /** What the recipient may use the material for. Narrow beats broad. */
  purpose?: string | null;
  actor: ActorIdentity;
  createdBy?: string | null;
}

export interface CreatedDataRoomShare {
  shareId: string;
  /** The plaintext credential, exactly once — only the hash is stored. */
  token: string;
  permission: 'view' | 'download';
  expiresAt: string | null;
  /** 'not-required' | 'pending'. Never 'signed' at mint time: an NDA that has just
   *  been sent has not been answered. */
  ndaState: 'not-required' | 'pending';
  ndaSignatureRequestId: number | null;
  /** True when the room watermarks and the requested `download` was refused —
   *  reported rather than silently downgraded, so a caller can say why. */
  downloadRefusedByWatermark: boolean;
}

async function loadRoom(db: Db, tenantId: number, dataRoomId: number) {
  const [room] = await db
    .select({
      id: dataRooms.id,
      objectId: dataRooms.objectId,
      name: dataRooms.name,
      status: dataRooms.status,
      ndaRequired: dataRooms.ndaRequired,
      watermark: dataRooms.watermark,
      expiresAt: dataRooms.expiresAt,
      companyId: dataRooms.companyId,
    })
    .from(dataRooms)
    .where(scopedToTenant(dataRooms, tenantId, eq(dataRooms.id, dataRoomId)))
    .limit(1);
  if (!room) throw new DataRoomError('No data room with that id in this workspace.', 404);
  return room;
}

/**
 * Share a room with one firm.
 *
 * The NDA is sent FIRST and the link is minted bound to it, rather than the other
 * way round: a link that exists before the agreement that gates it is a link
 * somebody can forward in the window between the two calls.
 */
export async function shareDataRoom(
  db: Db,
  env: Env,
  tenantId: number,
  input: ShareDataRoomInput,
): Promise<CreatedDataRoomShare> {
  const room = await loadRoom(db, tenantId, input.dataRoomId);
  if (room.status === 'closed') {
    throw new DataRoomError('This data room is closed. Re-open it before sharing — a closed room that still issues links is a control nobody is applying.', 409);
  }

  const recipientName = input.recipientName?.trim();
  const recipientEmail = input.recipientEmail?.trim().toLowerCase();
  if (!recipientName || !recipientEmail?.includes('@')) {
    throw new DataRoomError('A data-room share needs a named recipient and a real address — this is who the NDA and the access log are about.', 400);
  }

  // A watermarked room cannot hand out an un-watermarked copy. Refused rather than
  // downgraded quietly, so the caller can tell the user what happened.
  const requestedDownload = input.permission === 'download';
  const permission: 'view' | 'download' = requestedDownload && !room.watermark ? 'download' : 'view';

  const shareExpiry = input.expiresAt ? new Date(input.expiresAt) : null;
  if (shareExpiry && Number.isNaN(shareExpiry.getTime())) throw new DataRoomError('expiresAt is not a date.', 400);
  // A share can lapse before the room and never after it: the room's clock is the
  // outer bound, and a link outliving it would be the column not being enforced.
  const expiresAt = room.expiresAt && (!shareExpiry || room.expiresAt < shareExpiry) ? room.expiresAt : shareExpiry;

  let ndaSignatureRequestId: number | null = null;
  if (room.ndaRequired) {
    const sent = await sendTemplatedDocument(db, env, tenantId, {
      templateKey: 'mutual-nda',
      values: {
        companyName: room.name,
        counterparty: recipientName,
        ...(input.purpose ? { purpose: input.purpose } : {}),
        jurisdiction: input.jurisdiction?.trim() || 'the jurisdiction stated in the parties’ correspondence',
      },
      parties: [{ name: recipientName, email: recipientEmail, partyRef: input.firmPartyRef ?? null }],
      subject: `NDA — ${room.name} data room`,
      ...(room.objectId ? { objectId: room.objectId } : {}),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      createdBy: input.createdBy ?? null,
    });
    ndaSignatureRequestId = sent.requestId;
  }

  const { token, tokenHash } = await mintShareToken();
  const [row] = await db
    .insert(dataRoomShares)
    .values({
      tenantId,
      dataRoomId: room.id,
      tokenHash,
      recipientName,
      recipientEmail,
      firmPartyRef: input.firmPartyRef?.trim() || null,
      permission,
      ndaSignatureRequestId,
      expiresAt,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: dataRoomShares.id });
  if (!row) throw new DataRoomError('The share link could not be created.', 500);

  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: DATA_ROOM_VERBS.shared,
    targetType: TARGET_TYPE,
    targetId: String(room.id),
    targetLabel: room.name,
    ...(room.objectId ? { objectId: room.objectId } : {}),
    metadata: {
      shareId: row.id,
      permission,
      recipientEmail,
      firmPartyRef: input.firmPartyRef ?? null,
      ndaRequired: room.ndaRequired,
      watermark: room.watermark,
    },
  });

  return {
    shareId: row.id,
    token,
    permission,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    ndaState: room.ndaRequired ? 'pending' : 'not-required',
    ndaSignatureRequestId,
    downloadRefusedByWatermark: requestedDownload && permission === 'view',
  };
}

export async function revokeDataRoomShare(
  db: Db,
  env: Env,
  tenantId: number,
  shareId: string,
  actor: ActorIdentity,
): Promise<void> {
  const [row] = await db
    .update(dataRoomShares)
    .set({ revokedAt: new Date() })
    .where(scopedToTenant(dataRoomShares, tenantId, eq(dataRoomShares.id, shareId), sql`${dataRoomShares.revokedAt} IS NULL`))
    .returning({ id: dataRoomShares.id, dataRoomId: dataRoomShares.dataRoomId, recipientEmail: dataRoomShares.recipientEmail });
  if (!row) throw new DataRoomError('No active share with that id.', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: DATA_ROOM_VERBS.revoked,
    targetType: TARGET_TYPE,
    targetId: String(row.dataRoomId),
    metadata: { shareId, recipientEmail: row.recipientEmail },
  });
}

/** Every link into one room, with what each recipient has actually done. What the
 *  owner reads to answer "who has this, and did they open it". */
export interface DataRoomShareSummary {
  shareId: string;
  recipientName: string | null;
  recipientEmail: string | null;
  firmPartyRef: string | null;
  permission: string;
  state: 'active' | 'revoked' | 'expired';
  ndaState: NdaState;
  expiresAt: string | null;
  createdAt: string;
}

export type NdaState = 'not-required' | 'pending' | 'signed' | 'declined' | 'expired';

/** What the NDA behind a share is doing RIGHT NOW, derived from the request's own
 *  status rather than stored — the reason a room cannot report "signed" for an NDA
 *  that was declined. */
function ndaStateFrom(requestId: number | null, status: string | null): NdaState {
  if (!requestId) return 'not-required';
  if (status === 'completed') return 'signed';
  if (status === 'declined') return 'declined';
  if (status === 'expired' || status === 'cancelled') return 'expired';
  return 'pending';
}

export async function listDataRoomShares(db: Db, tenantId: number, dataRoomId: number): Promise<DataRoomShareSummary[]> {
  await loadRoom(db, tenantId, dataRoomId);
  const rows = await db
    .select({
      id: dataRoomShares.id,
      recipientName: dataRoomShares.recipientName,
      recipientEmail: dataRoomShares.recipientEmail,
      firmPartyRef: dataRoomShares.firmPartyRef,
      permission: dataRoomShares.permission,
      expiresAt: dataRoomShares.expiresAt,
      revokedAt: dataRoomShares.revokedAt,
      createdAt: dataRoomShares.createdAt,
      ndaRequestId: dataRoomShares.ndaSignatureRequestId,
      ndaStatus: signatureRequests.status,
    })
    .from(dataRoomShares)
    .leftJoin(signatureRequests, eq(signatureRequests.id, dataRoomShares.ndaSignatureRequestId))
    .where(scopedToTenant(dataRoomShares, tenantId, eq(dataRoomShares.dataRoomId, dataRoomId)))
    .orderBy(desc(dataRoomShares.createdAt))
    .limit(200);

  return rows.map((row) => ({
    shareId: row.id,
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    firmPartyRef: row.firmPartyRef,
    permission: row.permission,
    state: shareGrantState(row),
    ndaState: ndaStateFrom(row.ndaRequestId, row.ndaStatus),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Reading the rooms — one call, because a card needs all of it at once
// ---------------------------------------------------------------------------

export interface DataRoomSummary {
  id: number;
  objectId: string | null;
  name: string;
  purpose: string | null;
  status: string;
  ndaRequired: boolean;
  watermark: boolean;
  expiresAt: string | null;
  documents: DataRoomDocumentView[];
  /**
   * Share of REQUIRED documents actually provided, 0-100.
   *
   * Derived, never stored. `dataRoom.readiness` was an authored number on the
   * canvas card under a hint that describes exactly this computation — an object
   * documenting a calculation nobody performed. A room with no required documents
   * reads 0 rather than 100: "nothing is required" is an unprepared room, not a
   * complete one.
   */
  readiness: number;
  /** How many PROVIDED documents this room's watermark cannot reach. Zero when the
   *  room does not watermark. */
  unstampable: number;
  activeShares: number;
  opens: number;
  documentViews: number;
}

/**
 * Every room, with its documents, its live links and how much of it has been read.
 *
 * FOUR queries whatever the room count is — the rooms, all their documents, all
 * their shares, and one grouped pass over the access log. A per-room fan-out would
 * be the N+1 that only appears once a workspace has a room per fund.
 */
export async function listDataRooms(db: Db, tenantId: number): Promise<DataRoomSummary[]> {
  const rooms = await db
    .select({
      id: dataRooms.id,
      objectId: dataRooms.objectId,
      name: dataRooms.name,
      purpose: dataRooms.purpose,
      status: dataRooms.status,
      ndaRequired: dataRooms.ndaRequired,
      watermark: dataRooms.watermark,
      expiresAt: dataRooms.expiresAt,
    })
    .from(dataRooms)
    .where(scopedToTenant(dataRooms, tenantId))
    .orderBy(desc(dataRooms.updatedAt))
    .limit(50);
  if (!rooms.length) return [];

  const ids = rooms.map((room) => room.id);
  const [documentsByRoom, shareRows, accessRows] = await Promise.all([
    roomDocumentsByRoom(db, tenantId, ids),
    db
      .select({ dataRoomId: dataRoomShares.dataRoomId, revokedAt: dataRoomShares.revokedAt, expiresAt: dataRoomShares.expiresAt })
      .from(dataRoomShares)
      .where(scopedToTenant(dataRoomShares, tenantId, inArray(dataRoomShares.dataRoomId, ids)))
      .limit(500),
    db
      .select({ targetId: activityLog.targetId, verb: activityLog.verb, count: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(scopedToTenant(
        activityLog,
        tenantId,
        eq(activityLog.targetType, TARGET_TYPE),
        inArray(activityLog.targetId, ids.map(String)),
        inArray(activityLog.verb, [DATA_ROOM_VERBS.opened, DATA_ROOM_VERBS.document]),
      ))
      .groupBy(activityLog.targetId, activityLog.verb),
  ]);

  const activeByRoom = new Map<number, number>();
  for (const row of shareRows) {
    if (shareGrantState(row) !== 'active') continue;
    activeByRoom.set(row.dataRoomId, (activeByRoom.get(row.dataRoomId) ?? 0) + 1);
  }

  const count = (roomId: number, verb: string): number =>
    accessRows.find((row) => row.targetId === String(roomId) && row.verb === verb)?.count ?? 0;

  return rooms.map((room) => {
    const documents = documentsByRoom.get(room.id) ?? [];
    const required = documents.filter((document) => document.required);
    return {
      id: room.id,
      objectId: room.objectId,
      name: room.name,
      purpose: room.purpose,
      status: room.status,
      ndaRequired: room.ndaRequired,
      watermark: room.watermark,
      expiresAt: room.expiresAt ? room.expiresAt.toISOString() : null,
      documents,
      readiness: required.length
        ? Math.round((required.filter((document) => document.available).length / required.length) * 100)
        : 0,
      // What a watermarked room CANNOT stamp — an image, an archive, a binary
      // spreadsheet. Reported on the list rather than discovered when a fund tries
      // to open one, because it is the difference between a control and a surprise:
      // those documents can only ever be served view-only.
      unstampable: room.watermark ? documents.filter((document) => document.available && !document.watermarkable).length : 0,
      activeShares: activeByRoom.get(room.id) ?? 0,
      opens: count(room.id, DATA_ROOM_VERBS.opened),
      documentViews: count(room.id, DATA_ROOM_VERBS.document),
    };
  });
}

// ---------------------------------------------------------------------------
// Resolving — the external half, where all three columns are enforced
// ---------------------------------------------------------------------------

export interface DataRoomDocumentView {
  /** Prefixed — `dd:12` or `legal:<uuid>`. See {@link dataRoomDocumentId}. */
  documentId: string;
  /** Which table it came from. Surfaced so an owner's card can say "this room
   *  holds four obligations and two executed files" rather than six of something. */
  source: 'diligence' | 'legal';
  label: string;
  category: string;
  status: string;
  required: boolean;
  /** False when the obligation exists and the file has not been provided. Listed
   *  anyway: a room that hides its gaps is a room nobody can chase. */
  available: boolean;
  mime: string | null;
  sizeBytes: number | null;
  /**
   * False when this file's format cannot carry the stamp at all (an image, an
   * archive, a binary spreadsheet).
   *
   * Reported on the LIST rather than discovered at the moment somebody opens one,
   * because it is a fact the room's owner needs BEFORE they share: in a
   * watermarked room these are the documents that can only ever be served
   * view-only, and knowing which they are is the difference between a control and
   * a surprise.
   */
  watermarkable: boolean;
}

export interface ResolvedDataRoomShare {
  shareId: string;
  tenantId: number;
  dataRoomId: number;
  roomName: string;
  recipientName: string | null;
  recipientEmail: string | null;
  permission: 'view' | 'download';
  /** True when every document is stamped or restricted to inline reading. */
  watermark: boolean;
  /** What the stamp says — the recipient and the instant. Null when the room does
   *  not watermark. */
  watermarkLabel: string | null;
  ndaState: NdaState;
  expiresAt: string | null;
  documents: DataRoomDocumentView[];
}

export type DataRoomResolution =
  | { outcome: 'ok'; share: ResolvedDataRoomShare }
  | { outcome: 'invalid' }
  | { outcome: 'nda-pending'; roomName: string; ndaState: NdaState };

/**
 * Resolve an external token into the room it opens.
 *
 * A DECLARED cross-tenant read for the `share_token` reason, same as
 * `signatureEngine.resolveSigner` and `resolveLegalDocumentShare`: the token is
 * the credential and carries no session, so the row it resolves to reports the
 * tenant rather than the caller asserting one.
 *
 * `invalid` deliberately collapses "no such token", "revoked" and "expired" into
 * one answer for the recipient. Which it was is in the owner's own share list and
 * in the activity log; telling an unauthenticated caller that a token EXISTED and
 * has lapsed is more than they need to try again.
 */
export async function resolveDataRoomShare(db: Db, env: Env, token: string, options: { log?: boolean } = {}): Promise<DataRoomResolution> {
  const clean = token.trim();
  if (!clean || clean.length > 128) return { outcome: 'invalid' };
  const tokenHash = await hashShareToken(clean);

  const [row] = await db
    .select({
      shareId: dataRoomShares.id,
      tenantId: dataRoomShares.tenantId,
      dataRoomId: dataRoomShares.dataRoomId,
      permission: dataRoomShares.permission,
      recipientName: dataRoomShares.recipientName,
      recipientEmail: dataRoomShares.recipientEmail,
      shareExpiresAt: dataRoomShares.expiresAt,
      revokedAt: dataRoomShares.revokedAt,
      ndaRequestId: dataRoomShares.ndaSignatureRequestId,
      ndaStatus: signatureRequests.status,
      roomName: dataRooms.name,
      roomStatus: dataRooms.status,
      roomExpiresAt: dataRooms.expiresAt,
      watermark: dataRooms.watermark,
      objectId: dataRooms.objectId,
    })
    .from(dataRoomShares)
    .innerJoin(dataRooms, eq(dataRooms.id, dataRoomShares.dataRoomId))
    .leftJoin(signatureRequests, eq(signatureRequests.id, dataRoomShares.ndaSignatureRequestId))
    .where(acrossTenants(dataRoomShares, 'share_token', eq(dataRoomShares.tokenHash, tokenHash)))
    .limit(1);
  if (!row) return { outcome: 'invalid' };

  // BOTH clocks, and the room's own status. Shortening the room shortens every
  // link into it — which is the whole point of `data_rooms.expires_at` being a
  // column on the room rather than on each share.
  if (shareGrantState({ revokedAt: row.revokedAt, expiresAt: row.shareExpiresAt }) !== 'active') return { outcome: 'invalid' };
  if (shareGrantState({ revokedAt: null, expiresAt: row.roomExpiresAt }) !== 'active') return { outcome: 'invalid' };
  if (row.roomStatus === 'closed') return { outcome: 'invalid' };

  const ndaState = ndaStateFrom(row.ndaRequestId, row.ndaStatus);
  if (ndaState === 'pending' || ndaState === 'declined' || ndaState === 'expired') {
    return { outcome: 'nda-pending', roomName: row.roomName, ndaState };
  }

  const documents = await roomDocuments(db, row.tenantId, row.dataRoomId);

  if (options.log !== false) {
    await recordActivity(env, db, {
      tenantId: row.tenantId,
      actor: SYSTEM_ACTOR,
      verb: DATA_ROOM_VERBS.opened,
      targetType: TARGET_TYPE,
      targetId: String(row.dataRoomId),
      targetLabel: row.roomName,
      ...(row.objectId ? { objectId: row.objectId } : {}),
      metadata: { shareId: row.shareId, recipientEmail: row.recipientEmail },
    });
  }

  const watermarkLabel = row.watermark
    ? `${row.recipientEmail ?? 'recipient'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : null;

  return {
    outcome: 'ok',
    share: {
      shareId: row.shareId,
      tenantId: row.tenantId,
      dataRoomId: row.dataRoomId,
      roomName: row.roomName,
      recipientName: row.recipientName,
      recipientEmail: row.recipientEmail,
      // A watermarked room never serves a download, whatever the share says. The
      // mint refuses it too; enforcing it again here is deliberate, because the
      // room's own setting can be turned ON after a download link was issued.
      permission: row.watermark ? 'view' : (row.permission === 'download' ? 'download' : 'view'),
      watermark: row.watermark,
      watermarkLabel,
      ndaState,
      expiresAt: (row.shareExpiresAt ?? row.roomExpiresAt)?.toISOString() ?? null,
      documents,
    },
  };
}

/**
 * The contents of one room or of many — every diligence obligation AND every legal
 * file in each.
 *
 * TWO shapes, deliberately, because they answer different questions and a fund
 * asks both. An obligation says "we require a cap table" and may have no file
 * behind it yet; a `legal_document_files` row IS the file — the formation
 * certificate, the executed IP assignment — sealed at rest and placeable in a room
 * by its `data_room_id` (0937).
 *
 * BATCHED over room ids on purpose: the room list and the single-room read want the
 * identical rows, and writing the mapping twice is how a card and a share link come
 * to disagree about what is in a room. THREE queries whatever the room count is —
 * the obligations, the legal files, and one artifact read across both. A per-room
 * or per-document fan-out is the N+1 that only appears once a workspace has a room
 * per fund.
 */
async function roomDocumentsByRoom(
  db: Db,
  tenantId: number,
  roomIds: readonly number[],
): Promise<Map<number, DataRoomDocumentView[]>> {
  const byRoom = new Map<number, DataRoomDocumentView[]>();
  if (!roomIds.length) return byRoom;

  const [obligations, files] = await Promise.all([
    db
      .select({
        roomId: dueDiligenceChecklists.dataRoomId,
        id: dueDiligenceDocuments.id,
        label: dueDiligenceDocuments.label,
        status: dueDiligenceDocuments.status,
        required: dueDiligenceDocuments.required,
        position: dueDiligenceDocuments.position,
        artifactId: dueDiligenceDocuments.artifactId,
        category: dueDiligenceChecklists.category,
      })
      .from(dueDiligenceDocuments)
      .innerJoin(dueDiligenceChecklists, eq(dueDiligenceChecklists.id, dueDiligenceDocuments.checklistId))
      .where(scopedToTenant(dueDiligenceDocuments, tenantId, inArray(dueDiligenceChecklists.dataRoomId, [...roomIds])))
      .orderBy(desc(dueDiligenceDocuments.required), dueDiligenceDocuments.position)
      .limit(1000),
    db
      .select({
        roomId: legalDocumentFiles.dataRoomId,
        id: legalDocumentFiles.id,
        label: legalDocumentFiles.title,
        category: legalDocumentFiles.category,
        artifactId: legalDocumentFiles.currentArtifactId,
      })
      .from(legalDocumentFiles)
      .where(scopedToTenant(legalDocumentFiles, tenantId, inArray(legalDocumentFiles.dataRoomId, [...roomIds])))
      .orderBy(desc(legalDocumentFiles.updatedAt))
      .limit(500),
  ]);

  const artifactIds = [...obligations, ...files].map((row) => row.artifactId).filter((id): id is string => !!id);
  const meta = artifactIds.length
    ? await db
        .select({ id: artifacts.id, mime: artifacts.mime, sizeBytes: artifacts.byteSize })
        .from(artifacts)
        .where(scopedToTenant(artifacts, tenantId, inArray(artifacts.id, artifactIds)))
    : [];
  const byId = new Map(meta.map((row) => [row.id, row]));

  const push = (
    roomId: number | null,
    ref: DataRoomDocumentRef,
    row: { label: string; category: string | null; status?: string; required?: boolean; artifactId: string | null },
  ) => {
    if (roomId == null) return;
    const artifact = row.artifactId ? byId.get(row.artifactId) : undefined;
    const list = byRoom.get(roomId) ?? [];
    list.push({
      documentId: dataRoomDocumentId(ref),
      source: ref.source,
      label: row.label,
      category: row.category ?? 'other',
      // A legal file that is IN the room is provided — there is no outstanding
      // obligation behind it that could still be missing.
      status: row.status ?? (artifact ? 'provided' : 'missing'),
      required: row.required ?? false,
      available: Boolean(artifact),
      mime: artifact?.mime ?? null,
      sizeBytes: artifact?.sizeBytes ?? null,
      watermarkable: canWatermark(artifact?.mime ?? null),
    });
    byRoom.set(roomId, list);
  };

  // Obligations first, and required ones above the rest, because the reason to
  // open a diligence list is to find what is still missing.
  for (const row of obligations) push(row.roomId, { source: 'diligence', id: row.id }, row);
  for (const row of files) push(row.roomId, { source: 'legal', id: row.id }, row);
  return byRoom;
}

/** One room's contents. A thin call of the batch above, so a card and a share link
 *  can never be built from two different mappings of the same rows. */
async function roomDocuments(db: Db, tenantId: number, dataRoomId: number): Promise<DataRoomDocumentView[]> {
  return (await roomDocumentsByRoom(db, tenantId, [dataRoomId])).get(dataRoomId) ?? [];
}

export interface DataRoomFile {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  /** True when the bytes were stamped. False for a binary that cannot be, which
   *  the caller reports rather than implying a protection that is not there. */
  stamped: boolean;
  /** 'inline' | 'attachment'. A watermarked room is always inline. */
  disposition: 'inline' | 'attachment';
}

/**
 * One document's bytes, through a share.
 *
 * Every enforcement the room's resolve applies is applied again here, because this
 * endpoint is reachable directly with the token and a check that only runs on the
 * page a recipient happens to load is not a check.
 *
 * ── THE WATERMARK IS NOW APPLIED TO THE BYTES ───────────────────────────────
 * A PDF is stamped diagonally on every page with the reader and the instant, the
 * same as a text document — the first pass could only do the text half, and served
 * a PDF unstamped with the column downgraded to "no download". A format the stamp
 * cannot reach at all (an image, an archive) is still served inline-only, which is
 * the honest remaining control and is reported as `view-only` rather than implied.
 *
 * A PDF that cannot be parsed is REFUSED. Serving it unstamped from a room whose
 * whole promise is the stamp would be the column lying at the one moment it
 * matters.
 */
export async function readDataRoomDocument(
  db: Db,
  env: Env,
  token: string,
  documentId: string,
): Promise<DataRoomFile> {
  const resolution = await resolveDataRoomShare(db, env, token, { log: false });
  if (resolution.outcome !== 'ok') {
    throw new DataRoomError(
      resolution.outcome === 'nda-pending'
        ? 'This data room requires a signed NDA before its documents open. Sign the request you were sent, then reload.'
        : 'This link is no longer valid.',
      resolution.outcome === 'nda-pending' ? 403 : 404,
    );
  }
  const share = resolution.share;

  const ref = parseDataRoomDocumentId(documentId);
  if (!ref) throw new DataRoomError('That is not a document in this data room.', 404);

  const document = ref.source === 'legal'
    ? (await db
        .select({ label: legalDocumentFiles.title, artifactId: legalDocumentFiles.currentArtifactId })
        .from(legalDocumentFiles)
        .where(scopedToTenant(
          legalDocumentFiles,
          share.tenantId,
          eq(legalDocumentFiles.id, ref.id),
          // The room membership is the access predicate, not just the id: a legal
          // file that has been moved OUT of this room must stop resolving through
          // links into it.
          eq(legalDocumentFiles.dataRoomId, share.dataRoomId),
        ))
        .limit(1))[0]
    : (await db
        .select({ label: dueDiligenceDocuments.label, artifactId: dueDiligenceDocuments.artifactId })
        .from(dueDiligenceDocuments)
        .innerJoin(dueDiligenceChecklists, eq(dueDiligenceChecklists.id, dueDiligenceDocuments.checklistId))
        .where(scopedToTenant(
          dueDiligenceDocuments,
          share.tenantId,
          eq(dueDiligenceDocuments.id, ref.id),
          eq(dueDiligenceChecklists.dataRoomId, share.dataRoomId),
        ))
        .limit(1))[0];

  if (!document?.artifactId) throw new DataRoomError('That document is not in this data room, or has not been provided yet.', 404);

  const artifact = await loadAndDecryptArtifact(db, env, share.tenantId, document.artifactId);
  const mime = artifact.mime ?? 'application/octet-stream';

  let bytes = artifact.bytes;
  let stamped = false;
  if (share.watermark) {
    const result = await watermarkDocument(bytes, mime, share.watermarkLabel ?? share.recipientEmail ?? 'recipient', share.roomName);
    bytes = result.bytes;
    stamped = result.outcome === 'stamped';
  }

  await recordActivity(env, db, {
    tenantId: share.tenantId,
    actor: SYSTEM_ACTOR,
    verb: DATA_ROOM_VERBS.document,
    targetType: TARGET_TYPE,
    targetId: String(share.dataRoomId),
    targetLabel: share.roomName,
    metadata: {
      shareId: share.shareId,
      documentId: dataRoomDocumentId(ref),
      label: document.label,
      recipientEmail: share.recipientEmail,
      stamped,
    },
  });

  return {
    filename: document.label,
    mime,
    bytes,
    stamped,
    // A watermarked room never offers "save as" for a format the stamp could not
    // reach: inline is the only remaining control there. A STAMPED file is safe to
    // hand over, because the copy carries the reader's name.
    disposition: share.permission === 'download' && (!share.watermark || stamped) ? 'attachment' : 'inline',
  };
}

// ---------------------------------------------------------------------------
// View analytics — "what did they actually read"
// ---------------------------------------------------------------------------

export interface DataRoomAnalytics {
  dataRoomId: number;
  opens: number;
  documentViews: number;
  /** One row per recipient, so "which firm is actually in diligence" is answerable
   *  rather than inferable from a total. */
  recipients: Array<{ recipientEmail: string; opens: number; documentViews: number; lastSeen: string | null }>;
  /** One row per document, most-read first — the answer to FO-E2's own question:
   *  "sending a data room to a firm and knowing what they actually read". */
  documents: Array<{ documentId: number; label: string; views: number; lastViewedAt: string | null }>;
}

/**
 * The room's reading history, grouped in SQL.
 *
 * Three grouped reads over the one indexed access path rather than pulling every
 * event into memory: a room open for a month is thousands of rows, and "count them
 * in the worker" is the shape that works in a demo and times out in a raise.
 */
export async function dataRoomAnalytics(db: Db, tenantId: number, dataRoomId: number): Promise<DataRoomAnalytics> {
  await loadRoom(db, tenantId, dataRoomId);
  // Built once and SPREAD into each of the three `where`s rather than retyped:
  // three copies of an access predicate is three places to forget the tenant when
  // one of them is later edited, which is the failure `scopedToTenant` exists to
  // make impossible.
  const scope = [scopedToTenant(
    activityLog,
    tenantId,
    eq(activityLog.targetType, TARGET_TYPE),
    eq(activityLog.targetId, String(dataRoomId)),
    inArray(activityLog.verb, [DATA_ROOM_VERBS.opened, DATA_ROOM_VERBS.document]),
  )];

  const [totals, byRecipient, byDocument] = await Promise.all([
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

  const recipients = new Map<string, { recipientEmail: string; opens: number; documentViews: number; lastSeen: string | null }>();
  for (const row of byRecipient) {
    const entry = recipients.get(row.recipient) ?? { recipientEmail: row.recipient, opens: 0, documentViews: 0, lastSeen: null };
    if (row.verb === DATA_ROOM_VERBS.opened) entry.opens += row.count;
    else entry.documentViews += row.count;
    const seen = row.lastSeen ? new Date(row.lastSeen).toISOString() : null;
    if (seen && (!entry.lastSeen || seen > entry.lastSeen)) entry.lastSeen = seen;
    recipients.set(row.recipient, entry);
  }

  const total = (verb: string) => totals.find((row) => row.verb === verb)?.count ?? 0;

  return {
    dataRoomId,
    opens: total(DATA_ROOM_VERBS.opened),
    documentViews: total(DATA_ROOM_VERBS.document),
    recipients: [...recipients.values()].sort((a, b) => b.documentViews - a.documentViews),
    documents: byDocument
      .filter((row) => row.documentId)
      .map((row) => ({
        documentId: Number(row.documentId),
        label: row.label ?? '',
        views: row.views,
        lastViewedAt: row.lastViewedAt ? new Date(row.lastViewedAt).toISOString() : null,
      })),
  };
}
