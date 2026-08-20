/**
 * THE signature engine — what turns a draft into a record.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `SIGNATURE_PARTY_STATUSES`, `SIGNATURE_REQUEST_STATUSES`, `SIGNATURE_INTENTS`,
 * `isTerminalPartyStatus` and `isAgreedPartyStatus` were all declared in the
 * canvas contract and all unused. `isTerminalPartyStatus` even documents the
 * three call sites it was written for — the request's completion check, the
 * reminder job's "who still owes us", and the canvas progress meter — and none of
 * the three existed. `contract.sign` was a gated act with nothing behind the
 * gate: the approval gate correctly refused to let a model perform it, and there
 * was nothing to perform.
 *
 * All three call sites are in this file, and they call the contract's predicates
 * rather than re-testing the statuses. That is the point of the predicates:
 * `declined` is terminal and is NOT completion, which an `=== 'signed'` test in
 * each caller gets right and a `!== 'pending'` test does not.
 *
 * ── WHY THE DOCUMENT BODY IS COPIED, NOT REFERENCED ──────────────────────────
 * The evidence an auditor needs is what THIS person saw on THAT day. A live
 * reference to a canvas object somebody edited afterwards is not that, and the
 * difference only becomes visible in the dispute where it matters. So the terms
 * are frozen onto the request when it is sent, and `documentRef` records where
 * they came from for provenance rather than for resolution.
 *
 * ── WHY THERE IS NO VENDOR HERE ──────────────────────────────────────────────
 * A DocuSign / Dropbox Sign adapter is a separate change and it is downstream of
 * this one, not a substitute for it: an adapter with no internal engine has
 * nothing to map onto and would become the second answer to "is it signed". When
 * it lands it is manifest DATA in the connector platform, the same argument
 * migration 0410 makes for every other vendor.
 */

import { and, asc, eq, gt, isNull, lt, lte, ne, notInArray, or } from 'drizzle-orm';
import {
  SIGNATURE_PARTY_STATUSES,
  isAgreedPartyStatus,
  isSignatureIntent,
  isTerminalPartyStatus,
  type SignatureIntent,
  type SignaturePartyStatus,
  type SignatureRequestStatus,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { signatureParties, signatureRequests } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { hashShareToken, mintShareToken } from '../security/shareToken';

export class SignatureError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SignatureError';
  }
}

/** How many requests one reminder sweep will chase. Bounded so a backlog costs a
 *  longer tail of sweeps rather than one request that times out mid-send. */
const REMINDER_BATCH = 100;

const asPartyStatus = (value: string): SignaturePartyStatus =>
  (SIGNATURE_PARTY_STATUSES as readonly string[]).includes(value)
    ? value as SignaturePartyStatus
    : 'pending';

/**
 * The statuses that END a party's involvement, DERIVED from the contract's own
 * predicate rather than restated.
 *
 * Needed as a value (not a test) because `reissuePartyToken` expresses "still
 * owes an answer" as a SQL predicate on the row rather than a filter in memory —
 * the update must not be able to rotate a decided party's credential even under a
 * concurrent decision. Deriving it means a sixth status added to the contract is
 * classified once, in the contract, and this stays correct.
 */
const TERMINAL_PARTY_STATUSES: string[] =
  SIGNATURE_PARTY_STATUSES.filter((status) => isTerminalPartyStatus(status));

// ---------------------------------------------------------------------------
// Creating and sending
// ---------------------------------------------------------------------------

export interface CreateSignatureRequestInput {
  subject: string;
  intent?: string;
  documentTitle: string;
  /** The terms, rendered to the signer verbatim. Required UNLESS
   *  `documentArtifactId` is given — a request binds to text OR to a binary
   *  file, never neither. */
  documentBody?: string | null;
  /** A binary file (a `kernel.artifacts` row) the signer reviews and signs,
   *  instead of rendered text — e.g. an uploaded PDF/DOCX. The engine does not
   *  know what an "artifact" means; it stores the pointer and the hash the
   *  caller already computed, exactly as it freezes `documentBody` verbatim. */
  documentArtifactId?: string | null;
  /** SHA-256 of the artifact's PLAINTEXT bytes at the moment this request was
   *  created — required together with `documentArtifactId`, frozen for the same
   *  reason `documentBody` is copied rather than referenced: what this person
   *  saw on that day must stay provable even if the file is later re-uploaded. */
  documentChecksum?: string | null;
  documentRef?: string | null;
  objectId?: string | null;
  expiresAt?: string | null;
  remindAfterDays?: number;
  createdBy?: string | null;
  /** In signing ORDER. Countersignature is a position, not a second concept. */
  parties: Array<{ name: string; email: string; partyRef?: string | null }>;
}

