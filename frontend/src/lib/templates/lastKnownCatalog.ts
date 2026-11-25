/**
 * The installable template catalogue, kept readable when the API is not.
 *
 * A successful list read is persisted (per workspace — the answer is
 * tenant-scoped, so one person's saved copy is never served to another); a read
 * that fails because the network is gone or the platform is out answers from that
 * copy instead. With no copy, the failure propagates and the caller falls back to
 * the bundled prompt/pack entries it merges anyway. Writes (install / setup /
 * publish) never go through here: they stay online-only and throw the transport
 * error to the wizard.
 */

import { readLocalJson, writeLocalJson } from '@/lib/storage';
import { isServiceOutage } from '@/lib/errors/serviceOutage';
import { TRANSPORT_FAILURE_STATUS } from '@/lib/errors/transportFailure';
import type { TemplateSummary } from './api';

const STORAGE_PREFIX = 'bf:template-catalog:v1:';

/** True when the failure means "the catalogue is unreachable", not "this request is wrong". */
export function isCatalogUnavailable(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === undefined) return false;
  if (status === TRANSPORT_FAILURE_STATUS || status >= 500) return true;
  return isServiceOutage({ status, code: typeof e?.code === 'string' ? e.code : undefined });
}

export async function listWithLastKnownGood(
  tenantKey: string,
  fetchList: () => Promise<TemplateSummary[]>,
): Promise<TemplateSummary[]> {
  const key = `${STORAGE_PREFIX}${tenantKey}`;
  try {
    const templates = await fetchList();
    writeLocalJson(key, templates);
    return templates;
  } catch (error) {
    if (!isCatalogUnavailable(error)) throw error;
    const saved = readLocalJson<TemplateSummary[]>(key);
    if (Array.isArray(saved)) return saved;
    throw error;
  }
}
