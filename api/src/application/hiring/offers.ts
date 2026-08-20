/**
 * `offer_letters` — draft → send → respond, with the signature engine doing the signing.
 *
 * ── ONE ANSWER TO "IS IT SIGNED" ─────────────────────────────────────────────────
 * Sending an offer does NOT invent a signing flow. It calls
 * `application/signature/signatureEngine.createSignatureRequest`, the same engine
 * `legalDocumentStore.requestLegalDocumentSignature` calls, and stores the request id it
 * gets back on `offer_letters.signature_request_id` (0983). Everything that follows —
 * the signer's token, the reminder sweep, expiry, the audit of what was shown on the day
 * — is the engine's, already built and already audited. A second "has the candidate
 * signed" answer living in this module is precisely the drift the engine exists to
 * prevent, and an offer is the document where two answers are most expensive.
 *
 * The engine is domain-agnostic by design ("it does not know what a legal document is"),
 * so this module does the domain half: it renders the terms from the offer's own columns
 * (`domain/hiring/offerLetter.ts`), names the parties, and hands over text plus a
 * `documentRef` that points back at the row.
 *
 * ── SENT EXACTLY ONCE ────────────────────────────────────────────────────────────
 * `canSendOffer` refuses anything that is not a draft or an approved offer, and the
 * stored request id refuses a second send even if the status were somehow re-driven. Two
 * signature requests against one offer would give a candidate two links, one of which
 * binds them to terms nobody is tracking.
 *
 * ── ACCEPTANCE IS A HIRING DECISION ──────────────────────────────────────────────
 * An accepted offer records a `hire` decision, which is what moves the candidate to the
 * terminal stage. It is not a third way to move the board: `decisions.ts` owns that, and
 * routing acceptance through it is what keeps the funnel's conversion into `hired` equal
 * to the number of offers actually accepted.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { offerLetters } from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { createSignatureRequest, type CreatedSignatureRequest } from '../signature/signatureEngine';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { readApplication } from './applications';
import { recordDecision } from './decisions';
import { AtsError } from './atsError';
import {
  canRespondToOffer,
  canSendOffer,
  isOfferEditable,
  isOfferResponse,
  offerDocumentRef,
  offerSignatureSubject,
  renderOfferLetter,
  type OfferResponse,
} from '../../domain/hiring/offerLetter';
import type { Env } from '../../env';

export interface OfferLetter {
  id: number;
  applicationId: number | null;
  candidateRef: string;
  title: string;
  baseSalary: string | null;
  currency: string;
  equity: string | null;
  startDate: string | null;
  status: string;
  expiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  signatureRequestId: number | null;
  terms: Record<string, unknown> | null;
}

const OFFER_COLUMNS = {
  id: offerLetters.id,
  applicationId: offerLetters.applicationId,
  candidateRef: offerLetters.candidateRef,
  title: offerLetters.title,
  baseSalary: offerLetters.baseSalary,
  currency: offerLetters.currency,
  equity: offerLetters.equity,
  startDate: offerLetters.startDate,
  status: offerLetters.status,
  expiresAt: offerLetters.expiresAt,
  sentAt: offerLetters.sentAt,
  respondedAt: offerLetters.respondedAt,
  signatureRequestId: offerLetters.signatureRequestId,
  terms: offerLetters.terms,
  objectId: offerLetters.objectId,
} as const;

interface OfferRow {
  id: number;
  applicationId: number | null;
  candidateRef: string;
  title: string;
  baseSalary: string | null;
  currency: string;
  equity: string | null;
  startDate: Date | null;
  status: string;
  expiresAt: Date | null;
  sentAt: Date | null;
  respondedAt: Date | null;
  signatureRequestId: number | null;
  terms: unknown;
  objectId: string | null;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toOffer(row: OfferRow): OfferLetter {
  return {
    id: row.id,
    applicationId: row.applicationId ?? null,
    candidateRef: row.candidateRef,
    title: row.title,
    baseSalary: row.baseSalary ?? null,
    currency: row.currency,
    equity: row.equity ?? null,
    startDate: iso(row.startDate),
    status: row.status,
    expiresAt: iso(row.expiresAt),
    sentAt: iso(row.sentAt),
    respondedAt: iso(row.respondedAt),
    signatureRequestId: row.signatureRequestId ?? null,
    terms: (row.terms ?? null) as Record<string, unknown> | null,
  };
}

/** A date column from a caller's string, refusing what is not a date rather than
 *  storing `Invalid Date` and discovering it in the letter. */
