/**
 * The RETURN LEG — reading a signature request back onto the card that sent it.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `canvas_request_signature` wrote `signatureState: 'sent'` and a request id, and
 * nothing ever wrote anything after that. So every kind that sends one — `contract`,
 * `offer`, `policy` — showed who was ASKED and never who answered:
 *
 *   - `contract.signatureState` / `signedAt` were declared as "written by the sign
 *     flow" by a flow that only ever wrote the first of them, once.
 *   - `policy.roster` and `policy.acknowledgementRate` were declared as "written by
 *     the signature subsystem, never by hand", and the signature subsystem had no
 *     writer for either. So "who has not signed the handbook" — the entire reason
 *     the object exists — was unanswerable from the object that asked.
 *
 * ── WHY ONE PROJECTION AND NOT A FIELD-WRITER PER KIND ──────────────────────
 * `signatureProgress()` already returns the same shape for every request: the
 * status, the counts, and one row per party with what they did and when. What
 * differs between kinds is only which FIELDS that shape lands on, and that is
 * data — {@link SIGNATURE_TARGET_FIELDS} — not three functions. A fourth kind that
 * declares the bookkeeping pair is one entry here.
 *
 * Same direction as the pipeline projection, for the same reason: the card is
 * overwritten FROM the record, so there is nothing to mirror and nothing to forget.
 */

import type { SignatureProgress } from '@/lib/founderOpsApi';

/**
 * Where one kind puts the answer.
 *
 * `roster` and `rate` are optional because most kinds do not have them: a contract
 * has two signatories and a progress meter would be noise, while a policy's whole
 * point is the roster. Declaring it per kind rather than writing it everywhere is
 * what stops a `contract` growing an `acknowledgementRate` nobody asked for.
 */
export interface SignatureTargetFields {
  /** Rows field for the per-party answer, when the kind declares one. */
  roster?: string;
  /** Meter field for "share of the required roster who have agreed". */
  rate?: string;
  /** Columns the roster rows use, in the order the spec declares them. */
  rosterColumns?: readonly [string, string, string, string];
}

export const SIGNATURE_TARGET_FIELDS: Readonly<Record<string, SignatureTargetFields>> = {
  // The roster IS the policy: "who must acknowledge and who has".
  policy: { roster: 'roster', rate: 'acknowledgementRate', rosterColumns: ['person', 'requiredBy', 'status', 'acknowledgedAt'] },
  // A contract and an offer carry the state and the date and nothing more — two
  // signatories do not need a meter.
  contract: {},
  offer: {},
};

/**
 * The card fields one signature request projects to.
 *
 * `signedAt` is set ONLY on completion and cleared otherwise, which is the whole
 * distinction the field exists for: a request that was declined has an outcome and
 * no signing date, and a card that kept a stale date would assert an agreement
 * nobody gave.
 */
export function signatureFieldsFrom(kind: string, progress: SignatureProgress): Record<string, unknown> {
  const target = SIGNATURE_TARGET_FIELDS[kind] ?? {};
  const completed = progress.status === 'completed';
  const decided = progress.parties
    .map((party) => party.decidedAt)
    .filter((at): at is string => !!at)
    .sort();

  const fields: Record<string, unknown> = {
    signatureState: progress.status,
    signatureRequestId: progress.requestId,
    // The LAST decision is when it became fully agreed — not the first, which is
    // when one person agreed and the document was still open.
    signedAt: completed ? (decided[decided.length - 1] ?? '') : '',
  };

  if (target.roster) {
    const columns = target.rosterColumns ?? ['person', 'requiredBy', 'status', 'acknowledgedAt'];
    fields[target.roster] = progress.parties.map((party) => ({
      [columns[0]!]: party.name || party.email,
      [columns[1]!]: party.email,
      [columns[2]!]: party.status,
      [columns[3]!]: party.decidedAt ? party.decidedAt.slice(0, 10) : '',
    }));
  }
  if (target.rate) {
    // Agreed over total, NOT settled over total: somebody who declined has
    // answered and has not acknowledged, and counting them as progress is the one
    // arithmetic error this meter must not make.
    fields[target.rate] = progress.total ? Math.round((progress.agreed / progress.total) * 100) : 0;
  }
  return fields;
}

/** The one-line summary a card carries beside the meter. Says what is OUTSTANDING,
 *  because that is the number somebody acts on. */
export function signatureSummary(progress: SignatureProgress): string {
  const outstanding = progress.total - progress.settled;
  const verb = progress.intent === 'acknowledge' ? 'acknowledged' : 'signed';
  const declined = progress.parties.filter((party) => party.status === 'declined').length;
  return [
    `${progress.agreed} of ${progress.total} ${verb}`,
    outstanding > 0 ? `${outstanding} still to answer` : 'everyone has answered',
    declined > 0 ? `${declined} declined` : '',
    `request ${progress.status}`,
  ].filter(Boolean).join(' · ') + '.';
}
