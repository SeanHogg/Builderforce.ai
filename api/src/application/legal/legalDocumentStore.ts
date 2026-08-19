/**
 * legalDocumentStore.ts — the application-layer home for secure legal FILES.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * The legal seat had record tables (`legal_entities`, `legal_registrations`,
 * `intellectual_property`, `legal_matters`) and nowhere to hold the actual FILE
 * behind any of them — an NDA, a formation certificate, an executed IP
 * assignment. `kernel.artifacts` was clearly built for exactly this (an
 * object-scoped file with a checksum and a rendition chain) but had zero
 * writers anywhere in `api/src`. This is the first one.
 *
 * ── WHY ENCRYPTED, AND WHY HERE RATHER THAN IN `artifacts` GENERICALLY ───────
 * A legal file is the one artifact kind where "stored in R2" is not, on its
 * own, an adequate security bar — `fileCrypto.ts` seals every byte with a
 * per-tenant AES-256-GCM key before it reaches R2, so a raw bucket or database
 * compromise does not hand over plaintext contracts. Every other artifact kind
 * can adopt the same sealing later; this module is where it was actually
 * needed first.
 *
 * ── WHY NO `status` COLUMN ───────────────────────────────────────────────────
 * `legal_document_files` stores no status and no `signedAt`. Both are derived
 * here, at read time, from `legal_document_shares` and the `signature_requests`
 * row `signatureRequestId` points at — the same reasoning `contract`'s own
 * `signatureState` field documents: a header that disagrees with the rows
 * beneath it is a defect, not a feature, so there is no header to disagree.
 *
 * ── WHY RE-UPLOAD NEVER OVERWRITES ───────────────────────────────────────────
 * A new upload creates a NEW `artifacts` row and repoints `currentArtifactId`;
 * the old artifact is left exactly as it was. That is what lets a signature
 * completed against version 3 keep resolving to version 3's exact bytes and
 * checksum after version 4 replaces the file on the card.
 */

import { count, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { artifacts, legalDocumentFiles, legalDocumentShares, signatureRequests } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { credentialSecret } from '../integrations/credentialCrypto';
import { sealBytes } from '../security/fileCrypto';
import { hashShareToken, mintShareToken, shareGrantState } from '../security/shareToken';
import { sha256HexBytes } from '../../domain/shared/hash';
import { recordActivity, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import { createSignatureRequest, type CreatedSignatureRequest } from '../signature/signatureEngine';
import { loadAndDecryptArtifact, loadArtifactRow } from '../artifacts/artifactStore';

export class LegalDocumentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LegalDocumentError';
  }
}

const CATEGORIES = ['nda', 'msa', 'sow', 'offer_letter', 'ip_assignment', 'formation', 'registration', 'other'] as const;
type LegalDocumentCategory = (typeof CATEGORIES)[number];
const isCategory = (v: unknown): v is LegalDocumentCategory =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);

/** A legal file is a document, not a video — bounded so an unbounded upload
 *  from an authenticated-but-hostile caller cannot exhaust the tenant's R2. */
const MAX_BYTES = 25 * 1024 * 1024;