function asDate(value: string | null | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AtsError(`${field} is not a date.`, 400);
  return date;
}

/** `numeric(14,2)` — kept as a string end to end so no float rounding sits between the
 *  number a recruiter typed and the number the candidate signs. */
function asMoney(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new AtsError('A base salary has to be a positive number.', 400);
  return (Math.round(amount * 100) / 100).toFixed(2);
}

export interface DraftOfferInput {
  tenantId: number;
  applicationId?: number | null;
  candidateRef?: string | null;
  title: string;
  baseSalary?: number | string | null;
  currency?: string | null;
  equity?: string | null;
  startDate?: string | null;
  expiresAt?: string | null;
  terms?: Record<string, unknown> | null;
}

/**
 * Draft an offer.
 *
 * Created in `draft` — unlike a signature request, which the engine deliberately creates
 * already `sent`. The difference is real: a signature request IS the act of sending, but
 * an offer is negotiated internally (a number, a start date, an approval) before anybody
 * outside sees it, and the draft state is where that happens.
 */
export async function draftOffer(db: Db, env: Env, input: DraftOfferInput): Promise<OfferLetter> {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new AtsError('An offer needs a role title.', 400);

  const application = input.applicationId != null
    ? await readApplication(db, input.tenantId, input.applicationId)
    : null;
  if (input.applicationId != null && !application) throw new AtsError('No such application in this workspace.', 404);

  const candidateRef = (application?.candidateRef ?? input.candidateRef ?? '').trim();
  if (!candidateRef) throw new AtsError('An offer has to be to somebody — name the candidate.', 400);

  const [row] = await db
    .insert(offerLetters)
    .values({
      tenantId: input.tenantId,
      applicationId: application?.id ?? null,
      candidateRef,
      title,
      baseSalary: asMoney(input.baseSalary),
      currency: (input.currency ?? 'USD').trim().toUpperCase().slice(0, 8) || 'USD',
      equity: input.equity?.slice(0, 96) ?? null,
      startDate: asDate(input.startDate, 'startDate'),
      expiresAt: asDate(input.expiresAt, 'expiresAt'),
      status: 'draft',
      terms: input.terms ?? null,
    })
    .returning(OFFER_COLUMNS)
    .catch((error: unknown) => {
      // `uq_offer_letters_open` (0983) — one LIVE offer per candidate per application. A
      // second draft beside an outstanding one is two sets of terms, and the candidate
      // decides which they signed.
      if (typeof error === 'object' && error !== null && String((error as { message?: unknown }).message ?? '').includes('uq_offer_letters_open')) {
        throw new AtsError('This candidate already has a live offer. Withdraw or resolve it before drafting another.', 409);
      }
      throw error;
    });
  if (!row) throw new AtsError('The offer could not be drafted.', 500);
  return toOffer(row as unknown as OfferRow);
}

export interface UpdateOfferInput {
  title?: string;
  baseSalary?: number | string | null;
  currency?: string | null;
  equity?: string | null;
  startDate?: string | null;
  expiresAt?: string | null;
  terms?: Record<string, unknown> | null;
  /** 'approved' is the only status a caller may set directly — everything else is the
   *  result of sending or of the candidate answering. */
  approve?: boolean;
}

