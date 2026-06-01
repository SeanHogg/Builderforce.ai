/**
 * BI burn-rate pull (BuilderForce → host, spec 05 §4.1).
 *
 * BuilderForce PULLS the Segment's current monthly burn + runway from the host's
 * BI endpoint so cost-aware planning (cost-per-point, runway-aware sprint caps)
 * has real numbers. This is the reverse direction from the other seams: the
 * token presenting `read:bi.burn` is ISSUED BY THE HOST and stored here as BI
 * config — it is not a BuilderForce-issued tenant key.
 *
 * Everything degrades gracefully: missing config, a timeout, a non-200, or a
 * malformed body all return `{ available: false }` so callers fall back to
 * manual burn input rather than failing the request.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenants, segments } from '../../infrastructure/database/schema';

export interface BurnRate {
  available: boolean;
  monthlyBurn?: number;
  runwayMonths?: number;
  /** 'host' when pulled live; absent when unavailable. */
  source?: 'host';
  /** Machine-readable reason when unavailable (for logs / UI hints). */
  reason?: 'not_configured' | 'no_company' | 'unreachable' | 'bad_response';
}

interface HostBiConfig {
  baseUrl: string;
  token: string;
}

const FETCH_TIMEOUT_MS = 5_000;

function readHostBi(settingsRaw: string | null | undefined): HostBiConfig | null {
  if (!settingsRaw) return null;
  try {
    const parsed = JSON.parse(settingsRaw) as { hostBi?: { baseUrl?: unknown; token?: unknown } };
    const baseUrl = parsed.hostBi?.baseUrl;
    const token = parsed.hostBi?.token;
    if (typeof baseUrl === 'string' && /^https:\/\//.test(baseUrl) && typeof token === 'string' && token) {
      return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
    }
  } catch { /* fall through */ }
  return null;
}

function toFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export interface FetchBurnRateArgs {
  tenantId: number;
  segmentId: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the Segment's burn/runway from the host BI endpoint. Never throws —
 * returns `{ available: false, reason }` on any failure.
 */
export async function fetchBurnRate(db: Db, args: FetchBurnRateArgs): Promise<BurnRate> {
  const doFetch = args.fetchImpl ?? fetch;

  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  const config = readHostBi(tenant?.settings);
  if (!config) return { available: false, reason: 'not_configured' };

  // The host keys burn by its own company id (our segment's externalCompanyId).
  const [segment] = await db
    .select({ externalAccountId: segments.externalAccountId, externalCompanyId: segments.externalCompanyId })
    .from(segments)
    .where(eq(segments.id, args.segmentId))
    .limit(1);
  const companyId = segment?.externalCompanyId;
  if (!companyId) return { available: false, reason: 'no_company' };

  const qs = new URLSearchParams({ companyId });
  if (segment?.externalAccountId) qs.set('accountId', segment.externalAccountId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(`${config.baseUrl}/api/bi/burn-rate?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    if (!res.ok) return { available: false, reason: 'unreachable' };
    const body = (await res.json()) as Record<string, unknown>;
    const monthlyBurn = toFiniteNumber(body.monthlyBurn);
    const runwayMonths = toFiniteNumber(body.runwayMonths);
    if (monthlyBurn === undefined && runwayMonths === undefined) {
      return { available: false, reason: 'bad_response' };
    }
    return { available: true, source: 'host', monthlyBurn, runwayMonths };
  } catch {
    return { available: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