function requireBytesWithinLimit(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new LegalDocumentError('The uploaded file is empty.', 400);
  if (bytes.byteLength > MAX_BYTES) throw new LegalDocumentError('The uploaded file is larger than the 25MB legal-file limit.', 400);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadLegalDocumentInput {
  /** Attach a new version to an existing card. Omit to create one. */
  documentId?: string | null;
  title: string;
  category?: string;
  entityId?: number | null;
  matterId?: number | null;
  ipId?: number | null;
  objectId?: string | null;
  filename: string;
  mime?: string | null;
  bytes: Uint8Array;
  actor: ActorIdentity;
  createdBy?: string | null;
}

export interface UploadedLegalDocument {
  documentId: string;
  artifactId: string;
  checksum: string;
}

export async function uploadLegalDocumentFile(
  db: Db,
  env: Env,
  tenantId: number,
  input: UploadLegalDocumentInput,
): Promise<UploadedLegalDocument> {
  requireBytesWithinLimit(input.bytes);
  const title = input.title.trim().slice(0, 255);
  if (!title) throw new LegalDocumentError('A legal document needs a title.', 400);
  const category = isCategory(input.category) ? input.category : 'other';

  const checksum = await sha256HexBytes(input.bytes);
  const secret = credentialSecret(env);
  const sealed = await sealBytes(input.bytes, secret, tenantId);

  const artifactId = crypto.randomUUID();
  const storageKey = `legal/${tenantId}/${artifactId}.bin`;
  if (!env.UPLOADS) throw new LegalDocumentError('File storage is not configured on this deployment.', 503);
  await env.UPLOADS.put(storageKey, sealed, {
    customMetadata: { tenantId: String(tenantId), artifactId, encrypted: 'true' },
  });

  await db.insert(artifacts).values({
    id: artifactId,
    tenantId,
    objectId: input.objectId ?? null,
    kind: 'legalDocument',
    title,
    mime: input.mime ?? null,
    storageKey,
    byteSize: input.bytes.byteLength,
    checksum,
    attrs: { encrypted: true, filename: input.filename.slice(0, 300) },
    createdBy: input.createdBy ?? null,
  });

  let documentId: string;
  if (input.documentId) {
    const [existing] = await db
      .select({ id: legalDocumentFiles.id })
      .from(legalDocumentFiles)
      .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, input.documentId)))
      .limit(1);
    if (!existing) throw new LegalDocumentError('No such legal document in this workspace.', 404);
    await db
      .update(legalDocumentFiles)
      .set({
        title,
        category,
        entityId: input.entityId ?? null,
        matterId: input.matterId ?? null,
        ipId: input.ipId ?? null,
        currentArtifactId: artifactId,
        updatedAt: new Date(),
      })
      .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, existing.id)));
    documentId = existing.id;
  } else {
    const [row] = await db
      .insert(legalDocumentFiles)
      .values({
        tenantId,
        objectId: input.objectId ?? null,
        entityId: input.entityId ?? null,
        matterId: input.matterId ?? null,
        ipId: input.ipId ?? null,
        title,
        category,
        currentArtifactId: artifactId,
        createdBy: input.createdBy ?? null,
      })
      .returning({ id: legalDocumentFiles.id });
    if (!row) throw new LegalDocumentError('The legal document could not be created.', 500);
    documentId = row.id;
  }

  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: 'legal_document.uploaded',
    targetType: 'legal_document_file',
    targetId: documentId,
    targetLabel: title,
    metadata: { checksum, byteSize: input.bytes.byteLength },
  });

  return { documentId, artifactId, checksum };
}

export interface DownloadedLegalDocument {
  bytes: Uint8Array;
  mime: string | null;
  filename: string;
}

export async function downloadLegalDocumentFile(
  db: Db,
  env: Env,
  tenantId: number,
  documentId: string,
  actor: ActorIdentity,
): Promise<DownloadedLegalDocument> {
  const [doc] = await db
    .select()
    .from(legalDocumentFiles)
    .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, documentId)))
    .limit(1);
  if (!doc || !doc.currentArtifactId) throw new LegalDocumentError('No file uploaded for this legal document yet.', 404);

  const artifact = await loadAndDecryptArtifact(db, env, tenantId, doc.currentArtifactId);
  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'legal_document.downloaded',
    targetType: 'legal_document_file',
    targetId: documentId,
    targetLabel: doc.title,
  });
  return { bytes: artifact.bytes, mime: artifact.mime, filename: doc.title };
}

// ---------------------------------------------------------------------------
// Read — status is DERIVED, never stored
// ---------------------------------------------------------------------------

export interface LegalDocumentDetail {
  id: string;
  title: string;
  category: string;
  entityId: number | null;
  matterId: number | null;
  ipId: number | null;
  objectId: string | null;
  signatureRequestId: number | null;
  createdAt: string;
  updatedAt: string;
  artifact: { id: string; title: string; mime: string | null; byteSize: number | null; checksum: string | null } | null;
  /** 'draft' | 'shared' | 'awaiting_signature' | 'declined' | 'signed'. Computed
   *  from `legal_document_shares` and the signature request every time — never
   *  cached on this row, so it cannot drift from what actually happened. */
  status: string;
  signedAt: string | null;
  activeShares: number;
}

type LegalDocumentFileRow = typeof legalDocumentFiles.$inferSelect;

async function hydrate(db: Db, tenantId: number, doc: LegalDocumentFileRow): Promise<LegalDocumentDetail> {
  let artifact: LegalDocumentDetail['artifact'] = null;
  if (doc.currentArtifactId) {
    const row = await loadArtifactRow(db, tenantId, doc.currentArtifactId);
    if (row) artifact = { id: row.id, title: row.title, mime: row.mime, byteSize: row.byteSize, checksum: row.checksum };
  }

  let signatureStatus: string | null = null;
  let signedAt: string | null = null;
  if (doc.signatureRequestId) {
    const [req] = await db
      .select({ status: signatureRequests.status, completedAt: signatureRequests.completedAt })
      .from(signatureRequests)
      .where(scopedToTenant(signatureRequests, tenantId, eq(signatureRequests.id, doc.signatureRequestId)))
      .limit(1);
    if (req) {
      signatureStatus = req.status;
      signedAt = req.completedAt ? req.completedAt.toISOString() : null;
    }
  }

  const [shareCount] = await db
    .select({ value: count() })
    .from(legalDocumentShares)
    .where(scopedToTenant(legalDocumentShares, tenantId, eq(legalDocumentShares.documentId, doc.id), isNull(legalDocumentShares.revokedAt)));
  const activeShares = Number(shareCount?.value ?? 0);

  const status =
    signatureStatus === 'completed' ? 'signed'
    : signatureStatus === 'declined' ? 'declined'
    : signatureStatus === 'sent' ? 'awaiting_signature'
    : activeShares > 0 ? 'shared'
    : 'draft';

  return {
    id: doc.id,
    title: doc.title,
    category: doc.category,
    entityId: doc.entityId,
    matterId: doc.matterId,
    ipId: doc.ipId,
    objectId: doc.objectId,
    signatureRequestId: doc.signatureRequestId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    artifact,
    status,
    signedAt,
    activeShares,
  };
}