/** Edit an offer that has not gone out yet. */
export async function updateOffer(
  db: Db,
  tenantId: number,
  offerId: number,
  input: UpdateOfferInput,
): Promise<OfferLetter> {
  const existing = await readOffer(db, tenantId, offerId);
  if (!existing) throw new AtsError('No such offer in this workspace.', 404);
  if (!isOfferEditable(existing.status)) {
    throw new AtsError('That offer has already gone out — the terms a candidate was shown cannot be edited underneath them.', 409);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, 200);
    if (!title) throw new AtsError('An offer needs a role title.', 400);
    patch.title = title;
  }
  if (input.baseSalary !== undefined) patch.baseSalary = asMoney(input.baseSalary);
  if (input.currency !== undefined) patch.currency = (input.currency ?? 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
  if (input.equity !== undefined) patch.equity = input.equity?.slice(0, 96) ?? null;
  if (input.startDate !== undefined) patch.startDate = asDate(input.startDate, 'startDate');
  if (input.expiresAt !== undefined) patch.expiresAt = asDate(input.expiresAt, 'expiresAt');
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.approve) patch.status = 'approved';

  const [row] = await db
    .update(offerLetters)
    .set(patch)
    .where(scopedToTenant(offerLetters, tenantId, eq(offerLetters.id, offerId)))
    .returning(OFFER_COLUMNS);
  if (!row) throw new AtsError('The offer could not be updated.', 500);
  return toOffer(row as unknown as OfferRow);
}

export async function readOffer(db: Db, tenantId: number, offerId: number): Promise<OfferLetter | null> {
  const [row] = await db
    .select(OFFER_COLUMNS)
    .from(offerLetters)
    .where(scopedToTenant(offerLetters, tenantId, eq(offerLetters.id, offerId)))
    .limit(1);
  return row ? toOffer(row as unknown as OfferRow) : null;
}

export async function listOffers(
  db: Db,
  tenantId: number,
  opts: { applicationId?: number | null; candidateRef?: string | null; status?: string | null } = {},
): Promise<OfferLetter[]> {
  const rows = await db
    .select(OFFER_COLUMNS)
    .from(offerLetters)
    .where(scopedToTenant(
      offerLetters,
      tenantId,
      opts.applicationId != null ? eq(offerLetters.applicationId, opts.applicationId) : undefined,
      opts.candidateRef ? eq(offerLetters.candidateRef, opts.candidateRef) : undefined,
      opts.status ? eq(offerLetters.status, opts.status) : undefined,
    ))
    .orderBy(desc(offerLetters.id))
    .limit(200);
  return (rows as unknown as OfferRow[]).map(toOffer);
}

export interface SendOfferInput {
  tenantId: number;
  offerId: number;
  /** In signing order. The candidate first; a countersigner is simply the next position,
   *  which is the engine's own model of countersignature. */
  parties: Array<{ name: string; email: string; partyRef?: string | null }>;
  remindAfterDays?: number;
  createdBy?: string | null;
  actor: ActorIdentity;
}

export interface SentOffer {
  offer: OfferLetter;
  /** The engine's request, including the one-time invitation tokens. They exist ONLY in
   *  this response — nothing can read them back. */
  signature: CreatedSignatureRequest;
}

/**
 * Send an offer for signature — through the engine, exactly once.
 *
 * The terms are rendered from the row at THIS instant and handed over as `documentBody`,
 * which the engine freezes verbatim. That is the whole point of rendering rather than
 * storing a letter: what the candidate saw is provable, and it provably matches the
 * columns the payroll system will later read.
 */
