/**
 * `/api/developer` — the Developer Portal (PRD 24 Phases 1–4).
 *
 *   Publisher — the caller's WORKSPACE, because a developer is a tenant (0472)
 *     GET    /publisher                     this workspace as a publisher, or null
 *     POST   /publisher                     register it as one
 *     POST   /publisher/verify-domain       start a domain claim → the TXT record
 *
 *   Packages
 *     GET    /packages                      everything this publisher owns, drafts included
 *     POST   /packages                      create one
 *     GET    /packages/:id/versions         its submission history, with review findings
 *     POST   /packages/:id/versions         submit — static review runs synchronously
 *     POST   /packages/:id/publish          make an approved version the head, and list it
 *     POST   /packages/:id/listing          list / delist
 *
 *   Directory (PRD 24 Phase 3 — discovery)
 *     GET    /directory/categories          the category taxonomy, which is DATA
 *     GET    /directory                     search + filter + ranked results
 *
 *   Review evidence
 *     GET    /versions/:versionId/review     what each stage exercised, per action
 *
 *   Analytics (publisher-facing, AGGREGATE ONLY — see `installAnalytics.ts`)
 *     GET    /analytics                     installs, churn, version adoption, errors
 *
 *   Plans + earnings (PRD 24 Phase 2 — the publisher's half of the money)
 *     GET    /packages/:id/plans            the price list on the listing's catalog item
 *     PUT    /packages/:id/plans            replace it (identity-verified publishers only)
 *     GET    /earnings                      what this WORKSPACE has earned and may withdraw
 *     POST   /earnings/destination          nominate where the workspace is paid
 *     POST   /earnings/payout               send the available balance
 *
 *   Programs (PRD 24 Phase 4) — read-only; joining a track is an operator act
 *     GET    /programs                      this publisher's track, and what each offers
 *
 *   Catalog + installs (tenant-facing)
 *     GET    /catalog                       every listed package
 *     GET    /catalog/:slug                 one listing
 *     GET    /installs                      what this workspace has installed
 *     GET    /installs/preview/:packageId   the consent screen's data (writes nothing)
 *     POST   /installs                      install a FREE package, with the approved scopes
 *     POST   /installs/checkout             start a PAID install — pick a plan, then pay
 *     POST   /installs/checkout/complete    settle it; the install is created here
 *     POST   /installs/:id/cancel-plan      stop paying (closes the open metered period)
 *     GET    /installs/:id/usage            the open period and the reports behind it
 *     POST   /installs/:id/update           move to the head (refuses if scopes widened)
 *     DELETE /installs/:id                  uninstall
 *
 * The VENDOR's own API — the install-scoped token a publisher's integration
 * server calls us with, and the usage it reports — is not here. It lives on
 * `/api/v1` with every other credentialed machine surface, because a vendor
 * authenticates with a key rather than a session and must not be routed through
 * a door that assumes one. See `publicExtensionApiService.ts`.
 *
 * Preview and install are separate calls for the same reason `/plan` and `/build`
 * are separate on realizations: showing somebody what they are about to approve
 * must not itself approve it.
 *
 * There are no member endpoints, and their absence is the point of migration 0472.
 * A publisher's staff are its WORKSPACE's members, managed where workspace members
 * have always been managed. Publishing gained no second membership to keep in sync.
 * For the same reason no publisher id appears in a path: the caller's workspace is
 * on the JWT, so an id in the URL would be a second, forgeable answer to a question
 * the token has already settled.
 *
 * This module holds no SQL. Every handler calls an application service, which is
 * what `npm run check:layering` requires of a new route and what makes the scope
 * rules testable without an HTTP server. A `PublisherError` carries its own status
 * (400 / 403 / 404 / 409) and is rendered by the global handler through `statusOf`;
 * nothing is caught here.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import type { Env, HonoEnv } from '../../env';
import {
  becomePublisher,
  beginDomainVerification,
  requirePublisher,
  publisherFor,
  setPayoutDestination,
} from '../../application/developer/publishers';
import { verifyPublisherDomain } from '../../application/developer/domainVerification';
import {
  EXTENSION_SCOPES,
  LISTING_STATES,
  SUBMITTABLE_KINDS,
} from '../../application/developer/extensionContract';
import {
  createPackage,
  getPublicPackage,
  listPackagesForPublisher,
  listPublicCatalog,
  listReviewStages,
  listVersions,
  publishVersion,
  setListingState,
  submitVersion,
} from '../../application/developer/extensionPackages';
import {
  listDirectoryCategories,
  searchDirectory,
} from '../../application/developer/catalogSearch';
import { publisherAnalytics } from '../../application/developer/installAnalytics';
import {
  installPackage,
  listInstalls,
  previewInstall,
  uninstallPackage,
  updateInstall,
} from '../../application/developer/extensionInstalls';
import { pricingForPackage, setPackagePlans } from '../../application/developer/extensionPlans';
import { payoutPublisherBalance, publisherEarnings } from '../../application/developer/extensionEarnings';
import { partnerStandingFor } from '../../application/developer/partnerPrograms';
import {
  cancelPlan,
  completePlanCheckout,
  startPlanCheckout,
} from '../../application/developer/extensionCommerce';
import { openPeriodFor } from '../../application/developer/extensionBilling';
import { usageEvents } from '../../application/developer/extensionUsage';
import { parseBody, z, zNonEmptyString, zPositiveInt } from './requestBody';

const RegisterPublisherBody = z.object({
  website: z.string().optional(),
  supportEmail: z.string().optional(),
});

const VerifyDomainBody = z.object({
  domain: zNonEmptyString,
});

/** `kind` is checked against `SUBMITTABLE_KINDS` by the service, which owns that vocabulary. */
const CreatePackageBody = z.object({
  kind: zNonEmptyString,
  name: zNonEmptyString,
  slug: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
  docsUrl: z.string().nullable().optional(),
});