export async function getLegalDocumentFile(db: Db, tenantId: number, documentId: string): Promise<LegalDocumentDetail | null> {
  const [doc] = await db
    .select()
    .from(legalDocumentFiles)
    .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, documentId)))
    .limit(1);
  return doc ? hydrate(db, tenantId, doc) : null;
}

// ---------------------------------------------------------------------------
// Sharing — internal reads are plain tenant scoping; this is the EXTERNAL half
// ---------------------------------------------------------------------------

export interface ShareLegalDocumentInput {
  documentId: string;
  permission?: 'view' | 'download';
  recipientEmail?: string | null;
  expiresAt?: string | null;
  actor: ActorIdentity;
  createdBy?: string | null;
}

export interface CreatedLegalDocumentShare {
  shareId: string;
  /** The plaintext credential, exactly once — only the hash is stored. */
  token: string;
  permission: 'view' | 'download';
  expiresAt: string | null;
}

export async function shareLegalDocumentFile(
  db: Db,
  env: Env,
  tenantId: number,
  input: ShareLegalDocumentInput,
): Promise<CreatedLegalDocumentShare> {
  const [doc] = await db
    .select({ id: legalDocumentFiles.id, title: legalDocumentFiles.title })
    .from(legalDocumentFiles)
    .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, input.documentId)))
    .limit(1);
  if (!doc) throw new LegalDocumentError('No such legal document in this workspace.', 404);

  const permission: 'view' | 'download' = input.permission === 'download' ? 'download' : 'view';
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new LegalDocumentError('expiresAt is not a date.', 400);

  const { token, tokenHash } = await mintShareToken();
  const [row] = await db
    .insert(legalDocumentShares)
    .values({
      tenantId,
      documentId: doc.id,
      tokenHash,
      permission,
      recipientEmail: input.recipientEmail ?? null,
      expiresAt,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: legalDocumentShares.id });
  if (!row) throw new LegalDocumentError('The share link could not be created.', 500);

  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: 'legal_document.shared',
    targetType: 'legal_document_file',
    targetId: doc.id,
    targetLabel: doc.title,
    metadata: { permission, shareId: row.id },
  });

  return { shareId: row.id, token, permission, expiresAt: expiresAt ? expiresAt.toISOString() : null };
}

export async function revokeLegalDocumentShare(
  db: Db,
  env: Env,
  tenantId: number,
  shareId: string,
  actor: ActorIdentity,
): Promise<void> {
  const [row] = await db
    .update(legalDocumentShares)
    .set({ revokedAt: new Date() })
    .where(scopedToTenant(legalDocumentShares, tenantId, eq(legalDocumentShares.id, shareId), isNull(legalDocumentShares.revokedAt)))
    .returning({ id: legalDocumentShares.id, documentId: legalDocumentShares.documentId });
  if (!row) throw new LegalDocumentError('No active share with that id.', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'legal_document.share_revoked',
    targetType: 'legal_document_file',
    targetId: row.documentId,
    metadata: { shareId },
  });
}

export interface ResolvedLegalDocumentShare {
  shareId: string;
  documentId: string;
  title: string;
  permission: 'view' | 'download';
  bytes: Uint8Array;
  mime: string | null;
  filename: string;
}

/**
 * Resolve an external share token into the file it grants access to. A
 * DECLARED cross-tenant read for the `share_token` reason, same as
 * `signatureEngine.resolveSigner` and `formPublishing`'s recipient lookup: the
 * token is the credential and carries no session, so the row it resolves to
 * reports the tenant.
 */