export async function sendOffer(db: Db, env: Env, input: SendOfferInput, now = new Date()): Promise<SentOffer> {
  const offer = await readOffer(db, input.tenantId, input.offerId);
  if (!offer) throw new AtsError('No such offer in this workspace.', 404);
  if (offer.signatureRequestId != null) {
    throw new AtsError('That offer has already been sent for signature.', 409);
  }
  if (!canSendOffer(offer.status)) {
    throw new AtsError(`An offer in "${offer.status}" cannot be sent.`, 409);
  }
  if (!input.parties.length) {
    throw new AtsError('Name the candidate the offer goes to, with an email to reach them at.', 400);
  }

  const signature = await createSignatureRequest(db, input.tenantId, {
    subject: offerSignatureSubject(offer.title),
    intent: 'sign',
    documentTitle: offer.title,
    documentBody: renderOfferLetter({
      title: offer.title,
      baseSalary: offer.baseSalary,
      currency: offer.currency,
      equity: offer.equity,
      startDate: offer.startDate,
      expiresAt: offer.expiresAt,
      terms: offer.terms,
    }),
    documentRef: offerDocumentRef(offer.id),
    expiresAt: offer.expiresAt,
    ...(input.remindAfterDays != null ? { remindAfterDays: input.remindAfterDays } : {}),
    createdBy: input.createdBy ?? null,
    parties: input.parties,
  });

  const [row] = await db
    .update(offerLetters)
    .set({ status: 'sent', sentAt: now, signatureRequestId: signature.requestId, updatedAt: now })
    .where(scopedToTenant(offerLetters, input.tenantId, eq(offerLetters.id, offer.id)))
    .returning(OFFER_COLUMNS);
  if (!row) throw new AtsError('The offer was sent but could not be marked as sent.', 500);

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: input.actor,
    verb: 'hiring.offer.sent',
    targetType: 'offer_letter',
    targetId: offer.id,
    targetLabel: offer.title,
    metadata: { requestId: signature.requestId, candidateRef: offer.candidateRef },
  });

  return { offer: toOffer(row as unknown as OfferRow), signature };
}

export interface RespondToOfferInput {
  tenantId: number;
  offerId: number;
  response: string;
  /** What the candidate said. Recorded as the decision's rationale on acceptance. */
  note?: string | null;
  actor: ActorIdentity;
}

/**
 * Record the candidate's answer, and let an acceptance hire them.
 *
 * The pipeline move goes through `recordDecision` rather than `moveCandidate`: an
 * acceptance IS a hiring decision, it needs to appear in the decision history beside the
 * ones that got the candidate here, and there is exactly one function that moves a
 * candidate on the strength of a decision.
 */
export async function respondToOffer(
  db: Db,
  env: Env,
  input: RespondToOfferInput,
  now = new Date(),
): Promise<{ offer: OfferLetter; movedTo: string | null }> {
  if (!isOfferResponse(input.response)) {
    throw new AtsError('An offer is accepted or declined.', 400);
  }
  const response: OfferResponse = input.response;

  const offer = await readOffer(db, input.tenantId, input.offerId);
  if (!offer) throw new AtsError('No such offer in this workspace.', 404);
  if (!canRespondToOffer(offer.status)) {
    throw new AtsError(`An offer in "${offer.status}" is not waiting for an answer.`, 409);
  }

  const [row] = await db
    .update(offerLetters)
    .set({ status: response, respondedAt: now, updatedAt: now })
    .where(scopedToTenant(offerLetters, input.tenantId, eq(offerLetters.id, offer.id)))
    .returning(OFFER_COLUMNS);
  if (!row) throw new AtsError('The response could not be recorded.', 500);

  const decision = await recordDecision(db, env, {
    tenantId: input.tenantId,
    applicationId: offer.applicationId,
    candidateRef: offer.candidateRef,
    // A DECLINED offer is not a rejection of the candidate — it is the candidate
    // rejecting us, and filing it as `reject` would put a rejection reason against
    // somebody nobody turned down. It is recorded as a decision that moves nobody; the
    // recruiter decides what happens to the requisition next.
    decision: response === 'accepted' ? 'hire' : 'hold',
    rationale: input.note?.trim() || (response === 'accepted' ? 'Offer accepted.' : 'Offer declined by the candidate.'),
    evidence: { offerId: offer.id, signatureRequestId: offer.signatureRequestId },
    actor: input.actor,
  }, now);

  return { offer: toOffer(row as unknown as OfferRow), movedTo: decision.movedTo };
}
