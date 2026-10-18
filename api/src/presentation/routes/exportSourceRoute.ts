/**
 * The ONE HTTP adapter over `application/export/exportSource` — how any export
 * source is served, from the generic door or from a domain's historical path.
 *
 *   router.get('/compliance/export', exportSourceHandler(evidencePackExportSource, db));
 *
 * It enforces the source's DECLARED access (tenant role + paid-plan feature;
 * platform sources sit behind `superAdminMiddleware` wherever they are mounted),
 * builds the context, loads the rows, and answers through `renderExport`. A
 * historical route therefore cannot drift from the generic `/api/exports/sources/:id`:
 * they are the same handler over the same source.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { ForbiddenError } from '../../domain/shared/errors';
import { hasMinRole } from '../../domain/shared/types';
import { requestDb } from '../../application/shared/dbHandle';
import {
  exportSourcePath,
  renderExport,
  resolveExportFormat,
  type ExportSource,
  type PlatformExportContext,
  type TenantExportSource,
} from '../../application/export/exportSource';
import { planFeatureGate } from '../middleware/insightPlanGate';
import { legacyAliasNotice } from '../middleware/legacyAlias';

/** May the (already authenticated) caller pull this tenant source? */
export function canPullTenantSource(role: string | null | undefined, source: TenantExportSource): boolean {
  return hasMinRole(role, source.minRole);
}

/**
 * Serve `source` for this request. Assumes the caller's router already ran the
 * authentication its scope needs (`authMiddleware` for tenant sources,
 * `superAdminMiddleware` for platform ones) — the generic route picks that per
 * source; a historical router already had it.
 */
export async function serveExportSource(c: Context<HonoEnv>, source: ExportSource, db?: Db): Promise<Response> {
  const now = Date.now();
  const format = resolveExportFormat(source, c.req.query('format'));
  const routeParams = c.req.param() as Record<string, string | undefined>;
  const base: PlatformExportContext = {
    db: db ?? requestDb(c),
    env: c.env as Env,
    userId: (c.get('userId') as string | undefined) ?? null,
    // Route params first (`/report/:year/csv`), then the query string — so a
    // historical path and `/api/exports/sources/:id?year=` read the same name.
    param: (name) => routeParams[name] ?? c.req.query(name),
    now,
  };

  if (source.scope === 'platform') {
    return renderExport(await source.load(base, format), format, now);
  }

  if (!canPullTenantSource(c.get('role') as string | undefined, source)) {
    throw new ForbiddenError(`Requires at least '${source.minRole}' role, caller has '${c.get('role')}'`);
  }
  if (source.planFeature) {
    const gate = await planFeatureGate(c, source.planFeature);
    if (gate) return gate;
  }
  const result = await source.load({
    ...base,
    tenantId: c.get('tenantId') as number,
    segmentId: c.get('segmentId') as string,
  }, format);
  return renderExport(result, format, now);
}

/**
 * A route handler that serves one source at a domain's HISTORICAL path — kept so
 * deployed clients and bookmarks keep working, and stamped as a deprecated alias
 * (`Deprecation` + `Link: rel="successor-version"`, via the ONE `legacyAliasNotice`)
 * naming `/api/exports/sources/:id` as the successor. In-repo callers use the
 * canonical door.
 */
export function exportSourceHandler(source: ExportSource, db?: Db) {
  const notice = legacyAliasNotice(exportSourcePath(source.id));
  return async (c: Context<HonoEnv>): Promise<Response> => {
    // The notice stamps its headers AFTER `next`, onto `c.res` — so the download
    // is assigned there, and what the notice leaves on it is the answer.
    await notice(c, async () => { c.res = await serveExportSource(c, source, db); });
    return c.res;
  };
}
