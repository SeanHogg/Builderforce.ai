/**
 * `/api/developer` — the Developer Portal (PRD 24 Phase 1).
 *
 *   Publisher
 *     GET    /orgs                          publishers this user may act for
 *     POST   /orgs                          register one (caller becomes owner)
 *     POST   /orgs/:id/members              add a member
 *     DELETE /orgs/:id/members/:userId      remove one
 *     POST   /orgs/:id/verify-domain        start a domain claim → the TXT record
 *
 *   Packages
 *     GET    /orgs/:id/packages             everything this publisher owns, drafts included
 *     POST   /orgs/:id/packages             create one
 *     GET    /packages/:id/versions         its submission history, with review findings
 *     POST   /packages/:id/versions         submit — static review runs synchronously
 *     POST   /packages/:id/publish          make an approved version the head, and list it
 *     POST   /packages/:id/listing          list / delist
 *
 *   Catalog + installs (tenant-facing)
 *     GET    /catalog                       every listed package
 *     GET    /catalog/:slug                 one listing
 *     GET    /installs                      what this workspace has installed
 *     GET    /installs/preview/:packageId   the consent screen's data (writes nothing)
 *     POST   /installs                      install, with the approved scopes
 *     POST   /installs/:id/update           move to the head (refuses if scopes widened)
 *     DELETE /installs/:id                  uninstall
 *
 * Preview and install are separate calls for the same reason `/plan` and `/build`
 * are separate on realizations: showing somebody what they are about to approve
 * must not itself approve it.
 *
 * This module holds no SQL. Every handler calls an application service, which is
 * what `npm run check:layering` requires of a new route and what makes the scope
 * rules testable without an HTTP server.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import type { Env, HonoEnv } from '../../env';
import {
  addMember,
  beginDomainVerification,
  createDeveloperOrg,
  DeveloperOrgError,
  listMembershipsForUser,
  removeMember,
} from '../../application/developer/developerOrgs';
import {
  EXTENSION_SCOPES,
  SUBMITTABLE_KINDS,
  type DeveloperRole,
  type ListingState,
} from '../../application/developer/extensionContract';
import {
  createPackage,
  getPublicPackage,
  listPackagesForOrg,
  listPublicCatalog,
  listVersions,
  publishVersion,
  setListingState,
  submitVersion,
} from '../../application/developer/extensionPackages';
import {
  installPackage,
  listInstalls,
  previewInstall,
  uninstallPackage,
  updateInstall,
} from '../../application/developer/extensionInstalls';

/** Map an application error onto its status once, rather than in fifteen handlers. */
function fail(error: unknown): { body: { error: string }; status: 400 | 403 | 404 | 409 | 500 } {
  if (error instanceof DeveloperOrgError) return { body: { error: error.message }, status: error.status };
  return { body: { error: error instanceof Error ? error.message : 'unexpected error' }, status: 500 };
}