export interface SignatureInvitation {
  partyId: number;
  name: string;
  email: string;
  /** The plaintext credential, which exists ONLY here. The caller sends it;
   *  nothing can read it back. */
  token: string;
}

export interface CreatedSignatureRequest {
  requestId: number;
  status: SignatureRequestStatus;
  invitations: SignatureInvitation[];
}

/**
 * Create a request and mint one credential per party.
 *
 * Created in `sent` state directly. A `draft` signature request is a document,
 * and the platform already has one of those — modelling an unsent request as a
 * distinct lifecycle stage would add a state whose only behaviour is "does
 * nothing", and the register's complaint about `contract.sign` was precisely that
 * a state with no behaviour looks identical to a working feature.
 */
export async function createSignatureRequest(
  db: Db,
  tenantId: number,
  input: CreateSignatureRequestInput,
): Promise<CreatedSignatureRequest> {
  const subject = input.subject.trim().slice(0, 200);
  const documentTitle = input.documentTitle.trim().slice(0, 200);
  const documentBody = input.documentBody?.trim() || null;
  const documentArtifactId = input.documentArtifactId?.trim() || null;
  const documentChecksum = input.documentChecksum?.trim() || null;
  if (!subject || !documentTitle) throw new SignatureError('A signature request needs a subject and a document title.', 400);
  if (!documentBody && !documentArtifactId) {
    throw new SignatureError('A signature request with no terms is a request to agree to nothing. Send the text the signer is agreeing to, or bind it to a file.', 400);
  }
  if (documentArtifactId && !documentChecksum) {
    throw new SignatureError('A file-backed signature request needs the checksum of what is being signed, frozen at send time.', 400);
  }

  const parties = input.parties
    .map((p) => ({
      name: p.name.trim().slice(0, 200),
      email: p.email.trim().toLowerCase().slice(0, 320),
      partyRef: p.partyRef?.trim().slice(0, 64) ?? null,
    }))
    .filter((p) => p.name && p.email.includes('@'));
  if (!parties.length) throw new SignatureError('Name at least one party, with an email to reach them at.', 400);

  const intent: SignatureIntent = isSignatureIntent(input.intent) ? input.intent : 'sign';
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new SignatureError('expiresAt is not a date.', 400);

  const now = new Date();
  const [request] = await db
    .insert(signatureRequests)
    .values({
      tenantId,
      subject,
      intent,
      documentTitle,
      documentBody,
      documentArtifactId,
      documentChecksum,
      documentRef: input.documentRef ?? null,
      objectId: input.objectId ?? null,
      status: 'sent',
      sentAt: now,
      expiresAt,
      remindAfterDays: Math.max(0, Math.min(Math.round(input.remindAfterDays ?? 3), 60)),
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: signatureRequests.id });
  if (!request) throw new SignatureError('The signature request could not be created.', 500);

  const invitations: SignatureInvitation[] = [];
  for (const [position, party] of parties.entries()) {
    const { token, tokenHash } = await mintShareToken();
    const [row] = await db
      .insert(signatureParties)
      .values({
        tenantId,
        requestId: request.id,
        name: party.name,
        email: party.email,
        partyRef: party.partyRef,
        position,
        tokenHash,
      })
      .returning({ id: signatureParties.id });
    if (row) invitations.push({ partyId: row.id, name: party.name, email: party.email, token });
  }

  return { requestId: request.id, status: 'sent', invitations };
}

/** Cancel a request. Terminal, and it does NOT delete: a cancelled request that
 *  one party had already signed is exactly the record somebody will later ask
 *  about. */