/** The spec is untrusted and reviewed by the pipeline; the scopes are checked against the contract there. */
const SubmitVersionBody = z.object({
  semver: zNonEmptyString,
  spec: z.record(z.string(), z.unknown()).optional(),
  requestedScopes: z.array(z.string()).optional(),
  changelog: z.string().nullable().optional(),
});

const PublishVersionBody = z.object({
  versionId: zNonEmptyString,
});

const ListingStateBody = z.object({
  state: z.enum(LISTING_STATES),
});

const InstallBody = z.object({
  packageId: zNonEmptyString,
  approvedScopes: z.array(z.string()).optional(),
  connectionId: z.string().nullable().optional(),
});

/** `plans` is untrusted: parsed and clamped by `parseExtensionPlans`, never stored raw. */
const SetPlansBody = z.object({
  plans: z.array(z.unknown()).optional(),
  currency: z.string().optional(),
});

const PayoutDestinationBody = z.object({
  connectionId: zPositiveInt.nullable().optional(),
});

const StartCheckoutBody = z.object({
  packageId: zNonEmptyString,
  planCode: zNonEmptyString,
  approvedScopes: z.array(z.string()).optional(),
  returnUrl: zNonEmptyString,
});

const CompleteCheckoutBody = z.object({
  checkoutSessionId: zNonEmptyString,
});

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

  // ── Publisher ─────────────────────────────────────────────────────────────

  router.get('/publisher', async (c) => {
    const { tenantId, env } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ publisher: await publisherFor(db, env, tenantId) });
  });

  router.post('/publisher', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, RegisterPublisherBody);
    const publisher = await becomePublisher(db, env, {
      tenantId,
      userId,
      website: body.website ?? null,
      supportEmail: body.supportEmail ?? null,
    });
    return c.json({ publisher }, 201);
  });

  router.post('/publisher/verify-domain', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, VerifyDomainBody);
    const challenge = await beginDomainVerification(db, env, {
      tenantId,
      userId,
      domain: body.domain,
    });
    return c.json({ challenge });
  });

  /**
   * POST /publisher/verify-domain/check — perform the DNS lookup NOW.
   *
   * The scheduled sweep gets there on its own, but a publisher who has just added
   * the TXT record wants to know in the next few seconds, not the next few minutes.
   * Same call the sweep makes, so the two can never disagree about what counts as
   * verified. `manager` because it is the same authority that STARTED the claim.
   */
  router.post('/publisher/verify-domain/check', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    await requirePublisher(db, tenantId, userId, 'manager');
    const result = await verifyPublisherDomain(db, env, tenantId);
    return c.json(result);
  });

  // ── Packages ──────────────────────────────────────────────────────────────

  router.get('/packages', async (c) => {
    const { userId, tenantId } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ packages: await listPackagesForPublisher(db, tenantId, userId) });
  });

  router.post('/packages', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, CreatePackageBody);
    const pkg = await createPackage(db, env, {
      tenantId,
      actorUserId: userId,
      kind: body.kind,
      name: body.name,
      slug: body.slug,
      tagline: body.tagline,
      description: body.description ?? null,
      categories: body.categories,
      docsUrl: body.docsUrl ?? null,
    });
    return c.json({ package: pkg }, 201);
  });

  router.get('/packages/:id/versions', async (c) => {
    const { userId } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ versions: await listVersions(db, c.req.param('id'), userId) });
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
    const body = await parseBody(c, SubmitVersionBody);
    const { version, approved } = await submitVersion(db, env, {
      packageId: c.req.param('id'),
      actorUserId: userId,
      semver: body.semver,
      spec: body.spec ?? {},
      requestedScopes: body.requestedScopes ?? [],
      changelog: body.changelog ?? null,
    });
    return c.json({ version, approved }, 201);
  });

  router.post('/packages/:id/publish', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, PublishVersionBody);
    const pkg = await publishVersion(db, env, {
      packageId: c.req.param('id'),
      versionId: body.versionId,
      actorUserId: userId,
    });
    return c.json({ package: pkg });
  });

  router.post('/packages/:id/listing', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, ListingStateBody);
    const pkg = await setListingState(db, env, {
      packageId: c.req.param('id'),
      actorUserId: userId,
      state: body.state,
    });
    return c.json({ package: pkg });
  });

  // ── Directory ─────────────────────────────────────────────────────────────
  //
  // Separate from `/catalog` and not a replacement for it. `/catalog` returns the
  // whole listed set and is what the `/integrations` projection merges onto our
  // own ports; this answers a PERSON's question, which is narrower, ordered and
  // paged. One of them would have to be two endpoints anyway, so they are two.

  router.get('/directory/categories', async (c) => {
    const { env } = ctx(c);
    return c.json({ categories: await listDirectoryCategories(db, env) });
  });

  router.get('/directory', async (c) => {
    const { env } = ctx(c);
    const q = c.req.query();
    // Every bound is applied inside `searchDirectory` (which normalizes once, for
    // both the query and its cache key) rather than here, so a second caller
    // cannot pass a limit this route would have rejected.
    const result = await searchDirectory(db, env, {
      query: q.q ?? null,
      category: q.category ?? null,
      kind: q.kind ?? null,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
    return c.json(result);
  });

  // ── Review evidence ───────────────────────────────────────────────────────
  //
  // Addressed by VERSION id rather than nested under a package, because a version
  // id already determines its package and a path that repeated both would let a
  // caller pass a mismatched pair for the service to reconcile. Authority is
  // resolved from the version's package inside `listReviewStages`.

  router.get('/versions/:versionId/review', async (c) => {
    const { userId } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ stages: await listReviewStages(db, c.req.param('versionId'), userId) });
  });

  // ── Analytics ─────────────────────────────────────────────────────────────
  //
  // No id in the path: the publisher is the caller's workspace, on the JWT. The
  // response is AGGREGATE ONLY and cannot be asked to be otherwise — the boundary
  // and the reasoning are at the top of `installAnalytics.ts`.

  router.get('/analytics', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ analytics: await publisherAnalytics(db, env, tenantId, userId) });
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
    return c.json({ preview: await previewInstall(db, { tenantId, packageId: c.req.param('packageId') }) });
  });

  router.post('/installs', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, InstallBody);
    const install = await installPackage(db, env, {
      tenantId,
      packageId: body.packageId,
      userId,
      approvedScopes: body.approvedScopes ?? [],
      connectionId: body.connectionId ?? null,
    });
    return c.json({ install }, 201);
  });

  router.post('/installs/:id/update', async (c) => {
    const { tenantId, env } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    const install = await updateInstall(db, env, { tenantId, installId: c.req.param('id') });
    return c.json({ install });
  });

  router.delete('/installs/:id', async (c) => {
    const { tenantId, env } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    await uninstallPackage(db, env, { tenantId, installId: c.req.param('id') });
    return c.json({ ok: true });
  });

  // ── Plans (PRD 24 Phase 2 — the publisher's price list) ───────────────────
  //
  // Nested under the package because a price list belongs to exactly one listing
  // and has no identity apart from it — the same reason it is a `body` on that
  // listing's `catalog_items` row rather than a table of its own.

  router.get('/packages/:id/plans', async (c) => {
    const { userId } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ pricing: await pricingForPackage(db, c.req.param('id')) });
  });

  /**
   * PUT, not POST: the price list is replaced as a whole. Per-plan mutations
   * would need their own ordering, their own conflict story and their own answer
   * to "what happens to the installs on the plan you just deleted" — three
   * problems that do not exist when the caller states the list it wants.
   */
  router.put('/packages/:id/plans', async (c) => {
    const { userId, env } = ctx(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, SetPlansBody);
    const pricing = await setPackagePlans(db, env, {
      packageId: c.req.param('id'),
      actorUserId: userId,
      plans: body.plans ?? [],
      currency: body.currency,
    });
    return c.json({ pricing });
  });

  // ── Earnings and payout ───────────────────────────────────────────────────
  //
  // No id in the path: the publisher is the caller's workspace, on the JWT. The
  // BALANCE is the workspace's and not a person's, which is what makes an
  // extension's revenue survive the person who shipped it leaving.

  router.get('/earnings', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    await requirePublisher(db, tenantId, userId, 'manager');
    return c.json({ earnings: await publisherEarnings(db, env, tenantId) });
  });

  /**
   * Nominate the connection this workspace's revenue is paid to.
   *
   * A workspace has no `connections.user_id` of its own, so it names its
   * destination explicitly rather than having one inferred from whoever pressed
   * the button — which would send a company's revenue to an employee.
   */
  router.post('/earnings/destination', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, PayoutDestinationBody);
    // `owner`: this decides where the workspace's money leaves to, which is
    // the highest-consequence action in this router.
    await requirePublisher(db, tenantId, userId, 'owner');
    return c.json({
      publisher: await setPayoutDestination(db, env, {
        tenantId,
        userId,
        connectionId: body.connectionId ?? null,
      }),
    });
  });

  router.post('/earnings/payout', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    await requirePublisher(db, tenantId, userId, 'owner');
    // The amount is the AVAILABLE balance computed server-side, never a number
    // from the request: an endpoint that accepts an amount pays whatever a
    // crafted request asks for.
    const result = await payoutPublisherBalance(db, env, tenantId);
    return c.json(result, result.ok ? 200 : 409);
  });

  // ── Programs (PRD 24 Phase 4) ─────────────────────────────────────────────
  //
  // Read-only here on purpose. Joining a track is an operator decision
  // (`POST /api/admin/publishers/:tenantId/track`) because §2.1's funnel has a
  // human at the top and Featured placement's whole value is that not everybody
  // has it. What a publisher may do is READ what the tracks offer, which is
  // information they need before deciding whether to ask.

  router.get('/programs', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ standing: await partnerStandingFor(db, env, tenantId, userId) });
  });

  // ── Paid installs (PRD 24 §5.4 — the Vercel move) ─────────────────────────
  //
  // Separate from `POST /installs`, which installs a FREE package. A paid one
  // cannot go through that door: installing first would leave a workspace holding
  // a live scope grant on an extension nobody has paid for. The scopes the admin
  // approved ride through the checkout instead, and the install is created when
  // the money is confirmed — so an abandoned checkout leaves nothing behind.

  router.post('/installs/checkout', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, StartCheckoutBody);
    const start = await startPlanCheckout(db, env, {
      tenantId,
      userId,
      packageId: body.packageId,
      planCode: body.planCode,
      approvedScopes: body.approvedScopes ?? [],
      returnUrl: body.returnUrl,
    });
    return c.json(start);
  });

  router.post('/installs/checkout/complete', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    const body = await parseBody(c, CompleteCheckoutBody);
    const subscription = await completePlanCheckout(db, env, {
      tenantId,
      userId,
      checkoutSessionId: body.checkoutSessionId,
    });
    return c.json({ subscription });
  });

  /**
   * Stop paying, without uninstalling.
   *
   * The open metered period is closed first — cancelling without billing what has
   * already been consumed would hand the customer a free month by pressing Cancel
   * on its last day, and hand the vendor the bill.
   */
  router.post('/installs/:id/cancel-plan', async (c) => {
    const { userId, tenantId, env } = ctx(c);
    if (!userId || !tenantId) return c.json({ error: 'Authentication required' }, 401);
    await cancelPlan(db, env, { tenantId, installId: c.req.param('id') });
    return c.json({ ok: true });
  });

  /**
   * What the open metered period looks like RIGHT NOW.
   *
   * The number a customer wants before the invoice rather than on it, which is
   * the whole reason usage-based billing frightens people. Computed through the
   * same pricing function the period close uses, so the figure shown mid-month
   * and the figure charged at the end cannot be derived two different ways.
   */
  router.get('/installs/:id/usage', async (c) => {
    const { tenantId } = ctx(c);
    if (!tenantId) return c.json({ error: 'Authentication required' }, 401);
    const installId = c.req.param('id');
    const period = await openPeriodFor(db, tenantId, installId);
    if (!period) return c.json({ error: 'install not found' }, 404);
    return c.json({
      period,
      // The individual reports behind the total — what a disputed line is settled
      // with. Bounded: the answer to "what are these 40,000 units" is not 40,000
      // rows in one response.
      events: await usageEvents(db, tenantId, installId, period.since ? new Date(period.since) : null, 100),
    });
  });

  return router;
}
