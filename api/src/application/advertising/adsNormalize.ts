/**
 * The shared normalization primitives every ads adapter is built from.
 *
 * Split out of `adsProviders.ts` for a RUNTIME reason, not a stylistic one. The
 * registry has to import all eight adapters, and every adapter imports these helpers —
 * so with both in one module, `ADS_CONNECTOR_KEYS` (evaluated at import time from
 * `PROVIDERS`) ran while `PROVIDERS` was still in the temporal dead zone, and importing
 * the module threw. Moving the VALUES here leaves `adsProviders.ts` importing adapters
 * and adapters importing only TYPES from it, and a type-only cycle is erased at compile
 * time. `adsProviders.ts` re-exports everything below, so no caller needs to know.
 */

import type { AdCall, AdCallResult, AdInsightRow, AdObjective } from './adsProviders';

/** A network said no. `retryable` decides whether a sweep or a launch requeues — the
 *  same distinction `social/socialProviders` draws, for the same reason. */
export class AdsProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = 'AdsProviderError';
  }
}

/** 429 and 5xx are worth another attempt; a rejected token or a malformed budget is not. */
export function isRetryableAdStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}


export const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const text = (value: unknown): string => (value == null ? '' : String(value));

/** A count. Negative and non-finite both mean "the network did not say", which is 0 —
 *  a negative impression count has no meaning and would poison every rollup above it. */
export const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Money → integer cents, from whatever unit the network used.
 *
 * `scale` is how many of the network's units make one MAJOR currency unit: 1_000_000
 * for micros, 100 for a currency minor unit, 1 for a major unit. Rounding is applied
 * once, at the end, so a chain of conversions cannot drift — and the result is always
 * an integer, because the column is an integer and a float that reaches it truncates
 * silently in the wrong direction.
 */
export function toCents(value: unknown, scale: number): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / scale) * 100);
}

/** Cents → the network's own unit, for a budget going the other way. */
export function fromCents(cents: number | null | undefined, scale: number): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return Math.round((cents / 100) * scale);
}

/** Provider timestamps arrive as ISO strings, epoch seconds, or epoch milliseconds. */
export function toISO(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    // Epoch SECONDS and epoch MILLISECONDS are both common and differ by 1000x, so
    // guessing wrong dates a campaign to 1970 or to the year 55000. The threshold is
    // "would this be a sane date read as seconds" — anything larger is milliseconds.
    const ms = value > 100_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A YYYY-MM-DD day, from whatever the network put in its date column. */
export function toDay(value: unknown): string {
  const iso = toISO(value);
  if (iso) return iso.slice(0, 10);
  // Several networks report the day already formatted; keep it rather than lose it.
  const raw = text(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

/** Unwrap a call, turning a non-ok result into a typed, retry-classified error. */
export async function ask(
  call: AdCall,
  actionKey: string,
  input: Record<string, unknown> = {},
  opts?: { captureHeaders?: readonly string[] },
): Promise<AdCallResult> {
  const result = await call(actionKey, input, opts);
  if (!result.ok) {
    throw new AdsProviderError(
      result.error?.slice(0, 400) || `The network returned ${result.status}`,
      result.status || 502,
      isRetryableAdStatus(result.status),
    );
  }
  return result;
}

/** A missing account-scope field is a CONFIGURATION error, fixed by editing the
 *  connection — so it must never be retried, and must never reach a spend call. */
export function requireField(fields: Record<string, string>, key: string, label: string): string {
  const value = (fields[key] ?? '').trim();
  if (!value) throw new AdsProviderError(`This connection is missing ${label}. Add it to the connection and try again.`, 409, false);
  return value;
}

/** Refuse an objective this network cannot serve, by name, before anything is spent. */
export function mapObjective<T extends string>(
  provider: { label: string; objectives: readonly AdObjective[] },
  table: Partial<Record<AdObjective, T>>,
  objective: AdObjective,
): T {
  const native = table[objective];
  if (!native) {
    throw new AdsProviderError(
      `${provider.label} cannot run a “${objective}” campaign. It supports: ${provider.objectives.join(', ')}.`,
      400,
      false,
    );
  }
  return native;
}

/** Read a native objective back into our vocabulary, for a campaign made elsewhere. */
export function unmapObjective<T extends string>(
  table: Partial<Record<AdObjective, T>>,
  native: string | null,
): AdObjective | null {
  if (!native) return null;
  const upper = native.toUpperCase();
  for (const [objective, value] of Object.entries(table)) {
    if (String(value).toUpperCase() === upper) return objective as AdObjective;
  }
  return null;
}

/** Sum many days of one campaign into one row — used by every rollup above this port. */
export function totalInsights(rows: readonly AdInsightRow[]): Omit<AdInsightRow, 'date' | 'externalCampaignId'> {
  return rows.reduce(
    (acc, row) => ({
      spendCents: acc.spendCents + row.spendCents,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      conversions: acc.conversions + row.conversions,
      currency: row.currency || acc.currency,
    }),
    { spendCents: 0, impressions: 0, clicks: 0, conversions: 0, currency: 'USD' },
  );
}
