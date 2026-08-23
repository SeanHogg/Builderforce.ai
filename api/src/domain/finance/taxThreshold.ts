/**
 * WHO GETS A FORM — the 1099 reporting rules, as pure functions.
 *
 * These are the only decisions in tax reporting that are neither a database
 * query nor a CSV column, and they are the ones a mistake is expensive in: a
 * recipient wrongly excluded is a missing filing, and a recipient wrongly
 * included is somebody's tax ID on a form they should not be on. They live in
 * the domain layer with a test file rather than inline in the report so the
 * rules can be read, argued with and changed without touching a query.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────
 *  • A US recipient is reportable on a 1099-NEC at $600 or more for the calendar
 *    year. The IRS threshold is "$600 or more", not "more than $600" — an exact
 *    $600.00 recipient IS reportable, which is the boundary a `>` gets wrong.
 *  • A non-US recipient is reported on a 1042-S / W-8 path with no de-minimis
 *    floor, so any payment at all is reportable.
 *  • Residency is what decides, NOT the mailing address: a US citizen with an
 *    address abroad still gets a 1099. Absent residency we assume US, because
 *    over-reporting a domestic payee is the recoverable error and silently
 *    dropping one is not.
 *
 * Amounts are `usd_cents` throughout — the ledger's denomination. There is no
 * float in this module on purpose; a threshold comparison is exactly the place a
 * rounding error changes an answer.
 */

/** IRS 1099-NEC de-minimis for non-employee compensation, in cents. */
export const US_1099_NEC_THRESHOLD_CENTS = 60_000;

/** How the recipient is filed. Drives the form's "Recipient Type" column. */
export type RecipientType = 'individual' | 'business' | 'unknown';

/** The W-9 entity types this platform collects, and how each files. */
const ENTITY_TYPE_FILING: Record<string, RecipientType> = {
  individual: 'individual',
  sole_proprietor: 'individual',
  single_member_llc: 'individual',
  llc: 'business',
  corporation: 'business',
  c_corporation: 'business',
  s_corporation: 'business',
  partnership: 'business',
  trust: 'business',
  estate: 'business',
  business: 'business',
};

/** Every entity type a tax profile may declare — the form's select options. */
export const ENTITY_TYPES = Object.keys(ENTITY_TYPE_FILING);

/**
 * Derive how a recipient files from their declared W-9 entity type.
 *
 * A single-member LLC files as its owner ("disregarded entity"), which is why it
 * maps to `individual` and not to `business` alongside the other LLCs — the one
 * mapping in this table that is not the obvious one.
 */
export function recipientTypeFor(entityType: string | null | undefined): RecipientType {
  if (!entityType) return 'unknown';
  return ENTITY_TYPE_FILING[entityType.trim().toLowerCase()] ?? 'unknown';
}

/** Is this recipient filed under the US domestic (1099) regime? */
export function isUsRecipient(taxResidencyCountry: string | null | undefined): boolean {
  const country = (taxResidencyCountry ?? 'US').trim().toUpperCase();
  return country === '' || country === 'US' || country === 'USA';
}

/** Which form a recipient's residency puts them on. */
export function formTypeFor(taxResidencyCountry: string | null | undefined): '1099-NEC' | '1042-S' {
  return isUsRecipient(taxResidencyCountry) ? '1099-NEC' : '1042-S';
}

export interface ThresholdVerdict {
  /** Whether the recipient must be filed for this year. */
  reportable: boolean;
  /** Which form they fall under. */
  formType: '1099-NEC' | '1042-S';
  /** Why, in words — the report's audit column, for a human spot-check. */
  reason: string;
}

/**
 * Decide whether a year's total for one recipient is reportable, and say why.
 *
 * The `reason` is not decoration: the report's CSV carries it so whoever files
 * can see at a glance why a name they expected is absent, without re-deriving
 * the rule from a boolean.
 */
export function evaluateThreshold(
  totalPaidCents: number,
  taxResidencyCountry: string | null | undefined,
): ThresholdVerdict {
  const formType = formTypeFor(taxResidencyCountry);

  if (formType === '1042-S') {
    return {
      reportable: totalPaidCents > 0,
      formType,
      reason: totalPaidCents > 0
        ? 'Non-US recipient — reportable from the first dollar, no de-minimis threshold.'
        : 'Non-US recipient with no payments in the year.',
    };
  }

  const meets = totalPaidCents >= US_1099_NEC_THRESHOLD_CENTS;
  return {
    reportable: meets,
    formType,
    reason: meets
      ? `US recipient at or above the $${US_1099_NEC_THRESHOLD_CENTS / 100} 1099-NEC threshold.`
      : `US recipient below the $${US_1099_NEC_THRESHOLD_CENTS / 100} 1099-NEC threshold.`,
  };
}

/** The UTC half-open bounds of a calendar year: `[start, end)`. */
export function calendarYearBounds(year: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

/** Is `year` a plausible tax year to report on? Rejects junk at the boundary. */
export function isReportableYear(year: unknown): year is number {
  return typeof year === 'number' && Number.isInteger(year) && year >= 2020 && year <= 2100;
}

/**
 * Keep only the last four characters of a tax ID, digits and letters alike.
 *
 * The report and every read path show this and never the full value. It is here
 * rather than beside the vault because it is the same rule the FORM needs when it
 * echoes back what was submitted.
 */
export function taxIdLast4(taxId: string): string {
  return taxId.replace(/[^0-9A-Za-z]/g, '').slice(-4);
}
