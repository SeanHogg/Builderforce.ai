/**
 * Validation-engagements proxy (BuilderForce → host, spec 05 §4.2 PM-4).
 *
 * Lists the host's feedback widgets / validation cohorts ("engagements") for the
 * caller's Segment so the Voice-of-Customer surface can show which validation
 * instruments are live alongside the ingested `customer_feedback` rows. Same
 * direction + auth as the BI burn-rate pull: it uses the host-issued BI config
 * (`tenants.settings.hostBi = { baseUrl, token }`) to call the host read API.
 *
 * Everything degrades gracefully — missing config, no segment company, a timeout,
 * a non-200, or a malformed body all return `{ available: false, reason }` so the
 * inbox renders the stored feedback without the host overlay rather than erroring.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenants, segments } from '../../infrastructure/database/schema';

export interface ValidationEngagement {
  id: string;
  name?: string;
  kind?: string;
  status?: string;
  responses?: number;
}

export interface ValidationEngagements {
  available: boolean;
  engagements?: ValidationEngagement[];
  source?: 'host';
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
  } catch {
    /* fall through */
  }
  return null;
}

/** Normalise one host engagement record to our shape (defensive on field names). */
function toEngagement(raw: unknown): ValidationEngagement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = r.id ?? r.engagementId ?? r.widgetId;
  if (id == null) return null;
  return {
    id: String(id),
    name: typeof r.name === 'string' ? r.name : typeof r.title === 'string' ? r.title : undefined,
    kind: typeof r.kind === 'string' ? r.kind : typeof r.type === 'string' ? r.type : undefined,
    status: typeof r.status === 'string' ? r.status : undefined,
    responses: typeof r.responses === 'number' ? r.responses : typeof r.responseCount === 'number' ? r.responseCount : undefined,
  };
}

export interface FetchEngagementsArgs {
  tenantId: number;
  segmentId: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the Segment's validation engagements from the host. Never throws —
 * returns `{ available: false, reason }` on any failure.
 */
export async function fetchValidationEngagements(db: Db, args: FetchEngagementsArgs): Promise<ValidationEngagements> {
  const doFetch = args.fetchImpl ?? fetch;

  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  const config = readHostBi(tenant?.settings);
  if (!config) return { available: false, reason: 'not_configured' };

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
    const res = await doFetch(`${config.baseUrl}/api/validation/engagements?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    if (!res.ok) return { available: false, reason: 'unreachable' };
    const body = (await res.json()) as Record<string, unknown>;
    const list = Array.isArray(body.engagements) ? body.engagements : Array.isArray(body) ? (body as unknown[]) : null;
    if (!list) return { available: false, reason: 'bad_response' };
    const engagements = list.map(toEngagement).filter((e): e is ValidationEngagement => e !== null);
    return { available: true, source: 'host', engagements };
  } catch {
    return { available: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
