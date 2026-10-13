/**
 * ONE `PageFacts` per key page (PRD 33 §5.2) — what the page-review rules, the vision
 * review and the page score read. Cached under the site's version token (a capture
 * callback bumps it).
 *
 *   captures   the newest capture of each device (`replay_page_captures`)
 *   behaviour  sessions / conversions / frustration on the page's route, per device
 *   vitals     FIELD p75 of LCP / CLS / INP from `replay_vitals_daily`
 *   search     Search Console through the analytics port — `connected: false` when it
 *              is not, never zeros
 * A key page with no capture yet has no facts to review and is left out.
 */

import type { ReplayCaptureDevice } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { DAY_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';
import {
  EMPTY_VITALS,
  type PageCaptureFacts,
  type PageFacts,
  type PageSearchFacts,
} from '../../domain/replay/prescriptions/pageFacts';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { listCaptures, toCaptureDto, type CaptureRow } from './pageCaptureStore';
import { emptySplit, readPageBehaviour, readPageVitals } from './pageFactsReads';
import { pagesSearchFacts } from './pageSearchFacts';
import { pagesToReview } from './pageSelection';
import { siteOrigin } from './pageCapture';
import type { ReplaySiteRecord } from './replaySites';

const TTL = { kvTtlSeconds: 600, l1TtlMs: 60_000 };

/** Pure: the newest capture per path and device (rows newest first). */
export function newestCaptures(rows: readonly CaptureRow[]): Map<string, Partial<Record<ReplayCaptureDevice, CaptureRow>>> {
  const out = new Map<string, Partial<Record<ReplayCaptureDevice, CaptureRow>>>();
  for (const row of rows) {
    const device: ReplayCaptureDevice | null = row.deviceClass === 'desktop' || row.deviceClass === 'phone' ? row.deviceClass : null;
    if (!device) continue;
    const entry = out.get(row.path) ?? {};
    if (!entry[device]) entry[device] = row;
    out.set(row.path, entry);
  }
  return out;
}

function captureFacts(row: CaptureRow | undefined): PageCaptureFacts | null {
  if (!row) return null;
  const dto = toCaptureDto(row);
  return { captureId: dto.id, releaseKey: dto.releaseKey, seo: dto.seo, content: dto.content, labPerf: dto.labPerf, a11y: dto.a11y };
}

/** The key pages' facts (cached). */
export async function buildPageFacts(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  opts: { days: number; now?: Date },
): Promise<PageFacts[]> {
  const scope: ReplayScope = { tenantId: site.tenantId, siteId: site.id };
  const now = opts.now ?? new Date();
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.pageFacts(opts.days), async () => {
    const paths = await pagesToReview(env, db, scope, { now });
    const newest = newestCaptures(await listCaptures(db, site.id, { paths }));
    const captured = paths.filter((p) => newest.has(p));
    if (captured.length === 0) return [];

    const store = replayTelemetryDb(env, db);
    const sinceDay = new Date(now.getTime() - opts.days * DAY_MS).toISOString().slice(0, 10);
    const origin = await siteOrigin(env, db, site).catch(() => null);
    const [behaviour, vitals, search] = await Promise.all([
      readPageBehaviour(store, scope, captured, sinceDay),
      readPageVitals(store, scope, captured, sinceDay),
      origin
        ? pagesSearchFacts(env, db, site.tenantId, captured.map((p) => `${origin}${p}`))
        : Promise.resolve(new Map<string, PageSearchFacts>()),
    ]);

    return captured.map((path): PageFacts => {
      const rows = newest.get(path) ?? {};
      return {
        path,
        captures: { desktop: captureFacts(rows.desktop), phone: captureFacts(rows.phone) },
        behaviour: behaviour.pages.get(path) ?? emptySplit(),
        site: behaviour.site,
        vitals: vitals.get(path) ?? { desktop: { ...EMPTY_VITALS }, phone: { ...EMPTY_VITALS } },
        search: (origin ? search.get(`${origin}${path}`) : undefined) ?? { connected: false },
      };
    });
  }, TTL);
}
