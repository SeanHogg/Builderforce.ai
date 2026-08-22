/**
 * WHAT COMMUNICATIONS COST — the rate card, as data.
 *
 * ── WHY A CARD AND NOT THE VENDOR'S PRICE ────────────────────────────────────
 * Twilio prices per destination and changes them without asking. Reading a live
 * price before every send would put a vendor round trip in front of every
 * message, and reading it AFTER means billing a tenant for something they were
 * never quoted. So the platform publishes its own rate, marks it up over the
 * worst realistic vendor price, and charges that — the same way every reseller
 * of a metered vendor does.
 *
 * The consequence is stated rather than hidden: on a cheap destination the
 * platform makes margin, and on an expensive one it can lose. That is a pricing
 * decision, and it belongs in a table an operator can read and change, which is
 * this file.
 *
 * ── RATES ARE IN US CENTS, AND THEY ROUND UP AT THE LEDGER ───────────────────
 * A unit price here can be fractional (a segment at 0.9¢); `debitComms` rounds
 * the total up so a message can never be billed at less than it cost.
 */

/** What a metered communications event is. */
export type CommsUnit = 'sms_segment' | 'mms_message' | 'voice_minute' | 'number_month';

export interface CommsRate {
  unit: CommsUnit;
  /** US cents per unit. */
  cents: number;
  label: string;
}

/**
 * The default card. Deliberately flat rather than per-country: a per-destination
 * card is a table of several hundred rows that goes stale silently, and this
 * platform's phone product is aimed at domestic business numbers. A tenant
 * sending to an expensive destination is a case for `CommsRateOverride` below,
 * not for shipping a price list nobody maintains.
 */
export const DEFAULT_COMMS_RATES: readonly CommsRate[] = [
  { unit: 'sms_segment', cents: 2, label: 'SMS (per 160-character segment)' },
  { unit: 'mms_message', cents: 5, label: 'MMS (per message)' },
  { unit: 'voice_minute', cents: 3, label: 'Voice (per minute, rounded up)' },
  { unit: 'number_month', cents: 200, label: 'Phone number (per month)' },
];

const BY_UNIT: ReadonlyMap<CommsUnit, CommsRate> = new Map(DEFAULT_COMMS_RATES.map((r) => [r.unit, r]));

/** A tenant-specific override, stored as a `settings` value. Optional by design:
 *  most tenants use the card. */
export type CommsRateOverride = Partial<Record<CommsUnit, number>>;

export function rateFor(unit: CommsUnit, override?: CommsRateOverride | null): number {
  const custom = override?.[unit];
  if (typeof custom === 'number' && custom >= 0) return custom;
  return BY_UNIT.get(unit)?.cents ?? 0;
}

/**
 * How many SMS segments a body costs.
 *
 * GSM-7 fits 160 characters in one segment and 153 per segment once it is
 * concatenated; a body containing ANY character outside GSM-7 is sent as UCS-2,
 * where the numbers are 70 and 67. Getting this wrong is the single most common
 * way an SMS bill surprises somebody: one emoji in a 90-character message takes
 * it from one segment to two, and a naive `length / 160` says one.
 */
export function smsSegments(body: string): number {
  if (body.length === 0) return 1;
  const unicode = !isGsm7(body);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  if (body.length <= single) return 1;
  return Math.ceil(body.length / multi);
}

/** The GSM 03.38 basic set plus its extension characters. */
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
  + '^{}\\[~]|€',
);

function isGsm7(body: string): boolean {
  for (const char of body) if (!GSM7.has(char)) return false;
  return true;
}

/** Voice is billed per started minute — the vendor's own rule, restated so the
 *  quote a tenant sees matches the debit they get. */
export function voiceMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}