export async function resolveLegalDocumentShare(db: Db, env: Env, token: string): Promise<ResolvedLegalDocumentShare | null> {
  const clean = token.trim();
  if (!clean || clean.length > 128) return null;
  const tokenHash = await hashShareToken(clean);

  const [row] = await db
    .select({
      shareId: legalDocumentShares.id,
      tenantId: legalDocumentShares.tenantId,
      permission: legalDocumentShares.permission,
      expiresAt: legalDocumentShares.expiresAt,
      revokedAt: legalDocumentShares.revokedAt,
      documentId: legalDocumentFiles.id,
      title: legalDocumentFiles.title,
      currentArtifactId: legalDocumentFiles.currentArtifactId,
    })
    .from(legalDocumentShares)
    .innerJoin(legalDocumentFiles, eq(legalDocumentFiles.id, legalDocumentShares.documentId))
    .where(acrossTenants(legalDocumentShares, 'share_token', eq(legalDocumentShares.tokenHash, tokenHash)))
    .limit(1);
  if (!row) return null;
  // Revoked-or-lapsed is the ONE predicate every share-bearing table now shares
  // (`shareGrantState`) rather than four re-tests of the same two columns. An
  // external caller is told neither which it was nor that the row existed.
  if (shareGrantState(row) !== 'active') return null;
  if (!row.currentArtifactId) return null;

  const artifact = await loadAndDecryptArtifact(db, env, row.tenantId, row.currentArtifactId);
  await recordActivity(env, db, {
    tenantId: row.tenantId,
    actor: SYSTEM_ACTOR,
    verb: 'legal_document.share_viewed',
    targetType: 'legal_document_file',
    targetId: row.documentId,
    metadata: { shareId: row.shareId },
  });

  return {
    shareId: row.shareId,
    documentId: row.documentId,
    title: row.title,
    permission: row.permission === 'download' ? 'download' : 'view',
    bytes: artifact.bytes,
    mime: artifact.mime,
    filename: row.title,
  };
}

// ---------------------------------------------------------------------------
// Signing — binds a signature request to the CURRENT artifact's frozen checksum
// ---------------------------------------------------------------------------

export interface RequestLegalDocumentSignatureInput {
  documentId: string;
  subject: string;
  intent?: string;
  expiresAt?: string | null;
  remindAfterDays?: number;
  parties: Array<{ name: string; email: string; partyRef?: string | null }>;
  actor: ActorIdentity;
  createdBy?: string | null;
}

/**
 * Send a legal file for signature. The signature engine stays domain-agnostic
 * — it does not know what a "legal document" is — so this loads the file's
 * current artifact, freezes ITS checksum at THIS instant, and hands the engine
 * a pointer plus a hash, exactly the way it already freezes `documentBody` text.
 */
export async function requestLegalDocumentSignature(
  db: Db,
  env: Env,
  tenantId: number,
  input: RequestLegalDocumentSignatureInput,
): Promise<CreatedSignatureRequest> {
  const [doc] = await db
    .select()
    .from(legalDocumentFiles)
    .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, input.documentId)))
    .limit(1);
  if (!doc) throw new LegalDocumentError('No such legal document in this workspace.', 404);
  if (!doc.currentArtifactId) throw new LegalDocumentError('Upload a file before requesting a signature.', 400);

  if (doc.signatureRequestId) {
    const [existing] = await db
      .select({ status: signatureRequests.status })
      .from(signatureRequests)
      .where(scopedToTenant(signatureRequests, tenantId, eq(signatureRequests.id, doc.signatureRequestId)))
      .limit(1);
    if (existing && existing.status === 'sent') {
      throw new LegalDocumentError('A signature request is already in progress for this document.', 409);
    }
  }

  const artifact = await loadArtifactRow(db, tenantId, doc.currentArtifactId);
  if (!artifact || !artifact.checksum) throw new LegalDocumentError('The stored file has no checksum to freeze — re-upload it.', 500);

  const result = await createSignatureRequest(db, tenantId, {
    subject: input.subject,
    intent: input.intent,
    documentTitle: doc.title,
    documentArtifactId: artifact.id,
    documentChecksum: artifact.checksum,
    documentRef: `legal_document_file:${doc.id}`,
    objectId: doc.objectId,
    expiresAt: input.expiresAt ?? null,
    ...(input.remindAfterDays != null ? { remindAfterDays: input.remindAfterDays } : {}),
    createdBy: input.createdBy ?? null,
    parties: input.parties,
  });

  await db
    .update(legalDocumentFiles)
    .set({ signatureRequestId: result.requestId, updatedAt: new Date() })
    .where(scopedToTenant(legalDocumentFiles, tenantId, eq(legalDocumentFiles.id, doc.id)));

  await recordActivity(env, db, {
    tenantId,
    actor: input.actor,
    verb: 'legal_document.signature_requested',
    targetType: 'legal_document_file',
    targetId: doc.id,
    targetLabel: doc.title,
    metadata: { requestId: result.requestId },
  });

  return result;
}
