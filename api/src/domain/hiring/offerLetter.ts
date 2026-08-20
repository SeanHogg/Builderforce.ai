/**
 * The offer lifecycle, and the text a candidate actually signs.
 *
 * ── WHY THE LETTER IS RENDERED HERE ──────────────────────────────────────────────
 * `signatureEngine.createSignatureRequest` freezes `documentBody` verbatim — "what this
 * person saw on that day must stay provable". That is only worth anything if the body it
 * freezes is derived from the offer's own columns rather than typed into a form beside
 * them: a letter that says $120,000 above an `offer_letters.base_salary` of 110000 is two
 * answers to one question, and the signed one is the one that is enforceable.
 *
 * So the letter is a pure function of the row. Change the salary, re-render, and the
 * text follows; there is no second place for the number to live.
 *
 * ── PURE ON PURPOSE ──────────────────────────────────────────────────────────────
 * No database, no engine, no clock beyond what is passed in. The status machine below is
 * the same shape and for the same reason: "can this be sent" is asked by the application
 * service before it calls the engine and by the route before it 409s, and two copies of a
 * five-state machine is how a cancelled offer comes to be sendable from one door.
 */

/** `offer_letters.status`, as migration 0419 documents it. */
export const OFFER_STATUSES = ['draft', 'approved', 'sent', 'accepted', 'declined', 'expired'] as const;

export type OfferStatus = typeof OFFER_STATUSES[number];

export function isOfferStatus(value: unknown): value is OfferStatus {
  return typeof value === 'string' && (OFFER_STATUSES as readonly string[]).includes(value);
}

/** The two answers a candidate can give. */
export const OFFER_RESPONSES = ['accepted', 'declined'] as const;

export type OfferResponse = typeof OFFER_RESPONSES[number];

export function isOfferResponse(value: unknown): value is OfferResponse {
  return typeof value === 'string' && (OFFER_RESPONSES as readonly string[]).includes(value);
}

/**
 * Sendable exactly once, from exactly two states.
 *
 * `sent` is deliberately NOT sendable. Sending again would mint a second signature
 * request against the same offer, and then "is this offer signed?" has two answers — the
 * defect the whole platform routes through one engine to avoid.
 */
export function canSendOffer(status: string): boolean {
  return status === 'draft' || status === 'approved';
}

/** Only an offer that is actually out can be answered. */
export function canRespondToOffer(status: string): boolean {
  return status === 'sent';
}

/** An offer that has been answered or has lapsed is done being edited. */
export function isOfferEditable(status: string): boolean {
  return status === 'draft' || status === 'approved';
}

export interface OfferLetterFields {
  title: string;
  /** `numeric(14,2)` arrives from Postgres as a string; kept as one so no rounding
   *  happens between the database and the letter that quotes it. */
  baseSalary: string | null;
  currency: string;
  equity: string | null;
  startDate: Date | string | null;
  expiresAt: Date | string | null;
  /** Anything the tenant adds — bonus, remote policy, signing terms. */
  terms?: Record<string, unknown> | null;
}

/** A date as the letter states it: ISO-8601 date only, no timezone theatre on a start
 *  date that is a calendar day rather than an instant. */
function isoDay(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Compensation, in the currency it is denominated in.
 *
 * Deliberately not `Intl.NumberFormat` with a locale: this string is frozen into a
 * signed document, and a number whose grouping depends on which worker rendered it is a
 * number two copies of the same offer can disagree about.
 */
export function formatOfferSalary(baseSalary: string | null, currency: string): string | null {
  if (!baseSalary) return null;
  const amount = Number(baseSalary);
  if (!Number.isFinite(amount)) return null;
  const whole = Math.round(amount * 100) / 100;
  return `${currency.toUpperCase()} ${whole.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The letter, as the signer reads it.
 *
 * Terms the tenant added are listed under their own keys rather than dropped: a term
 * that is in the row and not in the letter is a term nobody agreed to, which is the
 * worse half of the two failure modes available here.
 */
export function renderOfferLetter(offer: OfferLetterFields): string {
  const lines: string[] = [`Offer of employment: ${offer.title}`, ''];

  const salary = formatOfferSalary(offer.baseSalary, offer.currency);
  if (salary) lines.push(`Base salary: ${salary} per year`);
  if (offer.equity) lines.push(`Equity: ${offer.equity}`);

  const start = isoDay(offer.startDate);
  if (start) lines.push(`Start date: ${start}`);

  const expires = isoDay(offer.expiresAt);
  if (expires) lines.push(`This offer expires on ${expires}.`);

  const extra = Object.entries(offer.terms ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (extra.length) {
    lines.push('', 'Additional terms:');
    for (const [key, value] of extra) lines.push(`  - ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }

  lines.push('', 'Signing below accepts the terms stated above.');
  return lines.join('\n');
}

/** The subject the signature request carries, and therefore what the candidate sees in
 *  the invitation. Named after the role, not the row id — nobody recognises `#412`. */
export function offerSignatureSubject(title: string): string {
  return `Your offer: ${title}`.slice(0, 200);
}

/** How the signature engine's `documentRef` names an offer, so a request can be traced
 *  back to the row that produced it without a second lookup table. */
export function offerDocumentRef(offerId: number): string {
  return `offer_letter:${offerId}`;
}