export function createDeveloperRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Everything here is a signed-in action: a publisher acts as a person, and an
  // install is a workspace admin's decision. The public catalog is authenticated
  // too in Phase 1 — it becomes part of the unauthenticated `/integrations`
  // projection in Phase 3, where the caching story is the page's, not this route's.
  router.use('*', authMiddleware);

  const ctx = (c: { get: (k: string) => unknown; env: Env }) => ({
    userId: c.get('userId') as string | undefined,
    tenantId: c.get('tenantId') as number | undefined,
    env: c.env,
  });

  // ── The contract itself, so a client never hardcodes the vocabulary ───────
  router.get('/contract', (c) =>
    c.json({ kinds: SUBMITTABLE_KINDS, scopes: EXTENSION_SCOPES }),
  );

  // ── Publishers ────────────────────────────────────────────────────────────

  router.get('/orgs', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ memberships: await listMembershipsForUser(db, env, userId) });
  });

  router.post('/orgs', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { legalName?: string; slug?: string; website?: string; supportEmail?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    try {
      const org = await createDeveloperOrg(db, env, {
        userId,
        legalName: body.legalName ?? '',
        slug: body.slug,
        website: body.website ?? null,
        supportEmail: body.supportEmail ?? null,
      });
      return c.json({ org }, 201);
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.post('/orgs/:id/members', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { userId?: string; role?: DeveloperRole };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    if (!body.userId) return c.json({ error: 'userId is required' }, 400);
    try {
      await addMember(db, env, {
        orgId: c.req.param('id'),
        actorUserId: userId,
        userId: body.userId,
        role: body.role ?? 'publisher',
      });
      return c.json({ ok: true });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.delete('/orgs/:id/members/:userId', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    try {
      await removeMember(db, env, {
        orgId: c.req.param('id'),
        actorUserId: userId,
        userId: c.req.param('userId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.post('/orgs/:id/verify-domain', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { domain?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    try {
      const challenge = await beginDomainVerification(db, env, {
        orgId: c.req.param('id'),
        actorUserId: userId,
        domain: body.domain ?? '',
      });
      return c.json({ challenge });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  // ── Packages ──────────────────────────────────────────────────────────────

  router.get('/orgs/:id/packages', async (c) => {
    const { userId } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    try {
      return c.json({ packages: await listPackagesForOrg(db, c.req.param('id'), userId) });
    } catch (error) {
      const { body, status } = fail(error);
      return c.json(body, status);
    }
  });

  router.post('/orgs/:id/packages', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = {
      kind?: string; name?: string; slug?: string; tagline?: string;
      description?: string; categories?: string[]; docsUrl?: string;
    };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    try {
      const pkg = await createPackage(db, env, {
        orgId: c.req.param('id'),
        actorUserId: userId,
        kind: body.kind ?? '',
        name: body.name ?? '',
        slug: body.slug,
        tagline: body.tagline,
        description: body.description ?? null,
        categories: body.categories,
        docsUrl: body.docsUrl ?? null,
      });
      return c.json({ package: pkg }, 201);
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.get('/packages/:id/versions', async (c) => {
    const { userId } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    try {
      return c.json({ versions: await listVersions(db, c.req.param('id'), userId) });
    } catch (error) {
      const { body, status } = fail(error);
      return c.json(body, status);
    }
  });

  /**
   * Submit a version.
   *
   * A REJECTED submission is still a 201, and that is deliberate: the version row
   * WAS created — rejected submissions are kept, with their findings, so the
   * publisher's third attempt can see the first two. An error status would also
   * make every HTTP client discard the body, and the body IS the fix list. The
   * outcome is `approved`, which callers branch on.
   */
  router.post('/packages/:id/versions', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { semver?: string; spec?: unknown; requestedScopes?: string[]; changelog?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    try {
      const { version, approved } = await submitVersion(db, env, {
        packageId: c.req.param('id'),
        actorUserId: userId,
        semver: body.semver ?? '',
        spec: body.spec ?? {},
        requestedScopes: body.requestedScopes ?? [],
        changelog: body.changelog ?? null,
      });
      return c.json({ version, approved }, 201);
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.post('/packages/:id/publish', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { versionId?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    if (!body.versionId) return c.json({ error: 'versionId is required' }, 400);
    try {
      const pkg = await publishVersion(db, env, {
        packageId: c.req.param('id'),
        versionId: body.versionId,
        actorUserId: userId,
      });
      return c.json({ package: pkg });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.post('/packages/:id/listing', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { state?: ListingState };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    if (body.state !== 'listed' && body.state !== 'delisted' && body.state !== 'draft') {
      return c.json({ error: 'state must be draft, listed or delisted' }, 400);
    }
    try {
      const pkg = await setListingState(db, env, {
        packageId: c.req.param('id'),
        actorUserId: userId,
        state: body.state,
      });
      return c.json({ package: pkg });
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  // ── Catalog ───────────────────────────────────────────────────────────────

  router.get('/catalog', async (c) => {
    const { env } = ctx(c);
    return c.json({ packages: await listPublicCatalog(db, env) });
  });

  router.get('/catalog/:slug', async (c) => {
    const { env } = ctx(c);
    const found = await getPublicPackage(db, env, c.req.param('slug'));
    if (!found) return c.json({ error: 'not found' }, 404);
    return c.json(found);
  });

  // ── Installs ──────────────────────────────────────────────────────────────

  router.get('/installs', async (c) => {
    const { tenantId, env } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ installs: await listInstalls(db, env, tenantId) });
  });

  router.get('/installs/preview/:packageId', async (c) => {
    const { tenantId } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    try {
      return c.json({ preview: await previewInstall(db, { tenantId, packageId: c.req.param('packageId') }) });
    } catch (error) {
      const { body, status } = fail(error);
      return c.json(body, status);
    }
  });

  router.post('/installs', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    type Body = { packageId?: string; approvedScopes?: string[]; connectionId?: string };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    if (!body.packageId) return c.json({ error: 'packageId is required' }, 400);
    try {
      const install = await installPackage(db, env, {
        tenantId,
        packageId: body.packageId,
        userId,
        approvedScopes: body.approvedScopes ?? [],
        connectionId: body.connectionId ?? null,
      });
      return c.json({ install }, 201);
    } catch (error) {
      const { body: b, status } = fail(error);
      return c.json(b, status);
    }
  });

  router.post('/installs/:id/update', async (c) => {
    const { tenantId, env } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    try {
      const install = await updateInstall(db, env, { tenantId, installId: c.req.param('id') });
      return c.json({ install });
    } catch (error) {
      const { body, status } = fail(error);
      return c.json(body, status);
    }
  });

  router.delete('/installs/:id', async (c) => {
    const { tenantId, env } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    try {
      await uninstallPackage(db, env, { tenantId, installId: c.req.param('id') });
      return c.json({ ok: true });
    } catch (error) {
      const { body, status } = fail(error);
      return c.json(body, status);
    }
  });

  return router;
}