export async function cancelSignatureRequest(db: Db, tenantId: number, requestId: number): Promise<void> {
  const [row] = await db
    .update(signatureRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(scopedToTenant(
      signatureRequests,
      tenantId,
      and(eq(signatureRequests.id, requestId), ne(signatureRequests.status, 'completed')),
    ))
    .returning({ id: signatureRequests.id });
  if (!row) throw new SignatureError('No open signature request with that id.', 404);
}

// ---------------------------------------------------------------------------
// The signer's half
// ---------------------------------------------------------------------------

export interface SignerView {
  tenantId: number;
  requestId: number;
  partyId: number;
  subject: string;
  intent: SignatureIntent;
  documentTitle: string;
  documentBody: string | null;
  /** Set when this request is bound to a file rather than (or as well as)
   *  rendered text — the signer-facing route fetches and decrypts it separately. */
  documentArtifactId: string | null;
  documentChecksum: string | null;
  signerName: string;
  status: SignaturePartyStatus;
  requestStatus: SignatureRequestStatus;
  /** True when an earlier party in the order has not finished. The signer is
   *  told they are waiting rather than shown a control that would fail. */
  waitingOnOthers: boolean;
  expiresAt: string | null;
}

/**
 * Resolve a signer's token into what they may see.
 *
 * A DECLARED cross-tenant read for the `share_token` reason: the signer has no
 * session, so the token is the credential and the row reports the tenant.
 *
 * Marks `viewed` as a side effect, and that is deliberate rather than sloppy — an
 * audit trail that cannot say the signer OPENED the document is missing the fact
 * most often disputed. It is written once: a re-open does not overwrite the first
 * view, because "when did they first see it" is the question.
 */
export async function resolveSigner(db: Db, token: string): Promise<SignerView | null> {
  const clean = token.trim();
  if (!clean || clean.length > 128) return null;
  const tokenHash = await hashShareToken(clean);

  const [row] = await db
    .select({
      partyId: signatureParties.id,
      tenantId: signatureParties.tenantId,
      partyStatus: signatureParties.status,
      partyName: signatureParties.name,
      position: signatureParties.position,
      viewedAt: signatureParties.viewedAt,
      requestId: signatureRequests.id,
      subject: signatureRequests.subject,
      intent: signatureRequests.intent,
      documentTitle: signatureRequests.documentTitle,
      documentBody: signatureRequests.documentBody,
      documentArtifactId: signatureRequests.documentArtifactId,
      documentChecksum: signatureRequests.documentChecksum,
      requestStatus: signatureRequests.status,
      expiresAt: signatureRequests.expiresAt,
    })
    .from(signatureParties)
    .innerJoin(signatureRequests, eq(signatureRequests.id, signatureParties.requestId))
    .where(acrossTenants(signatureParties, 'share_token', eq(signatureParties.tokenHash, tokenHash)))
    .limit(1);
  if (!row) return null;

  if (!row.viewedAt) {
    await db
      .update(signatureParties)
      .set({
        viewedAt: new Date(),
        // `viewed` only overwrites `pending`. A party who already signed and
        // re-opens the page has not un-signed.
        ...(row.partyStatus === 'pending' ? { status: 'viewed' } : {}),
        updatedAt: new Date(),
      })
      .where(scopedToTenant(signatureParties, row.tenantId, eq(signatureParties.id, row.partyId)));
  }

  const earlier = await db
    .select({ status: signatureParties.status })
    .from(signatureParties)
    .where(scopedToTenant(
      signatureParties,
      row.tenantId,
      eq(signatureParties.requestId, row.requestId),
      lt(signatureParties.position, row.position),
    ));

  return {
    tenantId: row.tenantId,
    requestId: row.requestId,
    partyId: row.partyId,
    subject: row.subject,
    intent: isSignatureIntent(row.intent) ? row.intent : 'sign',
    documentTitle: row.documentTitle,
    documentBody: row.documentBody,
    documentArtifactId: row.documentArtifactId,
    documentChecksum: row.documentChecksum,
    signerName: row.partyName,
    status: row.viewedAt || row.partyStatus !== 'pending' ? asPartyStatus(row.partyStatus === 'pending' ? 'viewed' : row.partyStatus) : 'viewed',
    requestStatus: row.requestStatus as SignatureRequestStatus,
    // CALL SITE 1 of `isTerminalPartyStatus`: an earlier party who declined is
    // finished and is not agreement, so a later signer must not be released by
    // it — which a `!== 'pending'` test would get wrong.
    waitingOnOthers: earlier.some((p) => !isAgreedPartyStatus(asPartyStatus(p.status))),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

export interface SignDecision {
  /** 'sign' honours the request's own intent — a request whose intent is
   *  `acknowledge` records `acknowledged`, never `signed`. The signer does not
   *  get to upgrade what they did. */
  decision: 'agree' | 'decline';
  /** What the signer typed as their name. Required to agree: a click with no
   *  typed name is a record that says nothing about who made it. */
  signedName?: string;
  declineReason?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Record one party's decision, and complete the request when the last one lands.
 *
 * Refuses on everything that would produce a record nobody can rely on: an
 * expired request, a cancelled one, a party who already decided, and a signer
 * whose turn has not come.
 */
export async function recordSignature(
  db: Db,
  token: string,
  input: SignDecision,
): Promise<{ status: SignaturePartyStatus; requestStatus: SignatureRequestStatus }> {
  const view = await resolveSigner(db, token);
  if (!view) throw new SignatureError('That signing link is not valid.', 404);
  if (view.requestStatus !== 'sent') {
    throw new SignatureError(`This request is ${view.requestStatus} and is no longer accepting signatures.`, 409);
  }
  if (view.expiresAt && new Date(view.expiresAt).getTime() <= Date.now()) {
    throw new SignatureError('This request has expired.', 409);
  }
  // CALL SITE 2: the party's own completion check.
  if (isTerminalPartyStatus(view.status)) throw new SignatureError('You have already responded to this request.', 409);
  if (input.decision === 'agree' && view.waitingOnOthers) {
    throw new SignatureError('An earlier party has not signed yet. You will be able to sign once they have.', 409);
  }

  const signedName = input.signedName?.trim().slice(0, 200) ?? '';
  if (input.decision === 'agree' && !signedName) {
    throw new SignatureError('Type your full name to sign.', 400);
  }

  const now = new Date();
  const status: SignaturePartyStatus = input.decision === 'decline'
    ? 'declined'
    : view.intent === 'acknowledge' ? 'acknowledged' : 'signed';

  await db
    .update(signatureParties)
    .set({
      status,
      decidedAt: now,
      signedName: input.decision === 'agree' ? signedName : null,
      declineReason: input.decision === 'decline' ? (input.declineReason?.trim().slice(0, 1000) ?? null) : null,
      // Stamped in the SAME statement as the status, so a record can never exist
      // without the evidence of how it was made.
      evidence: { ...(input.evidence ?? {}), at: now.toISOString(), intent: view.intent },
      updatedAt: now,
    })
    .where(scopedToTenant(signatureParties, view.tenantId, eq(signatureParties.id, view.partyId)));

  const requestStatus = await settleRequest(db, view.tenantId, view.requestId);
  return { status, requestStatus };
}

/**
 * Recompute a request's own status from its parties.
 *
 * CALL SITE 3 of the contract predicates, and the reason they exist: one decline
 * kills the request, and completion needs every party to have AGREED — not merely
 * to have finished. Derived rather than stored-and-nudged, so the header can
 * never disagree with the rows beneath it.
 */
export async function settleRequest(db: Db, tenantId: number, requestId: number): Promise<SignatureRequestStatus> {
  const parties = await db
    .select({ status: signatureParties.status })
    .from(signatureParties)
    .where(scopedToTenant(signatureParties, tenantId, eq(signatureParties.requestId, requestId)));

  const statuses = parties.map((p) => asPartyStatus(p.status));
  const next: SignatureRequestStatus = statuses.some((s) => s === 'declined')
    ? 'declined'
    : statuses.length > 0 && statuses.every(isAgreedPartyStatus)
      ? 'completed'
      : 'sent';

  await db
    .update(signatureRequests)
    .set({
      status: next,
      ...(next === 'completed' ? { completedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(signatureRequests, tenantId, eq(signatureRequests.id, requestId)));

  return next;
}

// ---------------------------------------------------------------------------
// The progress meter, and the reminder sweep
// ---------------------------------------------------------------------------

export interface SignatureProgress {
  requestId: number;
  subject: string;
  intent: SignatureIntent;
  status: SignatureRequestStatus;
  total: number;
  /** Parties who have AGREED — the numerator a progress meter shows. */
  agreed: number;
  /** Parties who are finished, agreed or not. `declined` counts here and not
   *  above, which is the distinction the contract's two predicates exist for. */
  settled: number;
  parties: Array<{ name: string; email: string; status: SignaturePartyStatus; decidedAt: string | null }>;
}

/** What the canvas card's progress meter reads. Derived from the parties, so a
 *  meter cannot claim a completion the rows do not support. */
export async function signatureProgress(
  db: Db,
  tenantId: number,
  requestId: number,
): Promise<SignatureProgress | null> {
  const [request] = await db
    .select({
      id: signatureRequests.id,
      subject: signatureRequests.subject,
      intent: signatureRequests.intent,
      status: signatureRequests.status,
    })
    .from(signatureRequests)
    .where(scopedToTenant(signatureRequests, tenantId, eq(signatureRequests.id, requestId)))
    .limit(1);
  if (!request) return null;

  const rows = await db
    .select({
      name: signatureParties.name,
      email: signatureParties.email,
      status: signatureParties.status,
      decidedAt: signatureParties.decidedAt,
    })
    .from(signatureParties)
    .where(scopedToTenant(signatureParties, tenantId, eq(signatureParties.requestId, requestId)))
    .orderBy(asc(signatureParties.position));

  const parties = rows.map((row) => ({
    name: row.name,
    email: row.email,
    status: asPartyStatus(row.status),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  }));

  return {
    requestId: request.id,
    subject: request.subject,
    intent: isSignatureIntent(request.intent) ? request.intent : 'sign',
    status: request.status as SignatureRequestStatus,
    total: parties.length,
    agreed: parties.filter((p) => isAgreedPartyStatus(p.status)).length,
    settled: parties.filter((p) => isTerminalPartyStatus(p.status)).length,
    parties,
  };
}

export interface ReminderDue {
  tenantId: number;
  requestId: number;
  subject: string;
  documentTitle: string;
  intent: SignatureIntent;
  /** Who sent it. The sweep has no request to read a language from, and a
   *  counterparty has no account here, so the sender's stored locale is the only
   *  signal about what language the chase should be written in. */
  createdBy: string | null;
  /** Only the parties who still owe an answer — the reminder job's own question,
   *  answered with `isTerminalPartyStatus` rather than a `=== 'pending'` test
   *  that would chase somebody who has already declined. */
  pending: Array<{ partyId: number; name: string; email: string }>;
}

/**
 * Requests that are sent, unexpired, and have gone quiet for longer than they
 * declared.
 *
 * Returns WHAT to chase and sends nothing: the sweep composes and the transport
 * delivers, which keeps this testable without a mail server and keeps the
 * decision about who still owes an answer in one place.
 *
 * `remindAfterDays = 0` opts out entirely — a standing invitation that must not
 * chase — and the filter honours it rather than treating 0 as "immediately".
 */
export async function signatureRemindersDue(db: Db, now = new Date()): Promise<ReminderDue[]> {
  const rows = await db
    .select({
      id: signatureRequests.id,
      tenantId: signatureRequests.tenantId,
      subject: signatureRequests.subject,
      documentTitle: signatureRequests.documentTitle,
      intent: signatureRequests.intent,
      createdBy: signatureRequests.createdBy,
      remindAfterDays: signatureRequests.remindAfterDays,
      sentAt: signatureRequests.sentAt,
      lastRemindedAt: signatureRequests.lastRemindedAt,
    })
    .from(signatureRequests)
    // A sweep has no caller and therefore no tenant to filter by — it is the
    // platform acting on its own schedule over every tenant's rows, which is what
    // a sweep IS. Declared rather than omitted, and it still names what it acts
    // on: sent, unexpired, and opted in to reminders.
    .where(acrossTenants(
      signatureRequests,
      'scheduled_sweep',
      eq(signatureRequests.status, 'sent'),
      // 0 opts out entirely — honoured here rather than treated as "immediately".
      gt(signatureRequests.remindAfterDays, 0),
      or(isNull(signatureRequests.expiresAt), gt(signatureRequests.expiresAt, now)),
    ))
    .orderBy(asc(signatureRequests.updatedAt))
    .limit(REMINDER_BATCH);

  const due: ReminderDue[] = [];
  for (const row of rows) {
    const since = (row.lastRemindedAt ?? row.sentAt)?.getTime();
    if (since == null) continue;
    if (now.getTime() - since < row.remindAfterDays * 86_400_000) continue;

    const parties = await db
      .select({ id: signatureParties.id, name: signatureParties.name, email: signatureParties.email, status: signatureParties.status })
      .from(signatureParties)
      .where(scopedToTenant(signatureParties, row.tenantId, eq(signatureParties.requestId, row.id)))
      .orderBy(asc(signatureParties.position));

    const pending = parties
      .filter((p) => !isTerminalPartyStatus(asPartyStatus(p.status)))
      .map((p) => ({ partyId: p.id, name: p.name, email: p.email }));
    if (!pending.length) continue;

    due.push({
      tenantId: row.tenantId,
      requestId: row.id,
      subject: row.subject,
      documentTitle: row.documentTitle,
      intent: isSignatureIntent(row.intent) ? row.intent : 'sign',
      createdBy: row.createdBy,
      pending,
    });
  }
  return due;
}

/**
 * Mint a REPLACEMENT credential for one party and return the plaintext.
 *
 * The reminder job exists to point somebody at the thing they still owe an
 * answer on, and it could not: only the HASH of a party's token is stored, so the
 * only address the sweep could name was the `/sign` landing page — a message that
 * says "use the link you were sent" to somebody who, by hypothesis, has not acted
 * on it.
 *
 * Storing the plaintext so a cron job could quote it is the obvious fix and the
 * wrong one — it turns every `signature_parties` row into a working signature on
 * somebody else's behalf. Re-issuing keeps the one-way property exactly as it was
 * and still produces a link that opens. The old link stops working at that
 * moment; the cost is charged only when the message carrying the new one is about
 * to be sent.
 *
 * Only a party who still owes an answer may be re-issued — the fourth call site
 * of `isTerminalPartyStatus`, expressed as a predicate on the row. `viewed` is
 * NOT terminal and must be re-issuable: somebody who opened the document and did
 * not decide is precisely who a reminder is for. Rotating a token on a row that
 * has signed, acknowledged or declined would hand out a fresh credential for a
 * decision that is already recorded and closed.
 */
export async function reissuePartyToken(
  db: Db,
  tenantId: number,
  partyId: number,
): Promise<string | null> {
  const { token, tokenHash } = await mintShareToken();
  const [row] = await db
    .update(signatureParties)
    .set({ tokenHash, updatedAt: new Date() })
    .where(scopedToTenant(
      signatureParties,
      tenantId,
      eq(signatureParties.id, partyId),
      notInArray(signatureParties.status, TERMINAL_PARTY_STATUSES),
    ))
    .returning({ id: signatureParties.id });
  return row ? token : null;
}

/** Stamp a request as chased. Called by the sweep AFTER delivery, so a transport
 *  failure means it is tried again rather than silently skipped for a cycle. */
export async function markReminded(db: Db, tenantId: number, requestId: number, at = new Date()): Promise<void> {
  await db
    .update(signatureRequests)
    .set({ lastRemindedAt: at, updatedAt: at })
    .where(scopedToTenant(signatureRequests, tenantId, eq(signatureRequests.id, requestId)));
}

/** Expire everything past its date. Cheap, set-based, and idempotent. */
export async function expireSignatureRequests(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .update(signatureRequests)
    .set({ status: 'expired', updatedAt: now })
    // Same declaration as the reminder read above, for the same reason.
    .where(acrossTenants(
      signatureRequests,
      'scheduled_sweep',
      eq(signatureRequests.status, 'sent'),
      lte(signatureRequests.expiresAt, now),
    ))
    .returning({ id: signatureRequests.id });
  return rows.length;
}
