/**
 * `GET REPLAY_PATHS.previewUrl` (PRD 33 §5.1.4, D13): a short-lived link to a hosted
 * release BEFORE anyone publishes it. The grant (`ide/sitePreviewAccess.grantSitePreview`)
 * names one tenant, project and release; the sites Worker serves that release's files
 * to whoever holds the link, privately, uncounted, for 30 minutes.
 */

import type { ReplayPreviewUrlDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../domain/shared/errors';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { HOSTING_APEX } from '../ide/siteHosting';
import { siteForProject } from '../ide/siteTraffic';
import { grantSitePreview, SITE_PREVIEW_PARAM } from '../ide/sitePreviewAccess';
import { hostedProjectOf, releasePrefix } from './prescriptionReleases';
import { getSiteForTenant } from './replaySites';

const RELEASE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export async function previewUrlFor(env: Env, db: Db, scope: ReplayScope, releaseKey: string, now: Date = new Date()): Promise<ReplayPreviewUrlDto> {
  const key = releaseKey.trim();
  if (!RELEASE_KEY.test(key)) throw new ValidationError('releaseKey is not a hosted release');
  const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
  const projectId = hostedProjectOf(site);
  // 409 when the release was pruned; only a release of THIS project's site resolves.
  const r2Prefix = await releasePrefix(db, site.tenantId, projectId, key);
  const hosted = await siteForProject(db, site.tenantId, projectId);
  if (!hosted) throw new NotFoundError('Published site of project', projectId);
  const grant = await grantSitePreview(env, { tenantId: site.tenantId, projectId, versionToken: key, r2Prefix }, now);
  if (!grant) throw new ServiceUnavailableError('Previews are not available on this deploy');
  return {
    releaseKey: key,
    url: `https://${hosted.subdomain}.${HOSTING_APEX}/?${SITE_PREVIEW_PARAM}=${grant.token}`,
    expiresAt: grant.expiresAt.toISOString(),
  };
}
